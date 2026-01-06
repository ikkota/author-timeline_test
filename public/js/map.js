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
    let allMarkers = [];
    let currentYear = null;
    let isYearLocked = false;

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
            maxZoom: 10
        });

        // Add CAWM tile layer (Ancient World)
        const cawmTiles = L.tileLayer('https://cawm.lib.uiowa.edu/tiles/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://cawm.lib.uiowa.edu/">CAWM</a> (CC BY 4.0)',
            maxZoom: 10,
            errorTileUrl: '' // Fallback handled below
        });

        // Fallback to OpenStreetMap if CAWM fails
        const osmTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors'
        });

        // Try CAWM first, fallback to OSM
        cawmTiles.on('tileerror', function () {
            if (!map.hasLayer(osmTiles)) {
                map.addLayer(osmTiles);
            }
        });
        cawmTiles.addTo(map);

        // Initialize marker cluster group
        markersLayer = L.markerClusterGroup({
            maxClusterRadius: 40,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false
        });
        map.addLayer(markersLayer);

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

    // Load authors_geo.json
    async function loadGeoData() {
        try {
            const response = await fetch('data/authors_geo.json');
            authorsGeo = await response.json();
            console.log(`Loaded geo data for ${Object.keys(authorsGeo).length} authors`);

            // Create all markers
            createAllMarkers();

            // Initial display (show all)
            updateMapMarkers(null);
        } catch (error) {
            console.error('Failed to load authors_geo.json:', error);
        }
    }

    // Create markers for all authors with coordinates
    function createAllMarkers() {
        allMarkers = [];

        for (const [qid, author] of Object.entries(authorsGeo)) {
            if (author.geo_status !== 'ok' && author.geo_status !== 'needs_review') {
                continue;
            }

            const activeStart = author.active_range?.start;
            const activeEnd = author.active_range?.end;

            for (const loc of author.locations || []) {
                if (!loc.coord) continue;

                const marker = L.circleMarker([loc.coord.lat, loc.coord.lon], {
                    radius: 6,
                    fillColor: getMarkerColor(loc.source_property),
                    color: '#fff',
                    weight: 1,
                    opacity: 1,
                    fillOpacity: 0.8
                });

                // Popup content
                const popupContent = `
                    <div class="marker-popup">
                        <strong>${author.name}</strong><br>
                        <span class="popup-place">${loc.place_label}</span>
                        <span class="popup-prop">(${formatProperty(loc.source_property)})</span>
                        ${author.wikipedia_url ? `<br><a href="${author.wikipedia_url}" target="_blank">Wikipedia</a>` : ''}
                    </div>
                `;
                marker.bindPopup(popupContent);

                // Store metadata for filtering
                marker._authorData = {
                    qid: qid,
                    name: author.name,
                    start: activeStart,
                    end: activeEnd,
                    location: loc
                };

                allMarkers.push(marker);
            }
        }

        console.log(`Created ${allMarkers.length} markers`);
    }

    // Get marker color based on source property
    function getMarkerColor(prop) {
        switch (prop) {
            case 'P937': return '#e74c3c'; // Work location - red
            case 'P551': return '#3498db'; // Residence - blue
            case 'P19': return '#2ecc71';  // Birth - green
            case 'P20': return '#9b59b6';  // Death - purple
            default: return '#95a5a6';
        }
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

    // Update map markers based on selected year
    function updateMapMarkers(year) {
        markersLayer.clearLayers();

        const yearIndicator = document.getElementById('year-indicator');

        if (year === null) {
            // Show all markers
            allMarkers.forEach(m => markersLayer.addLayer(m));
            if (yearIndicator) yearIndicator.textContent = 'Year: All';
        } else {
            // Filter by year
            const visibleMarkers = allMarkers.filter(m => {
                const data = m._authorData;
                if (data.start === null || data.end === null) return true;
                return data.start <= year && year <= data.end;
            });
            visibleMarkers.forEach(m => markersLayer.addLayer(m));

            const yearStr = year < 0 ? `${Math.abs(year)} BC` : `${year} AD`;
            if (yearIndicator) yearIndicator.textContent = `Year: ${yearStr}`;
        }

        currentYear = year;
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
        unlock: function () {
            isYearLocked = false;
        },
        isLocked: function () {
            return isYearLocked;
        }
    };

    // Initialize when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initMap);
    } else {
        initMap();
    }
})();
