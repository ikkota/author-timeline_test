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

    return None, None

def ensure_display_range(birth_year, death_year, point_year=None):
    """
    表示用に必ず(start,end)レンジを返す。
    - birth & death 両方ある -> exact
    - birthのみ -> +50年 (inferred)
    - deathのみ -> -50年 (inferred)
    - pointのみ -> ±25年 (inferred)
    戻り値: (start_year, end_year, className)
    """
    # 1) birth & death が両方ある
    if birth_year is not None and death_year is not None:
        # 同一年なら単一点扱いにして ±25（ユーザー要望）
        if birth_year == death_year:
            y = birth_year
            return y - 25, y + 25, "inferred"
        return birth_year, death_year, "exact"

    # 2) birthのみ
    if birth_year is not None and death_year is None:
        return birth_year, birth_year + 50, "inferred"

    # 3) deathのみ
    if birth_year is None and death_year is not None:
        return death_year - 50, death_year, "inferred"

    # 4) pointのみ（例：floruit だけ）
    if point_year is not None:
        return point_year - 25, point_year + 25, "inferred"

    # 5) 何もない
    return None, None, None

def build_tooltip(raw_birth, raw_death, raw_floruit, class_name):
    """
    tooltipの内容を作る。
    - inferred（便宜レンジ）は表示しない（空文字）
    - exact は元文字列を表示（便宜数値は出さない）
    """
    if class_name == "inferred":
        return ""

    parts = []
    rb = (raw_birth or "").strip()
    rd = (raw_death or "").strip()
    rf = (raw_floruit or "").strip()

    if rb:
        parts.append(f"Birth: {rb}")
    if rd:
        parts.append(f"Death: {rd}")

    # Birth/DeathがなくFloruitだけの場合に表示したいなら以下ON
    if (not rb and not rd) and rf:
        parts.append(f"Floruit: {rf}")

    return " / ".join(parts)

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
            
        raw_occ = clean_value(row.get('Occupation'))
        occupations = [o.strip() for o in raw_occ.split(',')] if raw_occ else []
        
        if raw_occ:
            print(f"Occupation found for {qid}: {raw_occ}")
        
        # Priority Logic for Primary Occupation
        # Lower index = Higher priority
        priority_keywords = [
            # Philosophy & Theology
            '哲学者', 'philosopher', '神学者', 'theologian', 'ソフィスト', 'sophist',
            # Science & Math
            '数学者', 'mathematician', '天文学者', 'astronomer', '物理学者', 'physicist', 
            '医師', 'physician', '地理学者', 'geographer', 'music theorist', '音楽理論家',
            # Literature (Poetry/Drama) - Specific over generic
            '詩人', 'poet', '劇作家', 'playwright', '悲劇作家', 'tragedian', '喜劇作家', 'comedian',
            'epigrammatist', 'エピグラマティスト',
            # History
            '歴史家', 'historian', 'annalist', 'biographer', '伝記作家',
            # Rhetoric & Grammar
            '雄弁家', 'orator', '修辞学者', 'rhetorician', '文法学者', 'grammarian', 
            '司書', 'librarian', 'musicologist', '音楽学者',
            # Public Life
            '政治家', 'politician', '軍人', 'military personnel', '弁護士', 'lawyer',
            # Generic (Last Resort)
            '著作家', 'writer'
        ]
        
        primary_occ = occupations[0] if occupations else None
        
        if occupations:
            best_rank = 999
            for o in occupations:
                otilde = o.lower().strip()
                found = False
                for i, k in enumerate(priority_keywords):
                    if k.lower() in otilde:
                        if i < best_rank:
                            best_rank = i
                            primary_occ = o
                        found = True
                        break
        
        # Parse Years
        b_start, b_end = parse_year(raw_b)
        d_start, d_end = parse_year(raw_d)
        f_start, f_end = parse_year(raw_f)
        
        # Determine Display Range
        # For birth/death, we use the "start" of the parsed range if available
        # If parse_year returned a range (e.g. 5th century BC -> -500, -400), 
        # we generally use the start/end of that for the "Exact" logic?
        # User spec says: "Birthのみ -> end = birth + 50". this implies simple year handling.
        # But our parse_year returns (start, end).
        # Let's use the 'start' component for single-year logic if they are equal, 
        # or just pass the start/end to ensure_display_range if we want to support range-input-dates later.
        # ALLOW SIMPLIFICATION:
        # Use simple integer years for range calculation. 
        # If parse_year returned a specific year (start==end), use that.
        # If it returned a range (century), use the center? Or just Start?
        # Current logic uses b_start / d_start. Let's stick to that for now to match prior behavior logic
        
        # Use b_start (e.g. -500) as the "Birth Year"
        b_val = b_start if b_start is not None else None
        d_val = d_start if d_start is not None else None
        # For floruit, if it's a range (-500, -400), maybe take average? Or just start?
        # User said "point (floruit) -> ±25".
        # Let's use f_start.
        f_val = f_start if f_start is not None else None
        
        # Special case: If parse_year returned a range (century), it is effectively "inferred" / approx?
        # The user requirement "ensure_display_range" seems to target MISSING dates.
        # If we have "5th century BC", we DO have dates (-500, -400).
        # But the user logic is specific.
        # Let's strictly follow the user's "ensrue_display_range" logic.
        
        start, end, className = ensure_display_range(b_val, d_val, point_year=f_val)
        
        # Skip if completely invalid
        if start is None or end is None:
            continue
            
        # Build Tooltip
        tooltip = build_tooltip(raw_b, raw_d, raw_f, className)
        
        item = {
            "id": qid,
            "content": name or "Unknown", # Fallback name
            "start": start,
            "end": end,
            "className": className,
            "occupations": occupations,
            "primary_occupation": primary_occ
        }
        
        # Only add title if it exists (inferred => empty)
        if tooltip:
             item["title"] = tooltip
             
        # Type is always range now due to start/end logic, unless ensuring point specifically?
        # Vis.js handles start/end as range automatically.
        item["type"] = "range"

        # Add to list
        output_data.append(item)

    # Save
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {len(output_data)} items to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
