-- Automapper host adapter (Approach A). Thin signal + IO shim: forwards
-- room.info GMCP and movement sends to the iframe engine, and owns per-world
-- storage. All graph/identity/render/area logic lives in ui/*.js.

local movement = require("movement")

local panel = mud.panel("map")
local last_room = nil  -- replayed to the iframe on (re)mount

-- Pick a generic area signal from room.info: prefer a real zone name, fall
-- back to a coarse boundary flag. The engine (ui/area.js) decides semantics
-- from the field NAME, so the adapter stays game-agnostic.
local AREA_FIELDS = { "area", "zone", "domain", "kind" }
local function area_signal(data)
  for _, f in ipairs(AREA_FIELDS) do
    if data[f] ~= nil then return f, tostring(data[f]) end
  end
  return nil, nil
end

-- room.info → normalized room_seen. `identifier` is the stable room key.
gmcp.on("room.info", function(_pkg, data)
  if type(data) ~= "table" then return end
  local key = data.identifier or data.id or data.num or data.vnum
  if key == nil then return end
  local area_field, area_tag = area_signal(data)
  last_room = {
    key = tostring(key),
    name = data.name or "",
    -- Normalize env to string at the boundary: Discworld's `terrain` is a
    -- number, and downstream JS assumes a string for hashing (envColor).
    env = tostring(data.terrain or data.environment or ""),
    areaField = area_field,
    areaTag = area_tag,
  }
  panel:post("room_seen", last_room)
end)

-- Every outbound command: if it normalizes to a direction, tell the engine we
-- moved (used to place the next newly-seen room). Observe-only; never blocks.
mud.on_send(function(m)
  local dir = movement.normalize(m.text)
  if dir then panel:post("moved", { dir = dir }) end
end)

-- Resolver config from settings, forwarded to the engine on load.
local function area_cfg()
  return {
    strategy = settings.get("area_strategy") or "auto",
    overworld = settings.get("area_overworld") or "outside",
  }
end

-- Iframe (re)mounted: hand it the persisted map + resolver config, then replay
-- the last room so a reload mid-session repaints "you are here" immediately.
panel:on_message("ready", function()
  local json = storage.get("map")
  panel:post("load", {
    json = type(json) == "string" and json or nil,
    cfg = area_cfg(),
  })
  if last_room then panel:post("room_seen", last_room) end
end)

-- Debounced full-map save from the engine.
panel:on_message("persist", function(payload)
  if payload and type(payload.json) == "string" then
    storage.set("map", payload.json)
  end
end)

-- /map — recenter the view on the current room.
mud.command("map", function()
  panel:post("recenter", {})
end)
