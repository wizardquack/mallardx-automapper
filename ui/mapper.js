// Iframe glue. Wires the tested engine modules (graph/identity/render) to the
// canvas and the host `panel` SDK. `panel` is injected by Mallard's SDK shim.

import { createMap, currentRoom, toJSON, fromJSON, listAreas, getRoom } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { computeLayout, draw } from "./render.js";

const $name = document.querySelector(".room-name");
const $canvas = document.querySelector(".map-canvas");
const $area = document.querySelector(".area-select");
const ctx = $canvas.getContext("2d");

let map = createMap();
let pendingDir = null;
let viewedAreaId = null;              // which area the panel is showing
let cfg = { strategy: "auto", overworld: "outside" };  // resolver config (from load)
const ZOOMS = [16, 24, 32, 44, 60];
let zoomIdx = 2;
let panX = 0, panY = 0;

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
  $area.hidden = areas.length < 2;         // only useful once there are 2+
  if (viewedAreaId != null) $area.value = viewedAreaId;
}

function focusCurrentArea() {
  const cur = currentRoom(map);
  viewedAreaId = cur ? cur.areaId : (listAreas(map)[0]?.id ?? null);
  panX = 0; panY = 0;
}

// ── Rendering ───────────────────────────────────────────────────────────────
function redraw() {
  const cw = $canvas.clientWidth, ch = $canvas.clientHeight;
  if ($canvas.width !== cw) $canvas.width = cw;
  if ($canvas.height !== ch) $canvas.height = ch;
  ctx.clearRect(0, 0, cw, ch);
  const layout = computeLayout(map, {
    cx: cw / 2 + panX,
    cy: ch / 2 + panY,
    scale: ZOOMS[zoomIdx],
    areaId: viewedAreaId,
  });
  draw(ctx, layout, { roomSize: Math.max(8, ZOOMS[zoomIdx] * 0.5) });
  const cur = currentRoom(map);
  $name.textContent = cur ? (cur.name || "(unnamed room)") : "Not mapping";
}

// ── Host messages ────────────────────────────────────────────────────────────
panel.on("load", (frame) => {
  map = frame && frame.json ? fromJSON(frame.json) : createMap();
  if (frame && frame.cfg) cfg = { ...cfg, ...frame.cfg };
  focusCurrentArea();
  rebuildAreaSelect();
  redraw();
});

panel.on("moved", (frame) => {
  pendingDir = frame && frame.dir ? frame.dir : null;
});

panel.on("room_seen", (frame) => {
  if (!frame || !frame.key) return;
  resolveRoomSeen(
    map,
    { key: frame.key, name: frame.name, env: frame.env, areaTag: frame.areaTag, areaField: frame.areaField },
    pendingDir,
    cfg,
  );
  pendingDir = null;
  focusCurrentArea();       // auto-switch view to the current room's area
  rebuildAreaSelect();
  redraw();
  schedulePersist();
});

panel.on("recenter", () => {
  focusCurrentArea();
  redraw();
});

// ── Local UI ──────────────────────────────────────────────────────────────
$area.addEventListener("change", () => {
  viewedAreaId = $area.value;   // browse another area without moving character
  panX = 0; panY = 0;
  redraw();
});
document.querySelector(".zoom-in").addEventListener("click", () => {
  zoomIdx = Math.min(ZOOMS.length - 1, zoomIdx + 1); redraw();
});
document.querySelector(".zoom-out").addEventListener("click", () => {
  zoomIdx = Math.max(0, zoomIdx - 1); redraw();
});
document.querySelector(".recenter").addEventListener("click", () => {
  focusCurrentArea(); redraw();
});

let dragging = false, lastX = 0, lastY = 0;
$canvas.addEventListener("mousedown", (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  panX += e.clientX - lastX; panY += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  redraw();
});
window.addEventListener("mouseup", () => { dragging = false; });
window.addEventListener("resize", redraw);

// ── Handshake ─────────────────────────────────────────────────────────────────
panel.post("ready", {});
redraw();
