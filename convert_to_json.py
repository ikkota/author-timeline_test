import pandas as pd
import json
import re
import os

INPUT_FILE = "author_metadata_final.xlsx"
OUTPUT_FILE = "public/data/authors.json"

def clean_value(val):
    """Returns cleaned string or None if empty/garbage."""
    if pd.isna(val):
        return None
    s = str(val).strip()
    if not s:
        return None
    # User constraint: Remove URL-like garbage
    if "http" in s or ".org" in s or "/" in s and len(s) > 20: # heuristic
        return None
    return s

def parse_year(date_str):
    """
    Parses a string into an integer year (start, end).
    Handles:
    - "-450" -> -450, -450
    - "c. -450" -> -450, -450 (Point approximation)
    - "5th century BC" -> -500, -400
    - "1st century" -> 0, 100 (Default to AD per instruction for unknown)
    """
    if not date_str:
        return None, None

    date_str = date_str.lower().replace('cl.', 'c.').replace('fl.', '').strip()
    
    # Check for Century
    # "5th century bc"
    century_match = re.search(r'(\d+)(?:st|nd|rd|th)?\s+century', date_str)
    if century_match:
        cent = int(century_match.group(1))
        is_bc = 'bc' in date_str or 'b.c.' in date_str or 'bce' in date_str
        
        if is_bc:
            # 5th century BC = -500 to -400 (roughly)
            # - (Cent * 100) to - ((Cent-1) * 100)
            start = -(cent * 100)
            end = -((cent - 1) * 100)
             # Fix for 1st century BC: -100 to 0
        else:
            # 5th century AD = 401 to 500. Simplified: (Cent-1)*100 to Cent*100
            start = (cent - 1) * 100
            end = cent * 100
            
        return start, end

    # Check for simple year
    # Extract first sequence of digits
    # Handle negative sign
    
    # Try to find a year number
    # Remove 'c.'
    clean_s = date_str.replace('c.', '').strip()
    
    # Check for "BC" suffix in year like "450 BC"
    is_bc_year = 'bc' in clean_s or 'bce' in clean_s
    
    # Find digits
    digits = re.search(r'\d+', clean_s)
    if digits:
        val = int(digits.group(0))
        if '-' in clean_s and not is_bc_year: # "-450"
             # Check if minus is before digits
             if re.search(r'-\s*\d', clean_s):
                 val = -val
        
        if is_bc_year:
            val = -val
            
        return val, val
        
    return None, None

def main():
    print(f"Reading {INPUT_FILE}...")
    if not os.path.exists(INPUT_FILE):
        print("Input file not found.")
        return

    df = pd.read_excel(INPUT_FILE)
    
    # Identify columns
    # We expect Name, Birth, Death, Floruit
    # Map them safely
    cols = df.columns
    # Basic mapping
    name_col = next((c for c in cols if 'Name' in str(c)), 'Name')
    birth_col = next((c for c in cols if 'Birth' in str(c)), 'Birth')
    death_col = next((c for c in cols if 'Death' in str(c)), 'Death')
    floruit_col = next((c for c in cols if 'Floruit' in str(c)), 'Floruit')

    output_data = []
    
    for idx, row in df.iterrows():
        name = clean_value(row.get(name_col))
        qid = clean_value(row.get('QID')) or f"row_{idx}"
        
        raw_b = clean_value(row.get(birth_col))
        raw_d = clean_value(row.get(death_col))
        raw_f = clean_value(row.get(floruit_col))
        
        # Skip if totally empty
        if not raw_b and not raw_d and not raw_f:
            continue
            
        item = {
            "id": qid,
            "content": name or "Unknown", # Fallback name
            "title": f"Birth: {raw_b or '?'} / Death: {raw_d or '?'}" # Tooltip
        }
        
        b_start, b_end = parse_year(raw_b)
        d_start, d_end = parse_year(raw_d)
        
        # Logic: Birth/Death Priority
        if b_start is not None or d_start is not None:
            # We have at least one birth or death date
            
            # Start
            if b_start is not None:
                item["start"] = b_start
            else:
                # No birth, but have death.
                # Use death as start? Or make it a point at death?
                # Vis.js range needs start.
                # If only death is known, display as point?
                item["start"] = d_start # Treat as point
            
            # End
            if d_start is not None:
                item["end"] = d_start
            
            # Determine type
            if b_start is not None and d_start is not None:
                 item["type"] = "range"
            else:
                 item["type"] = "point"
            
            item["source"] = "birth-death"
            
            # Class name for styling
            is_approx = 'c.' in str(raw_b) or 'c.' in str(raw_d) or 'century' in str(raw_b) or 'century' in str(raw_d)
            item["className"] = "approx" if is_approx else "exact"
            
            # Handle century range in Birth alone?
            # If Birth is "5th century BC" (-500 to -400) and Death is empty.
            # We should probably show that range?
            # But "start" and "end" in Vis.js define the ITEM placement.
            # If we set start=-500, end=-400, it looks like he lived for 100 years.
            # Which is true-ish (he lived *in* that time).
            # If we have Birth Range AND Death Range, it gets complex.
            # Simple approach: Start = Birth Start, End = Death End (or Start if point).
            
            # Refinement for Century:
            # If parse_year returned a range (start!=end) for Birth, use that if Death blank.
            if b_start != b_end and raw_d is None:
                 item["start"] = b_start
                 item["end"] = b_end
                 item["type"] = "range"
                 item["className"] = "approx century"

        elif raw_f:
            # Only Floruit
            item["source"] = "floruit"
            item["title"] = f"Floruit: {raw_f}"
            
            f_start, f_end = parse_year(raw_f)
            if f_start is not None:
                if f_start != f_end:
                    # It was a century or range already
                    item["start"] = f_start
                    item["end"] = f_end
                else:
                    # Point year, expand to +/- 10
                    item["start"] = f_start - 10
                    item["end"] = f_end + 10
                
                item["type"] = "range" # Always range for floruit visibility
                item["className"] = "floruit"
            else:
                # Could not parse floruit
                continue

        # Add to list
        output_data.append(item)

    # Save
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {len(output_data)} items to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
