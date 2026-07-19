-- Automapper host adapter (Approach A). Thin signal + IO shim: forwards
-- room.info GMCP and movement sends to the iframe engine, and owns per-world
-- storage. All graph/identity/render logic lives in ui/*.js.

local movement = require("movement")

local panel = mud.panel("map")
local last_room = nil  -- replayed to the iframe on (re)mount

-- room.info → normalized room_seen. Discworld/IRE room.info carries
-- { identifier, name, terrain, ... }; identifier is the stable room key.
gmcp.on("room.info", function(_pkg, data)
  if type(data) ~= "table" then return end
  local key = data.identifier or data.id or data.num or data.vnum
  if key == nil then return end
  last_room = {
    key = tostring(key),
    name = data.name or "",
    env = data.terrain or data.environment or "",
  }
  panel:post("room_seen", last_room)
end)

-- Every outbound command: if it normalizes to a direction, tell the engine we
-- moved (used to place the next newly-seen room). Observe-only; never blocks.
mud.on_send(function(m)
  local dir = movement.normalize(m.text)
  if dir then panel:post("moved", { dir = dir }) end
end)

-- Iframe (re)mounted: hand it the persisted map, then replay the last room so
-- a reload mid-session repaints "you are here" immediately.
panel:on_message("ready", function()
  local json = storage.get("map")
  panel:post("load", { json = type(json) == "string" and json or nil })
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
