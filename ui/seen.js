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
    // mudstd.room's explicit exits ([{ dir, toKey }]); absent on room.info.
    exits: Array.isArray(frame.exits) ? frame.exits : undefined,
  };
}
