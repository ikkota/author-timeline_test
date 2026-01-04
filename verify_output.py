import pandas as pd
import os

FILE = "author_metadata_wikipedia.xlsx"

if not os.path.exists(FILE):
    print(f"{FILE} not found.")
    exit(1)

df = pd.read_excel(FILE)
print(f"Total Rows: {len(df)}")
print(f"Columns: {df.columns.tolist()}")

with_text = df[df['WP_raw_chronology_text'].notna() & (df['WP_raw_chronology_text'] != "")]
print(f"Entries with Wikipedia Text: {len(with_text)}")

print("\n--- Sample Entries ---")
print(df[['QID', 'WP_language', 'WP_raw_chronology_text']].head(5).to_string())
