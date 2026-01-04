// Timeline Logic

async function loadData() {
    console.log("Fetching ./data/authors.json...");
    const response = await fetch('./data/authors.json');
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    console.log("Data loaded:", data.length, "items");
    return data;
}

function createDate(year) {
    if (year === null || year === undefined) return null;

    // Use user-recommended robust method for ancient dates/BC
    const d = new Date(Date.UTC(0, 0, 1));
    d.setUTCFullYear(year, 0, 1);
    return d;
}

// Custom date formatter for axis
function formatAxis(date, scale, step) {
    let d = date;
    // Vis.js might pass a Moment object
    if (d && typeof d.toDate === 'function') {
        d = d.toDate();
    } else if (typeof d === 'number') {
        d = new Date(d);
    }

    if (!d || typeof d.getUTCFullYear !== 'function') {
        return String(date);
    }

    const year = d.getUTCFullYear();
    if (year < 0) {
        return Math.abs(year) + " BC";
    }
    return year + " AD";
}

async function initTimeline() {
    try {
        const jsonData = await loadData();

        // Create a DataSet (raw items)
        const rawItems = new vis.DataSet(jsonData.map(item => {
            const start = createDate(item.start);
            const end = createDate(item.end);

            // Vis.js expects start/end. 
            // If type is point, only start is needed.
            // If type is range, both needed.

            // Occupation Styling Logic
            let style = "";
            const primary = item.primary_occupation;

            if (primary) {
                // Dynamic Color Generator
                // Hashes a string to a consistent pastel HSL color.
                const getColor = (str) => {
                    let hash = 0;
                    for (let i = 0; i < str.length; i++) {
                        hash = str.charCodeAt(i) + ((hash << 5) - hash);
                    }
                    // H: 0-360 (Hue)
                    const h = Math.abs(hash % 360);
                    // S: 60-90% (Saturation - keep it vibrant enough)
                    const s = 65 + (Math.abs(hash % 25));
                    // L: 75-85% (Lightness - slightly darker than before for visibility)
                    const l = 75 + (Math.abs(hash % 10));

                    return `hsl(${h}, ${s}%, ${l}%)`;
                };

                // Use single color based on primary occupation
                style = `background-color: ${getColor(primary)}; border-color: #999;`;
            }

            const obj = {
                id: item.id,
                content: item.content,
                start: start,
                end: end,
                type: item.type || 'range', // Default to range
                className: item.className,
                style: style, // Apply inline style
                occupations: item.occupations // Keep usage for filter
            };

            // Only add title if it exists (inferred items have no title)
            if (item.title && item.title.trim().length > 0) {
                obj.title = item.title;
            }

            return obj;
        }));

        // --- Filtering Logic ---

        // 1. Extract unique occupations
        const allOccs = new Set();
        rawItems.forEach(item => {
            if (item.occupations) {
                item.occupations.forEach(o => allOccs.add(o));
            }
        });
        const sortedOccs = Array.from(allOccs).sort();

        // 2. Populate Checkboxes
        const filterContainer = document.getElementById('filter-container');
        sortedOccs.forEach(occ => {
            const div = document.createElement('div');
            const label = document.createElement('label');
            label.style.display = "block";
            label.style.cursor = "pointer";

            const checkbox = document.createElement('input');
            checkbox.type = "checkbox";
            checkbox.value = occ;
            checkbox.style.marginRight = "5px";

            label.appendChild(checkbox);
            label.appendChild(document.createTextNode(occ));
            div.appendChild(label);
            filterContainer.appendChild(div);
        });

        // 3. Create DataView
        const itemsView = new vis.DataView(rawItems, {
            filter: function (item) {
                const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]:checked');
                if (checkboxes.length === 0) return true; // Show all if none selected

                const selected = Array.from(checkboxes).map(cb => cb.value);
                // Return true if item has ANY of the selected occupations
                return item.occupations && item.occupations.some(o => selected.includes(o));
            }
        });

        // 4. Update count helper
        const updateCount = () => {
            document.getElementById('filter-count').textContent = `${itemsView.length} items`;
        };
        updateCount();

        // 5. Event Listeners
        // Use delegation or direct listeners? Direct is fine since we just created them.
        // Actually delegation on container is cleaner.
        filterContainer.addEventListener('change', () => {
            itemsView.refresh();
            updateCount();
            timeline.fit();
        });

        // Clear Filter
        document.getElementById('clear-filters').addEventListener('click', () => {
            const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            itemsView.refresh();
            updateCount();
            timeline.fit();
        });

        // --- Floating Panel Logic ---
        const panel = document.getElementById('controls');
        const header = document.getElementById('panel-header');
        const toggleBtn = document.getElementById('toggle-panel');
        const content = document.getElementById('panel-content');

        // Toggle
        toggleBtn.addEventListener('click', () => {
            if (content.style.display === "none") {
                content.style.display = "block";
                toggleBtn.textContent = "[-]";
            } else {
                content.style.display = "none";
                toggleBtn.textContent = "[+]";
            }
        });

        // Drag
        let isDragging = false;
        let startX, startY, startLeft, startTop;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;

            // Get current computed style
            const style = window.getComputedStyle(panel);
            startLeft = parseInt(style.left);
            startTop = parseInt(style.top);

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
        });

        function onMouseMove(e) {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            panel.style.left = `${startLeft + dx}px`;
            panel.style.top = `${startTop + dy}px`;
        }

        function onMouseUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }
        // Helper to Create JS Date from Year
        // Supports BC (negative years).
        // JS Date: 1 AD = Year 1. 1 BC = Year 0. 2 BC = Year -1.
        function createDate(year) {
            if (year === undefined || year === null) return null;
            // Convert dataset year (where -1 is 1 BC) to JS year (where 0 is 1 BC)
            const jsYear = year < 0 ? year + 1 : year;

            // Use setFullYear to ensure year is set correctly (avoiding 0-99 => 1900s issue)
            const d = new Date(0);
            d.setFullYear(jsYear, 0, 1);
            d.setHours(0, 0, 0, 0);
            return d;
        }

        function formatAxis(date, scale, step) {
            let d = date;
            // Vis.js/Moment compatibility check
            if (d && typeof d.toDate === 'function') {
                d = d.toDate();
            } else if (typeof d === 'number') {
                d = new Date(d);
            }

            if (!d || typeof d.getFullYear !== 'function') {
                console.warn("Invalid date in formatAxis:", date);
                return "";
            }

            const year = d.getFullYear();
            // JS Year 0 is 1 BC. -1 is 2 BC.
            if (year <= 0) {
                return `${Math.abs(year - 1)} BC`;
            }
            return `${year} AD`;
        }

        const container = document.getElementById('timeline-container');

        // Configuration
        const options = {
            height: '100%',
            zoomMin: 1000 * 60 * 60 * 24 * 365 * 10, // 10 years min zoom
            zoomMax: 1000 * 60 * 60 * 24 * 365 * 3000, // 3000 years max zoom
            min: createDate(-1000), // Limit view to 1000 BC
            max: createDate(1350),  // Limit view to 1350 AD
            start: createDate(-300), // Default view start
            end: createDate(300),    // Default view end (Centered on AD 1)
            showMajorLabels: false,  // Hide second row of labels
            format: {
                minorLabels: formatAxis,
                majorLabels: formatAxis // Should be hidden, but just in case
            },
            verticalScroll: true,
            horizontalScroll: true,
            stack: true, // Auto-stack items
            margin: {
                item: 10, // Margin between items
            }
        };

        // Create Timeline with DataView
        const timeline = new vis.Timeline(container, itemsView, options);

        // Remove loading text
        const loading = document.querySelector('.loading');
        if (loading) loading.style.display = 'none';

    } catch (e) {
        console.error("Failed to init timeline:", e);
        document.getElementById('timeline-container').innerHTML = `
            <div style="padding:20px; color:red;">
                Error loading data: ${e.message}<br>
                Check console for details.
            </div>`;
    }
}

document.addEventListener('DOMContentLoaded', initTimeline);
