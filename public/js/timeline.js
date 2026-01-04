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
                occupations: item.occupations, // Keep usage for filter
                wikipedia_url: item.wikipedia_url // Pass through
            };

            // Only add title if it exists (inferred items have no title)
            if (item.title && item.title.trim().length > 0) {
                // Use tooltipText for custom tooltip, NOT title (which triggers native browser tooltip)
                obj.tooltipText = item.title;
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

        // 5. Create Timeline (Before Event Listeners)

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

        // 6. Event Listeners

        // Custom Tooltip Logic
        const tooltip = document.createElement('div');
        tooltip.id = 'custom-tooltip';
        document.body.appendChild(tooltip);

        let activeItemId = null;
        let tooltipTimeout = null;

        // Global function for filter interaction
        window.filterByOccupation = function (occ) {
            // Uncheck all
            const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);

            // Check target
            const target = Array.from(checkboxes).find(cb => cb.value === occ);
            if (target) {
                target.checked = true;
            }
            // Trigger refresh
            itemsView.refresh();
            updateCount();
            timeline.fit(); // Fit timeline after filter change
        };

        const hideTooltip = () => {
            tooltipTimeout = setTimeout(() => {
                tooltip.style.display = 'none';
                activeItemId = null;
            }, 300); // 300ms delay to allow moving to tooltip
        };

        const showTooltip = (item, x, y) => {
            if (tooltipTimeout) clearTimeout(tooltipTimeout);

            // Construct Content
            // Expected title format: "Name | Dates | Occupations"
            // If inferred, title is missing -> No tooltip (as per prior logic)
            if (!item.tooltipText) return;

            const parts = item.tooltipText.split(' | ');
            const name = parts[0] || item.content;
            const dates = parts[1] || "";
            // Use occupations array for robust linking
            const occs = item.occupations || [];

            let html = `<div class="tooltip-name">`;
            html += `${name}`;
            if (item.wikipedia_url) {
                html += ` <a href="${item.wikipedia_url}" target="_blank" style="color:#007bff; font-weight:normal; font-size: 0.9em; margin-left:5px; text-decoration:none;">(Wikipedia)</a>`;
            }
            html += `</div>`;

            if (dates) {
                html += `<div class="tooltip-dates">${dates}</div>`;
            }

            if (occs.length > 0) {
                html += `<div class="tooltip-occs">`;
                occs.forEach(o => {
                    // Escape quotes just in case
                    const safeOcc = o.replace(/"/g, '&quot;');
                    html += `<span class="tooltip-occ-tag" onclick="window.filterByOccupation('${safeOcc}')">${o}</span>`;
                });
                html += `</div>`;
            }

            tooltip.innerHTML = html;
            tooltip.style.display = 'block';

            // Position
            // Prevent overflow
            const rect = tooltip.getBoundingClientRect();
            let left = x + 15;
            let top = y + 15;

            if (left + rect.width > window.innerWidth) {
                left = x - rect.width - 15;
            }
            if (top + rect.height > window.innerHeight) {
                top = y - rect.height - 15;
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        };

        timeline.on('hoverItem', function (props) {
            const id = props.item;
            activeItemId = id;
            const item = itemsView.get(id); // Get processed item
            if (item) {
                showTooltip(item, props.pageX, props.pageY);
            }
        });

        timeline.on('blurItem', function (props) {
            hideTooltip();
        });

        // Tooltip Interaction
        tooltip.addEventListener('mouseenter', () => {
            if (tooltipTimeout) clearTimeout(tooltipTimeout);
        });

        tooltip.addEventListener('mouseleave', () => {
            hideTooltip();
        });

        // Filter Change Event
        filterContainer.addEventListener('change', () => {
            itemsView.refresh();
            updateCount();
            timeline.fit(); // Fit timeline after filter change
        });

        document.getElementById('clear-filters').addEventListener('click', () => {
            const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            itemsView.refresh();
            updateCount();
            timeline.fit(); // Fit timeline after filter change
        });

        // Floating Panel Logic
        const controls = document.getElementById('controls');
        const header = document.getElementById('panel-header');
        const content = document.getElementById('panel-content');

        document.getElementById('toggle-panel').addEventListener('click', function () {
            if (content.style.display === "none") {
                content.style.display = "block";
                this.textContent = "[-]";
            } else {
                content.style.display = "none";
                this.textContent = "[+]";
            }
        });

        // Floating Panel Drag Logic
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = controls.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            controls.style.right = 'auto'; // Disable right-lock
            controls.style.left = initialLeft + 'px';
            controls.style.top = initialTop + 'px';
            e.preventDefault(); // Prevent text selection
        });

        document.addEventListener('mousemove', (e) => {
            if (isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                controls.style.left = (initialLeft + dx) + 'px';
                controls.style.top = (initialTop + dy) + 'px';
            }
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });

        // Remove loading text
        const loading = document.querySelector('.loading');
        if (loading) loading.style.display = 'none';
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
