import pandas as pd
import requests
import re
import sys
import time
import concurrent.futures
import urllib.parse
import os
from bs4 import BeautifulSoup

# Configuration
INPUT_FILE = "author_metadata_refined.xlsx"
OUTPUT_FILE = "author_metadata_wikipedia.xlsx"
PARTIAL_FILE = "author_metadata_wikipedia_partial.csv"
WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
# Initial list of languages to check. English is usually most structured, Japanese requested too.
LANG_PRIORITY = ['en', 'ja', 'fr', 'de', 'it', 'es'] 

def get_sitelinks(qids):
    """
    Fetches sitelinks for a batch of QIDs.
    Returns dict: {qid: {lang: title, ...}}
    """
    if not qids: return {}
    values = " ".join([f"wd:{q}" for q in qids])
    
    query = f"""
    SELECT ?q ?sitelink ?site WHERE {{
      VALUES ?q {{ {values} }}
      ?sitelink schema:about ?q .
      ?sitelink schema:isPartOf ?site .
      FILTER(STRSTARTS(STR(?site), "https://en.wikipedia.org/") || STRSTARTS(STR(?site), "https://ja.wikipedia.org/") || STRSTARTS(STR(?site), "https://fr.wikipedia.org/") || STRSTARTS(STR(?site), "https://de.wikipedia.org/") || STRSTARTS(STR(?site), "https://it.wikipedia.org/") || STRSTARTS(STR(?site), "https://es.wikipedia.org/"))
    }}
    """
    try:
        r = requests.get(WIKIDATA_ENDPOINT, params={'format': 'json', 'query': query}, headers={'User-Agent': 'Bot/0.1'})
        r.raise_for_status()
        results = r.json()['results']['bindings']
        
        links = {q: {} for q in qids}
        for item in results:
            qid = item['q']['value'].split('/')[-1]
            url = item['sitelink']['value']
            # parse language from URL (https://xx.wikipedia.org/...)
            lang = url.split('//')[1].split('.')[0]
            # title is last part of URL (unquoted) or we can get title from elsewhere, 
            # but Wikipedia API takes titles or we can just query by pageid if we had it.
            # actually we can query by title. Title is decoded from URL path.
            title = urllib.parse.unquote(url.split('/wiki/')[-1])
            if qid in links:
                links[qid][lang] = {'url': url, 'title': title}
        return links
    except Exception as e:
        print(f"Sitelink fetch error: {e}")
        return {}

def clean_text(text):
    # Remove references [1][2]...
    text = re.sub(r'\[\d+\]', '', text)
    # Remove pronunciation / extra parens if nested? No, keep context.
    # Just basic cleanup.
    return text.strip()

def split_sentences(text):
    # Simple sentence splitter. 
    # Handle ".", "!", "?" followed by space and capital letter or end of string.
    # (Simplified)
    sentences = re.split(r'(?<=[.!?])\s+', text)
    return sentences

def extract_chronology(text, lang):
    """
    Extracts sentences relevant to chronology using regex keywords.
    Returns: extracted_text (str)
    """
    # Specific keywords for chronology
    keywords_en = r'born|died|active|flourish|century|BC|AD|BCE|CE|lived|c\.|circa|\b[1-9]\d{2,3}\b'
    keywords_ja = r'生|没|年|世紀|頃|活動|時代'
    # For others, simple century/year match?
    keywords_generic = r'\d{3,4}|century|siècle|jahrhundert'

    if lang == 'en': keywords = keywords_en
    elif lang == 'ja': keywords = keywords_ja
    else: keywords = keywords_generic
    
    sentences = split_sentences(clean_text(text))
    
    selected = []
    # Always take the first sentence! (Usually "Name (born... died...) was a ...")
    if sentences:
        first = sentences[0]
        selected.append(first)
        
        # Look for 1-2 more relevant sentences immediately following?
        # Or scan remaining? 
        # User said: "関連する連続した2〜3文まで可" (Continuous relevant 2-3 sentences allowed).
        # "生没年に関する記述" (Description about birth/death).
        
        count = 1
        for s in sentences[1:]:
            if count >= 3: break
            if re.search(keywords, s, re.IGNORECASE):
                selected.append(s)
                count += 1
            else:
                # If we encounter a sentence that doesn't look like chronology, maybe stop if we want *continuous*?
                # User: "関連する連続した" (Connected/Continuous). 
                # If sentence 2 is "He wrote many books." (No chronology), do we skip it and look at 3?
                # Usually chronology is at the very top.
                # Let's keep scanning for a bit but prioritize early sentences.
                pass
                
    return " ".join(selected)

def fetch_wikipedia_content(title, lang):
    """
    Fetches first paragraph of introduction.
    """
    endpoint = f"https://{lang}.wikipedia.org/w/api.php"
    params = {
        'action': 'query',
        'format': 'json',
        'prop': 'extracts',
        'titles': title,
        'exintro': 1,
        'explaintext': 1, # Plain text
        'redirects': 1
    }
    try:
        r = requests.get(endpoint, params=params, headers={'User-Agent': 'Bot/0.1'}, timeout=10)
        data = r.json()
        pages = data['query']['pages']
        for pid, val in pages.items():
            if pid == '-1': return None
            return val.get('extract', '')
    except Exception as e:
        print(f"Wiki fetch error ({lang}:{title}): {e}")
        return None

def main():
    print(f"Reading {INPUT_FILE}...")
    try:
        df = pd.read_excel(INPUT_FILE)
    except FileNotFoundError:
        print("Input file not found.")
        sys.exit(1)
        
    # We need QID column 'QID' inside, or 'Work QID' that we renamed? 
    # Previous script output 'QID' as column name.
    # Check columns
    qid_col = 'QID' if 'QID' in df.columns else 'Work QID' # Fallback
    
    # Check partial
    processed_qids = set()
    if os.path.exists(PARTIAL_FILE):
        try:
            partial = pd.read_csv(PARTIAL_FILE)
            processed_qids = set(partial['QID'].unique())
            print(f"Resuming with {len(processed_qids)} processed.")
        except: pass
        
    qids = df[qid_col].dropna().unique()
    valid_qids = [q for q in qids if str(q).startswith('Q') and q not in processed_qids]
    
    if not os.path.exists(PARTIAL_FILE) or len(processed_qids) == 0:
        pd.DataFrame(columns=['QID', 'WP_language', 'WP_source_url', 'WP_section', 'WP_raw_chronology_text']).to_csv(PARTIAL_FILE, index=False)

    BATCH = 20
    
    batches = [valid_qids[i:i+BATCH] for i in range(0, len(valid_qids), BATCH)]
    
    print(f"Processing {len(valid_qids)} items in {len(batches)} batches...")
    
    for batch in batches:
        # 1. Get sitelinks for batch
        links_map = get_sitelinks(batch)
        
        rows = []
        
        # 2. For each QID, pick best language and fetch text
        # Using ThreadPool for Wikipedia content fetching
        
        def process_single(qid):
            sitelinks = links_map.get(qid, {})
            if not sitelinks:
                return {'QID': qid, 'WP_language': '', 'WP_source_url': '', 'WP_section': '', 'WP_raw_chronology_text': ''}
            
            # Select priority language
            target_lang = None
            target_info = None
            
            for lang in LANG_PRIORITY:
                if lang in sitelinks:
                    target_lang = lang
                    target_info = sitelinks[lang]
                    break
            
            if not target_lang: # Pick any
                target_lang = list(sitelinks.keys())[0]
                target_info = sitelinks[target_lang]
                
            # Fetch content
            raw_text = fetch_wikipedia_content(target_info['title'], target_lang)
            
            if raw_text:
                extracted = extract_chronology(raw_text, target_lang)
            else:
                extracted = ""
                
            return {
                'QID': qid,
                'WP_language': target_lang,
                'WP_source_url': target_info['url'],
                'WP_section': 'Introduction',
                'WP_raw_chronology_text': extracted
            }

        with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
            future_to_qid = {executor.submit(process_single, qid): qid for qid in batch}
            for future in concurrent.futures.as_completed(future_to_qid):
                try:
                    res = future.result()
                    rows.append(res)
                except Exception as e:
                    print(f"Worker error: {e}")
        
        # Append to CSV
        pd.DataFrame(rows).to_csv(PARTIAL_FILE, mode='a', header=False, index=False)
        print(f"Processed batch of {len(batch)}.")
        time.sleep(1)

    # Merge with original
    print("Merging and saving...")
    partial_df = pd.read_csv(PARTIAL_FILE)
    
    # Merge on QID
    merged = pd.merge(df, partial_df, left_on=qid_col, right_on='QID', how='left')
    if 'QID_y' in merged.columns: merged.drop(columns=['QID_y'], inplace=True)
    if 'QID_x' in merged.columns: merged.rename(columns={'QID_x': qid_col}, inplace=True)

    merged.to_excel(OUTPUT_FILE, index=False)
    print("Done.")

if __name__ == "__main__":
    main()
