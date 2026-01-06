
import json
p="public/data/authors.json"
try:
    data=json.load(open(p,"r",encoding="utf-8"))
    inferred=[x for x in data if x.get("className")=="inferred"]
    with_title=[x for x in inferred if "title" in x and x["title"].strip()]
    print("total:", len(data))
    print("inferred:", len(inferred))
    print("inferred with title (should be 0):", len(with_title))
    print("sample inferred:", inferred[0] if inferred else None)
except Exception as e:
    print(e)
