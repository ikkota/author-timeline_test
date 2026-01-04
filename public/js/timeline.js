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

        // Transform JSON integer years to JS Date objects
        const items = new vis.DataSet(jsonData.map(item => {
            const start = createDate(item.start);
            const end = createDate(item.end);

            // Vis.js expects start/end. 
            // If type is point, only start is needed.
            // If type is range, both needed.

            return {
                id: item.id,
                content: item.content,
                start: start,
                end: end,
                type: item.type,
                title: item.title,
                className: item.className,
                group: item.group // if we add grouping later
            };
        }));

        const container = document.getElementById('timeline-container');

        // Configuration
        const options = {
            height: '100%',
            zoomMin: 1000 * 60 * 60 * 24 * 365 * 10, // 10 years min zoom
            zoomMax: 1000 * 60 * 60 * 24 * 365 * 3000, // 3000 years max zoom
            start: createDate(-500), // Default view: Classical antiquity
            end: createDate(0),
            format: {
                minorLabels: formatAxis,
                majorLabels: formatAxis
            },
            verticalScroll: true,
            horizontalScroll: true,
            stack: true, // Auto-stack items
            margin: {
                item: 10, // Margin between items
            }
        };

        // Create Timeline
        const timeline = new vis.Timeline(container, items, options);

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
