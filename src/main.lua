-- Automapper host adapter (Approach A). Thin signal + IO shim: forwards
-- room.info GMCP and movement sends to the iframe engine, executes the engine's
-- speedwalk sends, and owns per-world storage. All graph/identity/render/area/
-- pathfind/search/walk logic lives in ui/*.js.

local movement = require("movement")
local sendguard = require("sendguard")

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
    env = tostring(data.terrain or data.environment or ""),
    areaField = area_field,
    areaTag = area_tag,
  }
  panel:post("room_seen", last_room)
end)

-- Every outbound command. Our own speedwalk sends are consumed by the guard
-- (no moved / no user_input). Genuine user input posts `moved` (for placement)
-- and `user_input` (so the engine can cancel a running walk).
mud.on_send(function(m)
  local text = m.text
  if sendguard.consume(text) then return end
  local dir = movement.normalize(text)
  if dir then panel:post("moved", { dir = dir }) end
  panel:post("user_input", {})
end)

-- Resolver config from settings, forwarded to the engine on load.
local function area_cfg()
  return {
    strategy = settings.get("area_strategy") or "auto",
    overworld = settings.get("area_overworld") or "outside",
  }
end

-- Speedwalk config from settings, forwarded to the engine on load.
local function walk_cfg()
  return {
    mode = settings.get("speedwalk_mode") or "safe",
    delayMs = settings.get("speedwalk_delay") or 250,
    separator = settings.get("speedwalk_separator") or ";",
    timeoutMs = settings.get("speedwalk_timeout_ms") or 4000,
    abortOnInput = settings.get("speedwalk_abort_on_input") ~= false,
  }
end

-- Iframe (re)mounted: hand it the persisted map + config, then replay the last
-- room so a reload mid-session repaints "you are here" immediately.
panel:on_message("ready", function()
  local json = storage.get("map")
  sendguard.reset()
  panel:post("load", {
    json = type(json) == "string" and json or nil,
    cfg = area_cfg(),
    walk = walk_cfg(),
  })
  if last_room then panel:post("room_seen", last_room) end
end)

-- Debounced full-map save from the engine.
panel:on_message("persist", function(payload)
  if payload and type(payload.json) == "string" then
    storage.set("map", payload.json)
  end
end)

-- Engine asks us to send a movement command (a single dir, or a batched line).
-- Register it as an expected self-send BEFORE sending so mud.on_send ignores it.
panel:on_message("walk_send", function(payload)
  if payload and type(payload.cmd) == "string" then
    sendguard.expect(payload.cmd)
    mud.send(payload.cmd)
  end
end)

-- Engine status line → a normal client note.
panel:on_message("notify", function(payload)
  if payload and type(payload.text) == "string" then
    mud.note(payload.text)
  end
end)

-- /goto <name|#id> — resolve + speedwalk.
mud.command("goto", function(m)
  local target = ((m and m.args) or ""):gsub("^%s+", ""):gsub("%s+$", "")
  if target == "" then
    mud.note("automapper: usage — /goto <room name or #id>")
    return
  end
  panel:post("request_walk", { target = target })
end)

-- /map            — recenter the view on the current room.
-- /map stop        — cancel a running speedwalk.
-- /map path <name> — highlight the route without walking.
-- /map reset       — warn; ask for confirmation before wiping.
-- /map reset confirm — erase THIS world's saved map and start fresh.
mud.command("map", function(m)
  local args = ((m and m.args) or ""):gsub("^%s+", ""):gsub("%s+$", "")
  if args == "" then
    panel:post("recenter", {})
  elseif args == "stop" then
    panel:post("request_stop", {})
  elseif args:sub(1, 5) == "path " then
    panel:post("request_path", { target = (args:sub(6):gsub("^%s+", "")) })
  elseif args == "reset" then
    mud.note("automapper: this erases the saved map for THIS world. "
      .. "Type '/map reset confirm' to proceed.")
  elseif args == "reset confirm" then
    storage.delete("map")
    sendguard.reset()
    panel:post("load", { json = nil, cfg = area_cfg(), walk = walk_cfg() })
    if last_room then panel:post("room_seen", last_room) end
    mud.note("automapper: map reset for this world. Re-walk to rebuild it.")
  else
    mud.note("automapper: unknown '/map " .. args .. "'. "
      .. "Try /map, /map path <name>, /map stop, or /map reset.")
  end
end)
