// Room annotations: what a room looks like beyond its square — fill colour,
// glyph, region tint — and the legend and hover card that explain them. Pure:
// no DOM, no host APIs (render.js paints, mapper.js wires the host).
//
// Server-fed fields (see seen.js / identity.js): env (the terrain id), tags,
// region, elevation, lat/lon, exitStyles. User-set fields (edits.js): color,
// symbol, note. Server terrain definitions live in map.terrains, tag
// definitions in map.tagDefs, region names in area.regions and their colours
// in area.regionColors.

import { floorNeighbours } from "./floors.js";
import { linksOf, linkLabel } from "./links.js";

// Built-in colours for well-known terrain words, for servers that name a
// terrain without defining it (IRE's `environment`, a mudstd `terrain` with no
// mudstd.room.terrain). Matched by word against the terrain's id and label, in
// order, so "deep water" is deep before it's water. Mid-tones, legible on
// light and dark themes alike.
const TERRAIN_CLASSES = [
  ["#2f4f9a", ["deep", "ocean", "sea"]],
  ["#4a7fc0", ["water", "river", "lake", "shallow", "shallows", "stream", "pond", "underwater"]],
  ["#5f7a4a", ["swamp", "marsh", "bog", "fen"]],
  ["#3f7f3f", ["forest", "wood", "woods", "jungle", "grove"]],
  ["#7fae5a", ["field", "grass", "grassland", "plain", "plains", "meadow", "farmland", "farm", "garden", "park", "hydroponics"]],
  ["#9a9a4f", ["hill", "hills", "highland", "highlands"]],
  ["#8a7a6a", ["mountain", "mountains", "peak", "cliff", "rock", "rocky"]],
  ["#d8c27a", ["desert", "sand", "dunes", "beach"]],
  ["#d8e4ec", ["snow", "ice", "tundra", "glacier", "arctic"]],
  ["#c0503a", ["lava", "fire", "volcano", "volcanic"]],
  ["#6a5a6a", ["cave", "cavern", "underground", "tunnel", "mine", "sewer", "sewers", "dungeon"]],
  ["#2a2f4a", ["air", "sky", "space", "vacuum"]],
  ["#5a8a9a", ["dock", "docks", "harbour", "harbor", "port", "pier", "berth", "spine"]],
  ["#c08040", ["ship", "vessel", "boat", "cockpit"]],
  ["#6aa0a0", ["lift", "elevator", "ladder", "ladderway", "stairs", "stair", "shaft"]],
  ["#9a7ab0", ["hub", "plaza", "square", "junction"]],
  ["#8a909a", ["corridor", "hallway", "passage", "walkway", "lobby", "ring", "concourse"]],
  ["#a08c6e", ["road", "street", "path", "trail", "bridge", "lane", "alley", "track"]],
  ["#a0a0a8", ["city", "urban", "town", "village"]],
  ["#c0a040", ["shop", "market", "store", "bazaar"]],
  ["#b0a0d0", ["temple", "church", "shrine", "chapel"]],
  ["#b59a7a", ["indoors", "inside", "building", "room", "hall", "house", "interior"]],
];

const GREY = "#888888";

function words(s) {
  return String(s).toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

// The built-in colour for a terrain word or label, or null.
export function builtinTerrainColor(...names) {
  const ws = new Set(names.filter((n) => n != null && n !== "").flatMap(words));
  if (ws.size === 0) return null;
  for (const [color, keys] of TERRAIN_CLASSES) {
    if (keys.some((k) => ws.has(k))) return color;
  }
  return null;
}

// A deterministic colour for any terrain value — unknown words, Discworld's
// numeric terrain codes. Coerced to a string: Discworld sends a number and an
// old stored map may still hold one.
export function envColor(env) {
  const s = String(env == null ? "" : env);
  if (!s) return GREY;
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffffff;
  const r = 80 + (h & 0x7f);
  const g = 80 + ((h >> 7) & 0x7f);
  const b = 80 + ((h >> 14) & 0x7f);
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

// What a room's terrain is called: the server's label, else the id itself.
export function terrainLabel(map, env) {
  const s = String(env == null ? "" : env);
  if (!s) return "";
  const def = map.terrains && map.terrains[s];
  return (def && def.label) || s;
}

// A room's fill: the user's colour, else the server's for its terrain, else a
// built-in one for a well-known terrain word, else the hash, else grey.
export function fillColor(map, room) {
  if (room.color) return room.color;
  const env = room.env == null ? "" : String(room.env);
  if (!env) return GREY;
  const def = map.terrains && map.terrains[env];
  if (def && def.color) return def.color;
  return builtinTerrainColor(env, def && def.label) || envColor(env);
}

// Glyphs for well-known tags, first match wins. Text-presentation codepoints
// only: emoji-default ones (⚓ ⚡) would come out as colour emoji in WebKit.
export const GLYPHS = [
  ["★", ["start", "recall", "spawn", "home"]],
  ["⇅", ["lift", "elevator"]],
  ["$", ["shop", "store", "market", "vendor", "broker", "outfitter", "trader", "merchant"]],
  ["¤", ["bank", "vault"]],
  ["+", ["healer", "clinic", "hospital", "temple", "infirmary"]],
  ["⌂", ["inn", "bunkhouse", "lodging", "hotel", "tavern", "pub", "bar", "rent"]],
  ["✉", ["post", "postoffice", "mail"]],
  ["⚑", ["dock", "berth", "harbour", "harbor", "port", "stable"]],
  ["ϟ", ["charger", "power"]],
  ["⚒", ["workshop", "workshops", "machines", "forge", "smithy", "crafting"]],
  ["▣", ["freight", "storage", "warehouse", "cargo", "locker"]],
  ["i", ["terminal", "charts", "info", "information", "library", "news", "records", "map"]],
  ["!", ["quest", "questgiver"]],
  ["†", ["trainer", "guild", "guildhall"]],
];

// A tag's lookup word: lower-cased, its qualifier dropped ("machines: refinery"
// → "machines"), spaces and dashes folded.
export function tagWord(tag) {
  return String(tag).toLowerCase().split(":")[0].trim().replace(/[\s-]+/g, "_");
}

export function glyphForTag(tag) {
  const w = tagWord(tag);
  for (const [glyph, keys] of GLYPHS) if (keys.includes(w)) return glyph;
  return null;
}

// The server's definition (mudstd.room.tags) for a room's tag, matched by
// lookup word, or null.
export function tagDef(map, tag) {
  const defs = map && Array.isArray(map.tagDefs) ? map.tagDefs : [];
  if (defs.length === 0) return null;
  const w = tagWord(tag);
  return defs.find((d) => tagWord(d.id) === w) || null;
}

// What a tag is called: the server's label where it defines the tag, else the
// tag as sent.
export function tagLabel(map, tag) {
  const def = tagDef(map, tag);
  return def ? def.label : String(tag);
}

// What's drawn in the room: the user's symbol; else the glyph of the first
// tag the server defines with one (mudstd.room.tags, in its order) that the
// room has; else the first built-in glyph among the room's tags in GLYPHS'
// order (so a lift lobby with a charger is a lift); else none.
export function roomGlyph(room, map = null) {
  if (room.symbol) return room.symbol;
  const tags = Array.isArray(room.tags) ? room.tags : [];
  if (tags.length === 0) return null;
  const words = new Set(tags.map(tagWord));
  const defs = map && Array.isArray(map.tagDefs) ? map.tagDefs : [];
  for (const d of defs) if (d.glyph && words.has(tagWord(d.id))) return d.glyph;
  for (const [glyph, keys] of GLYPHS) if (keys.some((k) => words.has(k))) return glyph;
  return null;
}

// A region's colour, hashed from its key to a hue spread round the wheel.
export function regionHue(key) {
  const s = String(key);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return Math.round((h * 137.508) % 360);
}
// A region's tint: the server's colour for it (regionColor, "#rrggbb") at
// `alpha` where there is one, else the hue hashed from its key.
export function regionColor(key, alpha = 1, color = null) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color || ""));
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }
  return `hsla(${regionHue(key)}, 55%, 55%, ${alpha})`;
}

// The server's colour for a region of an area, or null.
export function areaRegionColor(map, areaId, key) {
  const area = areaId != null && map.areas ? map.areas[areaId] : null;
  return (area && area.regionColors && area.regionColors[key]) || null;
}

export function regionName(map, room) {
  if (!room.region) return "";
  const area = room.areaId != null ? map.areas[room.areaId] : null;
  return (area && area.regions && area.regions[room.region]) || room.region;
}

// ── Height shading ───────────────────────────────────────────────────────────
// Rooms with an elevation are lightened (higher) or darkened (lower) by where
// they sit between the lowest and highest rooms in view. Subtle, so the
// terrain colour stays the main signal; and over a span of at least
// SHADE_MIN_SPAN metres, so a nearly flat area isn't shaded hard.
export const SHADE_STRENGTH = 0.3;
export const SHADE_MIN_SPAN = 100;

// The lowest and highest elevation among `rooms`, or null where none has one.
export function elevationRange(rooms) {
  let min = Infinity, max = -Infinity;
  for (const r of rooms) {
    if (!Number.isFinite(r.elevation)) continue;
    if (r.elevation < min) min = r.elevation;
    if (r.elevation > max) max = r.elevation;
  }
  return min === Infinity ? null : { min, max };
}

// How far to shade a room at `elevation`, from -1 (darkest) to 1 (lightest),
// within `range`; the range is widened about its middle to the minimum span.
// 0 for a room with no elevation, or no range.
export function shadeAmount(elevation, range, minSpan = SHADE_MIN_SPAN) {
  if (!range || !Number.isFinite(elevation)) return 0;
  const span = Math.max(range.max - range.min, minSpan);
  if (!(span > 0)) return 0;
  const mid = (range.min + range.max) / 2;
  return Math.max(-1, Math.min(1, ((elevation - mid) / span) * 2));
}

// A #rrggbb colour lightened toward white (t > 0) or darkened toward black
// (t < 0) by |t| × strength. Anything not #rrggbb comes back as it is.
export function shadeColor(hex, t, strength = SHADE_STRENGTH) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m || !t) return hex;
  const k = Math.max(-1, Math.min(1, t)) * strength;
  const n = parseInt(m[1], 16);
  const mix = (c) => Math.round(k > 0 ? c + (255 - c) * k : c * (1 + k));
  return "#" + [n >> 16, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, "0")).join("");
}

// ── Exit styles ──────────────────────────────────────────────────────────────
// How a way between rooms is drawn (mudstd extension `style` on an exit):
// path is the plain line and the default; the rest by priority, strongest
// last, for a line whose two ends disagree.
export const EXIT_STYLES = ["path", "trail", "road", "climb"];
export const EXIT_STYLE_LABELS = { road: "Road", path: "Path", trail: "Trail", climb: "Climb" };

// The style a room's exit by `dir` is drawn in.
export function exitStyle(room, dir) {
  const s = room && room.exitStyles ? room.exitStyles[dir] : null;
  return EXIT_STYLES.includes(s) ? s : "path";
}

// The stronger of two styles: climb > road > trail > path.
export function strongerStyle(a, b) {
  const ra = EXIT_STYLES.indexOf(a), rb = EXIT_STYLES.indexOf(b);
  return (rb > ra ? b : a) || "path";
}

// Black or white text, whichever reads on a #rrggbb fill.
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return "#000000";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#000000" : "#ffffff";
}

// The swatches the Colour menu offers.
export const SWATCHES = [
  ["Red", "#d9534f"], ["Orange", "#e8913a"], ["Yellow", "#e8c93a"], ["Green", "#5cb85c"],
  ["Teal", "#3aa8a0"], ["Blue", "#4a7fd9"], ["Purple", "#9a6ad9"], ["Pink", "#d96aa8"],
];

// "#abc", "abc", "#aabbcc", "AABBCC" → "#aabbcc"; anything else → null.
export function parseColor(s) {
  const t = String(s || "").trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(t)) return "#" + t;
  if (/^[0-9a-f]{3}$/.test(t)) return "#" + t.split("").map((c) => c + c).join("");
  return null;
}

// A tag's glyph and what to call it in the legend: the server's glyph and
// label where it defines the tag with a glyph, else the built-in glyph and
// the tag's word. Null for a tag with neither glyph.
function tagGlyph(map, tag) {
  const def = tagDef(map, tag);
  if (def && def.glyph) return { glyph: def.glyph, label: def.label, game: true };
  const g = glyphForTag(tag);
  if (!g) return null;
  return { glyph: g, label: def ? def.label : tagWord(tag).replace(/_/g, " "), game: false };
}

// What the legend lists for a set of rooms (the ones in view): terrains by
// fill, glyphs with the tags behind them (the server's glyphs first, in its
// order, then the built-in ones), regions, and the ways (exit styles) among
// `exits` (render.js layout exits) when any isn't a plain path. User colours
// and symbols aren't listed — they mean what the user says they mean.
export function legendModel(map, rooms, exits = []) {
  const terrains = new Map(), glyphs = new Map(), regions = new Map();
  for (const r of rooms) {
    if (!r.color && r.env != null && r.env !== "") {
      const env = String(r.env);
      if (!terrains.has(env)) {
        terrains.set(env, { label: terrainLabel(map, env), color: fillColor(map, { env }) });
      }
    }
    if (!r.symbol && Array.isArray(r.tags)) {
      for (const t of r.tags) {
        const g = tagGlyph(map, t);
        if (!g) continue;
        if (!glyphs.has(g.glyph)) glyphs.set(g.glyph, { tags: new Set(), game: false });
        const entry = glyphs.get(g.glyph);
        entry.tags.add(g.label);
        entry.game = entry.game || g.game;
      }
    }
    if (r.region && !regions.has(r.region)) {
      const color = areaRegionColor(map, r.areaId, r.region);
      regions.set(r.region, { name: regionName(map, r), color: regionColor(r.region, 1, color) });
    }
  }
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  // Glyph order: the server's, by its list; then the built-in table's.
  const order = [
    ...(Array.isArray(map.tagDefs) ? map.tagDefs.map((d) => d.glyph).filter(Boolean) : []),
    ...GLYPHS.map(([g]) => g),
  ];
  const rank = (g) => { const i = order.indexOf(g); return i < 0 ? order.length : i; };
  const styles = new Set((exits || []).map((e) => e.style || "path"));
  const ways = [...styles].some((st) => st !== "path")
    ? ["road", "path", "trail", "climb"].filter((st) => styles.has(st)).map((style) => ({ style, label: EXIT_STYLE_LABELS[style] }))
    : [];
  return {
    terrains: [...terrains.values()].sort(byLabel),
    glyphs: [...glyphs.keys()].sort((a, b) => rank(a) - rank(b))
      .map((g) => ({ glyph: g, tags: [...glyphs.get(g).tags], game: glyphs.get(g).game })),
    regions: [...regions.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ways,
  };
}

// "34.12°N 5.40°W" for a latitude and longitude in degrees, or "" without both.
export function formatLatLon(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
  const part = (v, pos, neg) => `${Math.abs(v).toFixed(2)}°${v < 0 ? neg : pos}`;
  return `${part(lat, "N", "S")} ${part(lon, "E", "W")}`;
}

// The host tooltip spec ({ title, body, rows }) for a room's hover card.
export function tooltipSpec(map, room) {
  const rows = [];
  if (room.charted) rows.push({ label: "Visited", value: "Not yet (charted)" });
  const region = regionName(map, room);
  if (region) rows.push({ label: "Region", value: region });
  const terrain = terrainLabel(map, room.env);
  if (terrain) rows.push({ label: "Terrain", value: terrain });
  if (Number.isFinite(room.elevation)) rows.push({ label: "Elevation", value: `${Math.round(room.elevation)} m` });
  const position = formatLatLon(room.lat, room.lon);
  if (position) rows.push({ label: "Position", value: position });
  const tags = Array.isArray(room.tags) ? room.tags.map(String).filter(Boolean) : [];
  if (tags.length) rows.push({ label: "Here", value: tags.map((t) => tagLabel(map, t)).join(", ") });
  // Up and down by exit; links (a lift's stops among them) on their own row.
  const floors = floorNeighbours(map, room).filter((f) => f.via === "exit");
  const names = (up) => floors.filter((f) => f.up === up)
    .map((f) => map.rooms[f.toId].name || `#${f.toId}`).join(", ");
  if (floors.some((f) => f.up)) rows.push({ label: "Up", value: names(true) });
  if (floors.some((f) => !f.up)) rows.push({ label: "Down", value: names(false) });
  const links = Object.keys(linksOf(room)).filter((to) => map.rooms[to]);
  if (links.length) rows.push({ label: "Links", value: links.map((to) => linkLabel(map, room.id, to)).join(", ") });
  const spec = { title: room.name || `#${room.id}`, rows };
  if (room.note) spec.body = room.note;
  return spec;
}
