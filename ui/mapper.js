// Iframe glue. Wires the tested engine modules (graph/identity/render/pathfind/
// search/walk) to the canvas and the host `panel` SDK. `panel` is injected by
// Mallard's SDK shim.

import {
  createMap, currentRoom, toJSON, fromJSON, listAreas, getRoom, getArea, setCurrent, setTerrains,
} from "./graph.js";
import { renameRoom, deleteRoom, mergeRooms, addExit, deleteExit, setOneWay,
  moveRoom, isCellOccupied, moveToArea, computePocket, movePocket,
  setRoomColor, setRoomSymbol, setRoomNote, editEach, moveRooms } from "./edits.js";
import { legendModel, tooltipSpec, parseColor } from "./annotate.js";
import { addLink, deleteLink, setLinkOneWay, setLinkField, linksOf, hasWay } from "./links.js";
import { createHistory } from "./history.js";
import { roomMenuModel, selectionMenuModel } from "./editmenu.js";
import { addArea } from "./graph.js";
import { resolveRoomSeen, contradicts } from "./identity.js";
import { seenFromFrame, terrainsFromFrame } from "./seen.js";
import { importChart } from "./chart.js";
import { fingerprint, exitDirections, suggestNamePattern, suggestExitsPattern } from "./fingerprint.js";
import { computeLayout, draw, roomsInRect, cardAt, DEFAULT_COLORS } from "./render.js";
import { findPath } from "./pathfind.js";
import { matchRooms, resolveDestination } from "./search.js";
import { createWalk } from "./walk.js";
import { createMoveQueue } from "./movequeue.js";

const $name = document.querySelector(".room-name");
const $canvas = document.querySelector(".map-canvas");
const $area = document.querySelector(".area-select");
const $search = document.querySelector(".search-box");
const $results = document.querySelector(".search-results");
const ctx = $canvas.getContext("2d");
const now = () => performance.now();

let map = createMap();
const moves = createMoveQueue();   // sent directions awaiting their room, oldest first
let viewedAreaId = null;              // which area the panel is showing
let viewedZ = null;                   // explicit floor override; null = follow current
let focusAnchorId = null;             // transient center-on-this-room; cleared on move
let highlightPath = null;             // { rooms:Set, edges:Set } for the route overlay
let cfg = { strategy: "auto", overworld: "outside" };            // area resolver config
let walkCfg = { mode: "safe", delayMs: 250, separator: ";", timeoutMs: 4000, abortOnInput: true };
let loaded = false;
let walk = null;
let walkTimer = null;
const history = createHistory();
let pendingMode = null;   // { kind: "merge"|"addExit", ... } for two-step actions
const ZOOMS = [16, 24, 32, 44, 60];
let zoomIdx = 2;
let panX = 0, panY = 0;
let lastLayout = { rooms: [] };
let lastRoomSize = 0;
let lastCards = [];         // stub cards last drawn (render.js): where an exit leads off the view
let pocketPreview = null;   // { ids:Set<string>, areaId:string } while previewing
let pendingTerrains = null; // mudstd.room.terrain received before the map loaded
let pendingCharts = [];     // mudstd.map.rooms received before the map loaded
let sawRoom = false;        // a room has arrived since the map loaded or we connected
let selection = new Set();  // room ids picked with shift-click / shift-drag
let marquee = null;         // { x0, y0, x1, y1 } canvas px while shift-dragging a box
let linkOffer = null;       // { fromId, toId } while offering to link a move the map can't explain

// View preferences, kept across reloads where the WebView allows storage.
function pref(name, fallback) {
  try { const v = localStorage.getItem(`automapper.${name}`); return v == null ? fallback : v === "1"; }
  catch { return fallback; }
}
function setPref(name, on) {
  try { localStorage.setItem(`automapper.${name}`, on ? "1" : "0"); } catch { /* no storage */ }
}
let showLabels = pref("labels", true);
let showLegend = pref("legend", false);

// ── Persistence (debounced) ────────────────────────────────────────────────
let persistTimer = null;
function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    panel.post("persist", { json: toJSON(map) });
  }, 500);
}

// Every user edit goes through here: snapshot the pre-edit map, run the
// mutation, and (only if it changed something) persist + redraw. Keeps undo,
// persistence, and rendering uniform.
function applyEdit(fn) {
  const before = toJSON(map);
  const ok = fn();
  if (!ok) return false;
  history.push(before);
  rebuildAreaSelect();
  redraw();
  schedulePersist();
  return true;
}

function doUndo() {
  const restored = history.undo(toJSON(map));
  if (restored == null) return;
  map = fromJSON(restored);
  focusCurrentArea(); rebuildAreaSelect(); redraw(); schedulePersist();
}
function doRedo() {
  const restored = history.redo(toJSON(map));
  if (restored == null) return;
  map = fromJSON(restored);
  focusCurrentArea(); rebuildAreaSelect(); redraw(); schedulePersist();
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
// Map the host theme tokens (injected by Mallard onto :root) to the canvas
// palette. Falls back to render.js defaults when a token is absent (e.g. plugin
// opened outside the host). Read fresh each redraw so theme switches take hold.
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => { const s = cs.getPropertyValue(name).trim(); return s || fb; };
  return {
    exit: v("--fg-muted", DEFAULT_COLORS.exit),
    exitPath: v("--accent", DEFAULT_COLORS.exitPath),
    roomStroke: v("--border", DEFAULT_COLORS.roomStroke),
    roomPath: v("--accent", DEFAULT_COLORS.roomPath),
    current: DEFAULT_COLORS.current,
    label: v("--fg", DEFAULT_COLORS.label),
    halo: v("--bg", DEFAULT_COLORS.halo),
  };
}

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
  lastCards = draw(ctx, layout, { roomSize: lastRoomSize, colors: themeColors(), labels: showLabels }).cards;
  for (const id of selection) if (!map.rooms[id]) selection.delete(id);
  drawSelection();
  const cur = currentRoom(map);
  $name.textContent = cur ? (cur.name || "(unnamed room)") : "Not mapping";
  drawPocketOverlay();
  renderLegend();
}

// ── Legend ───────────────────────────────────────────────────────────────────
// What the colours and glyphs in view mean (annotate.js legendModel).
const $legend = document.querySelector(".legend");
const $legendBtn = document.querySelector(".legend-toggle");
const $labelsBtn = document.querySelector(".labels-toggle");
function renderLegend() {
  $legend.hidden = !showLegend;
  $legendBtn.classList.toggle("on", showLegend);
  $labelsBtn.classList.toggle("on", showLabels);
  if (!showLegend) return;
  const model = legendModel(map, lastLayout.rooms.map((r) => map.rooms[r.id]).filter(Boolean));
  $legend.innerHTML = "";
  const section = (title, items) => {
    if (!items.length) return;
    const h = document.createElement("div");
    h.className = "legend-head";
    h.textContent = title;
    $legend.appendChild(h);
    for (const [mark, text] of items) {
      const row = document.createElement("div");
      row.className = "legend-row";
      row.append(mark, Object.assign(document.createElement("span"), { textContent: text }));
      $legend.appendChild(row);
    }
  };
  const swatch = (color, cls = "legend-swatch") => {
    const el = document.createElement("span");
    el.className = cls;
    el.style.background = color;
    return el;
  };
  section("Terrain", model.terrains.map((t) => [swatch(t.color), t.label]));
  section("Here", model.glyphs.map((g) => [
    Object.assign(document.createElement("span"), { className: "legend-glyph", textContent: g.glyph }),
    g.tags.join(", "),
  ]));
  section("Regions", model.regions.map((r) => [swatch(r.color, "legend-swatch legend-region"), r.name]));
  if (!$legend.childElementCount) {
    $legend.appendChild(Object.assign(document.createElement("div"), {
      className: "legend-empty",
      textContent: "Nothing to explain here yet — rooms are plain until the server sends terrain or tags, or you colour them.",
    }));
  }
}
$legendBtn.addEventListener("click", () => { showLegend = !showLegend; setPref("legend", showLegend); redraw(); });
$labelsBtn.addEventListener("click", () => { showLabels = !showLabels; setPref("labels", showLabels); redraw(); });

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
    } else if (a.type === "manual") {
      const to = getRoom(map, a.step.toId);
      const where = to ? (to.name || `#${to.id}`) : "the next room";
      const how = a.step.link && a.step.link.name ? `Take ${a.step.link.name} to ${where}` : `Make your way to ${where}`;
      panel.post("notify", { text: `${how}; the walk carries on when you arrive.` });
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

// ── Inline widgets (no native prompt/confirm — broken in Mallard's WebView) ──
// Inline text prompt — resolves to the trimmed string, or null on cancel.
// window.prompt does not work in Mallard's WebView, so we build our own.
// `allowEmpty` resolves an emptied field to "" (to clear) rather than null.
function inlinePrompt(title, initial = "", allowEmpty = false) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "edit-modal-back";
    back.innerHTML =
      `<div class="edit-modal"><div class="edit-modal-title"></div>` +
      `<input class="edit-modal-input" type="text"/>` +
      `<div class="edit-modal-row"><button class="edit-cancel">Cancel</button>` +
      `<button class="edit-ok">OK</button></div></div>`;
    back.querySelector(".edit-modal-title").textContent = title;
    const input = back.querySelector(".edit-modal-input");
    input.value = initial;
    document.body.appendChild(back);
    input.focus(); input.select();
    const done = (val) => { back.remove(); resolve(val); };
    const value = () => input.value.trim() || (allowEmpty ? "" : null);
    back.querySelector(".edit-ok").addEventListener("click", () => done(value()));
    back.querySelector(".edit-cancel").addEventListener("click", () => done(null));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") done(value());
      else if (e.key === "Escape") done(null);
    });
  });
}

// Inline confirm — resolves true/false.
function inlineConfirm(message) {
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "edit-modal-back";
    back.innerHTML =
      `<div class="edit-modal"><div class="edit-modal-title"></div>` +
      `<div class="edit-modal-row"><button class="edit-cancel">Cancel</button>` +
      `<button class="edit-ok edit-danger">Delete</button></div></div>`;
    back.querySelector(".edit-modal-title").textContent = message;
    document.body.appendChild(back);
    back.querySelector(".edit-ok").focus();
    const done = (val) => { back.remove(); resolve(val); };
    back.querySelector(".edit-ok").addEventListener("click", () => done(true));
    back.querySelector(".edit-cancel").addEventListener("click", () => done(false));
    back.addEventListener("keydown", (e) => { if (e.key === "Escape") done(false); });
  });
}

// ── Selection ────────────────────────────────────────────────────────────────
// Shift-click adds or removes a room, shift-drag on empty map adds a box of
// them; right-click one for what to do with them all. Dragging a selected
// room moves the lot.
function drawSelection() {
  const accent = themeColors().exitPath;
  ctx.save();
  if (selection.size) {
    ctx.strokeStyle = accent; ctx.lineWidth = 2;
    if (ctx.setLineDash) ctx.setLineDash([3, 2]);
    const half = lastRoomSize / 2 + 3;
    for (const r of lastLayout.rooms) {
      if (selection.has(r.id)) ctx.strokeRect(r.px - half, r.py - half, half * 2, half * 2);
    }
  }
  if (marquee) {
    const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1);
    const w = Math.abs(marquee.x1 - marquee.x0), h = Math.abs(marquee.y1 - marquee.y0);
    ctx.globalAlpha = 0.12; ctx.fillStyle = accent; ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1; ctx.strokeStyle = accent; ctx.lineWidth = 1;
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function clearSelection() {
  if (!selection.size) return false;
  selection.clear();
  return true;
}

const SELECTION_ACTIONS = new Set([
  "selClear", "selSetColor", "selSetColorCustom", "selSetSymbol", "selMoveToArea", "selDelete",
]);
async function handleSelectionAction(action, arg) {
  const ids = Array.from(selection);
  if (action === "selClear") {
    clearSelection(); redraw();
  } else if (action === "selSetColor") {
    applyEdit(() => editEach(map, ids, (m, id) => setRoomColor(m, id, arg)));
  } else if (action === "selSetColorCustom") {
    const input = await inlinePrompt(`Colour for ${ids.length} rooms (hex, e.g. #3aa8a0)`, "");
    if (input == null) return;
    const hex = parseColor(input);
    if (!hex) { panel.post("notify", { text: `'${input}' isn't a hex colour.` }); return; }
    applyEdit(() => editEach(map, ids, (m, id) => setRoomColor(m, id, hex)));
  } else if (action === "selSetSymbol") {
    const sym = await inlinePrompt(`Symbol for ${ids.length} rooms (1–2 characters; empty clears)`, "", true);
    if (sym != null) applyEdit(() => editEach(map, ids, (m, id) => setRoomSymbol(m, id, sym)));
  } else if (action === "selMoveToArea") {
    const areaId = await resolveTargetArea(arg);
    if (areaId == null) return;
    if (applyEdit(() => movePocket(map, ids, areaId))) {
      panel.post("notify", { text: `Moved ${ids.length} room(s) to area.` });
    }
  } else if (action === "selDelete") {
    const ok = await inlineConfirm(`Delete ${ids.length} rooms?`);
    if (ok && applyEdit(() => editEach(map, ids, deleteRoom))) { clearSelection(); redraw(); }
  }
}

// ── Menu action dispatcher ────────────────────────────────────────────────────
async function handleMenuAction(action, arg, roomId) {
  if (pocketPreview) cancelPocket();
  pendingMode = null;
  if (SELECTION_ACTIONS.has(action)) { await handleSelectionAction(action, arg); return; }
  if (action === "selectPocket") {
    selection = new Set(computePocket(map, roomId));
    redraw();
    panel.post("notify", { text: `${selection.size} room(s) selected — right-click one for what to do with them.` });
  } else if (action === "rename") {
    const r = getRoom(map, roomId); if (!r) return;
    const name = await inlinePrompt("Rename room", r.name || "");
    if (name != null) applyEdit(() => renameRoom(map, roomId, name));
  } else if (action === "setColor") {
    applyEdit(() => setRoomColor(map, roomId, arg));
  } else if (action === "setColorCustom") {
    const r = getRoom(map, roomId); if (!r) return;
    const input = await inlinePrompt("Room colour (hex, e.g. #3aa8a0)", r.color || "");
    if (input == null) return;
    const hex = parseColor(input);
    if (!hex) { panel.post("notify", { text: `'${input}' isn't a hex colour.` }); return; }
    applyEdit(() => setRoomColor(map, roomId, hex));
  } else if (action === "setSymbol") {
    const r = getRoom(map, roomId); if (!r) return;
    const sym = await inlinePrompt("Symbol (1–2 characters; empty clears)", r.symbol || "", true);
    if (sym != null) applyEdit(() => setRoomSymbol(map, roomId, sym));
  } else if (action === "setNote") {
    const r = getRoom(map, roomId); if (!r) return;
    const note = await inlinePrompt("Note (empty clears)", r.note || "", true);
    if (note != null) applyEdit(() => setRoomNote(map, roomId, note));
  } else if (action === "addLink") {
    pendingMode = { kind: "link", fromId: roomId };
    panel.post("notify", { text: "Click the room this links to — change floor or area first if need be (Esc to cancel)." });
  } else if (action === "renameLink") {
    const link = linksOf(getRoom(map, roomId))[arg]; if (!link) return;
    const name = await inlinePrompt("Link name (empty clears)", link.name || "", true);
    if (name != null) applyEdit(() => setLinkField(map, roomId, arg, "name", name));
  } else if (action === "setLinkCmd") {
    const link = linksOf(getRoom(map, roomId))[arg]; if (!link) return;
    const cmd = await inlinePrompt("Command that takes it (empty: speedwalk stops for you to)", link.cmd || "", true);
    if (cmd != null) applyEdit(() => setLinkField(map, roomId, arg, "cmd", cmd));
  } else if (action === "toggleLinkOneWay") {
    applyEdit(() => setLinkOneWay(map, roomId, arg.to, arg.oneWay));
  } else if (action === "deleteLink") {
    applyEdit(() => deleteLink(map, roomId, arg));
  } else if (action === "viewRoom") {
    focusRoom(arg);
  } else if (action === "setCurrent") {
    applyEdit(() => { setCurrent(map, roomId); return true; });
  } else if (action === "deleteRoom") {
    const ok = await inlineConfirm("Delete this room?");
    if (ok) applyEdit(() => deleteRoom(map, roomId));
  } else if (action === "merge") {
    pendingMode = { kind: "merge", fromId: roomId };
    panel.post("notify", { text: "Click the room to merge this one INTO (Esc to cancel)." });
  } else if (action === "addExit") {
    pendingMode = { kind: "addExit", fromId: roomId, dir: arg };
    panel.post("notify", { text: `Click the target room for the '${arg}' exit (Esc to cancel).` });
  } else if (action === "deleteExit") {
    applyEdit(() => deleteExit(map, roomId, arg));
  } else if (action === "toggleOneWay") {
    applyEdit(() => setOneWay(map, roomId, arg.dir, arg.oneWay));
  } else if (action === "moveToArea") {
    await doAreaMove(roomId, arg, false);
  } else if (action === "movePocket") {
    await doAreaMove(roomId, arg, true);
  }
}

// Walk the pure descriptor, binding onClick handlers the panel.menu SDK expects.
function bindMenuActions(nodes, roomId) {
  return nodes.map((n) => {
    const item = { ...n };
    if (item.submenu) item.submenu = bindMenuActions(item.submenu, roomId);
    if (item.action) {
      const { action, arg } = item;
      item.onClick = () => handleMenuAction(action, arg, roomId);
    }
    delete item.action; delete item.arg;
    return item;
  });
}

function openRoomMenu(clientX, clientY, roomId) {
  if (selection.size > 1 && selection.has(roomId)) {
    panel.menu.show({ x: clientX, y: clientY },
      bindMenuActions(selectionMenuModel(map, Array.from(selection), listAreas(map)), roomId));
    return;
  }
  if (clearSelection()) redraw();
  const nodes = bindMenuActions(roomMenuModel(map, roomId, listAreas(map)), roomId);
  panel.menu.show({ x: clientX, y: clientY }, nodes);
}

async function resolveTargetArea(arg) {
  if (arg !== "__new__") return arg;
  const label = await inlinePrompt("New area name", "");
  if (label == null) return null;
  return addArea(map, { key: null, label }).id;
}

async function doAreaMove(roomId, arg, pocket) {
  const areaId = await resolveTargetArea(arg);
  if (areaId == null) return;
  if (!pocket) {
    applyEdit(() => moveToArea(map, roomId, areaId));
    panel.post("notify", { text: "Room moved to area." });
    return;
  }
  const ids = computePocket(map, roomId);
  pocketPreview = { ids: new Set(ids), areaId };
  showPocketBar();
  redraw();
}

function drawPocketOverlay() {
  if (!pocketPreview) return;
  ctx.save();
  ctx.strokeStyle = "#f59e0b"; ctx.lineWidth = 3;
  const half = lastRoomSize / 2 + 3;
  for (const r of lastLayout.rooms) {
    if (pocketPreview.ids.has(r.id)) ctx.strokeRect(r.px - half, r.py - half, half * 2, half * 2);
  }
  ctx.restore();
}

const $pocketBar = document.querySelector(".pocket-bar");
function showPocketBar() { $pocketBar.hidden = false; }
function hidePocketBar() { $pocketBar.hidden = true; }
function commitPocket() {
  if (!pocketPreview) return;
  const ids = Array.from(pocketPreview.ids);
  const areaId = pocketPreview.areaId;
  pocketPreview = null; hidePocketBar();
  applyEdit(() => movePocket(map, ids, areaId));
  panel.post("notify", { text: `Moved ${ids.length} room(s) to area.` });
}
function cancelPocket() { pocketPreview = null; hidePocketBar(); redraw(); }
document.querySelector(".pocket-confirm").addEventListener("click", commitPocket);
document.querySelector(".pocket-cancel").addEventListener("click", cancelPocket);

// ── Learn mode (non-GMCP capture setup) ──────────────────────────────────────
// The adapter streams every incoming line here while '/map learn' is on. The
// user marks which line is the room name and which is the exits list; we infer
// a regex for each (fingerprint.js) and show them to paste into settings.
const $learnPanel = document.querySelector(".learn-panel");
const $learnLines = document.querySelector(".learn-lines");
const $learnOut = document.querySelector(".learn-out");
const $learnTitle = document.querySelector(".learn-title");
const LEARN_TITLE = "Learn mode — click Name / Exits on a room's lines";
let learnActive = false;
let learnLines = [];
let nameSample = null;
let exitsSample = null;
const LEARN_MAX = 80;

function setLearnActive(on) {
  learnActive = !!on;
  if (learnActive) { learnLines = []; nameSample = null; exitsSample = null; renderLearn(); }
  $learnPanel.hidden = !learnActive;
}
function addLearnLine(text) {
  learnLines.push(text);
  if (learnLines.length > LEARN_MAX) learnLines.shift();
  renderLearn();
}
function renderLearn() {
  if ($learnTitle) {
    $learnTitle.textContent = learnLines.length
      ? `${LEARN_TITLE}  (${learnLines.length} lines)`
      : LEARN_TITLE;
  }
  $learnLines.innerHTML = "";
  if (learnLines.length === 0) {
    const empty = document.createElement("div");
    empty.className = "learn-empty";
    empty.textContent = "Walk into a room — its output lines will appear here. "
      + "Then click “Name” on the title line and “Exits” on the exits line.";
    $learnLines.appendChild(empty);
  }
  for (const text of learnLines) {
    const row = document.createElement("div");
    row.className = "learn-line";
    const span = document.createElement("span");
    span.className = "learn-text";
    span.textContent = text;
    const nameBtn = document.createElement("button");
    nameBtn.textContent = "Name";
    if (text === nameSample) nameBtn.classList.add("chosen-name");
    nameBtn.addEventListener("click", () => { nameSample = text; renderLearn(); updateLearnOut(); });
    const exitsBtn = document.createElement("button");
    exitsBtn.textContent = "Exits";
    if (text === exitsSample) exitsBtn.classList.add("chosen-exits");
    exitsBtn.addEventListener("click", () => { exitsSample = text; renderLearn(); updateLearnOut(); });
    row.append(span, nameBtn, exitsBtn);
    $learnLines.appendChild(row);
  }
  $learnLines.scrollTop = $learnLines.scrollHeight;
}
function updateLearnOut() {
  if (nameSample == null || exitsSample == null) { $learnOut.hidden = true; return; }
  $learnOut.querySelector(".learn-name-pat").textContent = suggestNamePattern(nameSample);
  $learnOut.querySelector(".learn-exits-pat").textContent = suggestExitsPattern(exitsSample);
  $learnOut.hidden = false;
}
function closeLearn() {
  setLearnActive(false);
  panel.post("learn_stop", {});
}
document.querySelector(".learn-close").addEventListener("click", closeLearn);
panel.on("learn", (frame) => setLearnActive(frame && frame.on));
panel.on("learn_line", (frame) => {
  if (learnActive && frame && frame.text != null) addLearnLine(frame.text);
});

// ── Host messages ────────────────────────────────────────────────────────────
panel.on("load", (frame) => {
  map = frame && frame.json ? fromJSON(frame.json) : createMap();
  if (frame && frame.cfg) cfg = { ...cfg, ...frame.cfg };
  if (frame && frame.walk) walkCfg = { ...walkCfg, ...frame.walk };
  loaded = true;
  sawRoom = false; hideLinkOffer(); moves.clear();
  if (pendingTerrains) { setTerrains(map, pendingTerrains); pendingTerrains = null; }
  for (const frame of pendingCharts) applyChart(frame);
  pendingCharts = [];
  stopWalkTimer(); walk = null; highlightPath = null;
  focusCurrentArea();
  rebuildAreaSelect();
  redraw();
});

// Queued, not overwritten: a paced MUD answers a burst of moves one room at a
// time, and each arrival belongs to the oldest unanswered direction.
panel.on("moved", (frame) => {
  if (frame && frame.dir) moves.push(frame.dir);
});

// The direction that brought us to `seen`: the oldest queued move — unless the
// room re-reported itself (no move happened, keep the queue), or the map knows
// that direction leads elsewhere (the queue lost a step to a blocked move:
// drop it all and let resolveRoomSeen infer from known exits).
function takeMoveFor(seen) {
  if (seen.fp) return moves.shift();   // fingerprints: no identity to check against
  const prev = currentRoom(map);
  if (prev && prev.key === seen.key) return null;
  const dir = moves.peek();
  if (dir != null && contradicts(map, dir, seen.key)) { moves.clear(); return null; }
  return moves.shift();
}

// Shared ingest for a resolved "room seen" — from GMCP room.info (a `key`) or
// non-GMCP capture (a fingerprint `fp`). Correlates with the pending movement
// direction, mutates the graph, advances any active walk, and repaints.
function ingestRoom(seen) {
  if (!loaded) return;
  const walking = !!(walk && walk.isActive());
  let pendingDir = takeMoveFor(seen);
  if (walking) {
    const d = walk.pendingDir();
    if (d != null) pendingDir = d;
  }
  const prevId = map.currentId, first = !sawRoom;
  sawRoom = true;
  resolveRoomSeen(map, seen, pendingDir, cfg);
  const curId = map.currentId;
  if (curId !== prevId) hideLinkOffer();
  if (!first && !walking && prevId != null && getRoom(map, prevId) && curId != null && curId !== prevId
      && !hasWay(map, prevId, curId)) {
    offerLink(prevId, curId);
  }
  hideHover();   // the view recentres; a card would point at where the room was
  history.clear();
  if (walk && walk.isActive()) {
    dispatchWalkActions(walk.onRoomSeen(map.currentId, now()));
  }
  focusCurrentArea();
  rebuildAreaSelect();
  redraw();
  schedulePersist();
}

// mudstd.room.terrain: the server's terrain labels and colours. Kept in the
// map so they colour rooms after a reload or offline.
panel.on("terrains", (frame) => {
  const defs = terrainsFromFrame(frame);
  if (!loaded) { pendingTerrains = { ...(pendingTerrains || {}), ...defs }; return; }
  if (setTerrains(map, defs)) { redraw(); schedulePersist(); }
});

// mudstd.map.rooms: a chart, many rooms at once (chart.js). Nobody moves, so
// the view stays where it is; the area picker learns any new areas. A chart
// part already held at this version is skipped.
function applyChart(frame) {
  if (!frame || !Array.isArray(frame.rooms)) return false;
  const name = typeof frame.chart === "string" && frame.chart ? frame.chart : null;
  const version = typeof frame.version === "string" && frame.version ? frame.version : null;
  const part = Number.isInteger(frame.part) ? frame.part : 1;
  const tag = name ? `${name}#${part}` : null;
  if (tag && version && map.charts[tag] === version) return false;
  const seen = frame.rooms.map(seenFromFrame).filter(Boolean);
  importChart(map, seen, cfg);
  if (tag && version) map.charts[tag] = version;
  return true;
}

panel.on("room_chart", (frame) => {
  if (!loaded) { pendingCharts.push(frame); return; }
  if (!applyChart(frame)) return;
  rebuildAreaSelect();
  redraw();
  schedulePersist();
});

panel.on("room_seen", (frame) => {
  const seen = seenFromFrame(frame);
  if (seen) ingestRoom(seen);
});

// Non-GMCP: the adapter assembled a room's name + exits from output lines.
// Fingerprint them into a synthetic identity and ingest exactly like GMCP.
panel.on("capture", (frame) => {
  if (!frame || !frame.name) return;
  ingestRoom({
    fp: fingerprint({ name: frame.name, exits: frame.exits }),
    exitDirs: exitDirections(frame.exits),
    name: frame.name, env: "",
  });
});

// Movement-failure guard: a blocked move produced no room change, so drop the
// pending direction — otherwise the next reprint would forge a phantom link.
panel.on("move_fail", () => { moves.shift(); });

// A new session: where you log in isn't a move to offer a link for.
panel.on("connected", () => { sawRoom = false; hideLinkOffer(); moves.clear(); });

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

// Canvas: pan (drag), single-click = preview the route (a stub card: view where it leads), double-click = walk.
let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, movedDuringDrag = false;
let dragRoomId = null;   // non-null while dragging a room (vs panning)
function roomAt(clientX, clientY) {
  const rect = $canvas.getBoundingClientRect();
  const x = clientX - rect.left, y = clientY - rect.top;
  const half = lastRoomSize / 2;
  for (const r of lastLayout.rooms) {
    if (x >= r.px - half && x <= r.px + half && y >= r.py - half && y <= r.py + half) return r.id;
  }
  return null;
}
// The stub card under a pointer, where no room is: a card sits beneath any
// room it meets, so the room wins.
function cardAtClient(clientX, clientY) {
  if (roomAt(clientX, clientY) != null) return null;
  const rect = $canvas.getBoundingClientRect();
  return cardAt(lastCards, clientX - rect.left, clientY - rect.top);
}
const DIR_NAMES = { n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest", se: "southeast", sw: "southwest" };
// Hover card for a stub card: where it leads, and what a click does.
function cardTooltip(k) {
  const to = getRoom(map, k.to);
  const area = to && getArea(map, to.areaId);
  const rows = [{ label: "Exit", value: DIR_NAMES[k.dir] || k.dir }];
  if (to) rows.push({ label: "To", value: to.name || `#${to.id}` });
  if (k.kind === "floor") rows.push({ label: "Floor", value: k.up ? "Above" : "Below" });
  const title = k.kind === "area" ? ((area && area.label) || k.label) : k.label;
  return { title, rows, body: "Click to view · double-click to walk there" };
}
// Convert a client pixel to an integer area-grid cell, using the anchor and
// scale the last layout was drawn with. Mirrors render.js computeLayout math.
function cellFromClient(clientX, clientY, room) {
  const anchor = anchorForArea(room.areaId);
  if (!anchor) return null;
  const rect = $canvas.getBoundingClientRect();
  const scale = ZOOMS[zoomIdx];
  const cx = $canvas.width / 2 + panX, cy = $canvas.height / 2 + panY;
  const px = clientX - rect.left, py = clientY - rect.top;
  const x = Math.round((px - cx) / scale) + anchor.coords.x;
  const y = Math.round((py - cy) / scale) + anchor.coords.y;
  return { x, y };
}

// The anchor render.js used: the focus anchor if in-area, else current, else
// the area's lowest-id room.
function anchorForArea(areaId) {
  const cur = currentRoom(map);
  if (focusAnchorId != null && map.rooms[focusAnchorId] && map.rooms[focusAnchorId].areaId === areaId) {
    return map.rooms[focusAnchorId];
  }
  if (cur && cur.areaId === areaId) return cur;
  const ids = Object.keys(map.rooms)
    .filter((id) => map.rooms[id].areaId === areaId)
    .sort((a, b) => Number(a) - Number(b));
  return ids.length ? map.rooms[ids[0]] : null;
}
// Hover card: the host tooltip (title, rows, note) over a room after a short
// rest. Hidden when the pointer leaves the room, the canvas, or starts a drag.
let hoverId = null, hoverTimer = null;
function hideHover() {
  if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
  if (hoverId != null && panel.tooltip) panel.tooltip.hide();
  hoverId = null;
}
$canvas.addEventListener("mousemove", (e) => {
  if (dragging) return;
  const card = cardAtClient(e.clientX, e.clientY);
  $canvas.style.cursor = card ? "pointer" : "";
  if (!panel.tooltip) return;
  if (card) { hoverCard(card); return; }
  const id = roomAt(e.clientX, e.clientY);
  if (id === hoverId) return;
  hideHover();
  if (id == null) return;
  hoverId = id;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    const room = getRoom(map, id);
    const lr = lastLayout.rooms.find((r) => r.id === id);
    if (!room || !lr) return;
    const rect = $canvas.getBoundingClientRect();
    const half = lastRoomSize / 2;
    panel.tooltip.show(
      { x: rect.left + lr.px - half, y: rect.top + lr.py - half, width: lastRoomSize, height: lastRoomSize },
      tooltipSpec(map, room),
    );
  }, 350);
});
// The same, over a stub card; its hover key is "card:" + where and which way.
function hoverCard(k) {
  const key = `card:${k.to}|${k.dir}`;
  if (key === hoverId) return;
  hideHover();
  hoverId = key;
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (!getRoom(map, k.to)) return;
    const rect = $canvas.getBoundingClientRect();
    panel.tooltip.show({ x: rect.left + k.l, y: rect.top + k.t, width: k.r - k.l, height: k.b - k.t }, cardTooltip(k));
  }, 350);
}
$canvas.addEventListener("mouseleave", hideHover);
$canvas.addEventListener("wheel", hideHover, { passive: true });

$canvas.addEventListener("mousedown", (e) => {
  hideHover();
  dragging = true; movedDuringDrag = false;
  lastX = e.clientX; lastY = e.clientY; downX = e.clientX; downY = e.clientY;
  const id = roomAt(e.clientX, e.clientY);
  const plain = e.button === 0 && !pocketPreview;
  dragRoomId = plain && !e.shiftKey ? id : null;
  if (plain && e.shiftKey && !pendingMode && id == null) {
    const rect = $canvas.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    marquee = { x0: x, y0: y, x1: x, y1: y };
  }
});
window.addEventListener("mousemove", (e) => {
  if (!dragging) return;
  if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 4) movedDuringDrag = true;
  if (marquee) {
    const rect = $canvas.getBoundingClientRect();
    marquee.x1 = e.clientX - rect.left; marquee.y1 = e.clientY - rect.top;
    redraw();
    return;
  }
  if (dragRoomId != null) return;   // room-drag commits on mouseup; no live pan
  panX += e.clientX - lastX; panY += e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  redraw();
});
window.addEventListener("mouseup", (e) => {
  if (marquee) {
    if (movedDuringDrag) {
      for (const id of roomsInRect(lastLayout, marquee.x0, marquee.y0, marquee.x1, marquee.y1, lastRoomSize)) {
        selection.add(id);
      }
    }
    marquee = null;
    redraw();
  } else if (dragging && dragRoomId != null && movedDuringDrag && selection.size > 1 && selection.has(dragRoomId)) {
    const r = getRoom(map, dragRoomId);
    const cell = r && cellFromClient(e.clientX, e.clientY, r);
    if (cell && (cell.x !== r.coords.x || cell.y !== r.coords.y)
        && !applyEdit(() => moveRooms(map, Array.from(selection), cell.x - r.coords.x, cell.y - r.coords.y))) {
      panel.post("notify", { text: "Some of those cells are already occupied." });
    }
  } else if (dragging && dragRoomId != null && movedDuringDrag) {
    const r = getRoom(map, dragRoomId);
    if (r) {
      const cell = cellFromClient(e.clientX, e.clientY, r);
      if (cell && (cell.x !== r.coords.x || cell.y !== r.coords.y)) {
        if (isCellOccupied(map, r.areaId, cell.x, cell.y, r.coords.z, r.id)) {
          panel.post("notify", { text: "That cell is already occupied." });
        } else {
          applyEdit(() => moveRoom(map, r.id, cell.x, cell.y));
        }
      }
    }
  }
  dragging = false; dragRoomId = null;
});
$canvas.addEventListener("click", (e) => {
  // The second click of a double-click on a card: the first switched the
  // view, so leave it to dblclick, which walks to the room the card named.
  if (e.detail >= 2 && clickedCard) return;
  clickedCard = null;
  if (movedDuringDrag) return;               // it was a pan/drag, not a click
  const id = roomAt(e.clientX, e.clientY);
  if (pocketPreview) {
    if (id != null) {
      if (pocketPreview.ids.has(id)) pocketPreview.ids.delete(id);
      else pocketPreview.ids.add(id);
      redraw();
    }
    return;
  }
  if (pendingMode) {
    if (id != null) resolvePendingMode(id);
    else {
      // A card takes you to the other area or floor, to pick the room there.
      const card = cardAtClient(e.clientX, e.clientY);
      if (card) { hideHover(); focusRoom(card.to); }
    }
    return;                                   // consume the click either way
  }
  if (e.shiftKey) {
    if (id != null) {
      if (selection.has(id)) selection.delete(id); else selection.add(id);
      redraw();
    }
    return;
  }
  const cleared = clearSelection();
  const card = id == null ? cardAtClient(e.clientX, e.clientY) : null;
  // A room: show the route there, leaving the map where it is. A card: go
  // and look at where it leads (the other area or floor), remembering the
  // room so a double-click walks there though the view has changed under it.
  if (id != null) { previewPath(id); if (cleared && !currentRoom(map)) redraw(); }
  else if (card) {
    clickedCard = { to: card.to, at: e.timeStamp };
    hideHover();
    focusRoom(card.to); previewPath(card.to);
  }
  else if (cleared) redraw();
});
function resolvePendingMode(targetId) {
  const mode = pendingMode;
  pendingMode = null;
  if (mode.kind === "merge") {
    if (targetId === mode.fromId) { panel.post("notify", { text: "Can't merge a room into itself." }); return; }
    applyEdit(() => mergeRooms(map, mode.fromId, targetId));
    panel.post("notify", { text: "Rooms merged." });
  } else if (mode.kind === "addExit") {
    applyEdit(() => addExit(map, mode.fromId, mode.dir, targetId));
    panel.post("notify", { text: `Exit '${mode.dir}' added.` });
  } else if (mode.kind === "link") {
    if (targetId === mode.fromId) { panel.post("notify", { text: "Can't link a room to itself." }); return; }
    makeLink(mode.fromId, targetId, false);
  }
}

// Name a new link (optional), then add it.
async function makeLink(fromId, toId, oneWay) {
  const name = await inlinePrompt("Link name, e.g. Lift 12 (optional)", "", true);
  if (name == null) return;
  if (applyEdit(() => addLink(map, fromId, toId, { name, oneWay }))) {
    panel.post("notify", { text: oneWay ? "One-way link added." : "Link added." });
  }
}

// ── Link offer ──────────────────────────────────────────────────────────────
// After a move the map knows no exit or link for — a teleport, a lift, a
// ferry — offer to link where you were to where you are.
const $linkBar = document.querySelector(".link-bar");
function offerLink(fromId, toId) {
  linkOffer = { fromId, toId };
  const from = getRoom(map, fromId);
  const $label = $linkBar.querySelector(".link-bar-label");
  $label.textContent = $label.title =
    `No known way here from ${from ? (from.name || `#${fromId}`) : `#${fromId}`}.`;
  $linkBar.hidden = false;
}
function hideLinkOffer() { linkOffer = null; $linkBar.hidden = true; }
function acceptLinkOffer(oneWay) {
  const offer = linkOffer;
  hideLinkOffer();
  if (offer && getRoom(map, offer.fromId) && getRoom(map, offer.toId)) makeLink(offer.fromId, offer.toId, oneWay);
}
$linkBar.querySelector(".link-both").addEventListener("click", () => acceptLinkOffer(false));
$linkBar.querySelector(".link-one").addEventListener("click", () => acceptLinkOffer(true));
$linkBar.querySelector(".link-dismiss").addEventListener("click", hideLinkOffer);
let clickedCard = null;   // { to, at } of the stub card a plain click last went through
$canvas.addEventListener("dblclick", (e) => {
  if (clickedCard && e.timeStamp - clickedCard.at < 1000) {
    const to = clickedCard.to;
    clickedCard = null;
    startWalk(to);
    return;
  }
  const id = roomAt(e.clientX, e.clientY);
  if (id != null) startWalk(id);
});
$canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  hideHover();
  const id = roomAt(e.clientX, e.clientY);
  if (id != null) openRoomMenu(e.clientX, e.clientY, id);
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && learnActive) { closeLearn(); return; }
  if (e.key === "Escape" && pocketPreview) { cancelPocket(); return; }
  if (e.key === "Escape" && pendingMode) {
    pendingMode = null;
    panel.post("notify", { text: "Cancelled." });
    return;
  }
  if (e.key === "Escape" && clearSelection()) { redraw(); return; }
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key.toLowerCase() === "z" && !e.shiftKey) {
    e.preventDefault();
    if (pocketPreview) cancelPocket();
    pendingMode = null;
    doUndo();
  } else if ((e.key.toLowerCase() === "z" && e.shiftKey) || e.key.toLowerCase() === "y") {
    e.preventDefault();
    if (pocketPreview) cancelPocket();
    pendingMode = null;
    doRedo();
  }
});
window.addEventListener("resize", redraw);
// Repaint the canvas when the host switches theme (CSS handles the DOM chrome
// on its own; the canvas has to be told). Mallard re-pushes the theme vars
// before firing this, so themeColors() reads the new palette.
window.addEventListener("mallard:themechange", redraw);

// ── Handshake ─────────────────────────────────────────────────────────────────
panel.post("ready", {});
redraw();
