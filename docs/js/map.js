/**
 * map.js - Leaflet map integration for Author GeoTimeline
 * 
 * Displays author locations on an ancient world map,
 * synchronized with the timeline's selected year.
 */

(function () {
    'use strict';

    // State
    let map = null;
    let markersLayer = null;
    let placeLayers = {
        major: null,
        mid: null,
        minor: null,
        sea: null,
        physical: null,
        all: null,
    };
    let placeData = [];
    let physicalData = [];
    let authorsGeo = {};
    let authorsArray = [];
    let authorById = new Map();
    let allMarkers = [];
    let markersByAuthorId = new Map();
    let currentYear = null;
    let isYearLocked = false;
    let currentOccFilter = null;
    let unknownPopupTimeout = null;
    let unknownPopupHideTimeout = null;

    // City labels for major ancient locations
    const CITY_LABELS = [
        { name: 'Rome', lat: 41.9028, lon: 12.4964 },
        { name: 'Athens', lat: 37.9838, lon: 23.7275 },
        { name: 'Alexandria', lat: 31.2001, lon: 29.9187 },
        { name: 'Constantinople', lat: 41.0082, lon: 28.9784 },
        { name: 'Carthage', lat: 36.8528, lon: 10.3233 },
        { name: 'Pergamon', lat: 39.1217, lon: 27.1789 },
        { name: 'Antioch', lat: 36.2028, lon: 36.1606 },
        { name: 'Jerusalem', lat: 31.7683, lon: 35.2137 },
        { name: 'Ephesus', lat: 37.9394, lon: 27.3417 },
        { name: 'Corinth', lat: 37.9061, lon: 22.8811 },
        { name: 'Syracuse', lat: 37.0755, lon: 15.2866 },
        { name: 'Miletus', lat: 37.5306, lon: 27.2783 },
        { name: 'Smyrna', lat: 38.4189, lon: 27.1287 },
        { name: 'Thebes', lat: 38.3194, lon: 23.3181 },
        { name: 'Sparta', lat: 37.0739, lon: 22.4303 },
    ];

    const THRESHOLDS = {
        places: { low: 4, mid: 7, high: 9 },
        physical: { low: 4, mid: 6, high: 8 },
    };

    const PLACE_LIMITS = [
        { zoom: 6, limit: 200 },  // z<=5 ~200 labels
        { zoom: 7, limit: 220 },  // z=7 keep tight to avoid overload
        { zoom: 99, limit: 400 },
    ];

    const CORE_TAG_MODE = 'all'; // 'greek' | 'roman' | 'all'

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Initialize map
    function initMap() {
        // Create map centered on Mediterranean
        map = L.map('map', {
            center: [38, 20],
            zoom: 5,
            minZoom: 5,
            maxZoom: 7, // semantic cap: avoid modern-detail noise
            zoomDelta: 0.2,
            zoomSnap: 0.2,
            wheelPxPerZoomLevel: 240
        });

        // Base layers without modern labels
        const baseLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Physical_Map/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles &copy; Esri &mdash; Source: US National Park Service',
            maxZoom: 10,
            maxNativeZoom: 10,
            opacity: 0.95
        });

        // Single low-contrast, no-label base to avoid modern labels
        baseLayer.addTo(map);

        // Initialize marker cluster group
        markersLayer = L.markerClusterGroup({
            maxClusterRadius: 40,
            spiderfyOnMaxZoom: true,
            zoomToBoundsOnClick: false,
            showCoverageOnHover: false,
            // Calculate cluster: unique author count + dominant occupation color
            iconCreateFunction: function (cluster) {
                const ids = new Set();
                const occCounts = new Map();

                cluster.getAllChildMarkers().forEach(m => {
                    const data = m._authorData;
                    if (data?.id) {
                        if (!ids.has(data.id)) {
                            ids.add(data.id);
                            // Count occupation for this unique author
                            const occ = data.occupation || 'unknown';
                            occCounts.set(occ, (occCounts.get(occ) || 0) + 1);
                        }
                    }
                });
                const count = ids.size;

                // Find dominant occupation
                let dominantOcc = null;
                let maxCount = 0;
                occCounts.forEach((cnt, occ) => {
                    if (cnt > maxCount) {
                        maxCount = cnt;
                        dominantOcc = occ;
                    }
                });
                const color = getOccColor(dominantOcc);

                let size = 60;
                if (count < 10) {
                    size = 60;
                } else if (count < 100) {
                    size = 80;
                } else {
                    size = 100;
                }

                return L.divIcon({
                    html: `<div style="background-color: ${color}; opacity: 0.8;"><span>${count}</span></div>`,
                    className: 'marker-cluster',
                    iconSize: new L.Point(size, size)
                });
            }
        });
        map.addLayer(markersLayer);

        // Prevent zoom on cluster click; always spiderfy to reveal authors
        markersLayer.on('clusterclick', (e) => {
            if (e?.layer?.spiderfy) {
                e.layer.spiderfy();
            }
        });

        // Add city labels
        // addCityLabels(); // legacy labels; disable to avoid duplicates

        // Init ancient layers
        placeLayers.major = L.layerGroup();
        placeLayers.mid = L.layerGroup();
        placeLayers.minor = L.layerGroup();
        placeLayers.sea = L.layerGroup().addTo(map);
        placeLayers.physical = L.geoJSON([], {
            style: feature => stylePhysical(feature)
        }).addTo(map);
        placeLayers.all = L.layerGroup([placeLayers.major, placeLayers.mid, placeLayers.minor]).addTo(map);

        // QA Layer Control
        L.control.layers(
            { "Base (no labels)": baseLayer },
            {
                "Places (cities)": placeLayers.all,
                "Physical (rivers/lakes)": placeLayers.physical,
                "Sea labels": placeLayers.sea
            },
            { collapsed: false }
        ).addTo(map);

        // Zoom indicator (always show current zoom level)
        const zoomIndicator = L.control({ position: 'bottomleft' });
        zoomIndicator.onAdd = function () {
            const div = L.DomUtil.create('div', 'zoom-indicator');
            div.innerHTML = `z=${map.getZoom()}`;
            return div;
        };
        zoomIndicator.addTo(map);
        map.on('zoomend', () => {
            const el = document.querySelector('.zoom-indicator');
            if (el) el.innerHTML = `z=${map.getZoom()}`;
        });

        // Redraw labels when the map view changes
        map.on('zoomend moveend', () => {
            updateAncientLayers();
        });

        // Load geo data
        loadGeoData();
    }

    // Add city name labels to map
    function addCityLabels() {
        CITY_LABELS.forEach(city => {
            const label = L.divIcon({
                className: 'city-label',
                html: `<span>${city.name}</span>`,
                iconSize: null
            });
            L.marker([city.lat, city.lon], {
                icon: label,
                interactive: false,
                zIndexOffset: -1000
            }).addTo(map);
        });
    }

    // Load authors.json and authors_geo.json
    async function loadGeoData() {
        try {
            // Fetch both in parallel
            const cacheBust = `v=${Date.now()}`;
            const [respGeo, respAuthors, respPlaces, respPhysical] = await Promise.all([
                fetch(`data/authors_geo_lod.json?${cacheBust}`),
                fetch(`data/authors.json?${cacheBust}`),
                fetch(`data/places.geojson?${cacheBust}`),
                fetch(`data/physical.geojson?${cacheBust}`)
            ]);

            authorsGeo = await respGeo.json();
            authorsArray = await respAuthors.json();
            const places = await respPlaces.json();
            const physical = await respPhysical.json();
            placeData = places.features || [];
            physicalData = physical.features || [];

            // Build lookup map for metadata (esp. primary_occupation)
            authorById = new Map(authorsArray.map(a => [a.id, a]));

            console.log(`Loaded geo data for ${Object.keys(authorsGeo).length} authors and metadata for ${authorsArray.length} authors`);

            // Create all markers
            createAllMarkers();
            buildPlaceLayers();
            buildPhysicalLayer();

            // Create unknown panel structure
            createUnknownPanel();

            // Initial display (show all)
            updateMapMarkers(null);
            updateAncientLayers();
        } catch (error) {
            console.error('Failed to load data:', error);
        }
    }

    // Create panel container for authors without mappable coordinates
    function createUnknownPanel() {
        const panel = document.createElement('div');
        panel.id = 'unknown-panel';
        panel.innerHTML = `
            <div id="unknown-header">
                <span id="unknown-title">Unknown (--)</span>
                <button id="toggle-unknown">▼</button>
            </div>
            <div id="unknown-content">
                <div id="unknown-list"></div>
            </div>
        `;

        document.getElementById('map-container').appendChild(panel);

        // Toggle behavior
        const toggleBtn = document.getElementById('toggle-unknown');
        const content = document.getElementById('unknown-content');
        let isExpanded = false;

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            isExpanded = !isExpanded;
            content.style.display = isExpanded ? 'block' : 'none';
            toggleBtn.textContent = isExpanded ? '▲' : '▼';
        });

        // Header click also toggles
        document.getElementById('unknown-header').addEventListener('click', () => {
            toggleBtn.click();
        });
    }

    // Update the unknown panel list based on current year
    function updateUnknownPanel(yearOrNull) {
        const titleEl = document.getElementById('unknown-title');
        const listEl = document.getElementById('unknown-list');
        if (!titleEl || !listEl) return;

        // Helper: Check if active at year t
        const isActive = (author, year) => {
            if (year === null) return true;
            return author.start <= year && year <= author.end;
        };

        // Helper: Check if author has any valid coordinates
        const hasAnyCoord = (qid) => {
            const geo = authorsGeo[qid];
            if (!geo || !geo.locations) return false;
            return geo.locations.some(l => l.coord && Number.isFinite(l.coord.lat) && Number.isFinite(l.coord.lon));
        };

        // Filter active authors who have NO coordinates
        const unknownAuthors = authorsArray.filter(author => {
            const occs = author.occupations || [];
            const matchesOcc = !currentOccFilter || occs.some(o => currentOccFilter.has(o));
            return isActive(author, yearOrNull) && matchesOcc && !hasAnyCoord(author.id);
        });

        // Sort by name
        unknownAuthors.sort((a, b) => a.content.localeCompare(b.content));

        // Update Title
        titleEl.textContent = `Unknown (${unknownAuthors.length})`;

        // Rebuild List
        listEl.innerHTML = "";
        unknownAuthors.forEach(author => {
            const item = document.createElement('div');
            item.className = 'unknown-item';

            const name = author.content;
            item.textContent = name;

            // Click to focus on timeline
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                if (window.timelineAPI?.focusAuthor) {
                    window.timelineAPI.focusAuthor(author.id);
                }
            });

            listEl.appendChild(item);
        });
    }

    // Create markers for all authors with coordinates, de-duplicating by (author, coordinate)
    function createAllMarkers() {
        allMarkers = [];
        markersByAuthorId = new Map();
        const mergedMap = new Map(); // Keyed by authorId|lat,lon

        for (const [qid, author] of Object.entries(authorsGeo)) {
            const activeStart = author.active_range?.start;
            const activeEnd = author.active_range?.end;

            for (const loc of author.locations || []) {
                if (!loc.coord || !Number.isFinite(loc.coord.lat) || !Number.isFinite(loc.coord.lon)) continue;

                const lat = loc.coord.lat;
                const lon = loc.coord.lon;
                const coordKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
                const authorCoordKey = `${qid}|${coordKey}`;

                if (mergedMap.has(authorCoordKey)) {
                    // Update existing entry
                    const entry = mergedMap.get(authorCoordKey);
                    entry.props.add(formatProperty(loc.source_property));
                } else {
                    // New entry
                    mergedMap.set(authorCoordKey, {
                        id: qid,
                        name: author.name,
                        lat: lat,
                        lon: lon,
                        place_label: loc.place_label,
                        props: new Set([formatProperty(loc.source_property)]),
                        start: activeStart,
                        end: activeEnd
                    });
                }
            }
        }

        // Convert merged entries into markers
        mergedMap.forEach((entry, key) => {
            const authorMeta = authorById.get(entry.id);
            const color = getOccColor(authorMeta?.primary_occupation);

            const marker = L.circleMarker([entry.lat, entry.lon], {
                radius: 12,
                fillColor: color,
                fillOpacity: 0.85,
                color: 'rgba(0,0,0,0.6)',
                weight: 1.5,
                opacity: 1
            });

            // Popup content with consolidated properties
            const propsStr = Array.from(entry.props).join(', ');
            const popupContent = `
                <div class="marker-popup">
                    <strong>${entry.name}</strong><br>
                    <span class="popup-place">${entry.place_label || 'Unknown location'}</span>
                    <span class="popup-prop">(${propsStr})</span>
                </div>
            `;
            marker.bindPopup(popupContent);

            // Store metadata for year filtering and clustering
            marker._authorData = {
                id: entry.id,
                name: entry.name,
                start: entry.start,
                end: entry.end,
                occupation: authorMeta?.primary_occupation,
                occupations: authorMeta?.occupations || []
            };

            // Click handler: open popup and sync with timeline (without changing map year)
            marker.on('click', (e) => {
                // Open popup naturally
                marker.openPopup();

                // Also sync with timeline (but don't change map year)
                const qid = entry.id;
                if (window.timelineAPI?.focusAuthor) {
                    // Temporarily lock year to prevent timeline from changing it
                    const wasLocked = isYearLocked;
                    isYearLocked = true;
                    window.timelineAPI.focusAuthor(qid, { preserveWindow: true });
                    // Restore after a delay
                    setTimeout(() => { isYearLocked = wasLocked; }, 500);
                }
            });

            allMarkers.push(marker);

            if (!markersByAuthorId.has(entry.id)) {
                markersByAuthorId.set(entry.id, []);
            }
            markersByAuthorId.get(entry.id).push(marker);
        });

        console.log(`Created ${allMarkers.length} unique author-location markers`);
    }

    // Format property name for display
    function formatProperty(prop) {
        switch (prop) {
            case 'P937': return 'work';
            case 'P551': return 'residence';
            case 'P19': return 'birth';
            case 'P20': return 'death';
            default: return prop;
        }
    }

    // Update map markers and Unknown panel based on selected year
    function updateMapMarkers(year) {
        markersLayer.clearLayers();
        const yearIndicator = document.getElementById('year-indicator');

        const visibleMarkers = allMarkers.filter(m => {
            const data = m._authorData;
            if (!data) return false;
            const occs = data.occupations || [];
            const matchesOcc = !currentOccFilter || occs.some(o => currentOccFilter.has(o));
            if (!matchesOcc) return false;
            if (year === null) return true;
            if (data.start === null || data.end === null) return true;
            return data.start <= year && year <= data.end;
        });
        visibleMarkers.forEach(m => markersLayer.addLayer(m));

        if (yearIndicator) {
            if (year === null) {
                yearIndicator.textContent = 'Year: All';
            } else {
                const yearStr = year < 0 ? `${Math.abs(year)} BC` : `${year} AD`;
                yearIndicator.textContent = `Year: ${yearStr}`;
            }
        }

        // Update Unknown Panel dynamically
        updateUnknownPanel(year);

        currentYear = year;
        updateAncientLayers();
    }

    function showUnknownPopup(name) {
        const container = document.getElementById('map-container');
        const panel = document.getElementById('unknown-panel');
        if (!container || !panel) return false;

        let popup = document.getElementById('unknown-popup');
        if (!popup) {
            popup = document.createElement('div');
            popup.id = 'unknown-popup';
            container.appendChild(popup);
        }

        popup.textContent = name || 'Unknown';
        popup.style.display = 'block';
        popup.style.opacity = '1';
        popup.style.pointerEvents = 'none';

        const panelRect = panel.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const left = Math.max(10, panelRect.left - containerRect.left);
        const top = Math.max(10, panelRect.top - containerRect.top - popup.offsetHeight - 8);

        popup.style.left = `${left}px`;
        popup.style.top = `${top}px`;
        popup.style.minWidth = `${Math.max(160, panelRect.width)}px`;

        if (unknownPopupTimeout) clearTimeout(unknownPopupTimeout);
        if (unknownPopupHideTimeout) clearTimeout(unknownPopupHideTimeout);
        unknownPopupTimeout = setTimeout(() => {
            popup.style.opacity = '0';
            unknownPopupHideTimeout = setTimeout(() => {
                popup.style.display = 'none';
            }, 220);
        }, 2400);

        return true;
    }

    function pickBestMarker(markers) {
        if (!map || !markers.length) return null;
        const bounds = map.getBounds();
        const inView = markers.find(m => bounds.contains(m.getLatLng()));
        return inView || markers[0];
    }

    function getMarkersForAuthor(qid, year) {
        const markers = markersByAuthorId.get(qid) || [];
        return markers.filter(m => {
            const data = m._authorData;
            if (!data) return false;
            const occs = data.occupations || [];
            const matchesOcc = !currentOccFilter || occs.some(o => currentOccFilter.has(o));
            if (!matchesOcc) return false;
            if (year === null || year === undefined) return true;
            if (data.start === null || data.end === null) return true;
            return data.start <= year && year <= data.end;
        });
    }

    // Public API for timeline integration
    window.mapAPI = {
        setYear: function (year, locked) {
            if (locked !== undefined) {
                isYearLocked = locked;
            }
            if (!isYearLocked || locked) {
                updateMapMarkers(year);
            }
        },
        setOccupationFilter: function (occupations) {
            if (Array.isArray(occupations) && occupations.length > 0) {
                currentOccFilter = new Set(occupations);
            } else {
                currentOccFilter = null;
            }
            updateMapMarkers(currentYear);
        },
        showAuthorPopup: function (qid) {
            const candidates = getMarkersForAuthor(qid, currentYear);
            const marker = pickBestMarker(candidates);
            if (!marker) {
                const meta = authorById.get(qid);
                const name = meta?.content || meta?.name || qid;
                return showUnknownPopup(name);
            }

            const openPopup = () => {
                marker.openPopup();
            };

            const parent = markersLayer.getVisibleParent ? markersLayer.getVisibleParent(marker) : marker;
            if (parent && parent !== marker && parent.spiderfy) {
                parent.spiderfy();
                setTimeout(openPopup, 120);
            } else {
                openPopup();
            }

            return true;
        },
        unlock: function () {
            isYearLocked = false;
        },
        isLocked: function () {
            return isYearLocked;
        },
        invalidateSize: function () {
            if (map) {
                map.invalidateSize();
            }
        }
    };

    // Helper: minZoom/tier
    function getMinZoom(props, category) {
        if (typeof props.minZoom === 'number') return props.minZoom;
        if (props.tier && THRESHOLDS[category][props.tier] !== undefined) {
            return THRESHOLDS[category][props.tier];
        }
        return THRESHOLDS[category].high;
    }

    function placeLevel(props) {
        const mz = getMinZoom(props, 'places');
        if (mz <= THRESHOLDS.places.low) return 'major';
        if (mz <= THRESHOLDS.places.mid) return 'mid';
        return 'minor';
    }

    function maxPlacesForZoom(z) {
        for (const { zoom, limit } of PLACE_LIMITS) {
            if (z < zoom) return limit;
        }
        return 1000;
    }

    function coreTagOk(tags) {
        if (!Array.isArray(tags) || tags.length === 0) return false;
        if (CORE_TAG_MODE === 'all') return true;
        return tags.includes(CORE_TAG_MODE);
    }

    function allowedBucketsForZoom(z) {
        if (z <= 5) return new Set(['S']);
        if (z <= 6) return new Set(['S', 'A']);
        return new Set(['S', 'A', 'B']);
    }

    function placeLabelCandidates(features, mapRef) {
        const b = mapRef.getBounds();
        const z = mapRef.getZoom();
        const allowed = allowedBucketsForZoom(z);
        return features
            .filter(f => {
                const props = f.properties || {};
                if (!props.bucket || !allowed.has(props.bucket)) return false;
                if (!coreTagOk(props.core_tags)) return false;
                const coords = f.geometry?.coordinates || [];
                if (coords.length < 2) return false;
                return b.contains([coords[1], coords[0]]);
            })
            .map(f => {
                const props = f.properties || {};
                const importance = props.importance || 0;
                const bucketRank = props.bucket_rank || 0;
                const priority = bucketRank * 10000 + importance;
                return { f, priority };
            })
            .sort((a, b) => b.priority - a.priority);
    }

    function rectsOverlap(a, b) {
        return !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
    }

    function rectForPoint(pt, labelW, labelH) {
        return {
            x1: pt.x - labelW / 2,
            y1: pt.y - labelH / 2,
            x2: pt.x + labelW / 2,
            y2: pt.y + labelH / 2,
        };
    }

    function placeWithOffsets(feature, mapRef, occupied, opts = {}) {
        const labelW = opts.labelW ?? 90;
        const labelH = opts.labelH ?? 18;
        const maxShift = opts.maxShift ?? 14;
        const coords = feature.geometry.coordinates;
        const basePt = mapRef.latLngToContainerPoint([coords[1], coords[0]]);
        const offsets = [
            [0, 0],
            [maxShift, 0],
            [-maxShift, 0],
            [0, maxShift],
            [0, -maxShift],
            [maxShift, maxShift],
            [-maxShift, maxShift],
            [maxShift, -maxShift],
            [-maxShift, -maxShift],
        ];

        for (const [dx, dy] of offsets) {
            const pt = { x: basePt.x + dx, y: basePt.y + dy };
            const rect = rectForPoint(pt, labelW, labelH);
            let hit = false;
            for (const r of occupied) {
                if (rectsOverlap(rect, r)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                return { pt, rect };
            }
        }

        // If no offset avoids overlap, keep original (S must be placed)
        return { pt: basePt, rect: rectForPoint(basePt, labelW, labelH) };
    }

    function selectNonOverlappingLabels(candidates, mapRef, opts = {}) {
        const maxLabels = opts.maxLabels ?? 200;
        const labelW = opts.labelW ?? 90;
        const labelH = opts.labelH ?? 18;
        const accepted = [];
        const occupied = [];
        for (const c of candidates) {
            if (accepted.length >= maxLabels) break;
            const coords = c.f.geometry.coordinates;
            const pt = mapRef.latLngToContainerPoint([coords[1], coords[0]]);
            const rect = {
                x1: pt.x - labelW / 2,
                y1: pt.y - labelH / 2,
                x2: pt.x + labelW / 2,
                y2: pt.y + labelH / 2,
            };
            let hit = false;
            for (const r of occupied) {
                if (rectsOverlap(rect, r)) {
                    hit = true;
                    break;
                }
            }
            if (!hit) {
                occupied.push(rect);
                accepted.push(c.f);
            }
        }
        return accepted;
    }

    function buildPlaceLayers() {
        placeLayers.major.clearLayers();
        placeLayers.mid.clearLayers();
        placeLayers.minor.clearLayers();
        placeLayers.sea.clearLayers();

        const zoom = map.getZoom();
        const candidates = placeLabelCandidates(placeData, map);
        const occupied = [];
        const sLabels = [];
        const otherLabels = [];

        for (const c of candidates) {
            const props = c.f.properties || {};
            if (props.bucket === 'S') {
                sLabels.push(c.f);
            } else {
                otherLabels.push(c.f);
            }
        }

        const placed = [];
        for (const f of sLabels) {
            const placedInfo = placeWithOffsets(f, map, occupied, { labelW: 90, labelH: 18 });
            occupied.push(placedInfo.rect);
            placed.push({ f, pt: placedInfo.pt });
        }

        // Add non-overlapping A/B labels using remaining slots
        const remaining = Math.max(0, maxPlacesForZoom(zoom) - placed.length);
        if (remaining > 0) {
            for (const f of otherLabels) {
                if (placed.length >= maxPlacesForZoom(zoom)) break;
                const coords = f.geometry.coordinates;
                const pt = map.latLngToContainerPoint([coords[1], coords[0]]);
                const rect = rectForPoint(pt, 90, 18);
                let hit = false;
                for (const r of occupied) {
                    if (rectsOverlap(rect, r)) {
                        hit = true;
                        break;
                    }
                }
                if (!hit) {
                    occupied.push(rect);
                    placed.push({ f, pt });
                }
            }
        }

        placed.forEach(({ f, pt }) => {
            const props = f.properties || {};
            const level = placeLevel(props);
            const icon = L.divIcon({
                className: `ancient-label ancient-label-${level}`,
                html: `<span>${escapeHtml(props.display_name || props.name_en || '')}</span>`,
                iconSize: [0, 0]
            });
            const latlng = map.containerPointToLatLng([pt.x, pt.y]);
            const marker = L.marker(latlng, { icon, interactive: false });
            if (level === 'major') {
                placeLayers.major.addLayer(marker);
            } else if (level === 'mid') {
                placeLayers.mid.addLayer(marker);
            } else {
                placeLayers.minor.addLayer(marker);
            }
        });
    }

    function stylePhysical(feature) {
        const type = feature?.properties?.feature_type;
        if (type === 'coastline') return { color: '#3b3b3b', weight: 1.1, opacity: 0.7 };
        if (type === 'river') return { color: '#2f6f8f', weight: 1.2, opacity: 0.95 };
        if (type === 'lake') {
            return {
                color: '#2f6f8f',
                weight: 0.9,
                opacity: 0.9,
                fillColor: '#8fc3d8',
                fillOpacity: 0.45
            };
        }
        if (type === 'sea_region') {
            return {
                color: '#6aa2b8',
                weight: 0.8,
                opacity: 0.7,
                fillColor: '#8fc3d8',
                fillOpacity: 0.45
            };
        }
        return { color: '#555', weight: 1 };
    }

    function buildPhysicalLayer() {
        placeLayers.physical.clearLayers();
        const zoom = Math.min(map.getZoom(), 7); // further cap physical detail to keep noise down
        const filtered = physicalData.filter(f => {
            const props = f.properties || {};
            return zoom >= getMinZoom(props, 'physical');
        });
        placeLayers.physical.addData(filtered);

        // sea labels
        placeLayers.sea.clearLayers();
        filtered.forEach(f => {
            const props = f.properties || {};
            if (props.feature_type !== 'sea_region' || !props.name_en) return;
            const coords = centroidOfCoords(f.geometry?.coordinates);
            if (!coords) return;
            const icon = L.divIcon({
                className: 'ancient-label ancient-label-sea',
                html: `<span>${escapeHtml(props.name_en)}</span>`,
                iconSize: [0, 0]
            });
            placeLayers.sea.addLayer(L.marker([coords[0], coords[1]], { icon, interactive: false }));
        });
    }

    function centroidOfCoords(coords) {
        let sumLat = 0;
        let sumLon = 0;
        let count = 0;
        const walk = item => {
            if (!Array.isArray(item)) return;
            if (item.length >= 2 && typeof item[0] === 'number') {
                sumLon += item[0];
                sumLat += item[1];
                count += 1;
                return;
            }
            item.forEach(child => walk(child));
        };
        walk(coords);
        if (!count) return null;
        return [sumLat / count, sumLon / count];
    }

    function updateAncientLayers() {
        buildPlaceLayers();
        buildPhysicalLayer();
    }

    // Initialize when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMap);
    } else {
        initMap();
    }
})();

