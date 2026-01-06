import pandas as pd
import os

files = ["author_metadata_with_occ.xlsx", "author_metadata_final.xlsx"]

for f in files:
    if os.path.exists(f):
        df = pd.read_excel(f)
        print(f"--- {f} ---")
        print(f"Columns: {list(df.columns)}")
        if 'Occupation' in df.columns:
            non_empty = df['Occupation'].dropna().astype(str)
            non_empty = non_empty[non_empty != ""]
            print(f"Non-empty Occupation count: {len(non_empty)}")
            if len(non_empty) > 0:
                print(f"Sample: {non_empty.iloc[0]}")
        else:
            print("Occupation column MISSING")
    else:
        print(f"{f} MISSING")

import json
if os.path.exists("public/data/authors.json"):
    with open("public/data/authors.json", encoding="utf-8") as f:
        data = json.load(f)
        print("--- authors.json ---")
        print(f"Total items: {len(data)}")
        with_occ = [x for x in data if x.get("occupations") and len(x["occupations"]) > 0]
        print(f"Items with occupations: {len(with_occ)}")
        if len(with_occ) > 0:
            print(f"Sample item: {with_occ[0]}")
