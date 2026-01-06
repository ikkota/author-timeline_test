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

    // Initialize map
    function initMap() {
        // Create map centered on Mediterranean
        map = L.map('map', {
            center: [38, 20],
            zoom: 4,
            minZoom: 3,
            maxZoom: 10,
            zoomDelta: 0.1,
            zoomSnap: 0.1,
            wheelPxPerZoomLevel: 240
        });

        // Add CAWM tile layer (Ancient World)
        const cawmTiles = L.tileLayer('https://cawm.lib.uiowa.edu/tiles/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://cawm.lib.uiowa.edu/">CAWM</a> (CC BY 4.0)',
            maxZoom: 10,
            errorTileUrl: '' // Fallback handled below
        });

        // Fallback to OpenStreetMap (added below CAWM so CAWM stays visible)
        const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        });

        // Add OSM as base layer first
        osmTiles.addTo(map);
        // Add CAWM on top (will show CAWM where available, OSM where not)
        cawmTiles.addTo(map);

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
        addCityLabels();

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
            const [respGeo, respAuthors] = await Promise.all([
                fetch('data/authors_geo.json'),
                fetch('data/authors.json')
            ]);

            authorsGeo = await respGeo.json();
            authorsArray = await respAuthors.json();

            // Build lookup map for metadata (esp. primary_occupation)
            authorById = new Map(authorsArray.map(a => [a.id, a]));

            console.log(`Loaded geo data for ${Object.keys(authorsGeo).length} authors and metadata for ${authorsArray.length} authors`);

            // Create all markers
            createAllMarkers();

            // Create unknown panel structure
            createUnknownPanel();

            // Initial display (show all)
            updateMapMarkers(null);
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

    // Initialize when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMap);
    } else {
        initMap();
    }
})();

