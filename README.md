# A Timeline of Classical Authors (BC–AD)

> Visualizing temporal and geographical uncertainty in classical authorship

## Overview

This project provides an interactive timeline and map of classical authors, primarily from ancient Greek and Roman traditions.

Instead of assigning fixed dates or single locations, the project visualizes chronological and geographical information as **ranges**, preserving historical uncertainty.

🔗 **Live Demo**: [https://ikkota.github.io/author-timeline/](https://ikkota.github.io/author-timeline/)

## Features

- Interactive timeline of classical authors (BC–AD)
- Geographic visualization of authors' activity locations
- Temporal ranges instead of fixed dates (birth, death, floruit)
- Multiple locations per author supported
- Explicit handling of unknown or uncertain data
- Resizable split-pane layout (timeline + map)
- Occupation-based filtering

## Data Sources

- **Wikidata** — author identifiers (QID), locations, metadata
- **Wikipedia** — human-readable references for each author
- **Perseus Digital Library** — author selection criteria
- **CAWM** (Consortium of Ancient World Mappers) — ancient world map tiles (CC BY 4.0)

### Geographic Data

Geographic coordinates are derived from Wikidata (P625), with administrative fallback (P131) when direct coordinates are unavailable.

| Property | Meaning |
|----------|---------|
| P937 | Work location |
| P551 | Residence |
| P19 | Place of birth |
| P20 | Place of death |

## Methodology

- All authors are identified by **Wikidata QIDs**.
- Chronological data is represented as **ranges**, not points.
- If a location lacks explicit temporal qualifiers, it is treated as valid throughout the author's active period.
- Locations without resolvable coordinates are **not mapped** and are explicitly flagged for review.
- Coordinate resolution uses parent administrative entities (up to 3 hops) as fallback, with explicit `coord_source` tracking.

## How to Use

1. **Pan/Zoom the timeline** to explore authors active in a given year
2. **Click on the timeline** to lock the year and explore the map
3. **Press ESC** or click background to unlock
4. **Click map markers** to view author and location details
5. **Drag the splitter** between timeline and map to adjust layout
6. **Filter by occupation** using the floating panel

## Technology Stack

- [Vis.js Timeline](https://visjs.github.io/vis-timeline/) — timeline visualization
- [Leaflet](https://leafletjs.com/) — map visualization
- [Leaflet.markercluster](https://github.com/Leaflet/Leaflet.markercluster) — marker clustering

## Deployment

This project uses **GitHub Pages** with subtree deployment from the `public/` folder.

## Data Update

To update the data:
1. Edit `author_metadata_final.xlsx`
2. Run `python convert_to_json.py` (timeline data)
3. Run `python enrich_geo.py` (geographic data)
4. Commit and push

## License

This project is released under the **MIT License**.

You are free to use it for education, research, and development.

## Limitations

- Geographic data availability varies across authors.
- Some locations are approximated via administrative entities.
- The project does not attempt to reconstruct precise movements or routes.
- Authors without any recorded dates (birth, death, or floruit) in Wikidata are omitted.

## Author

**Ikko Tanaka** — [researchmap.jp/ikkotanaka](https://researchmap.jp/ikkotanaka)
