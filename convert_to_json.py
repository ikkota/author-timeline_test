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
    - "c. -450" -> -450, -450
    - "5th century BC" -> -500, -400
    - "1st century" -> 0, 100
    """
    if not date_str:
        return None, None

    date_str = date_str.lower().replace('cl.', 'c.').replace('fl.', '').strip()
    
    # Check for Century
    century_match = re.search(r'(\d+)(?:st|nd|rd|th)?\s+century', date_str)
    if century_match:
        cent = int(century_match.group(1))
        is_bc = 'bc' in date_str or 'b.c.' in date_str or 'bce' in date_str
        
        if is_bc:
            start = -(cent * 100)
            end = -((cent - 1) * 100)
        else:
            start = (cent - 1) * 100
            end = cent * 100
        return start, end

    # Check for simple year
    clean_s = date_str.replace('c.', '').strip()
    is_bc_year = 'bc' in clean_s or 'bce' in clean_s
    digits = re.search(r'\d+', clean_s)
    if digits:
        val = int(digits.group(0))
        if re.search(r'-\s*\d', clean_s) and not is_bc_year:
            val = -val
        if is_bc_year:
            val = -val
        return val, val
        
    return None, None

def get_display_rank(className):
    """Returns a score for the quality of the display range."""
    if className == "exact":
        return 100
    if className == "inferred_birth" or className == "inferred_death":
        return 70
    if className == "inferred_floruit":
        return 50
    return 0

def build_title_from_raw(rec):
    """
    Generates the 'title' tooltip string from consolidated raw data.
    """
    rb = rec.get("raw_birth_text") or ""
    rd = rec.get("raw_death_text") or ""
    rf = rec.get("raw_floruit_text") or ""
    
    parts = []
    if rb: parts.append(f"Birth: {rb}")
    if rd: parts.append(f"Death: {rd}")
    
    # If no birth/death but floruit exists
    if not parts and rf:
        parts.append(f"Floruit: {rf}")
        
    if parts:
        return " / ".join(parts)
    else:
        # Fallback for inferred items with NO raw text
        return "Dates inferred for visualization"

def main():
    print(f"Reading {INPUT_FILE}...")
    if not os.path.exists(INPUT_FILE):
        print("Input file not found.")
        return

    df = pd.read_excel(INPUT_FILE)
    cols = df.columns
    name_col = next((c for c in cols if 'Name' in str(c)), 'Name')
    birth_col = next((c for c in cols if 'Birth' in str(c)), 'Birth')
    death_col = next((c for c in cols if 'Death' in str(c)), 'Death')
    floruit_col = next((c for c in cols if 'Floruit' in str(c)), 'Floruit')
    wp_url_col = next((c for c in cols if 'WP_source_url' in str(c)), 'WP_source_url')

    by_id = {}
    
    for idx, row in df.iterrows():
        # 1. Basic properties
        qid = clean_value(row.get('QID')) or f"row_{idx}"
        name = clean_value(row.get(name_col)) or "Unknown"
        
        raw_b = clean_value(row.get(birth_col))
        raw_d = clean_value(row.get(death_col))
        raw_f = clean_value(row.get(floruit_col))
        
        # WP_source_url processing per user instruction
        wp_url = row.get(wp_url_col, None)
        if isinstance(wp_url, str):
            wp_url = wp_url.strip()
            if not wp_url or "http" not in wp_url:
                wp_url = None
        else:
            wp_url = None
        
        raw_occ_str = clean_value(row.get('Occupation'))
        current_occs = [o.strip() for o in raw_occ_str.split(',')] if raw_occ_str else []

        # 2. Parse Years & Determine Display Info for THIS row
        b_val, _ = parse_year(raw_b)
        d_val, _ = parse_year(raw_d)
        f_val, _ = parse_year(raw_f)
        
        row_start, row_end, row_class = None, None, None
        if b_val is not None and d_val is not None:
            if b_val == d_val:
                row_start, row_end, row_class = b_val - 25, b_val + 25, "inferred_floruit"
            else:
                row_start, row_end, row_class = b_val, d_val, "exact"
        elif b_val is not None:
            row_start, row_end, row_class = b_val, b_val + 50, "inferred_birth"
        elif d_val is not None:
            row_start, row_end, row_class = d_val - 50, d_val, "inferred_death"
        elif f_val is not None:
            row_start, row_end, row_class = f_val - 25, f_val + 25, "inferred_floruit"
            
        # 3. Merging logic
        if qid not in by_id:
            by_id[qid] = {
                "id": qid,
                "content": name,
                "start": row_start,
                "end": row_end,
                "className": row_class or "inferred",
                "occupations": set(current_occs),
                "wikipedia_url": wp_url,
                "raw_birth_text": raw_b,
                "raw_death_text": raw_d,
                "raw_floruit_text": raw_f,
                "display_rank": get_display_rank(row_class)
            }
        else:
            rec = by_id[qid]
            # Merge fields
            if name != "Unknown": rec["content"] = name
            rec["occupations"].update(current_occs)
            
            # Non-null priority for Wikipedia URL
            if not rec["wikipedia_url"]: rec["wikipedia_url"] = wp_url
            
            if not rec["raw_birth_text"]: rec["raw_birth_text"] = raw_b
            if not rec["raw_death_text"]: rec["raw_death_text"] = raw_d
            if not rec["raw_floruit_text"]: rec["raw_floruit_text"] = raw_f
            
            curr_rank = get_display_rank(row_class)
            prev_rank = rec["display_rank"]
            
            should_update = False
            if curr_rank > prev_rank:
                should_update = True
            elif curr_rank == prev_rank and curr_rank > 0:
                curr_width = abs(row_end - row_start)
                prev_width = abs(rec["end"] - rec["start"]) if rec["start"] is not None else 9999
                if curr_width < prev_width:
                    should_update = True
            
            if should_update:
                rec["start"] = row_start
                rec["end"] = row_end
                rec["className"] = row_class or "inferred"
                rec["display_rank"] = curr_rank

    # 4. Finalize Primary Occupation & Title
    output_data = []
    priority_keywords = [
        '哲学者', 'philosopher', '神学者', 'theologian', 'ソフィスト', 'sophist',
        '数学者', 'mathematician', '天文学者', 'astronomer', '物理学者', 'physicist', 
        '医師', 'physician', '地理学者', 'geographer', 'music theorist', '音楽理論家',
        '詩人', 'poet', '劇作家', 'playwright', '悲劇作家', 'tragedian', '喜劇作家', 'comedian',
        'epigrammatist', 'エピグラマティスト',
        '歴史家', 'historian', 'annalist', 'biographer', '伝記作家',
        '雄弁家', 'orator', '修辞学者', 'rhetorician', '文法学者', 'grammarian', 
        '司書', 'librarian', 'musicologist', '音楽学者',
        '政治家', 'politician', '軍人', 'military personnel', '弁護士', 'lawyer',
        '著作家', 'writer'
    ]

    for qid, rec in by_id.items():
        if rec["start"] is None or rec["end"] is None:
            continue
            
        rec["title"] = build_title_from_raw(rec)
        occs_list = sorted(list(rec["occupations"]))
        
        primary_occ = occs_list[0] if occs_list else None
        if occs_list:
            best_rank = 999
            for o in occs_list:
                otilde = o.lower().strip()
                for i, k in enumerate(priority_keywords):
                    if k.lower() in otilde:
                        if i < best_rank:
                            best_rank = i
                            primary_occ = o
                        break
        
        final_class = "exact" if rec["className"] == "exact" else "inferred"
        
        final_item = {
            "id": rec["id"],
            "content": rec["content"],
            "start": rec["start"],
            "end": rec["end"],
            "className": final_class,
            "occupations": occs_list,
            "primary_occupation": primary_occ,
            "wikipedia_url": rec["wikipedia_url"],
            "title": rec["title"],
            "type": "range"
        }
        output_data.append(final_item)

    # Save
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=2, ensure_ascii=False)
    
    print(f"Saved {len(output_data)} unique items to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()
