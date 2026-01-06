"""Debug script to identify where SSL failure occurs"""
import requests
from enrich_geo import (
    build_people_locations_query, 
    build_place_coord_query,
    load_json, 
    chunk,
    safe_get,
    uri_to_qid
)

session = requests.Session()
UA = "AncientAuthorsGeoTimeline/0.1 (debug)"

authors = load_json('public/data/authors.json')
qids = [a.get('id') for a in authors if a.get('id')][:100]

print(f"Testing with {len(qids)} authors...")

# Test 1: People locations query
print("\n1. Testing people locations query (POST)...")
sparql = build_people_locations_query(qids)
print(f"   Query length: {len(sparql)}")

headers = {
    "User-Agent": UA,
    "Content-Type": "application/sparql-query",
    "Accept": "application/sparql-results+json",
}

try:
    r = session.post("https://query.wikidata.org/sparql", data=sparql, headers=headers, timeout=120)
    print(f"   Status: {r.status_code}")
    if r.status_code == 200:
        data = r.json()
        bindings = data.get("results", {}).get("bindings", [])
        print(f"   Results: {len(bindings)}")
        
        # Collect places without coords
        places_without_coords = []
        for b in bindings:
            place_uri = safe_get(b, "place")
            coord = safe_get(b, "coord")
            if place_uri and not coord:
                places_without_coords.append(uri_to_qid(place_uri))
        
        print(f"   Places without direct coords: {len(places_without_coords)}")
        
        if places_without_coords:
            print("\n2. Testing place coord query (POST)...")
            unique_places = list(dict.fromkeys(places_without_coords))[:50]
            sparql2 = build_place_coord_query(unique_places)
            print(f"   Query length: {len(sparql2)}")
            
            r2 = session.post("https://query.wikidata.org/sparql", data=sparql2, headers=headers, timeout=120)
            print(f"   Status: {r2.status_code}")
            if r2.status_code == 200:
                data2 = r2.json()
                print(f"   Results: {len(data2.get('results', {}).get('bindings', []))}")
    else:
        print(f"   Error: {r.text[:500]}")
        
except Exception as e:
    print(f"   FAILED: {e}")

print("\nDone.")
