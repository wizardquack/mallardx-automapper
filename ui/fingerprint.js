// Non-GMCP room identity: a stable fingerprint hashed from a room's normalized
// name + sorted exit directions (+ optional terrain). Pure; no DOM, no host
// APIs. This is the crux of universal (non-GMCP) mapping — where a MUD gives us
// no room id, the fingerprint stands in for one, and position + movement vector
// disambiguate the rooms that inevitably share a fingerprint.

// Alias table for exit-line parsing. Mirrors src/movement.lua's canonical set
// (n s e w ne nw se sw u d) but lives here because exit *lines* are parsed in
// the engine, while sent *commands* are normalized in Lua. Longer aliases must
// precede their prefixes so "northeast" is not eaten as "north" + "east".
const EXIT_ALIASES = {
  northeast: "ne", northwest: "nw", southeast: "se", southwest: "sw",
  north: "n", south: "s", east: "e", west: "w", up: "u", down: "d",
  ne: "ne", nw: "nw", se: "se", sw: "sw",
  n: "n", s: "s", e: "e", w: "w", u: "u", d: "d",
};

// Collapse whitespace, lowercase, trim, and drop trailing sentence punctuation
// so cosmetically different reprints of the same room name hash identically.
export function normalizeName(name) {
  return String(name == null ? "" : name)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?,;:]+$/, "");
}

// Parse a raw exits string ("north, east and up", "n e u", "N, NE, D") into a
// canonical, de-duplicated, sorted direction list. Recognized directions map to
// their canonical token; unrecognized tokens (custom/special exits like
// "enter", "portal") are kept lowercased so they still shape the fingerprint —
// two rooms differing only by a special exit are genuinely different rooms.
export function parseExitList(text) {
  const raw = String(text == null ? "" : text).toLowerCase();
  const out = [];
  const seen = new Set();
  for (const rawTok of raw.split(/[\s,;/|]+|\band\b/)) {
    // Strip surrounding punctuation so "east." / "(north)" match "east"/"north".
    const tok = rawTok.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
    if (!tok) continue;
    const dir = EXIT_ALIASES[tok] || tok;
    if (!seen.has(dir)) { seen.add(dir); out.push(dir); }
  }
  out.sort();
  return out;
}

// FNV-1a 32-bit, hex — deterministic and dependency-free. Distinct from
// render.js's color hash (different purpose, different width) on purpose.
export function hashString(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// Build the fingerprint key. `exits` may be a raw exits string or an already
// parsed array; either is normalized to the canonical sorted list first. The
// "fp:" prefix keeps fingerprint keys from ever colliding with a GMCP room id
// in the same map blob.
export function fingerprint({ name, exits, terrain }) {
  const dirs = Array.isArray(exits) ? parseExitList(exits.join(" ")) : parseExitList(exits);
  const t = terrain == null || terrain === "" ? "" : "|" + String(terrain).toLowerCase().trim();
  const basis = normalizeName(name) + "|" + dirs.join(",") + t;
  return "fp:" + hashString(basis);
}

// Learn-mode aid: turn a sample output line into an anchored regex that captures
// the variable span. `variable` is the substring the user identified as the
// changing part (the room name, or the exits list). Everything else is escaped
// to a literal so the pattern only fires on lines of that exact shape. Returns
// null when `variable` is not a substring of `sample`.
export function inferLinePattern(sample, variable) {
  const line = String(sample == null ? "" : sample);
  const v = String(variable == null ? "" : variable).trim();
  if (!v) return null;
  const at = line.indexOf(v);
  if (at < 0) return null;
  const before = line.slice(0, at);
  const after = line.slice(at + v.length);
  return "^" + escapeRegex(before) + "(.+?)" + escapeRegex(after) + "$";
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The alphanumeric "core" of a line: everything from the first letter/digit to
// the last, dropping decorative borders. "[ The Square ]" → "The Square".
function innerAlnumSpan(line) {
  const s = String(line == null ? "" : line);
  const m = s.match(/^[^A-Za-z0-9]*(.*?)[^A-Za-z0-9]*$/);
  return m ? m[1] : s;
}

// Learn-mode: suggest a room-name regex from a clicked title line. Strips any
// decorative border (brackets, rules) so a marked title yields a tight pattern
// (`^\[ (.+?) \]$`); a bare title falls back to a whole-line capture.
export function suggestNamePattern(line) {
  return inferLinePattern(line, innerAlnumSpan(line)) || "^(.+)$";
}

// Learn-mode: suggest an exits regex from a clicked exits line. Anchors on the
// label before the list ("Obvious exits: ", "Exits: ") when present so only the
// list is captured, dropping any trailing sentence punctuation.
export function suggestExitsPattern(line) {
  const s = String(line == null ? "" : line);
  const at = s.indexOf(": ");
  const listRaw = at >= 0 ? s.slice(at + 2) : innerAlnumSpan(s);
  const list = listRaw.replace(/[.!?;]+$/, "");
  return inferLinePattern(s, list) || "^(.+)$";
}
