// Room annotations: what a room looks like beyond its square — fill colour,
// glyph, region tint — and the legend and hover card that explain them. Pure:
// no DOM, no host APIs (render.js paints, mapper.js wires the host).
//
// Server-fed fields (see seen.js / identity.js): env (the terrain id), tags,
// region. User-set fields (edits.js): color, symbol, note. Server terrain
// definitions live in map.terrains, region names in area.regions.

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

// What's drawn in the room: the user's symbol, else the first glyph among
// the room's tags in GLYPHS' order (so a lift lobby with a charger is a lift).
export function roomGlyph(room) {
  if (room.symbol) return room.symbol;
  const tags = Array.isArray(room.tags) ? room.tags : [];
  if (tags.length === 0) return null;
  const words = new Set(tags.map(tagWord));
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
export function regionColor(key, alpha = 1) {
  return `hsla(${regionHue(key)}, 55%, 55%, ${alpha})`;
}

export function regionName(map, room) {
  if (!room.region) return "";
  const area = room.areaId != null ? map.areas[room.areaId] : null;
  return (area && area.regions && area.regions[room.region]) || room.region;
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

// What the legend lists for a set of rooms (the ones in view): terrains by
// fill, glyphs with the tags behind them, and regions. User colours and
// symbols aren't listed — they mean what the user says they mean.
export function legendModel(map, rooms) {
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
        const g = glyphForTag(t);
        if (!g) continue;
        if (!glyphs.has(g)) glyphs.set(g, new Set());
        glyphs.get(g).add(tagWord(t).replace(/_/g, " "));
      }
    }
    if (r.region && !regions.has(r.region)) {
      regions.set(r.region, { name: regionName(map, r), color: regionColor(r.region) });
    }
  }
  const byLabel = (a, b) => a.label.localeCompare(b.label);
  return {
    terrains: [...terrains.values()].sort(byLabel),
    glyphs: GLYPHS.filter(([g]) => glyphs.has(g)).map(([g]) => ({ glyph: g, tags: [...glyphs.get(g)] })),
    regions: [...regions.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

// The host tooltip spec ({ title, body, rows }) for a room's hover card.
export function tooltipSpec(map, room) {
  const rows = [];
  const region = regionName(map, room);
  if (region) rows.push({ label: "Region", value: region });
  const terrain = terrainLabel(map, room.env);
  if (terrain) rows.push({ label: "Terrain", value: terrain });
  const tags = Array.isArray(room.tags) ? room.tags.map(String).filter(Boolean) : [];
  if (tags.length) rows.push({ label: "Here", value: tags.join(", ") });
  const spec = { title: room.name || `#${room.id}`, rows };
  if (room.note) spec.body = room.note;
  return spec;
}
