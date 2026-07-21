// Iframe glue. Wires the tested engine modules (graph/identity/render/pathfind/
// search/walk) to the canvas and the host `panel` SDK. `panel` is injected by
// Mallard's SDK shim.

import {
  createMap, currentRoom, toJSON, fromJSON, listAreas, getRoom, getArea,
} from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { computeLayout, draw } from "./render.js";
import { findPath } from "./pathfind.js";
import { matchRooms, resolveDestination } from "./search.js";
import { createWalk } from "./walk.js";

const $name = document.querySelector(".room-name");
const $canvas = document.querySelector(".map-canvas");
const $area = document.querySelector(".area-select");
const $search = document.querySelector(".search-box");
const $results = document.querySelector(".search-results");
const ctx = $canvas.getContext("2d");
const now = () => performance.now();

let map = createMap();
let pendingDir = null;
let viewedAreaId = null;              // which area the panel is showing
let viewedZ = null;                   // explicit floor override; null = follow current
let focusAnchorId = null;             // transient center-on-this-room; cleared on move
let highlightPath = null;             // { rooms:Set, edges:Set } for the route overlay
let cfg = { strategy: "auto", overworld: "outside" };            // area resolver config
let walkCfg = { mode: "safe", delayMs: 250, separator: ";", timeoutMs: 4000, abortOnInput: true };
let loaded = false;
let walk = null;
let walkTimer = null;
const ZOOMS = [16, 24, 32, 44, 60];
let zoomIdx = 2;
let panX = 0, panY = 0;
let lastLayout = { rooms: [] };
let lastRoomSize = 0;

// ── Persistence (debounced) ────────────────────────────────────────────────
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    panel.post("persist", { json: toJSON(map) });
  }, 500);
}

// ── Area switcher ───────────────────────────────────────────────────────────
function rebuildAreaSelect() {
  const areas = listAreas(map);
  $area.innerHTML = "";
  for (const a of areas) {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = a.label || `Area ${a.id}`;
    $area.appendChild(opt);
  }
  $area.hidden = areas.length < 2;
  if (viewedAreaId != null) $area.value = viewedAreaId;
}

function focusCurrentArea() {
  const cur = currentRoom(map);
  viewedAreaId = cur ? cur.areaId : (listAreas(map)[0]?.id ?? null);
  viewedZ = null;            // resume following the current floor
  focusAnchorId = null;      // resume centering on the current room
  panX = 0; panY = 0;
}

// ── Rendering ───────────────────────────────────────────────────────────────
function redraw() {
  if (viewedAreaId != null && !listAreas(map).some((a) => a.id === viewedAreaId)) {
    focusCurrentArea();
  }
  const cw = $canvas.clientWidth, ch = $canvas.clientHeight;
  if ($canvas.width !== cw) $canvas.width = cw;
  if ($canvas.height !== ch) $canvas.height = ch;
  ctx.clearRect(0, 0, cw, ch);
  const layout = computeLayout(map, {
    cx: cw / 2 + panX,
    cy: ch / 2 + panY,
    scale: ZOOMS[zoomIdx],
    areaId: viewedAreaId,
    viewedZ,
    path: highlightPath,
    anchorId: focusAnchorId,
  });
  lastLayout = layout;
  lastRoomSize = Math.max(8, ZOOMS[zoomIdx] * 0.5);
  draw(ctx, layout, { roomSize: lastRoomSize });
  const cur = currentRoom(map);
  $name.textContent = cur ? (cur.name || "(unnamed room)") : "Not mapping";
}

// ── Walk controller ──────────────────────────────────────────────────────────
function startWalkTimer() {
  if (walkTimer) return;
  walkTimer = setInterval(() => {
    if (walk) dispatchWalkActions(walk.onTick(now()));
  }, 50);
}
function stopWalkTimer() {
  if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }
}

function buildHighlight(path) {
  const rooms = new Set(), edges = new Set();
  for (const s of path) {
    rooms.add(s.fromId); rooms.add(s.toId);
    edges.add(s.fromId < s.toId ? `${s.fromId}|${s.toId}` : `${s.toId}|${s.fromId}`);
  }
  return { rooms, edges };
}

function dispatchWalkActions(actions) {
  for (const a of actions) {
    if (a.type === "send") {
      panel.post("walk_send", { cmd: a.cmd });
    } else if (a.type === "done") {
      stopWalkTimer(); highlightPath = null; redraw();
    } else if (a.type === "aborted") {
      stopWalkTimer(); highlightPath = null; redraw();
      panel.post("notify", { text:
        a.reason === "timeout" ? "Speedwalk stopped — no response (timed out)."
        : a.reason === "off-route" ? "Speedwalk stopped — went off-route."
        : a.reason === "user-input" ? "Speedwalk cancelled."
        : "Speedwalk stopped." });
    }
  }
}

function startWalk(toId) {
  const cur = currentRoom(map);
  if (!cur) { panel.post("notify", { text: "Not mapping yet — can't walk." }); return; }
  const path = findPath(map, cur.id, toId);
  if (path == null) { panel.post("notify", { text: "No known route there." }); return; }
  if (path.length === 0) { panel.post("notify", { text: "You're already there." }); return; }
  highlightPath = buildHighlight(path);
  walk = createWalk(walkCfg);
  const actions = walk.start(path, now());
  startWalkTimer();
  redraw();
  dispatchWalkActions(actions);
}

function previewPath(toId) {
  const cur = currentRoom(map);
  if (!cur) return;
  const path = findPath(map, cur.id, toId);
  highlightPath = path && path.length ? buildHighlight(path) : null;
  redraw();
}

function focusRoom(id) {
  const r = getRoom(map, id);
  if (!r) return;
  viewedAreaId = r.areaId;
  viewedZ = r.coords.z;
  focusAnchorId = id;
  panX = 0; panY = 0;
  redraw();
}

function notifyCandidates(candidates, verb) {
  if (!candidates || candidates.length === 0) {
    panel.post("notify", { text: `No room matches to ${verb}.` });
    return;
  }
  const names = candidates.slice(0, 8).map((r) => `${r.name || "(unnamed)"} [#${r.id}]`).join(", ");
  panel.post("notify", { text: `Ambiguous — ${candidates.length} matches: ${names}. Use /goto #id.` });
}

// ── Host messages ────────────────────────────────────────────────────────────
panel.on("load", (frame) => {
  map = frame && frame.json ? fromJSON(frame.json) : createMap();
  if (frame && frame.cfg) cfg = { ...cfg, ...frame.cfg };
  if (frame && frame.walk) walkCfg = { ...walkCfg, ...frame.walk };
  loaded = true;
  stopWalkTimer(); walk = null; highlightPath = null;
  focusCurrentArea();
  rebuildAreaSelect();
  redraw();
});

panel.on("moved", (frame) => {
  pendingDir = frame && frame.dir ? frame.dir : null;
});

panel.on("room_seen", (frame) => {
  if (!frame || !frame.key || !loaded) return;
  if (walk && walk.isActive()) {
    const d = walk.pendingDir();
    if (d != null) pendingDir = d;
  }
  resolveRoomSeen(
    map,
    { key: frame.key, name: frame.name, env: frame.env, areaTag: frame.areaTag, areaField: frame.areaField },
    pendingDir,
    cfg,
  );
  pendingDir = null;
  if (walk && walk.isActive()) {
    dispatchWalkActions(walk.onRoomSeen(map.currentId, now()));
  }
  focusCurrentArea();
  rebuildAreaSelect();
  redraw();
  schedulePersist();
});

panel.on("recenter", () => { focusCurrentArea(); redraw(); });

panel.on("request_walk", (frame) => {
  const res = resolveDestination(map, map.currentId, frame && frame.target != null ? frame.target : "");
  if (res.roomId) startWalk(res.roomId);
  else notifyCandidates(res.candidates, "walk to");
});

panel.on("request_path", (frame) => {
  const res = resolveDestination(map, map.currentId, frame && frame.target != null ? frame.target : "");
  if (res.roomId) {
    focusRoom(res.roomId);
    previewPath(res.roomId);
    const r = getRoom(map, res.roomId);
    panel.post("notify", { text: `Route to ${r ? (r.name || res.roomId) : res.roomId} highlighted.` });
  } else notifyCandidates(res.candidates, "path to");
});

panel.on("request_stop", () => { if (walk) dispatchWalkActions(walk.stop()); });

panel.on("user_input", () => {
  if (walk && walk.isActive()) dispatchWalkActions(walk.onUserInput());
});

// ── Local UI ──────────────────────────────────────────────────────────────
$area.addEventListener("change", () => {
  viewedAreaId = $area.value; viewedZ = null; focusAnchorId = null;
  panX = 0; panY = 0; redraw();
});
document.querySelector(".zoom-in").addEventListener("click", () => {
  zoomIdx = Math.min(ZOOMS.length - 1, zoomIdx + 1); redraw();
});
document.querySelector(".zoom-out").addEventListener("click", () => {
  zoomIdx = Math.max(0, zoomIdx - 1); redraw();
});
document.querySelector(".recenter").addEventListener("click", () => { focusCurrentArea(); redraw(); });
document.querySelector(".z-up").addEventListener("click", () => {
  const base = viewedZ != null ? viewedZ : (currentRoom(map)?.coords.z ?? 0);
  viewedZ = base + 1; redraw();
});
document.querySelector(".z-down").addEventListener("click", () => {
  const base = viewedZ != null ? viewedZ : (currentRoom(map)?.coords.z ?? 0);
  viewedZ = base - 1; redraw();
});

// Search box
function renderResults(list) {
  $results.innerHTML = "";
  for (const r of list.slice(0, 12)) {
    const li = document.createElement("div");
    li.className = "search-result";
    const area = getArea(map, r.areaId);
    li.textContent = `${r.name || "(unnamed)"}${area ? " — " + (area.label || "") : ""}`;
    li.addEventListener("click", () => { focusRoom(r.id); previewPath(r.id); });
    li.addEventListener("dblclick", () => startWalk(r.id));
    $results.appendChild(li);
  }
  $results.hidden = list.length === 0;
}
$search.addEventListener("input", () => {
  const q = $search.value.trim();
  renderResults(q ? matchRooms(map, q) : []);
});
$search.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const res = resolveDestination(map, map.currentId, $search.value.trim());
    if (res.roomId) startWalk(res.roomId); else notifyCandidates(res.candidates, "walk to");
    $results.hidden = true;
  } else if (e.key === "Escape") {
    $results.hidden = true;
  }
});

// Canvas: pan (drag), single-click = select + center + preview, double-click = walk.
let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, movedDuringDrag = false;
function roomAt(clientX, clientY) {
  const rect = $canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const half = lastRoomSize / 2;
  for (const r of lastLayout.rooms) {
    if (x >= r.px - half && x <= r.px + half && y >= r.py - half && y <= r.py + half) return r.id;
  }
  return null;
}
$canvas.addEventListener("mousedown", (e) => {
  dragging = true; movedDuringDrag = false;
  lastX = e.clientX; lastY = e.clientY; downX = e.clientX; downY = e.clientY;
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) movedDuringDrag = true;
  panX += e.clientX - lastX; panY += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  redraw();
});
window.addEventListener("mouseup", () => { dragging = false; });
$canvas.addEventListener("click", (e) => {
  if (movedDuringDrag) return;               // it was a pan, not a click
  const id = roomAt(e.clientX, e.clientY);
  if (id != null) { focusRoom(id); previewPath(id); }
});
$canvas.addEventListener("dblclick", (e) => {
  const id = roomAt(e.clientX, e.clientY);
  if (id != null) startWalk(id);
});
window.addEventListener("resize", redraw);

// ── Handshake ─────────────────────────────────────────────────────────────────
panel.post("ready", {});
redraw();
