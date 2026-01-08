# Sources

## AWMC geodata (Physical Data)
- URL: https://raw.githubusercontent.com/AWMC/geodata/master/Physical%20Data/shoreline/shoreline.geojson
- Access date: 2026-01-08T13:18:43.093783Z
- License: ODbL (see https://raw.githubusercontent.com/AWMC/geodata/master/LICENSE.txt)
- License cache: cache\geodata\licenses\awmc_license.txt (sha256 d9685b90fa7d223f5cb0e7f57d00d5b63de69638c9de0340be2e7cf4dc6ecab3)
- Processing: filtered to Mediterranean bbox; used for coastline lines only.

## Pleiades Gazetteer
- URL: https://atlantides.org/downloads/pleiades/json/pleiades-places-latest.json.gz
- Access date: 2026-01-08T13:18:43.093783Z
- License: see https://pleiades.stoa.org/credits
- License cache: cache\geodata\licenses\pleiades_credits.html (sha256 a17d5fb436ecca4970774c4cc1c5c94f4761c6777ce77e33c0c03adb073e60a7)
- Processing: streamed JSON; filtered to Mediterranean bbox; used for places and waterway name matching.

## Natural Earth (fallback shapes)
- URL: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson
- Access date: 2026-01-08T13:18:43.093783Z
- License: Public Domain (Natural Earth)
- License cache: cache\geodata\licenses\natural_earth_license.md (sha256 2631b5b39b6d1acc56de75235109b5af2dbb4b0ac5a127b6f06185977247fd4b)
- Processing: multi-scale rivers/lakes (110m/50m/10m + Europe subsets) and marine polys; filtered to Mediterranean bbox.

## LOD linking
- Cache path: cache\geodata\wikidata_pleiades_mapping_af28b4819479.json
- Cache sha256: 87e4e15190f451aff58610a53afc8ddc69b31112b84eb7cbbe1eccf795da5107
- Used SPARQL: False
- Query hash: af28b4819479
- Generated cache: None
- Selection: numeric Pleiades IDs only; lowest numeric on collisions.
- Collisions (QID->Pleiades): 76 (rule: smallest_id)


## Author patching
No author patches applied.
- Optional patch file: overrides/authors_geo_patch.json
- Note: use --apply-author-patches to apply.

## Run metadata
- BBox: (-10.0, 24.0, 42.0, 46.0)
- Script version: 4bafa63d9ef2c6b73170ba51fe8680f937a559b5
- Python version: 3.13.5
- Build time (UTC): 2026-01-08T13:18:43.093783Z

## Summary
- Places: 14829 (low 90, mid 1300, high 13439)
- Places (from authors): 194 (buckets {'S': 14, 'A': 13, 'B': 24, 'C': 143, 'none': 0})
- Physical: 1848 (by type: {'coastline': 1435, 'river': 263, 'lake': 137, 'sea_region': 13})
- Authors: total 307, lod_linked 245, has_wikidata_only 14, missing 8, needs_enrichment 40
- Mapping: qids 14241, pleiades 13813, collisions 542

## Exclusions
- OpenStreetMap (OSM) is not used in v1 by policy.
