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
    // mudstd.room's explicit exits ([{ dir, toKey }]); absent on room.info.
    exits: Array.isArray(frame.exits) ? frame.exits : undefined,
    // Server-sent grid position ({ x, y, z }), already normalized by the
    // adapter; re-checked here so a malformed one can't place a room at NaN.
    coords: validCoords(frame.coords),
  };
}

export function validCoords(c) {
  if (!c || typeof c !== "object") return undefined;
  const z = c.z == null ? 0 : c.z;
  if (![c.x, c.y, z].every(Number.isFinite)) return undefined;
  return { x: c.x, y: c.y, z };
}
