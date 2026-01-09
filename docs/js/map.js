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
    let authorsGeoNormalized = {};
    let authorsArray = [];
    let authorById = new Map();
    let placeToAuthors = new Map();
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

    const PLACE_POPUP_MAX = 200;

    const CORE_TAG_MODE = 'all'; // 'author_related' | 'greek' | 'roman' | 'all'

    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatYear(year) {
        if (year === null || year === undefined || Number.isNaN(year)) return '?';
        const n = Number(year);
        if (!Number.isFinite(n)) return '?';
        if (n < 0) return `${Math.abs(n)} BC`;
        if (n === 0) return '0';
        return `${n} AD`;
    }

    function placeKeyFromCoords(lat, lon) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return `coord:${lat.toFixed(5)},${lon.toFixed(5)}`;
    }

    function placeKeyFromLocation(loc) {
        if (!loc) return null;
        if (loc.place_pleiades_id) return `pleiades:${loc.place_pleiades_id}`;
        if (loc.place_qid) return `qid:${loc.place_qid}`;
        const coord = loc.coord || {};
        return placeKeyFromCoords(Number(coord.lat), Number(coord.lon));
    }

    function placeKeyFromFeature(feature) {
        if (!feature) return null;
        const props = feature.properties || {};
        if (props.place_key) return props.place_key;
        if (props.pleiades_id) return `pleiades:${props.pleiades_id}`;
        if (props.wikidata_qid) return `qid:${props.wikidata_qid}`;
        const coords = feature.geometry?.coordinates || [];
        if (coords.length >= 2) {
            return placeKeyFromCoords(Number(coords[1]), Number(coords[0]));
        }
        return null;
    }

    // Initialize map
    function initMap() {
        // Create map centered on Mediterranean
        map = L.map('map', {
            center: [38, 20],
            zoom: 4,
            minZoom: 4,
            maxZoom: 7,
            zoomDelta: 0.2,
            zoomSnap: 0.2,
            wheelPxPerZoomLevel: 240
        });

        // Pane order: features < labels < markers
        map.createPane('ancient-features');
        map.getPane('ancient-features').style.zIndex = 320;
        map.createPane('ancient-labels');
        map.getPane('ancient-labels').style.zIndex = 380;
        map.getPane('ancient-labels').style.pointerEvents = 'auto';

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
        placeLayers.sea = L.layerGroup();
        placeLayers.physical = L.geoJSON([], {
            pane: 'ancient-features',
            style: feature => stylePhysical(feature)
        }).addTo(map);
        placeLayers.all = L.layerGroup([placeLayers.major, placeLayers.mid, placeLayers.minor]).addTo(map);

        // QA Layer Control
        L.control.layers(
            { "Base (no labels)": baseLayer },
            {
                "Places of Authors": placeLayers.all,
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

        map.on('popupopen', (e) => {
            const container = e.popup?.getElement();
            if (!container) return;
            if (container.querySelector('.place-popup')) {
                attachPlacePopupHandlers(container);
            }
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
                fetch(`data/places_from_authors.geojson?${cacheBust}`),
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

            // Prefer normalized authors for place popups; fallback to lod if missing
            authorsGeoNormalized = authorsGeo;
            try {
                const respNorm = await fetch(`data/authors_geo.normalized.json?${cacheBust}`);
                if (respNorm.ok) {
                    authorsGeoNormalized = await respNorm.json();
                } else {
                    console.info('authors_geo.normalized.json not found; using authors_geo_lod.json for place popups.');
                }
            } catch (err) {
                console.info('Failed to load authors_geo.normalized.json; using authors_geo_lod.json for place popups.', err);
            }
            placeToAuthors = buildPlaceAuthorIndex(authorsGeoNormalized);

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

    function rolesFromLocation(loc) {
        if (Array.isArray(loc?.roles) && loc.roles.length > 0) {
            return loc.roles;
        }
        if (loc?.source_property) {
            return [formatProperty(loc.source_property)];
        }
        return ['other'];
    }

    function buildPlaceAuthorIndex(geoSource) {
        const index = new Map();
        for (const [qid, author] of Object.entries(geoSource || {})) {
            const meta = authorById.get(qid);
            const name = meta?.content || author.name || qid;
            const start = Number.isFinite(meta?.start) ? meta.start : author.active_range?.start ?? null;
            const end = Number.isFinite(meta?.end) ? meta.end : author.active_range?.end ?? null;

            for (const loc of author.locations || []) {
                if (!loc || typeof loc !== 'object') continue;
                const key = placeKeyFromLocation(loc);
                if (!key) continue;

                if (!index.has(key)) index.set(key, new Map());
                const authorMap = index.get(key);
                if (!authorMap.has(qid)) {
                    authorMap.set(qid, {
                        id: qid,
                        name,
                        start,
                        end,
                        roles: new Set()
                    });
                }
                const entry = authorMap.get(qid);
                rolesFromLocation(loc).forEach(r => entry.roles.add(r));
            }
        }
        return index;
    }

    function sortPlaceAuthors(authors) {
        const rolePriority = { birth: 0, death: 0, work: 1, residence: 1, other: 2 };
        return authors.sort((a, b) => {
            const aPriority = Math.min(...a.roles.map(r => rolePriority[r] ?? 3));
            const bPriority = Math.min(...b.roles.map(r => rolePriority[r] ?? 3));
            if (aPriority !== bPriority) return aPriority - bPriority;
            const aStart = Number.isFinite(a.start) ? a.start : 99999;
            const bStart = Number.isFinite(b.start) ? b.start : 99999;
            if (aStart !== bStart) return aStart - bStart;
            return (a.name || '').localeCompare(b.name || '');
        });
    }

    function buildPlacePopupContent(placeName, authors) {
        if (!authors || authors.length === 0) {
            return `<div class="place-popup"><strong>${escapeHtml(placeName)}</strong><div class="place-popup__empty">No linked authors</div></div>`;
        }
        const sorted = sortPlaceAuthors(authors);
        const limited = sorted.slice(0, PLACE_POPUP_MAX);
            const rows = limited.map(author => {
                const roleLabels = Array.from(new Set(author.roles.map(r => r.toLowerCase())))
                    .filter(r => ['birth', 'death', 'work', 'residence', 'other'].includes(r));
                const badges = [];
                if (roleLabels.includes('birth')) {
                    badges.push(`
                    <span class="place-popup__year">${escapeHtml(formatYear(author.start))}</span>
                    <span class="place-popup__badge">birth</span>
                `);
                }
                if (roleLabels.includes('death')) {
                    badges.push(`
                    <span class="place-popup__year">${escapeHtml(formatYear(author.end))}</span>
                    <span class="place-popup__badge">death</span>
                `);
                }
                ['work', 'residence', 'other'].forEach(role => {
                    if (roleLabels.includes(role)) {
                        badges.push(`<span class="place-popup__badge place-popup__badge--role">${escapeHtml(role)}</span>`);
                    }
                });
            return `
                <button type="button" class="place-popup__author" data-author-id="${escapeHtml(author.id)}">
                    <span class="place-popup__name">${escapeHtml(author.name)}</span>
                    <span class="place-popup__badges">${badges.join('')}</span>
                </button>
            `;
        }).join('');
        const more = sorted.length > PLACE_POPUP_MAX
            ? `<div class="place-popup__more">and ${sorted.length - PLACE_POPUP_MAX} more...</div>`
            : '';
        return `
            <div class="place-popup">
                <strong>${escapeHtml(placeName)}</strong>
                <div class="place-popup__list">${rows}</div>
                ${more}
            </div>
        `;
    }

    function openPlacePopup(feature, latlngOverride) {
        if (!feature || !map) return;
        const props = feature.properties || {};
        const coords = feature.geometry?.coordinates || [];
        const fallbackLatLng = coords.length >= 2 ? [coords[1], coords[0]] : null;
        const latlng = latlngOverride || fallbackLatLng;
        if (!latlng) return;
        const placeName = props.display_name || props.name_en || 'Unknown place';
        const placeKey = placeKeyFromFeature(feature);
        const authorMap = placeKey ? placeToAuthors.get(placeKey) : null;
        const authors = authorMap
            ? Array.from(authorMap.values()).map(entry => ({
                id: entry.id,
                name: entry.name,
                start: entry.start,
                end: entry.end,
                roles: Array.from(entry.roles || [])
            }))
            : [];
        const html = buildPlacePopupContent(placeName, authors);
        L.popup({ closeButton: true, autoPan: true })
            .setLatLng(latlng)
            .setContent(html)
            .openOn(map);
    }

    function attachPlacePopupHandlers(container) {
        const buttons = container.querySelectorAll('.place-popup__author');
        if (!buttons.length) return;
        buttons.forEach(btn => {
            btn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                const qid = btn.getAttribute('data-author-id');
                if (!qid) return;
                if (window.mapAPI?.showAuthorPopup) {
                    window.mapAPI.showAuthorPopup(qid);
                }
                if (window.timelineAPI?.focusAuthor) {
                    const wasLocked = isYearLocked;
                    isYearLocked = true;
                    window.timelineAPI.focusAuthor(qid, { preserveWindow: true });
                    setTimeout(() => { isYearLocked = wasLocked; }, 500);
                }
            });
        });
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
        if (z < 5.8) return new Set(['S']);
        if (z < 6.4) return new Set(['S', 'A']);
        if (z < 7) return new Set(['S', 'A', 'B']);
        return new Set(['S', 'A', 'B', 'C']);
    }

    function placeLabelCandidates(features, mapRef) {
        const b = mapRef.getBounds();
        const z = mapRef.getZoom();
        const allowed = allowedBucketsForZoom(z);
        return features
            .filter(f => {
                const props = f.properties || {};
                if (!props.bucket || !allowed.has(props.bucket)) return false;
                const tags = props.tags || props.core_tags;
                if (!coreTagOk(tags)) return false;
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

    function countOverlaps(rect, occupied) {
        let count = 0;
        for (const r of occupied) {
            if (rectsOverlap(rect, r)) count += 1;
        }
        return count;
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
        const forceOffsetOnOverlap = opts.forceOffsetOnOverlap ?? false;
        const maxRadius = opts.maxRadius ?? 60;
        const step = opts.step ?? 6;
        const angleStep = opts.angleStep ?? 45;
        const coords = feature.geometry.coordinates;
        const basePt = mapRef.latLngToContainerPoint([coords[1], coords[0]]);

        const baseRect = rectForPoint(basePt, labelW, labelH);
        if (countOverlaps(baseRect, occupied) == 0) {
            return { pt: basePt, rect: baseRect };
        }

        let best = { pt: basePt, rect: baseRect, overlaps: countOverlaps(baseRect, occupied), dist: 0 };
        for (let r = step; r <= maxRadius; r += step) {
            for (let a = 0; a < 360; a += angleStep) {
                const rad = (a * Math.PI) / 180;
                const pt = { x: basePt.x + Math.cos(rad) * r, y: basePt.y + Math.sin(rad) * r };
                const rect = rectForPoint(pt, labelW, labelH);
                const overlaps = countOverlaps(rect, occupied);
                if (overlaps == 0) {
                    return { pt, rect };
                }
                if (forceOffsetOnOverlap) {
                    if (overlaps < best.overlaps || (overlaps == best.overlaps && r > best.dist)) {
                        best = { pt, rect, overlaps, dist: r };
                    }
                }
            }
        }

        if (forceOffsetOnOverlap) {
            return { pt: best.pt, rect: best.rect };
        }
        return { pt: basePt, rect: baseRect };
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
            const placedInfo = placeWithOffsets(f, map, occupied, {
                labelW: 90,
                labelH: 18,
                maxRadius: 72,
                step: 6,
                angleStep: 45,
                forceOffsetOnOverlap: true
            });
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
                className: `ancient-label ancient-label-${level} ancient-label-clickable`,
                html: `<span>${escapeHtml(props.display_name || props.name_en || '')}</span>`,
                iconSize: [0, 0]
            });
            const latlng = map.containerPointToLatLng([pt.x, pt.y]);
            const marker = L.marker(latlng, { icon, interactive: true, pane: 'ancient-labels' });
            marker.on('click', () => openPlacePopup(f, marker.getLatLng()));
            if (level === 'major') {
                placeLayers.major.addLayer(marker);
            } else if (level === 'mid') {
                placeLayers.mid.addLayer(marker);
            } else {
                placeLayers.minor.addLayer(marker);
            }
            const placeKey = placeKeyFromFeature(f);
            if (placeKey && !props.place_key) {
                props.place_key = placeKey;
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
        const zoom = Math.min(map.getZoom(), 7);
        const filtered = physicalData.filter(f => {
            const props = f.properties || {};
            return zoom >= getMinZoom(props, 'physical');
        });
        placeLayers.physical.addData(filtered);

        // sea labels disabled
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

