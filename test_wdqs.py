import requests
import json
from enrich_geo import build_people_locations_query, load_json

authors = load_json('public/data/authors.json')
qids = [a.get('id') for a in authors if a.get('id')][:50]
sparql = build_people_locations_query(qids)

print("Query length:", len(sparql))
print("Sending to WDQS...")

r = requests.get("https://query.wikidata.org/sparql", 
    params={"query": sparql, "format": "json"},
    headers={"User-Agent": "Test/1.0"},
    timeout=120)

print("Status:", r.status_code)
if r.status_code == 200:
    data = r.json()
    print("Results:", len(data.get("results",{}).get("bindings",[])))
else:
    print("Error:", r.text[:500])
