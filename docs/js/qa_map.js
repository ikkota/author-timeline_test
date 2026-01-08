(function () {
  "use strict";

  const thresholds = {
    places: { low: 4, mid: 7, high: 9 },
    physical: { low: 4, mid: 6, high: 8 }
  };

  const CORE_TAG_MODE = "all"; // "author_related" | "greek" | "roman" | "all"

  const map = L.map("qa-map", {
    center: [38, 20],
    zoom: 4,
    minZoom: 4,
    maxZoom: 7
  });

  const base = L.tileLayer(
    "https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png",
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 20
    }
  );
  base.addTo(map);

  const placesLayer = L.layerGroup().addTo(map);
  const physicalLayer = L.geoJSON([], {
    style: feature => stylePhysical(feature)
  }).addTo(map);
  const seaLabelLayer = L.layerGroup().addTo(map);

  const state = {
    places: [],
    physical: [],
    seaLabels: []
  };

  const ui = {
    placesToggle: document.getElementById("qa-toggle-places"),
    physicalToggle: document.getElementById("qa-toggle-physical"),
    seaToggle: document.getElementById("qa-toggle-sea"),
    placesCount: document.getElementById("qa-places-count"),
    physicalCount: document.getElementById("qa-physical-count"),
    seaCount: document.getElementById("qa-sea-count"),
    zoomLabel: document.getElementById("qa-zoom"),
    visiblePlaces: document.getElementById("qa-visible-places"),
    visiblePhysical: document.getElementById("qa-visible-physical"),
    visibleSea: document.getElementById("qa-visible-sea")
  };

  function escapeHtml(text) {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getMinZoom(props, category) {
    const minZoom = props.minZoom;
    if (typeof minZoom === "number") {
      return minZoom;
    }
    const tier = props.tier;
    if (tier && thresholds[category] && thresholds[category][tier] !== undefined) {
      return thresholds[category][tier];
    }
    return thresholds[category].high;
  }

  function getPlaceClass(props) {
    const minZoom = getMinZoom(props, "places");
    if (minZoom <= thresholds.places.low) return "major";
    if (minZoom <= thresholds.places.mid) return "mid";
    return "minor";
  }

  function passesZoom(props, category, zoom) {
    return zoom >= getMinZoom(props, category);
  }

  function coreTagOk(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return false;
    if (CORE_TAG_MODE === "all") return true;
    return tags.includes(CORE_TAG_MODE);
  }

  function allowedBucketsForZoom(z) {
    if (z < 5.8) return new Set(["S"]);
    if (z < 6.4) return new Set(["S", "A"]);
    if (z < 7) return new Set(["S", "A", "B"]);
    return new Set(["S", "A", "B", "C"]);
  }

  function maxPlacesForZoom(zoom) {
    if (zoom < 5) return 150;
    if (zoom < 7) return 400;
    if (zoom < 9) return 800;
    return 1600;
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
      y2: pt.y + labelH / 2
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
    if (countOverlaps(baseRect, occupied) === 0) {
      return { pt: basePt, rect: baseRect };
    }

    let best = { pt: basePt, rect: baseRect, overlaps: countOverlaps(baseRect, occupied), dist: 0 };
    for (let r = step; r <= maxRadius; r += step) {
      for (let a = 0; a < 360; a += angleStep) {
        const rad = (a * Math.PI) / 180;
        const pt = { x: basePt.x + Math.cos(rad) * r, y: basePt.y + Math.sin(rad) * r };
        const rect = rectForPoint(pt, labelW, labelH);
        const overlaps = countOverlaps(rect, occupied);
        if (overlaps === 0) {
          return { pt, rect };
        }
        if (forceOffsetOnOverlap) {
          if (overlaps < best.overlaps || (overlaps === best.overlaps && r > best.dist)) {
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

  function stylePhysical(feature) {
    const type = feature?.properties?.feature_type;
    if (type === "coastline") {
      return { color: "#3b3b3b", weight: 1.1, opacity: 0.7 };
    }
    if (type === "river") {
      return { color: "#2f6f8f", weight: 1.1, opacity: 0.85 };
    }
    if (type === "lake") {
      return {
        color: "#2f6f8f",
        weight: 0.9,
        opacity: 0.8,
        fillColor: "#7fb2c9",
        fillOpacity: 0.35
      };
    }
    if (type === "sea_region") {
      return {
        color: "#6aa2b8",
        weight: 0.8,
        opacity: 0.6,
        fillColor: "#b8d6e2",
        fillOpacity: 0.2
      };
    }
    return { color: "#555", weight: 1 };
  }

  function centroidOfCoords(coords) {
    let sumLat = 0;
    let sumLon = 0;
    let count = 0;
    const walk = item => {
      if (!Array.isArray(item)) return;
      if (item.length >= 2 && typeof item[0] === "number") {
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

  function buildSeaLabels(features) {
    const labels = [];
    features.forEach(feat => {
      const props = feat.properties || {};
      if (props.feature_type !== "sea_region" || !props.name_en) return;
      const center = centroidOfCoords(feat.geometry?.coordinates);
      if (!center) return;
      labels.push({
        name: props.name_en,
        lat: center[0],
        lon: center[1],
        minZoom: getMinZoom(props, "physical")
      });
    });
    return labels;
  }

  function updatePlaces() {
    if (!ui.placesToggle.checked) {
      placesLayer.clearLayers();
      ui.visiblePlaces.textContent = "0";
      return;
    }

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const allowed = allowedBucketsForZoom(zoom);
    const candidates = state.places.filter(feat => {
      const props = feat.properties || {};
      if (!props.bucket || !allowed.has(props.bucket)) return false;
      const tags = props.tags || props.core_tags;
      if (!coreTagOk(tags)) return false;
      const coords = feat.geometry?.coordinates || [];
      if (coords.length < 2) return false;
      return bounds.contains([coords[1], coords[0]]);
    });

    candidates.sort((a, b) => {
      const aProps = a.properties || {};
      const bProps = b.properties || {};
      const aImp = aProps.importance || 0;
      const bImp = bProps.importance || 0;
      const aBucket = aProps.bucket_rank || 0;
      const bBucket = bProps.bucket_rank || 0;
      const aPriority = aBucket * 10000 + aImp;
      const bPriority = bBucket * 10000 + bImp;
      if (bPriority !== aPriority) return bPriority - aPriority;
      const aName = aProps.display_name || aProps.name_en || "";
      const bName = bProps.display_name || bProps.name_en || "";
      return aName.localeCompare(bName);
    });

    const maxCount = maxPlacesForZoom(zoom);
    const visible = candidates.slice(0, maxCount);

    const placed = [];
    const occupied = [];
    const sLabels = [];
    const otherLabels = [];
    visible.forEach(feat => {
      const props = feat.properties || {};
      if (props.bucket === "S") sLabels.push(feat);
      else otherLabels.push(feat);
    });

    for (const feat of sLabels) {
      const placedInfo = placeWithOffsets(feat, map, occupied, {
        labelW: 90,
        labelH: 18,
        maxRadius: 72,
        step: 6,
        angleStep: 45,
        forceOffsetOnOverlap: true
      });
      occupied.push(placedInfo.rect);
      placed.push({ f: feat, pt: placedInfo.pt });
    }

    for (const feat of otherLabels) {
      const coords = feat.geometry?.coordinates || [];
      if (coords.length < 2) continue;
      const pt = map.latLngToContainerPoint([coords[1], coords[0]]);
      placed.push({ f: feat, pt });
    }

    placesLayer.clearLayers();
    placed.forEach(({ f, pt }) => {
      const props = f.properties || {};
      const label = props.display_name || props.name_en || "";
      const level = getPlaceClass(props);
      const icon = L.divIcon({
        className: `qa-label qa-label-${level}`,
        html: `<span>${escapeHtml(label)}</span>`,
        iconSize: [0, 0]
      });
      const latlng = map.containerPointToLatLng([pt.x, pt.y]);
      L.marker(latlng, { icon: icon, interactive: false }).addTo(placesLayer);
    });

    ui.visiblePlaces.textContent = String(visible.length);
  }

  function updatePhysical() {
    if (!ui.physicalToggle.checked) {
      physicalLayer.clearLayers();
      ui.visiblePhysical.textContent = "0";
      return;
    }

    const zoom = map.getZoom();
    const filtered = state.physical.filter(feat =>
      passesZoom(feat.properties || {}, "physical", zoom)
    );
    physicalLayer.clearLayers();
    physicalLayer.addData(filtered);
    ui.visiblePhysical.textContent = String(filtered.length);
  }

  function updateSeaLabels() {
    if (!ui.seaToggle.checked) {
      seaLabelLayer.clearLayers();
      ui.visibleSea.textContent = "0";
      return;
    }

    const zoom = map.getZoom();
    const bounds = map.getBounds();
    const visible = state.seaLabels.filter(label => {
      if (zoom < label.minZoom) return false;
      return bounds.contains([label.lat, label.lon]);
    });

    seaLabelLayer.clearLayers();
    visible.forEach(label => {
      const icon = L.divIcon({
        className: "qa-label qa-label-sea",
        html: `<span>${escapeHtml(label.name)}</span>`,
        iconSize: [0, 0]
      });
      L.marker([label.lat, label.lon], { icon: icon, interactive: false }).addTo(
        seaLabelLayer
      );
    });

    ui.visibleSea.textContent = String(visible.length);
  }

  function updateCounts() {
    ui.zoomLabel.textContent = map.getZoom().toFixed(1);
    updatePlaces();
    updatePhysical();
    updateSeaLabels();
  }

  function wireControls() {
    ["placesToggle", "physicalToggle", "seaToggle"].forEach(key => {
      ui[key].addEventListener("change", () => updateCounts());
    });
  }

  function loadData() {
    return Promise.all([
      fetch("data/places_from_authors.geojson").then(resp => resp.json()),
      fetch("data/physical.geojson").then(resp => resp.json())
    ]).then(([places, physical]) => {
      state.places = places.features || [];
      state.physical = physical.features || [];
      state.seaLabels = buildSeaLabels(state.physical);

      ui.placesCount.textContent = String(state.places.length);
      ui.physicalCount.textContent = String(state.physical.length);
      ui.seaCount.textContent = String(state.seaLabels.length);

      updateCounts();
    });
  }

  wireControls();
  loadData().catch(err => {
    console.error("QA map load failed:", err);
  });

  map.on("zoomend moveend", updateCounts);
})();
