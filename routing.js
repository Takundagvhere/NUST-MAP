// Routes between buildings, on foot or by vehicle.
// Reads paths.geojson, which can be EITHER a normal GeoJSON file of lines OR the
// raw JSON export from Overpass Turbo (the one with an "elements" list).
// On foot: footpaths, steps, pedestrian ways and all ordinary roads/service lanes, any direction.
// By vehicle: only roads cars may use, respecting one-way streets.
// Building points are never changed.
(function () {
  "use strict";
  if (typeof map === "undefined" || typeof L === "undefined") return;

  const FOOT = 1, CAR = 2;                  // travel modes (also edge flags)
  const MERGE_M = 3;                        // GeoJSON only: points closer than this are one junction
  const SNAP_M = 15;                        // your own pathways: each end joins the nearest road/path within this distance
  const WARN_M = 60;                        // warn if a building is farther than this from the network
  const SPEED = { 1: 80, 2: 400 };          // metres per minute: rough walking / campus driving estimates
  const MODE_TEXT = { 1: "on foot", 2: "by vehicle" };

  // Decide who may use a way: { foot, car, oneway (1 forward, -1 reverse, 0 both) }.
  function classify(tags) {
    tags = tags || {};
    const hw = tags.highway || "";
    if (!hw) {                              // hand-drawn GeoJSON line with no road type: walkway
      return { foot: true, car: tags.vehicles === true || tags.vehicles === "yes", oneway: 0 };
    }
    let car = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|road)(_link)?$/.test(hw);
    let foot = !/^(motorway|trunk)(_link)?$/.test(hw) && !/_link$/.test(hw);
    if (tags.access === "no" || tags.access === "private") {
      if (tags.foot !== "yes" && tags.foot !== "permissive") foot = false;
      if (tags.motor_vehicle !== "yes" && tags.vehicle !== "yes" && tags.motor_vehicle !== "permissive") car = false;
    }
    if (tags.foot === "no") foot = false;
    if (tags.motor_vehicle === "no" || tags.vehicle === "no") car = false;
    let oneway = 0;
    const o = tags.oneway;
    if (o === "yes" || o === "1" || o === "true" || tags.junction === "roundabout") oneway = 1;
    else if (o === "-1") oneway = -1;
    return { foot: foot, car: car, oneway: oneway };
  }

  const style = document.createElement("style");
  style.textContent = `
    #route-panel { display:flex; flex-wrap:wrap; gap:8px; align-items:end; padding:8px 14px; border-bottom:1px solid var(--line); }
    #route-panel label { display:flex; flex-direction:column; font-size:.75rem; color:var(--muted); flex:1 1 140px; }
    #route-panel label.chk { flex-direction:row; align-items:center; gap:6px; flex:0 0 auto; font-size:.85rem; color:var(--ink); }
    #route-panel select { padding:8px; font-size:.95rem; border:1px solid var(--line); border-radius:8px; background:var(--bg); color:var(--ink); }
    #route-panel button { padding:9px 12px; font-size:.9rem; border:1px solid var(--accent); border-radius:8px; background:var(--accent); color:var(--bg); cursor:pointer; }
    #route-panel button.secondary { background:transparent; color:var(--ink); border-color:var(--line); }
    #route-panel button:focus-visible, #route-panel select:focus-visible, #route-panel input:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
    #rt-msg { flex:1 1 100%; margin:0; font-size:.85rem; color:var(--ink); }
  `;
  document.head.appendChild(style);

  const panel = document.createElement("div");
  panel.id = "route-panel";
  panel.innerHTML =
    '<label>From<select id="rt-from"></select></label>' +
    '<label>To<select id="rt-to"></select></label>' +
    '<label>Travel<select id="rt-mode"><option value="1">On foot</option><option value="2">By vehicle</option></select></label>' +
    '<button id="rt-go" type="button">Show route</button>' +
    '<button id="rt-clear" type="button" class="secondary">Clear</button>' +
    '<label class="chk"><input type="checkbox" id="rt-net" checked> Show path network</label>' +
    '<p id="rt-msg" aria-live="polite"></p>';
  const anchor = document.getElementById("status");
  if (anchor) anchor.after(panel); else document.body.prepend(panel);

  const $ = id => document.getElementById(id);
  const msg = t => { $("rt-msg").textContent = t; };
  const mode = () => Number($("rt-mode").value) === CAR ? CAR : FOOT;

  const R = 6371000;
  function dist(a, b) {            // a, b = [lng, lat], result in metres
    const r = Math.PI / 180;
    const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // edges: [to, metres, mask] usable from this end (mask bit 1 = foot, 2 = vehicle)
  // und:   [to, mask] ignoring direction, used to find connected pieces
  const nodes = [];
  const byId = new Map();          // OSM node id -> index (Overpass data joins on ids)
  const lines = [];                // every kept line, for the network view

  function nodeFor(c, id) {
    if (id !== null && id !== undefined) {
      if (byId.has(id)) return byId.get(id);
      nodes.push({ c: c, edges: [], und: [] });
      byId.set(id, nodes.length - 1);
      return nodes.length - 1;
    }
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i].c, c) < MERGE_M) return i;
    nodes.push({ c: c, edges: [], und: [] });
    return nodes.length - 1;
  }

  function nearNode(c) {           // existing junction within SNAP_M of c, or -1
    let best = -1, bd = SNAP_M;
    nodes.forEach((n, i) => { const d = dist(c, n.c); if (d <= bd) { bd = d; best = i; } });
    return best;
  }

  function addEdge(a, b, w, cls) {
    const f = cls.foot ? FOOT : 0;
    const fwd = f | (cls.car && cls.oneway !== -1 ? CAR : 0);
    const bwd = f | (cls.car && cls.oneway !== 1 ? CAR : 0);
    const any = f | (cls.car ? CAR : 0);
    nodes[a].edges.push([b, w, fwd]);
    nodes[b].edges.push([a, w, bwd]);
    nodes[a].und.push([b, any]);
    nodes[b].und.push([a, any]);
  }

  function addLine(coords, ids, cls, custom) {
    const entry = { coords: coords, node: null, cls: cls };
    lines.push(entry);
    let prev = null;
    coords.forEach((c, k) => {
      let i = -1;
      if (custom && (k === 0 || k === coords.length - 1)) i = nearNode(c);   // ends of your own pathways join the network
      if (i < 0) i = nodeFor(c, ids ? ids[k] : null);
      if (entry.node === null) entry.node = i;
      if (prev !== null && prev !== i) addEdge(prev, i, dist(nodes[prev].c, nodes[i].c), cls);
      prev = i;
    });
  }

  function buildGraph(data, custom) {
    if (Array.isArray(data.elements)) {            // Overpass raw JSON
      data.elements.forEach(el => {
        if (el.type !== "way" || !el.geometry || !el.tags || !el.tags.highway) return;   // roads and paths only, never buildings
        const cls = classify(el.tags);
        if (!cls.foot && !cls.car) return;
        const coords = el.geometry.map(p => [p.lon, p.lat]);
        const ids = el.nodes && el.nodes.length === coords.length ? el.nodes : null;
        addLine(coords, ids, cls);
      });
    } else if (Array.isArray(data.features)) {     // normal GeoJSON lines
      data.features.forEach(f => {
        const g = f.geometry || {};
        if (f.properties && f.properties.building) return;
        const cls = classify(f.properties);
        if (!cls.foot && !cls.car) return;
        const ls = g.type === "MultiLineString" ? g.coordinates
                 : g.type === "LineString" ? [g.coordinates] : [];
        ls.forEach(l => addLine(l, null, cls, custom));
      });
    }
  }

  // Connected pieces, separately for each travel mode.
  const comp = {}, mainComp = {}, pieces = {};
  function labelPieces() {
    [FOOT, CAR].forEach(bit => {
      const cm = nodes.map(() => -1), sizes = [];
      nodes.forEach((n, start) => {
        if (cm[start] !== -1) return;
        const id = sizes.length;
        let size = 0;
        const stack = [start];
        cm[start] = id;
        while (stack.length) {
          const u = stack.pop(); size++;
          nodes[u].und.forEach(([v, m]) => { if ((m & bit) && cm[v] === -1) { cm[v] = id; stack.push(v); } });
        }
        sizes.push(size);
      });
      comp[bit] = cm;
      mainComp[bit] = sizes.indexOf(Math.max.apply(null, sizes.length ? sizes : [0]));
      pieces[bit] = sizes.filter(s => s > 1).length;
    });
  }

  function nearest(c, bit) {       // nearest point on the main network for this mode
    let best = -1, bd = Infinity;
    nodes.forEach((n, i) => {
      if (comp[bit][i] !== mainComp[bit]) return;
      const d = dist(c, n.c); if (d < bd) { bd = d; best = i; }
    });
    return { i: best, d: bd };
  }

  function shortest(src, dst, bit) {   // Dijkstra over edges this mode may use
    const d = nodes.map(() => Infinity), prev = nodes.map(() => -1), done = nodes.map(() => false);
    d[src] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < nodes.length; i++)
        if (!done[i] && d[i] < Infinity && (u === -1 || d[i] < d[u])) u = i;
      if (u === -1 || u === dst) break;
      done[u] = true;
      nodes[u].edges.forEach(([v, w, m]) => {
        if ((m & bit) && d[u] + w < d[v]) { d[v] = d[u] + w; prev[v] = u; }
      });
    }
    if (d[dst] === Infinity) return null;
    const path = [];
    for (let v = dst; v !== -1; v = prev[v]) path.push(v);
    return { nodes: path.reverse(), meters: d[dst] };
  }

  let customError = "";
  let places = [];                 // { name, c }
  const routeLayer = L.layerGroup().addTo(map);
  let netLayer = null;
  const ll = c => [c[1], c[0]];
  // Tell outlines.js which two places are chosen, so it can outline just those buildings.
  const announce = (a, b) => {
    if (typeof CustomEvent === "function")
      document.dispatchEvent(new CustomEvent("campus-route", { detail: a && b ? { from: a, to: b } : null }));
  };

  function showRoute() {
    routeLayer.clearLayers();
    const bit = mode();
    const a = places[$("rt-from").value], b = places[$("rt-to").value];
    if (!a || !b) return;
    announce(a, b);
    if (a === b) { msg("Pick two different places."); return; }
    if (!nodes.length) { msg("No roads or paths loaded yet. Check the message about paths.geojson, then reload."); return; }
    const sa = nearest(a.c, bit), sb = nearest(b.c, bit);
    if (sa.i < 0 || sb.i < 0) { msg("No " + (bit === CAR ? "roads" : "paths") + " loaded for this travel mode."); return; }
    const far = [[a, sa], [b, sb]].find(([, s]) => s.d > WARN_M);
    if (far) {
      msg(far[0].name + " is " + Math.round(far[1].d) + " m from the nearest " +
          (bit === CAR ? "road a vehicle can use" : "path") + ". " +
          (bit === CAR ? "Choose a place nearer a road, or add the access road to your data." : "Add a path to its entrance."));
      return;
    }
    const r = shortest(sa.i, sb.i, bit);
    if (!r) {
      msg("No connected route " + MODE_TEXT[bit] + " between these places. Tick 'Show path network': red lines are pieces cut off from the main network" +
          (bit === CAR ? ", and one-way streets can also block a route." : "."));
      return;
    }

    const line = r.nodes.map(i => ll(nodes[i].c));
    const col = bit === CAR ? "#b45309" : "#0f6b6e";
    L.polyline(line, { color: col, weight: 5, opacity: 0.9 }).addTo(routeLayer);
    L.polyline([ll(a.c), line[0]], { color: col, weight: 3, dashArray: "4 6" }).addTo(routeLayer);
    L.polyline([line[line.length - 1], ll(b.c)], { color: col, weight: 3, dashArray: "4 6" }).addTo(routeLayer);
    map.fitBounds(L.polyline(line.concat([ll(a.c), ll(b.c)])).getBounds().pad(0.3));

    const total = r.meters + sa.d + sb.d;
    msg(a.name + " to " + b.name + " " + MODE_TEXT[bit] + ": about " + Math.round(total) + " m, roughly " +
        Math.max(1, Math.round(total / SPEED[bit])) + " min.");
  }

  function drawNetwork() {
    if (netLayer) { map.removeLayer(netLayer); netLayer = null; }
    if (!$("rt-net").checked) return;
    const bit = mode();
    netLayer = L.layerGroup(lines.map(l => {
      const usable = bit === FOOT ? l.cls.foot : l.cls.car;
      const cut = usable && comp[bit][l.node] !== mainComp[bit];
      const pathOnly = l.cls.foot && !l.cls.car;
      return L.polyline(l.coords.map(ll), {
        color: cut ? "#c2410c" : pathOnly ? "#3f8f5f" : "#7a8a8b",
        weight: usable ? (cut ? 3 : 2.5) : 1.5,
        opacity: usable ? 0.9 : 0.25,
        dashArray: pathOnly ? "4 4" : null,
        interactive: false
      });
    })).addTo(map);
  }

  function fillSelect(sel) {
    sel.innerHTML = "";
    places.forEach((p, i) => {
      const o = document.createElement("option");
      o.value = i; o.textContent = p.name;
      sel.appendChild(o);
    });
  }

  $("rt-go").addEventListener("click", showRoute);
  $("rt-clear").addEventListener("click", () => { routeLayer.clearLayers(); msg(""); announce(null); });
  const pickChanged = () => announce(places[$("rt-from").value], places[$("rt-to").value]);
  $("rt-from").addEventListener("change", pickChanged);
  $("rt-to").addEventListener("change", pickChanged);
  $("rt-net").addEventListener("change", drawNetwork);
  $("rt-mode").addEventListener("change", () => {
    drawNetwork();
    if (routeLayer.getLayers().length) showRoute();
  });

  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });

  // Buildings first, so the From/To lists work even if the paths file has a problem.
  get("buildings.geojson")
    .then(b => {
      places = b.features
        .filter(f => f.geometry && f.geometry.type === "Point")
        .map(f => ({ name: f.properties.name, c: f.geometry.coordinates }))
        .sort((x, y) => x.name.localeCompare(y.name));
      fillSelect($("rt-from"));
      fillSelect($("rt-to"));
      if (places.length > 1) $("rt-to").value = 1;
    })
    .catch(e => msg("Could not read buildings.geojson: " + e.message))
    .then(() => get("paths.geojson"))
    .then(p => {
      buildGraph(p, false);
      // Optional file of pathways you draw yourself (a missing file is fine).
      return get("custom-paths.geojson").then(c => { buildGraph(c, true); }).catch(e => {
        if (!/404/.test(e.message)) customError = "custom-paths.geojson problem: " + e.message;
      });
    })
    .then(() => {
      labelPieces();
      drawNetwork();
      msg(customError ? customError
          : !nodes.length ? "paths.geojson has no usable roads or paths, so routes can't be drawn yet."
          : pieces[FOOT] > 1 ? "Walking network has " + pieces[FOOT] + " separate pieces. Routes use the largest one. Red lines show the cut-off pieces."
          : "");
    })
    .catch(e => msg("Could not read paths.geojson: " + e.message));
})();
