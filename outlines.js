// Building outlines.
// By default only the START and DESTINATION buildings of the chosen route are outlined.
// A tick box ("Show all NUST buildings") draws every building outline as well.
// Reads outlines.geojson (raw Overpass JSON, or GeoJSON polygons) and an optional
// names.json that lets you name or rename buildings by their OpenStreetMap id.
(function () {
  "use strict";
  if (typeof map === "undefined" || typeof L === "undefined") return;

  const LABEL_MIN_ZOOM = 17;   // names of all buildings appear when zoomed in this far
  const NEAR_M = 60;           // a pin outside every outline snaps to the closest outline within this distance

  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const css = document.createElement("style");
  css.textContent =
    ".ol-label{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;text-align:center;" +
    "font:600 11px system-ui,sans-serif;color:#0b3d3f;pointer-events:none;" +
    "text-shadow:0 0 3px #fff,0 0 3px #fff,0 0 3px #fff,0 0 3px #fff}" +
    ".ol-focus{font:700 12px system-ui,sans-serif;color:#1c2a2b;background:#fff;border:1px solid #1c2a2b;border-radius:6px;padding:2px 6px}";
  document.head.appendChild(css);

  const ctl = L.control({ position: "topright" });
  ctl.onAdd = function () {
    const d = L.DomUtil.create("div", "leaflet-bar");
    d.style.cssText = "background:#fff;color:#1c2a2b;padding:6px 8px;font:13px system-ui,sans-serif;max-width:200px";
    d.innerHTML = '<label style="cursor:pointer"><input type="checkbox" id="ol-toggle"> Show all NUST buildings</label>' +
                  '<div id="ol-note" style="font-size:11px;color:#5d6b6c"></div>';
    L.DomEvent.disableClickPropagation(d);
    return d;
  };
  ctl.addTo(map);

  map.createPane("outlinePane").style.zIndex = 450;   // above road/path lines, below markers
  const allShapes = L.layerGroup();                   // every building (off by default)
  const labels = L.layerGroup();                      // names of all buildings
  const focus = L.layerGroup().addTo(map);            // start + destination only (always on)
  const polys = [];                                   // { ll: [[lat,lng]...], tags, id }
  let names = {}, loaded = false, pending = null, loadNote = "";

  const note = t => { const n = document.getElementById("ol-note"); if (n) n.textContent = t; };
  const isOn = () => document.getElementById("ol-toggle").checked;

  // ---- geometry helpers ([lat, lng] points) ----
  function distM(a, b) {
    const r = Math.PI / 180, R = 6371000;
    const dLat = (b[0] - a[0]) * r, dLng = (b[1] - a[1]) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function inside(pt, ring) {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
      if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < (xj - xi) * (pt[0] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function findPoly(c) {                              // c = [lng, lat] (a pin from buildings.geojson)
    const pt = [c[1], c[0]];
    const hit = polys.find(p => inside(pt, p.ll));
    if (hit) return hit;
    let best = null, bd = NEAR_M;
    polys.forEach(p => p.ll.forEach(v => { const d = distM(pt, v); if (d < bd) { bd = d; best = p; } }));
    return best;
  }

  // ---- all-buildings layer ----
  function addPoly(p) {
    const tags = p.tags || {};
    const name = tags.name || "";
    const poly = L.polygon(p.ll, { pane: "outlinePane", color: "#5b6c6d", weight: 2, fillColor: "#9faaaa", fillOpacity: 0.28 });
    poly.bindTooltip(name || "Unnamed building", { sticky: true });
    const addr = [tags["addr:housename"], tags["addr:street"]].filter(Boolean).join(", ");
    poly.bindPopup(
      "<strong>" + esc(name || "Unnamed building") + "</strong>" +
      (tags.code ? " (" + esc(tags.code) + ")" : "") +
      (tags.department ? "<br>" + esc(tags.department) : "") +
      (tags.also ? "<br>Also here: " + esc(tags.also) : "") +
      (tags.building && tags.building !== "yes" ? "<br>Type: " + esc(tags.building) : "") +
      (addr ? "<br>" + esc(addr) : "") +
      (p.id != null ? '<br><small style="color:#5d6b6c">OSM id: ' + esc(p.id) + "</small>" : ""));
    poly.addTo(allShapes);
    if (name) {
      L.marker(poly.getBounds().getCenter(), {
        interactive: false, keyboard: false,
        icon: L.divIcon({ className: "", html: '<div class="ol-label">' + esc(name) + "</div>", iconSize: [0, 0] })
      }).addTo(labels);
    }
  }

  function refreshAll() {
    if (isOn()) allShapes.addTo(map); else map.removeLayer(allShapes);
    if (isOn() && map.getZoom() >= LABEL_MIN_ZOOM) labels.addTo(map); else map.removeLayer(labels);
  }

  // ---- start + destination highlight ----
  function showFocus(detail) {
    focus.clearLayers();
    note(loadNote);
    if (!detail) return;
    const missing = [];
    [["Start", detail.from, "#0f6b6e"], ["Destination", detail.to, "#c2570c"]].forEach(([role, place, color]) => {
      const p = place && findPoly(place.c);
      if (!p) { if (place) missing.push(place.name); return; }
      L.polygon(p.ll, { pane: "outlinePane", color: color, weight: 4, fillColor: color, fillOpacity: 0.4 })
        .bindTooltip(role + ": " + place.name, { permanent: true, direction: "center", className: "ol-focus" })
        .addTo(focus);
    });
    if (missing.length) note("No building outline found for: " + missing.join(", "));
  }

  document.addEventListener("campus-route", e => {    // sent by routing.js
    pending = e.detail || null;
    if (loaded) showFocus(pending);
  });

  // ---- loading ----
  function load(data) {
    const pts = [];
    if (Array.isArray(data.elements)) {                    // Overpass raw JSON
      data.elements.forEach(el => {
        if (el.type === "way" && el.geometry && el.geometry.length > 2 && el.tags && el.tags.building) {
          polys.push({ ll: el.geometry.map(p => [p.lat, p.lon]), tags: Object.assign({}, el.tags), id: el.id });
        } else if (el.type === "node" && el.tags && el.tags.name && el.lat != null) {
          pts.push({ ll: [el.lat, el.lon], name: el.tags.name });
        }
      });
    } else if (Array.isArray(data.features)) {             // GeoJSON
      data.features.forEach(f => {
        const g = f.geometry || {};
        const raw = f.id || (f.properties && f.properties["@id"]) || null;
        const id = raw ? String(raw).replace(/^way\//, "") : null;
        if (g.type === "Polygon") polys.push({ ll: g.coordinates[0].map(c => [c[1], c[0]]), tags: Object.assign({}, f.properties), id: id });
        if (g.type === "MultiPolygon") g.coordinates.forEach(pg => polys.push({ ll: pg[0].map(c => [c[1], c[0]]), tags: Object.assign({}, f.properties), id: id }));
        if (g.type === "Point" && f.properties && f.properties.name)
          pts.push({ ll: [g.coordinates[1], g.coordinates[0]], name: f.properties.name });
      });
    }

    polys.forEach(p => {
      const o = p.id != null ? names[String(p.id)] : null;     // your names.json wins
      if (typeof o === "string") p.tags.name = o;
      else if (o && typeof o === "object") Object.assign(p.tags, o);
      if (p.tags.name) return;
      const hits = pts.filter(q => inside(q.ll, p.ll));         // a named place inside the building
      if (hits.length) {
        p.tags.name = hits[0].name;
        if (hits.length > 1) p.tags.also = hits.slice(1).map(h => h.name).join(", ");
      } else if (p.tags.amenity) {                              // or what OSM says it is, e.g. Library
        const a = String(p.tags.amenity).replace(/_/g, " ");
        p.tags.name = a.charAt(0).toUpperCase() + a.slice(1);
      }
    });

    polys.forEach(addPoly);
    return polys.length;
  }

  document.getElementById("ol-toggle").addEventListener("change", refreshAll);
  map.on("zoomend", refreshAll);

  const getJson = u => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
  getJson("names.json").catch(() => ({}))                  // names.json is optional
    .then(n => { names = n || {}; return getJson("outlines.geojson"); })
    .then(d => {
      const n = load(d);
      loaded = true;
      loadNote = n + " building outlines loaded";
      refreshAll();
      showFocus(pending);
    })
    .catch(e => note("outlines problem: " + e.message));
})();
