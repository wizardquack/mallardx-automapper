// Colours as the map keeps them: "#rrggbb" (the '#' optional on the way in).

// "#rrggbb" or "rrggbb" → [r, g, b] (0…255 each), else null.
export function rgbOf(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

// "#rrggbb" or "rrggbb" → "#rrggbb" (lower case), else null.
export function hexColor(v) {
  if (typeof v !== "string") return null;
  const m = /^#?([0-9a-f]{6})$/i.exec(v);
  return m ? "#" + m[1].toLowerCase() : null;
}
