// Decide which area a "room seen" signal belongs to. The engine stays
// game-agnostic: it consumes a generic (areaTag, areaField) pair and a config;
// game-specific vocabulary (e.g. Discworld's "inside"/"outside") lives only in
// the shipped default config, never here.

import { addArea, getArea, getAreaByKey } from "./graph.js";

const ZONE_FIELDS = new Set(["area", "zone", "domain"]);

export function resolveArea(map, seen, prev, cfg) {
  const strategy = effectiveStrategy(cfg, seen);
  if (strategy === "zone") return resolveZone(map, seen);
  if (strategy === "boundary") return resolveBoundary(map, seen, prev, cfg);
  return resolveFallback(map, prev);
}

function effectiveStrategy(cfg, seen) {
  const s = (cfg && cfg.strategy) || "auto";
  if (s !== "auto") return s;
  if (seen.areaTag != null && seen.areaField && ZONE_FIELDS.has(seen.areaField)) return "zone";
  if (seen.areaTag != null && seen.areaField === "kind") return "boundary";
  return "fallback";
}

function ensureArea(map, key, label) {
  const existing = getAreaByKey(map, key);
  if (existing) return existing.id;
  return addArea(map, { key, label }).id;
}

// The zone value is the area's key. Its label is the server's `areaName`
// where sent (kept current if the server renames it), else the value itself.
function resolveZone(map, seen) {
  const id = ensureArea(map, "zone:" + seen.areaTag, seen.areaName || String(seen.areaTag));
  if (seen.areaName) getArea(map, id).label = seen.areaName;
  return id;
}

function resolveBoundary(map, seen, prev, cfg) {
  const overworld = (cfg && cfg.overworld) || "outside";
  if (seen.areaTag === overworld) {
    return ensureArea(map, "__overworld__", "Overworld");
  }
  // Interior: continue the previous room's area when it is a non-overworld
  // area (a contiguous building run); otherwise start a fresh interior.
  if (prev && prev.areaId != null) {
    const prevArea = getArea(map, prev.areaId);
    if (prevArea && prevArea.key !== "__overworld__") return prevArea.id;
  }
  return addArea(map, { key: null, label: seen.name || "Interior" }).id;
}

// Note: on worlds that send an area/zone/kind field only intermittently, `auto`
// makes no-tag rooms inherit the previous room's area. Such worlds are best
// served by an explicit `area_strategy` rather than relying on `auto`.
function resolveFallback(map, prev) {
  if (prev && prev.areaId != null) return prev.areaId;
  return ensureArea(map, "__default__", "Map");
}
