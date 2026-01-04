import pandas as pd
import requests
import re
import sys
import time
import os
import concurrent.futures
from datetime import datetime

# Configuration
INPUT_FILE = "matadata with wikidata.xlsx"
OUTPUT_FILE = "author_metadata_refined.xlsx"
PARTIAL_FILE = "author_metadata_refined_partial.csv"
WIKIDATA_ENDPOINT = "https://query.wikidata.org/sparql"
BATCH_SIZE = 40 # Reduced batch size due to complex query

def find_qid_column(df):
    potential_cols = [c for c in df.columns if re.search(r'wiki|qid', str(c), re.IGNORECASE)]
    for col in potential_cols:
        sample = df[col].dropna().astype(str)
        if sample.str.match(r'^Q\d+$').any():
            return col
    for col in df.columns:
        if col in potential_cols: continue
        try:
            sample = df[col].dropna().astype(str)
            if not sample.empty and (sample.str.match(r'^Q\d+$').sum() / len(sample) > 0.5):
                 return col
        except Exception:
            continue
    return None

def format_date_value(date_str, precision=11, circumstance=None, earliest=None, latest=None):
    """
    Formats a date based on precision and qualifiers.
    Precision: 11=day, 10=month, 9=year, 8=decade, 7=century
    Circumstance: Q5727902 -> circa
    """
    if not date_str:
        return None

    # Parse ISO date
    try:
        if date_str.startswith('-'):
            is_bc = True
            parts = date_str[1:].split('-')
            year = -int(parts[0])
        else:
            is_bc = False
            parts = date_str.split('-')
            year = int(parts[0])
    except:
        return date_str # Fallback

    # Basic formatting
    if precision is not None:
        try:
            precision = int(precision)
        except:
            precision = 9
    
    formatted = str(year)
    
    if precision <= 7: # Century
        # 450 -> 5th century
        century = (abs(year) - 1) // 100 + 1
        suffix = "BC" if year < 0 else "AD"
        formatted = f"{century}th century {suffix}"
    elif precision == 8: # Decade
        formatted = f"{year}s"
    
    # Qualifiers
    prefix = ""
    suffix = ""
    
    # Circa (P1480 = Q5727902)
    if 'Q5727902' in str(circumstance):
        prefix = "c. "
    
    # Range fallback
    if earliest and latest and not date_str:
        # If we didn't have a main date but have range (unlikely with this logic, 
        # but if main date is just a placeholder)
        pass 
    
    return f"{prefix}{formatted}{suffix}"

def extract_year(date_str):
    if not date_str: return None
    try:
        if date_str.startswith('-'):
            return str(-int(date_str[1:].split('-')[0]))
        return str(int(date_str.split('-')[0]))
    except:
        return None

def fetch_wikidata_batch(qids):
    if not qids: return {}
    values_clause = " ".join([f"wd:{qid}" for qid in qids])
    
    # Complex query to get qualifiers
    # We grab the BEST ranked statement (wikibase:rank ?rank FILTER(?rank != wikibase:DeprecatedRank))
    # But for simplicity, we just grab ANY non-deprecated.
    
    query = f"""
    SELECT ?q ?label 
           ?birthDate ?birthPrec ?birthCirc ?birthEarly ?birthLate
           ?deathDate ?deathPrec ?deathCirc ?deathEarly ?deathLate
           ?floruitDate ?floruitPrec ?floruitCirc ?floruitEarly ?floruitLate
    WHERE {{
      VALUES ?q {{ {values_clause} }}
      
      # Label
      OPTIONAL {{ ?q rdfs:label ?label. FILTER(LANG(?label) = "en") }}

      # Birth
      OPTIONAL {{ 
        ?q p:P569 ?bStmt. 
        ?bStmt ps:P569 ?birthDate.
        OPTIONAL {{ ?bStmt psv:P569 ?bNode. ?bNode wikibase:timePrecision ?birthPrec. }}
        OPTIONAL {{ ?bStmt pq:P1480 ?birthCirc. }}
        OPTIONAL {{ ?bStmt pq:P1319 ?birthEarly. }}
        OPTIONAL {{ ?bStmt pq:P1326 ?birthLate. }}
      }}

      # Death
      OPTIONAL {{ 
        ?q p:P570 ?dStmt. 
        ?dStmt ps:P570 ?deathDate.
        OPTIONAL {{ ?dStmt psv:P570 ?dNode. ?dNode wikibase:timePrecision ?deathPrec. }}
        OPTIONAL {{ ?dStmt pq:P1480 ?deathCirc. }}
        OPTIONAL {{ ?dStmt pq:P1319 ?deathEarly. }}
        OPTIONAL {{ ?dStmt pq:P1326 ?deathLate. }}
      }}

      # Floruit
      OPTIONAL {{ 
        ?q p:P1317 ?fStmt. 
        ?fStmt ps:P1317 ?floruitDate.
        OPTIONAL {{ ?fStmt psv:P1317 ?fNode. ?fNode wikibase:timePrecision ?floruitPrec. }}
        OPTIONAL {{ ?fStmt pq:P1480 ?floruitCirc. }}
        OPTIONAL {{ ?fStmt pq:P1319 ?floruitEarly. }}
        OPTIONAL {{ ?fStmt pq:P1326 ?floruitLate. }}
      }}
    }}
    """
    
    try:
        response = requests.get(
            WIKIDATA_ENDPOINT, 
            params={'format': 'json', 'query': query},
            headers={'User-Agent': 'Bot/0.1 (mailto:contact@example.com)'},
            timeout=60
        )
        response.raise_for_status()
        return response.json()['results']['bindings']
    except Exception as e:
        print(f"Error fetching batch: {e}")
        return []

def main():
    print(f"Reading {INPUT_FILE}...")
    try:
        df = pd.read_excel(INPUT_FILE)
    except FileNotFoundError:
        print(f"Error: {INPUT_FILE} not found.")
        sys.exit(1)

    qid_col = find_qid_column(df)
    if not qid_col:
        # Fallback
        if df.iloc[:, 0].astype(str).str.match(r'^Q\d+$').any():
            qid_col = df.columns[0]
        else:
            print("ERROR: Could not find QID column.")
            sys.exit(1)
        
    print(f"Found QID column: '{qid_col}'")
    
    valid_qids = [q for q in df[qid_col].dropna().unique() if str(q).startswith('Q')]
    
    # Check resumption
    processed_qids = set()
    if os.path.exists(PARTIAL_FILE):
        print("Resuming...")
        try:
            partial = pd.read_csv(PARTIAL_FILE)
            processed_qids = set(partial['QID'].unique())
        except: 
            pass
            
    qids_to_process = [q for q in valid_qids if q not in processed_qids]
    print(f"Remaining QIDs: {len(qids_to_process)}")

    if not os.path.exists(PARTIAL_FILE) or len(processed_qids) == 0:
         pd.DataFrame(columns=[
             'QID', 'Name', 'Birth', 'Death', 'Floruit', 
             'Note', 'Raw_Data'
         ]).to_csv(PARTIAL_FILE, index=False)

    batches = [qids_to_process[i:i+BATCH_SIZE] for i in range(0, len(qids_to_process), BATCH_SIZE)]

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        future_to_batch = {executor.submit(fetch_wikidata_batch, batch): batch for batch in batches}
        
        for future in concurrent.futures.as_completed(future_to_batch):
            batch = future_to_batch[future]
            try:
                bindings = future.result()
                
                # Group by QID
                data_map = {q: [] for q in batch}
                for item in bindings:
                    q_val = item['q']['value'].split('/')[-1]
                    if q_val in data_map:
                        data_map[q_val].append(item)
                
                rows = []
                for qid in batch:
                    items = data_map[qid]
                    
                    if not items:
                        rows.append({
                            'QID': qid, 'Name': '', 'Birth': '', 'Death': '', 'Floruit': '',
                            'Note': 'QID not found in Wikidata or no labels/dates',
                            'Raw_Data': '{}'
                        })
                        continue

                    # Consolidate items check (multiple statements possible)
                    # We pick the first one that has data usually, or merge logic?
                    # For simplicity, we define a helper that extracts data from the "best" item
                    
                    # If multiple rows for same QID (e.g. multiple birth dates), 
                    # we often just take the first one returned by SPARQL (arbitrary unless ordered).
                    item = items[0]
                    
                    name = item.get('label', {}).get('value', '')
                    
                    def process_prop(prefix):
                        p_date = item.get(f'{prefix}Date', {}).get('value')
                        p_prec = item.get(f'{prefix}Prec', {}).get('value')
                        p_circ = item.get(f'{prefix}Circ', {}).get('value') # URI
                        p_early = item.get(f'{prefix}Early', {}).get('value')
                        p_late = item.get(f'{prefix}Late', {}).get('value')
                        
                        fmt = format_date_value(p_date, p_prec, p_circ, p_early, p_late)
                        
                        raw = {}
                        if p_date: raw['value'] = p_date
                        if p_prec: raw['precision'] = p_prec
                        if p_circ: raw['circumstance'] = p_circ
                        if p_early: raw['earliest'] = p_early
                        if p_late: raw['latest'] = p_late
                        
                        return fmt, raw

                    b_fmt, b_raw = process_prop('birth')
                    d_fmt, d_raw = process_prop('death')
                    f_fmt, f_raw = process_prop('floruit')
                    
                    raw_dump = {'birth': b_raw, 'death': d_raw, 'floruit': f_raw}
                    
                    note = ""
                    if not b_fmt and not d_fmt and not f_fmt:
                        note = "No date info found"
                    
                    rows.append({
                        'QID': qid,
                        'Name': name,
                        'Birth': b_fmt,
                        'Death': d_fmt,
                        'Floruit': f_fmt,
                        'Note': note,
                        'Raw_Data': str(raw_dump)
                    })

                pd.DataFrame(rows).to_csv(PARTIAL_FILE, mode='a', header=False, index=False)
                print(f"Processed batch of {len(batch)}.")
                
            except Exception as e:
                print(f"Batch failed: {e}")

    # Finalize
    print("Writing final Excel...")
    final = pd.read_csv(PARTIAL_FILE)
    final.to_excel(OUTPUT_FILE, index=False)
    print("Done.")

if __name__ == "__main__":
    main()
