#!/usr/bin/env python3
"""
enrich_geo.py
- Input:  public/data/authors.json (array; each has id(QID), content, start, end, wikipedia_url)
- Output: public/data/authors_geo.json (dict keyed by QID)

Design goals:
- Join key is authors[i]["id"] (QID), NOT content/title.
- Collect rich location statements from Wikidata (P937/P551/P19/P20)
- If place has no coordinates, attempt parent fallback via P131 up to N hops.
- Never "hide" a living person: if a location has no time qualifiers,
  frontend treats it as valid throughout author active_range (from authors.json start/end).
- If we cannot obtain any mappable coordinates, flag needs_wikipedia_lookup.

Run:
  python enrich_geo.py --authors public/data/authors.json --out public/data/authors_geo.json
"""
from __future__ import annotations

import argparse
import json
import os
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import requests


WDQS_ENDPOINT = "https://query.wikidata.org/sparql"
UA = "AncientAuthorsGeoTimeline/0.1 (research; contact: github.com/ikkota)"


@dataclass
class Coord:
    lat: float
    lon: float


def ensure_dir(p: str) -> None:
    os.makedirs(p, exist_ok=True)


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, obj: Any) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def is_valid_qid(qid: str) -> bool:
    """Check if a string is a valid Wikidata QID."""
    if not qid or not isinstance(qid, str):
        return False
    qid = qid.strip()
    return qid.startswith("Q") and qid[1:].isdigit()


def qid_to_wd(qid: str) -> str:
    qid = qid.strip()
    if not is_valid_qid(qid):
        raise ValueError(f"Not a QID: {qid}")
    return f"wd:{qid}"


def parse_wkt_point(wkt: str) -> Optional[Coord]:
    # WDQS returns coord as WKT like: "Point(12.4924 41.8902)" (lon lat)
    if not wkt or "Point(" not in wkt:
        return None
    try:
        inner = wkt.split("Point(", 1)[1].split(")", 1)[0].strip()
        lon_s, lat_s = inner.split()
        return Coord(lat=float(lat_s), lon=float(lon_s))
    except Exception:
        return None


def wdqs_query(session: requests.Session, sparql: str, sleep_s: float, max_retries: int = 3) -> Dict[str, Any]:
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/sparql-query",
        "Accept": "application/sparql-results+json",
    }
    for attempt in range(max_retries):
        try:
            # Use POST method for better handling of large queries
            r = session.post(WDQS_ENDPOINT, data=sparql, headers=headers, timeout=120)
            if r.status_code == 429:
                wait = max(10.0, sleep_s * (2 ** (attempt + 2)))
                print(f"    Rate limited, waiting {wait:.1f}s...")
                time.sleep(wait)
                continue
            if r.status_code != 200:
                print(f"    WDQS error {r.status_code}: {r.text[:200]}")
            r.raise_for_status()
            if sleep_s > 0:
                time.sleep(sleep_s)
            return r.json()
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
            wait = sleep_s * (2 ** (attempt + 1))
            print(f"    Connection error (attempt {attempt+1}/{max_retries}): {e}. Retrying in {wait:.1f}s...")
            time.sleep(wait)
        except requests.exceptions.RequestException as e:
            print(f"    Request failed: {e}")
            raise
    raise RuntimeError(f"WDQS query failed after {max_retries} retries")


def chunk(lst: List[str], n: int) -> List[List[str]]:
    return [lst[i : i + n] for i in range(0, len(lst), n)]


def build_people_locations_query(qids: List[str]) -> str:
    values = "\n    ".join(qid_to_wd(q) for q in qids)
    return f"""
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX p: <http://www.wikidata.org/prop/>
PREFIX ps: <http://www.wikidata.org/prop/statement/>
PREFIX pq: <http://www.wikidata.org/prop/qualifier/>
PREFIX wikibase: <http://wikiba.se/ontology#>
PREFIX bd: <http://www.bigdata.com/rdf#>

SELECT ?person ?prop ?place ?rank ?startTime ?endTime ?coord ?placeLabel
WHERE {{
  VALUES ?person {{
    {values}
  }}

  {{
    ?person p:P937 ?st .
    ?st ps:P937 ?place .
    BIND("P937" AS ?prop)
    OPTIONAL {{ ?st pq:P580 ?startTime }}
    OPTIONAL {{ ?st pq:P582 ?endTime }}
    OPTIONAL {{ ?st wikibase:rank ?rank }}
  }}
  UNION
  {{
    ?person p:P551 ?st .
    ?st ps:P551 ?place .
    BIND("P551" AS ?prop)
    OPTIONAL {{ ?st pq:P580 ?startTime }}
    OPTIONAL {{ ?st pq:P582 ?endTime }}
    OPTIONAL {{ ?st wikibase:rank ?rank }}
  }}
  UNION
  {{
    ?person wdt:P19 ?place .
    BIND("P19" AS ?prop)
  }}
  UNION
  {{
    ?person wdt:P20 ?place .
    BIND("P20" AS ?prop)
  }}

  OPTIONAL {{ ?place wdt:P625 ?coord }}

  SERVICE wikibase:label {{
    bd:serviceParam wikibase:language "en".
    ?place rdfs:label ?placeLabel .
  }}
}}
"""


def build_place_coord_query(place_qids: List[str]) -> str:
    # Filter to valid QIDs only
    valid_qids = [q for q in place_qids if is_valid_qid(q)]
    if not valid_qids:
        return None
    values = "\n    ".join(qid_to_wd(q) for q in valid_qids)
    return f"""
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>

SELECT ?place ?coord WHERE {{
  VALUES ?place {{
    {values}
  }}
  OPTIONAL {{ ?place wdt:P625 ?coord }}
}}
"""


def build_place_parent_query(place_qids: List[str]) -> str:
    # Filter to valid QIDs only
    valid_qids = [q for q in place_qids if is_valid_qid(q)]
    if not valid_qids:
        return None
    values = "\n    ".join(qid_to_wd(q) for q in valid_qids)
    return f"""
PREFIX wd: <http://www.wikidata.org/entity/>
PREFIX wdt: <http://www.wikidata.org/prop/direct/>

SELECT ?place ?parent WHERE {{
  VALUES ?place {{
    {values}
  }}
  OPTIONAL {{ ?place wdt:P131 ?parent }}
}}
"""


def uri_to_qid(uri: str) -> str:
    return uri.rsplit("/", 1)[-1]


def safe_get(binding: Dict[str, Any], key: str) -> Optional[str]:
    if key not in binding:
        return None
    v = binding[key]
    if not isinstance(v, dict):
        return None
    return v.get("value")


def normalize_rank(rank_uri: Optional[str]) -> Optional[str]:
    if not rank_uri:
        return None
    if rank_uri.endswith("PreferredRank"):
        return "preferred"
    if rank_uri.endswith("NormalRank"):
        return "normal"
    if rank_uri.endswith("DeprecatedRank"):
        return "deprecated"
    return "unknown"


def resolve_coords_with_parent_fallback(
    session: requests.Session,
    place_qids: List[str],
    place_coord_cache: Dict[str, Optional[Coord]],
    place_parent_cache: Dict[str, List[str]],
    parent_hops: int,
    sleep_s: float,
) -> Dict[str, Tuple[Optional[Coord], str, int]]:
    """
    Returns: place_qid -> (coord or None, coord_source, parent_hops_used)
      coord_source in {"exact","via_parent","missing"}
    """
    # First pass: query coords for unknown places
    unknown = [q for q in place_qids if q not in place_coord_cache and is_valid_qid(q)]
    if unknown:
        for batch in chunk(unknown, 50):
            sparql = build_place_coord_query(batch)
            if sparql is None:
                continue
            data = wdqs_query(session, sparql, sleep_s)
            for q in batch:
                place_coord_cache[q] = None
            for b in data["results"]["bindings"]:
                place_uri = safe_get(b, "place")
                coord_wkt = safe_get(b, "coord")
                if place_uri:
                    qid = uri_to_qid(place_uri)
                    if coord_wkt:
                        place_coord_cache[qid] = parse_wkt_point(coord_wkt)

    out: Dict[str, Tuple[Optional[Coord], str, int]] = {}

    # Quick exact
    need_parents: List[str] = []
    for q in place_qids:
        c = place_coord_cache.get(q)
        if c:
            out[q] = (c, "exact", 0)
        else:
            need_parents.append(q)

    if not need_parents or parent_hops <= 0:
        for q in need_parents:
            out[q] = (None, "missing", 0)
        return out

    # Parent BFS up to parent_hops
    frontier = need_parents[:]
    visited = set(frontier)
    place_best: Dict[str, Tuple[Optional[Coord], str, int]] = {q: (None, "missing", 0) for q in need_parents}

    for hop in range(1, parent_hops + 1):
        # ensure parents known
        to_parent_query = [q for q in frontier if q not in place_parent_cache and is_valid_qid(q)]
        if to_parent_query:
            for batch in chunk(to_parent_query, 50):
                sparql = build_place_parent_query(batch)
                if sparql is None:
                    continue
                data = wdqs_query(session, sparql, sleep_s)
                for q in batch:
                    place_parent_cache[q] = []
                for b in data["results"]["bindings"]:
                    place_uri = safe_get(b, "place")
                    parent_uri = safe_get(b, "parent")
                    if place_uri and parent_uri:
                        pq = uri_to_qid(place_uri)
                        parent_q = uri_to_qid(parent_uri)
                        if is_valid_qid(pq) and is_valid_qid(parent_q):
                            place_parent_cache.setdefault(pq, []).append(parent_q)

        parents: List[str] = []
        for q in frontier:
            parents.extend(place_parent_cache.get(q, []))

        next_frontier = [p for p in dict.fromkeys(parents) if p not in visited]
        visited.update(next_frontier)

        if not next_frontier:
            break

        # query coords for new parents not in coord cache
        parent_unknown = [p for p in next_frontier if p not in place_coord_cache and is_valid_qid(p)]
        if parent_unknown:
            for batch in chunk(parent_unknown, 50):
                sparql = build_place_coord_query(batch)
                if sparql is None:
                    continue
                data = wdqs_query(session, sparql, sleep_s)
                for p in batch:
                    place_coord_cache[p] = None
                for b in data["results"]["bindings"]:
                    place_uri = safe_get(b, "place")
                    coord_wkt = safe_get(b, "coord")
                    if place_uri:
                        qid = uri_to_qid(place_uri)
                        if is_valid_qid(qid) and coord_wkt:
                            place_coord_cache[qid] = parse_wkt_point(coord_wkt)

        # Update children with found parent coords
        for child in frontier:
            if place_best.get(child, (None, "missing", 0))[0] is not None:
                continue
            for p in place_parent_cache.get(child, []):
                c = place_coord_cache.get(p)
                if c:
                    place_best[child] = (c, "via_parent", hop)
                    break

        frontier = next_frontier

    for q in need_parents:
        out[q] = place_best.get(q, (None, "missing", 0))

    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--authors", required=True, help="path to authors.json")
    ap.add_argument("--out", required=True, help="path to output authors_geo.json")
    ap.add_argument("--cache", default="cache", help="cache directory")
    ap.add_argument("--batch-size", type=int, default=200)
    ap.add_argument("--parent-hops", type=int, default=3)
    ap.add_argument("--sleep", type=float, default=0.2, help="sleep between WDQS calls")
    args = ap.parse_args()

    ensure_dir(args.cache)

    authors = load_json(args.authors)
    if not isinstance(authors, list):
        raise ValueError("authors.json must be a JSON array")

    # Build base output dict keyed by QID
    out: Dict[str, Any] = {}
    qids: List[str] = []
    for a in authors:
        qid = a.get("id")
        if not qid or not isinstance(qid, str):
            continue
        qids.append(qid)
        out[qid] = {
            "id": qid,
            "name": a.get("content") or qid,
            "wikipedia_url": a.get("wikipedia_url"),
            "active_range": {"start": a.get("start"), "end": a.get("end")},
            "geo_status": "missing_wikidata_location",
            "needs_wikipedia_lookup": True,
            "locations": [],
            "unknown_reason": "no_locations_yet",
        }

    session = requests.Session()

    # Caches
    place_coord_cache: Dict[str, Optional[Coord]] = {}
    place_parent_cache: Dict[str, List[str]] = {}

    # Process in batches
    for bi, batch in enumerate(chunk(qids, args.batch_size)):
        cache_path = os.path.join(args.cache, f"wdqs_people_locations_{bi:04d}.json")
        if os.path.exists(cache_path):
            print(f"  Loading cached batch {bi}...")
            data = load_json(cache_path)
        else:
            print(f"  Fetching batch {bi} ({len(batch)} authors)...")
            sparql = build_people_locations_query(batch)
            data = wdqs_query(session, sparql, args.sleep)
            save_json(cache_path, data)

        places_to_resolve: List[str] = []
        rows: List[Dict[str, Any]] = []

        for b in data["results"]["bindings"]:
            person_uri = safe_get(b, "person")
            prop = safe_get(b, "prop")
            place_uri = safe_get(b, "place")
            rank_uri = safe_get(b, "rank")
            start_time = safe_get(b, "startTime")
            end_time = safe_get(b, "endTime")
            coord_wkt = safe_get(b, "coord")
            place_label = safe_get(b, "placeLabel")

            if not person_uri or not prop or not place_uri:
                continue

            person_qid = uri_to_qid(person_uri)
            place_qid = uri_to_qid(place_uri)

            coord = parse_wkt_point(coord_wkt) if coord_wkt else None
            if coord is not None:
                place_coord_cache[place_qid] = coord
            else:
                places_to_resolve.append(place_qid)

            rows.append({
                "person_qid": person_qid,
                "source_property": prop,
                "place_qid": place_qid,
                "place_label": place_label or place_qid,
                "rank": normalize_rank(rank_uri),
                "qual_start": start_time,
                "qual_end": end_time,
                "coord": coord,
            })

        # Resolve missing coords with parent fallback
        unique_places = list(dict.fromkeys(places_to_resolve))
        if unique_places:
            print(f"    Resolving {len(unique_places)} places without direct coords...")
        resolved = resolve_coords_with_parent_fallback(
            session=session,
            place_qids=unique_places,
            place_coord_cache=place_coord_cache,
            place_parent_cache=place_parent_cache,
            parent_hops=args.parent_hops,
            sleep_s=args.sleep,
        )

        # Write into output
        for r in rows:
            person_qid = r["person_qid"]
            place_qid = r["place_qid"]

            coord = r["coord"]
            coord_source = "exact"
            parent_hops_used = 0

            if coord is None:
                coord, coord_source, parent_hops_used = resolved.get(place_qid, (None, "missing", 0))

            loc = {
                "source_property": r["source_property"],
                "place_qid": place_qid,
                "place_label": r["place_label"],
                "coord": None,
                "coord_source": coord_source,
                "parent_hops": parent_hops_used,
                "time": {
                    "start": r["qual_start"],
                    "end": r["qual_end"],
                    "from_qualifiers": bool(r["qual_start"] or r["qual_end"]),
                },
                "rank": r["rank"] or "unknown",
            }

            if coord:
                loc["coord"] = {"lat": coord.lat, "lon": coord.lon}

            if person_qid in out:
                out[person_qid]["locations"].append(loc)

    # Finalize statuses per person
    print("Finalizing geo statuses...")
    for qid, person in out.items():
        locs = person["locations"]

        if not locs:
            person["geo_status"] = "missing_wikidata_location"
            person["needs_wikipedia_lookup"] = True
            person["unknown_reason"] = "no_wikidata_places"
            continue

        mappable = [l for l in locs if l.get("coord") is not None]
        if not mappable:
            person["geo_status"] = "missing_coordinates"
            person["needs_wikipedia_lookup"] = True
            person["unknown_reason"] = "places_without_coordinates"
            continue

        if all(l.get("coord_source") == "via_parent" for l in mappable):
            person["geo_status"] = "needs_review"
            person["needs_wikipedia_lookup"] = False
            person["unknown_reason"] = "only_parent_fallback_coordinates"
        else:
            person["geo_status"] = "ok"
            person["needs_wikipedia_lookup"] = False
            person["unknown_reason"] = None

        # De-dup exact duplicates
        seen = set()
        deduped = []
        for l in person["locations"]:
            key = (l["source_property"], l["place_qid"], l.get("time", {}).get("start"), l.get("time", {}).get("end"))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(l)
        person["locations"] = deduped

    save_json(args.out, out)

    # Summary stats
    status_counts = {}
    for p in out.values():
        s = p["geo_status"]
        status_counts[s] = status_counts.get(s, 0) + 1
    print(f"\nWrote {args.out} for {len(out)} authors.")
    print("Status distribution:", status_counts)


if __name__ == "__main__":
    main()
