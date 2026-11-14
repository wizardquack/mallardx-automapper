// Turn a host `room_seen` frame (the Lua adapter's normalized room) into the
// "room seen" signal identity.js resolves. Pure: no DOM, no host APIs. Kept out
// of mapper.js so the hand-off is tested — a field dropped here never reaches
// the graph.

export function seenFromFrame(frame) {
  if (!frame || !frame.key) return null;
  return {
    key: frame.key,
    name: frame.name,
    env: frame.env,
    areaTag: frame.areaTag,
    areaField: frame.areaField,
    // The area's display name, where the server sends one; areaTag stays its key.
    areaName: typeof frame.areaName === "string" && frame.areaName ? frame.areaName : undefined,
    // mudstd.room's explicit exits ([{ dir, toKey? }]); absent on room.info.
    // A room with none may arrive as an empty Lua table, {}: that's no exits.
    exits: validExits(frame.exits),
    // Server-sent grid position ({ x, y, z }), already normalized by the
    // adapter; re-checked here so a malformed one can't place a room at NaN.
    coords: validCoords(frame.coords),
    // Where x comes round ({ x: n }), on a ring (extension); only with coords.
    wrap: validCoords(frame.coords) ? validWrap(frame.wrap) : undefined,
    // What's here and which part of the area (extensions; IRE `details` arrive
    // as tags). A Lua empty list may come through as {}: that's no tags.
    tags: validTags(frame.tags),
    region: nonEmpty(frame.region),
    regionName: nonEmpty(frame.regionName),
    regionColor: hexColor(frame.regionColor) || undefined,
    // Metres above the world's datum (not a floor), and degrees north and
    // east (extensions).
    elevation: finiteOr(frame.elevation),
    lat: finiteOr(frame.lat),
    lon: finiteOr(frame.lon),
    // Ways that aren't exits ([{ toKey, name?, cmd? }], extension `links`).
    links: validLinks(frame.links),
  };
}

function validLinks(list) {
  if (list && typeof list === "object" && !Array.isArray(list) && Object.keys(list).length === 0) return [];
  if (!Array.isArray(list)) return undefined;
  return list
    .filter((l) => l && (typeof l.toKey === "string" || typeof l.toKey === "number") && l.toKey !== "")
    .map((l) => {
      const out = { toKey: String(l.toKey) };
      if (nonEmpty(l.name)) out.name = l.name;
      if (nonEmpty(l.cmd)) out.cmd = l.cmd;
      return out;
    });
}

function validExits(list) {
  if (Array.isArray(list)) return list;
  if (list && typeof list === "object" && Object.keys(list).length === 0) return [];
  return undefined;
}

function finiteOr(v) {
  return Number.isFinite(v) ? v : undefined;
}

// "#rrggbb" or "rrggbb" → "#rrggbb" (lower case), else null.
export function hexColor(v) {
  if (typeof v !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  return m ? "#" + m[1].toLowerCase() : null;
}

function nonEmpty(v) {
  return typeof v === "string" && v ? v : undefined;
}

function validTags(t) {
  if (Array.isArray(t)) return t.filter((x) => typeof x === "string" && x);
  if (t && typeof t === "object" && Object.keys(t).length === 0) return [];
  return undefined;
}

// mudstd.room.terrain's list, as the adapter normalized it, → the map's
// { [id]: { label, color } }. Malformed entries are skipped.
export function terrainsFromFrame(frame) {
  const out = {};
  const list = frame && Array.isArray(frame.list) ? frame.list : [];
  for (const t of list) {
    if (!t || typeof t.id !== "string" || !t.id) continue;
    out[t.id] = {
      label: typeof t.label === "string" && t.label ? t.label : t.id,
      color: typeof t.color === "string" && /^#[0-9a-f]{6}$/i.test(t.color) ? t.color.toLowerCase() : null,
    };
  }
  return out;
}

// mudstd.room.tags' list, as the adapter normalized it, → the map's ordered
// [{ id, label, glyph }] (glyph null where there's none it can draw; see
// validGlyph). Malformed entries and repeated ids are skipped.
export function tagDefsFromFrame(frame) {
  const out = [];
  const ids = new Set();
  const list = frame && Array.isArray(frame.list) ? frame.list : [];
  for (const t of list) {
    if (!t || typeof t.id !== "string" || !t.id || ids.has(t.id)) continue;
    ids.add(t.id);
    out.push({
      id: t.id,
      label: typeof t.label === "string" && t.label ? t.label : t.id,
      glyph: validGlyph(t.glyph),
    });
  }
  return out;
}

// A glyph the map can draw: one or two characters, not whitespace or control
// characters, and nothing that defaults to emoji presentation. WebKit draws
// those as colour emoji (see GLYPHS in annotate.js), which don't take the ink
// colour; a text-presentation selector (U+FE0E) isn't honoured everywhere, so
// rather than append one they're turned away. Else null.
export function validGlyph(g) {
  if (typeof g !== "string") return null;
  const t = g.replace(/\uFE0E/g, "");
  const chars = Array.from(t);
  if (chars.length < 1 || chars.length > 2) return null;
  if (/[\s\p{C}\uFE0F\u200D]/u.test(t)) return null;
  if (/\p{Emoji_Presentation}/u.test(t)) return null;
  return t;
}

export function validWrap(w) {
  if (!w || typeof w !== "object") return undefined;
  return Number.isInteger(w.x) && w.x > 1 ? { x: w.x } : undefined;
}

export function validCoords(c) {
  if (!c || typeof c !== "object") return undefined;
  const z = c.z == null ? 0 : c.z;
  if (![c.x, c.y, z].every(Number.isFinite)) return undefined;
  return { x: c.x, y: c.y, z };
}
