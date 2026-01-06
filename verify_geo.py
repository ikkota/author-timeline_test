import json
data = json.load(open('public/data/authors_geo.json','r',encoding='utf-8'))
print('Total authors:', len(data))

# Status distribution
status_counts = {}
for p in data.values():
    s = p['geo_status']
    status_counts[s] = status_counts.get(s, 0) + 1
print('Status distribution:', status_counts)

# Sample authors
for name in ['Galen', 'Plato', 'Homer']:
    for qid, p in data.items():
        if name.lower() in p.get('name','').lower():
            print(f'\n{name} ({qid}):')
            print(f'  geo_status: {p["geo_status"]}')
            print(f'  locations: {len(p["locations"])}')
            if p['locations']:
                for loc in p['locations'][:3]:
                    has_coord = loc.get("coord") is not None
                    print(f'    - {loc["source_property"]}: {loc["place_label"]} (coord: {has_coord})')
            break
