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

            // Occupation Styling Logic
            let style = "";
            const primary = item.primary_occupation;

            if (primary) {
                const getColor = (str) => {
                    let hash = 0;
                    for (let i = 0; i < str.length; i++) {
                        hash = str.charCodeAt(i) + ((hash << 5) - hash);
                    }
                    const h = Math.abs(hash % 360);
                    const s = 65 + (Math.abs(hash % 25));
                    const l = 75 + (Math.abs(hash % 10));
                    return `hsl(${h}, ${s}%, ${l}%)`;
                };
                style = `background-color: ${getColor(primary)}; border-color: #999;`;
            }

            const obj = {
                id: item.id,
                content: item.content,
                start: start,
                end: end,
                type: item.type || 'range',
                className: item.className,
                style: style,
                occupations: item.occupations,
                wikipedia_url: item.wikipedia_url || item.wikipediaUrl // Support both
            };

            if (item.title && item.title.trim().length > 0) {
                obj.tooltipText = item.title;
            }

            return obj;
        }));

        // --- Filtering Logic ---
        const allOccs = new Set();
        rawItems.forEach(item => {
            if (item.occupations) {
                item.occupations.forEach(o => allOccs.add(o));
            }
        });
        const sortedOccs = Array.from(allOccs).sort();

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

        const itemsView = new vis.DataView(rawItems, {
            filter: function (item) {
                const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]:checked');
                if (checkboxes.length === 0) return true;
                const selected = Array.from(checkboxes).map(cb => cb.value);
                return item.occupations && item.occupations.some(o => selected.includes(o));
            }
        });

        const updateCount = () => {
            document.getElementById('filter-count').textContent = `${itemsView.length} items`;
        };
        updateCount();

        const container = document.getElementById('timeline-container');

        const options = {
            height: '100%',
            zoomMin: 1000 * 60 * 60 * 24 * 365 * 10,
            zoomMax: 1000 * 60 * 60 * 24 * 365 * 3000,
            min: createDate(-1000),
            max: createDate(1350),
            start: createDate(-300),
            end: createDate(300),
            showMajorLabels: false,
            format: {
                minorLabels: formatAxis,
                majorLabels: formatAxis
            },
            verticalScroll: true,
            horizontalScroll: true,
            stack: true,
            margin: {
                item: 10,
            }
        };

        const timeline = new vis.Timeline(container, itemsView, options);

        // --- Improved Tooltip Logic ---
        const tooltip = document.createElement('div');
        tooltip.id = 'custom-tooltip';
        document.body.appendChild(tooltip);

        let activeItemId = null;
        let tooltipTimeout = null;
        let tooltipHovered = false;

        window.filterByOccupation = function (occ) {
            const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            const target = Array.from(checkboxes).find(cb => cb.value === occ);
            if (target) target.checked = true;
            itemsView.refresh();
            updateCount();
            timeline.fit();
        };

        const hideTooltip = () => {
            if (tooltipHovered) return;
            if (tooltipTimeout) clearTimeout(tooltipTimeout);

            tooltipTimeout = setTimeout(() => {
                if (tooltipHovered) return;
                tooltip.style.display = 'none';
                activeItemId = null;
            }, 700); // 700ms delay for easier transition
        };

        const showTooltip = (item, element) => {
            if (tooltipTimeout) clearTimeout(tooltipTimeout);

            const wikiLink = item.wikipedia_url || item.wikipediaUrl;
            const dates = item.tooltipText || "";
            const occs = item.occupations || [];

            // Condition to show tooltip
            if (!dates.trim() && !wikiLink && occs.length === 0) return;

            let html = `<div class="tooltip-name">${item.content}`;
            if (wikiLink) {
                html += ` <a href="${wikiLink}" target="_blank" rel="noopener noreferrer" class="tooltip-wiki">(Wikipedia)</a>`;
            }
            html += `</div>`;

            if (dates.trim()) {
                html += `<div class="tooltip-dates">${dates}</div>`;
            }

            if (occs.length > 0) {
                html += `<div class="tooltip-occs">`;
                occs.forEach(o => {
                    const safeOcc = o.replace(/"/g, '&quot;');
                    html += `<span class="tooltip-occ-tag" onclick="window.filterByOccupation('${safeOcc}')">${o}</span>`;
                });
                html += `</div>`;
            }

            tooltip.innerHTML = html;
            tooltip.style.display = 'block';

            if (!element) return;
            const itemRect = element.getBoundingClientRect();
            const tooltipRect = tooltip.getBoundingClientRect();

            let left = itemRect.left + (itemRect.width / 2) - (tooltipRect.width / 2);
            let top = itemRect.bottom + 5;

            if (left < 10) left = 10;
            if (left + tooltipRect.width > window.innerWidth - 10) {
                left = window.innerWidth - tooltipRect.width - 10;
            }
            if (top + tooltipRect.height > window.innerHeight - 10) {
                top = itemRect.top - tooltipRect.height - 5;
            }

            tooltip.style.left = left + 'px';
            tooltip.style.top = top + 'px';
        };

        container.addEventListener('mousemove', function (event) {
            const props = timeline.getEventProperties(event);
            const id = props.item;

            if (id) {
                if (activeItemId !== id) {
                    activeItemId = id;
                    const item = itemsView.get(id);
                    if (item) {
                        let target = event.target;
                        while (target && target !== container) {
                            if (target.classList && target.classList.contains('vis-item')) break;
                            target = target.parentElement;
                        }
                        if (target && target.classList.contains('vis-item')) {
                            showTooltip(item, target);
                        }
                    }
                }
            } else {
                if (activeItemId !== null && !tooltipHovered) {
                    hideTooltip();
                }
            }
        });

        container.addEventListener('mouseleave', function () {
            if (!tooltipHovered) hideTooltip();
        });

        // Tooltip Interaction
        tooltip.addEventListener('mouseenter', () => {
            tooltipHovered = true;
            if (tooltipTimeout) clearTimeout(tooltipTimeout);
        });

        tooltip.addEventListener('mouseleave', () => {
            tooltipHovered = false;
            hideTooltip();
        });

        // Prevent events from bubbling up to container when inside tooltip
        tooltip.addEventListener('mousemove', (e) => e.stopPropagation());
        tooltip.addEventListener('mousedown', (e) => e.stopPropagation());

        filterContainer.addEventListener('change', () => {
            itemsView.refresh();
            updateCount();
            timeline.fit();
        });

        document.getElementById('clear-filters').addEventListener('click', () => {
            const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            itemsView.refresh();
            updateCount();
            timeline.fit();
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

        let isDragging = false;
        let startX, startY, initialLeft, initialTop;

        header.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = controls.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            controls.style.right = 'auto';
            controls.style.left = initialLeft + 'px';
            controls.style.top = initialTop + 'px';
            e.preventDefault();
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
