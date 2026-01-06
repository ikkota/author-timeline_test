import pandas as pd
import requests
import time
import concurrent.futures

INPUT_FILE = "author_metadata_wikipedia.xlsx"
OUTPUT_FILE = "author_metadata_with_occ.xlsx"
WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"

def fetch_occupations_batch(qids):
    if not qids: return {}
    
    values = " ".join([f"wd:{q}" for q in qids])
    query = f"""
    SELECT ?q ?occupationLabel WHERE {{
      VALUES ?q {{ {values} }}
      ?q p:P106 ?stmt .
      ?stmt ps:P106 ?occupation .
      ?occupation rdfs:label ?occupationLabel .
      FILTER(LANG(?occupationLabel) = "ja" || LANG(?occupationLabel) = "en")
      SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ja,en". }}
    }}
    """
    try:
        r = requests.get(WIKIDATA_ENDPOINT, params={'format': 'json', 'query': query}, headers={'User-Agent': 'Bot/0.1'})
        r.raise_for_status()
        results = r.json()['results']['bindings']
        
        # Aggregate by QID
        occ_map = {q: set() for q in qids}
        for item in results:
            qid = item['q']['value'].split('/')[-1]
            label = item['occupationLabel']['value']
            if qid in occ_map:
                occ_map[qid].add(label)
        
        return {q: ", ".join(sorted(list(labels))) for q, labels in occ_map.items()}
    except Exception as e:
        print(f"Batch error: {e}")
        return {}

def main():
    print(f"Reading {INPUT_FILE}...")
    try:
        df = pd.read_excel(INPUT_FILE)
    except FileNotFoundError:
        print("Input file not found.")
        return

    # Find QID column
    qid_col = 'QID' if 'QID' in df.columns else 'Work QID'
    qids = df[qid_col].dropna().unique()
    valid_qids = [q for q in qids if str(q).startswith('Q')]
    
    print(f"Fetching occupations for {len(valid_qids)} QIDs...")
    
    BATCH_SIZE = 50
    batches = [valid_qids[i:i+BATCH_SIZE] for i in range(0, len(valid_qids), BATCH_SIZE)]
    
    all_occupations = {}
    
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        future_to_batch = {executor.submit(fetch_occupations_batch, batch): batch for batch in batches}
        
        for i, future in enumerate(concurrent.futures.as_completed(future_to_batch)):
            batch_res = future.result()
            all_occupations.update(batch_res)
            if i % 2 == 0:
                print(f"Processed batch {i+1}/{len(batches)}")
            time.sleep(0.5)

    # Map back to DataFrame
    print("Mapping to dataframe...")
    df['Occupation'] = df[qid_col].map(lambda x: all_occupations.get(x, ""))
    
    print(f"Saving to {OUTPUT_FILE}...")
    df.to_excel(OUTPUT_FILE, index=False)
    print("Done.")

if __name__ == "__main__":
    main()
