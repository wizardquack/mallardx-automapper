// Iframe glue. Wires the tested engine modules (graph/identity/render) to the
// canvas and the host `panel` SDK. `panel` is injected by Mallard's SDK shim.

import { createMap, currentRoom, toJSON, fromJSON } from "./graph.js";
import { resolveRoomSeen } from "./identity.js";
import { computeLayout, draw } from "./render.js";

const $name = document.querySelector(".room-name");
const $canvas = document.querySelector(".map-canvas");
const ctx = $canvas.getContext("2d");

let map = createMap();
let pendingDir = null;
const ZOOMS = [16, 24, 32, 44, 60];
let zoomIdx = 2;
// Pan offset (px) applied on top of the current-room-centered layout.
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
  });
  draw(ctx, layout, { roomSize: Math.max(8, ZOOMS[zoomIdx] * 0.5) });
  const cur = currentRoom(map);
  $name.textContent = cur ? (cur.name || "(unnamed room)") : "Not mapping";
}

// ── Host messages ────────────────────────────────────────────────────────────
panel.on("load", (frame) => {
  map = frame && frame.json ? fromJSON(frame.json) : createMap();
  panX = 0; panY = 0;
  redraw();
});

panel.on("moved", (frame) => {
  pendingDir = frame && frame.dir ? frame.dir : null;
});

panel.on("room_seen", (frame) => {
  if (!frame || !frame.key) return;
  resolveRoomSeen(map, { key: frame.key, name: frame.name, env: frame.env }, pendingDir);
  pendingDir = null;
  panX = 0; panY = 0; // recenter on the room we just entered
  redraw();
  schedulePersist();
});

panel.on("recenter", () => {
  panX = 0; panY = 0;
  redraw();
});

// ── Local UI (zoom / pan) ────────────────────────────────────────────────────
document.querySelector(".zoom-in").addEventListener("click", () => {
  zoomIdx = Math.min(ZOOMS.length - 1, zoomIdx + 1); redraw();
});
document.querySelector(".zoom-out").addEventListener("click", () => {
  zoomIdx = Math.max(0, zoomIdx - 1); redraw();
});
document.querySelector(".recenter").addEventListener("click", () => {
  panX = 0; panY = 0; redraw();
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
