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
                style = `background-color: ${getOccColor(primary)}; border-color: #999;`;
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

        const getSelectedOccupations = () => {
            const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]:checked');
            return Array.from(checkboxes).map(cb => cb.value);
        };

        const syncMapOccupationFilter = () => {
            if (window.mapAPI?.setOccupationFilter) {
                window.mapAPI.setOccupationFilter(getSelectedOccupations());
            }
        };

        const updateCount = () => {
            document.getElementById('filter-count').textContent = `${itemsView.length} items`;
        };
        updateCount();

        const outerContainer = document.getElementById('timeline-container');
        let container = document.getElementById('timeline-view');
        if (!container) {
            container = document.createElement('div');
            container.id = 'timeline-view';
            outerContainer.appendChild(container);
        }

        const options = {
            height: '100%',
            zoomMin: 1000 * 60 * 60 * 24 * 365 * 10,
            zoomMax: 1000 * 60 * 60 * 24 * 365 * 3000,
            min: createDate(-1000),
            max: createDate(1350),
            start: createDate(-500),
            end: createDate(500),
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

        let mapLockedYear = null;
        let suppressMapSync = false;
        let isScrubbing = false;

        const formatYearLabel = (year) => {
            return year < 0 ? `${Math.abs(year)} BC` : `${year} AD`;
        };

        const getCenterYearFromRange = (range) => {
            const centerTime = (range.start.getTime() + range.end.getTime()) / 2;
            return new Date(centerTime).getUTCFullYear();
        };

        const setScrubberYear = (scrubberInput, scrubberLabel, year) => {
            if (!scrubberInput) return;
            scrubberInput.value = year;
            if (scrubberLabel) {
                scrubberLabel.textContent = `Year: ${formatYearLabel(year)}`;
            }
        };

        const panTimelineToYear = (year) => {
            const centerDate = createDate(year);
            if (!centerDate) return;
            const range = timeline.getWindow();
            const span = range.end.getTime() - range.start.getTime();
            const centerMs = centerDate.getTime();
            const start = new Date(centerMs - span / 2);
            const end = new Date(centerMs + span / 2);
            timeline.setWindow(start, end, { animation: false });
        };

        const existingScrubber = document.getElementById('time-scrubber');
        let scrubberInput = null;
        let scrubberLabel = null;

        if (existingScrubber) {
            scrubberInput = existingScrubber.querySelector('#time-scrubber-input');
            scrubberLabel = existingScrubber.querySelector('#time-scrubber-label');
        } else {
            const scrubber = document.createElement('div');
            scrubber.id = 'time-scrubber';

            scrubberLabel = document.createElement('span');
            scrubberLabel.id = 'time-scrubber-label';

            scrubberInput = document.createElement('input');
            scrubberInput.id = 'time-scrubber-input';
            scrubberInput.type = 'range';
            scrubberInput.min = options.min.getUTCFullYear();
            scrubberInput.max = options.max.getUTCFullYear();
            scrubberInput.step = 1;

            scrubber.appendChild(scrubberLabel);
            scrubber.appendChild(scrubberInput);
            outerContainer.appendChild(scrubber);
        }

        const initialYear = getCenterYearFromRange(timeline.getWindow());
        setScrubberYear(scrubberInput, scrubberLabel, initialYear);

        if (scrubberInput) {
            scrubberInput.addEventListener('input', () => {
                const year = parseInt(scrubberInput.value, 10);
                if (Number.isNaN(year)) return;
                isScrubbing = true;
                mapLockedYear = null;
                if (window.mapAPI) {
                    window.mapAPI.unlock();
                }
                setScrubberYear(scrubberInput, scrubberLabel, year);
                panTimelineToYear(year);
                if (window.mapAPI) {
                    window.mapAPI.setYear(year, false);
                }
            });

            scrubberInput.addEventListener('change', () => {
                isScrubbing = false;
            });
        }

        // --- Improved Tooltip Logic ---
        const tooltip = document.createElement('div');
        tooltip.id = 'custom-tooltip';
        document.body.appendChild(tooltip);

        // Close tooltip when clicking outside (blank area)
        document.addEventListener('mousedown', (e) => {
            // 1) Ignore clicks inside tooltip (links, tags)
            if (tooltip.contains(e.target)) return;

            // 2) Ignore clicks on timeline items (handled by mousemove/hover logic)
            if (e.target.closest && e.target.closest('.vis-item')) return;

            // 3) Close for anything else (background)
            tooltip.style.display = 'none';
            activeItemId = null;
            if (tooltipTimeout) clearTimeout(tooltipTimeout);
        });

        // Close on ESC key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                tooltip.style.display = 'none';
                activeItemId = null;
                if (tooltipTimeout) clearTimeout(tooltipTimeout);
            }
        });

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
            syncMapOccupationFilter();
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
            // ---- Position tooltip (prefer ABOVE the item) ----
            tooltip.style.display = 'block';

            // Get dimensions
            const itemRect = element.getBoundingClientRect();
            const tipRect = tooltip.getBoundingClientRect();

            // Horizontal: Center on item, clamp to viewport edges
            let left = itemRect.left + itemRect.width / 2 - tipRect.width / 2;
            left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

            // Vertical: Prefer above (item top - tip height - margin)
            const margin = 10;
            let top = itemRect.top - tipRect.height - margin;

            // Fallback to below if overlapping with viewport top
            if (top < 8) {
                top = itemRect.bottom + margin;
            }

            // Apply absolute coordinates including scroll
            tooltip.style.left = `${left + window.scrollX}px`;
            tooltip.style.top = `${top + window.scrollY}px`;
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
            syncMapOccupationFilter();
        });

        document.getElementById('clear-filters').addEventListener('click', () => {
            const checkboxes = filterContainer.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
            itemsView.refresh();
            updateCount();
            timeline.fit();
            syncMapOccupationFilter();
        });

        // --- Timeline-Map Sync ---

        // Update map on timeline range change (pan/zoom)
        timeline.on('rangechange', function (props) {
            const year = getCenterYearFromRange(props);
            if (!isScrubbing) {
                setScrubberYear(scrubberInput, scrubberLabel, year);
            }
            if (mapLockedYear !== null || suppressMapSync) return; // Don't update if locked/suppressed

            if (window.mapAPI) {
                window.mapAPI.setYear(year, false);
            }
        });

        // Lock year on click
        timeline.on('click', function (props) {
            if (props.time) {
                const year = props.time.getUTCFullYear();
                mapLockedYear = year;
                if (window.mapAPI) {
                    window.mapAPI.setYear(year, true);
                }
                setScrubberYear(scrubberInput, scrubberLabel, year);

                if (props.item && window.mapAPI?.showAuthorPopup) {
                    const qid = props.item;
                    setTimeout(() => {
                        window.mapAPI.showAuthorPopup(qid);
                    }, 0);
                }
            }
        });

        // Unlock on ESC (add to existing ESC handler)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && mapLockedYear !== null) {
                mapLockedYear = null;
                if (window.mapAPI) {
                    window.mapAPI.unlock();
                    // Update to current center
                    const range = timeline.getWindow();
                    const centerTime = (range.start.getTime() + range.end.getTime()) / 2;
                    const year = new Date(centerTime).getUTCFullYear();
                    window.mapAPI.setYear(year, false);
                }
            }
        });

        // Unlock on background click
        container.addEventListener('click', (e) => {
            if (!e.target.closest('.vis-item') && mapLockedYear !== null) {
                mapLockedYear = null;
                if (window.mapAPI) {
                    window.mapAPI.unlock();
                }
            }
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

        // --- Expose Timeline API for external use (e.g., from map) ---
        const getItemDomById = (qid) => {
            // Find the DOM element for the item - try multiple selectors
            let itemDom = container.querySelector(`.vis-item[data-id="${qid}"]`);

            // Fallback: try to find by searching vis-item elements
            if (!itemDom) {
                const allItems = container.querySelectorAll('.vis-item');
                for (const el of allItems) {
                    if (el.dataset && el.dataset.id === qid) {
                        itemDom = el;
                        break;
                    }
                }
            }

            // Another fallback: find selected item
            if (!itemDom) {
                itemDom = container.querySelector('.vis-item.vis-selected');
            }

            return itemDom;
        };

        const getTimelineScrollPanel = () => {
            return container.querySelector('.vis-panel.vis-center') || container;
        };

        const isItemFullyVisible = (itemDom) => {
            const panel = getTimelineScrollPanel();
            const panelRect = panel.getBoundingClientRect();
            const itemRect = itemDom.getBoundingClientRect();
            const margin = 8;
            return itemRect.top >= panelRect.top + margin && itemRect.bottom <= panelRect.bottom - margin;
        };

        const showTooltipAtCenter = (item) => {
            const containerRect = container.getBoundingClientRect();
            tooltip.innerHTML = buildTooltipHtml(item);
            tooltip.style.display = 'block';
            tooltip.style.left = (containerRect.left + containerRect.width / 2 - 150) + 'px';
            tooltip.style.top = (containerRect.top + 50) + 'px';
        };

        const bringItemIntoView = (qid) => {
            const prevWindow = timeline.getWindow();
            suppressMapSync = true;
            timeline.focus(qid, { animation: false });
            timeline.setWindow(prevWindow.start, prevWindow.end, { animation: false });
            setTimeout(() => { suppressMapSync = false; }, 0);
        };

        const showTooltipForId = (qid, options = {}) => {
            const item = itemsView.get(qid);
            if (!item) return;
            const ensureVisible = options.ensureVisible === true;

            let itemDom = getItemDomById(qid);

            if (itemDom) {
                if (ensureVisible && !isItemFullyVisible(itemDom)) {
                    bringItemIntoView(qid);
                    requestAnimationFrame(() => {
                        const refreshed = getItemDomById(qid);
                        if (refreshed) {
                            showTooltip(item, refreshed);
                        } else {
                            showTooltipAtCenter(item);
                        }
                    });
                    return;
                }
                showTooltip(item, itemDom);
            } else {
                if (ensureVisible) {
                    bringItemIntoView(qid);
                    requestAnimationFrame(() => {
                        const refreshed = getItemDomById(qid);
                        if (refreshed) {
                            showTooltip(item, refreshed);
                        } else {
                            showTooltipAtCenter(item);
                        }
                    });
                    return;
                }
                // Final fallback: position tooltip at timeline center
                showTooltipAtCenter(item);
            }
        };

        // Helper to build tooltip HTML (same as in showTooltip)
        const buildTooltipHtml = (item) => {
            const wikiLink = item.wikipedia_url || item.wikipediaUrl;
            const dates = item.tooltipText || "";
            const occs = item.occupations || [];

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
            return html;
        };

        window.timelineAPI = {
            focusAuthor(qid, options = {}) {
                const preserveWindow = options.preserveWindow === true;

                // 1) Select the item (avoid horizontal move when preserveWindow)
                timeline.setSelection([qid], { focus: !preserveWindow });

                if (preserveWindow) {
                    // 2) Scroll vertically only and show tooltip
                    setTimeout(() => {
                        showTooltipForId(qid, { ensureVisible: true });
                    }, 0);
                    return;
                }

                // 2) Focus (center on it with animation)
                timeline.focus(qid, {
                    animation: { duration: 300, easingFunction: 'easeInOutQuad' }
                });

                // 3) Show tooltip after animation completes and DOM re-renders
                setTimeout(() => {
                    showTooltipForId(qid);
                }, 400);
            }
        };

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
