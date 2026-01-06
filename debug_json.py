import json
with open('public/data/authors.json', encoding='utf-8') as f:
    d = json.load(f)
    item = [x for x in d if x['id']=='Q8778'][0]
    print(f"Title:\n{item.get('title')}")
    print(f"Occupations: {item.get('occupations')}")
    print(f"Style: {item.get('style')}")
