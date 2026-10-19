-- Automapper host adapter (Approach A). Thin signal + IO shim: forwards
-- room.info GMCP and movement sends to the iframe engine, executes the engine's
-- speedwalk sends, and owns per-world storage. All graph/identity/render/area/
-- pathfind/search/walk logic lives in ui/*.js.

local movement = require("movement")
local sendguard = require("sendguard")
local capture = require("capture")
local roomframe = require("roomframe")

local panel = mud.panel("map")
local last_room = nil  -- replayed to the iframe on (re)mount
local learn_handle = nil  -- catch-all trigger handle while '/map learn' is on

-- room.info → normalized room_seen. `identifier` is the stable room key.
gmcp.on("room.info", function(_pkg, data)
  local room = roomframe.normalize(data, false)
  if not room then return end
  last_room = room
  panel:post("room_seen", last_room)
end)

-- mudstd.room.info (mudstandards.org/gmcp/mudstandards_room) → same room_seen,
-- plus its explicit exits (each carries the target room's id) for direct linking.
gmcp.on("mudstd.room.info", function(_pkg, data)
  local room = roomframe.normalize(data, true)
  if not room then return end
  last_room = room
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

-- ── Non-GMCP capture (Phase 4) ──────────────────────────────────────────────
-- On MUDs without room.info GMCP, recognize the room-name and exits lines from
-- user-configured regexes and assemble them (src/capture.lua) into a synthetic
-- "room seen". The engine then fingerprints name+exits and places by movement
-- vector, exactly as it does for a GMCP key. Off by default (empty patterns /
-- capture_enabled=false) so GMCP worlds pay nothing.
--
-- Each pattern MUST contain exactly one capture group — its first group is the
-- room name or exits text. The host hands the callback ONLY the user capture
-- groups (the whole-line match is dropped), so the first group is m[1]; we read
-- it via m:raw(1) to get the raw string without numeric coercion.
local function nonempty(s)
  return type(s) == "string" and s:gsub("%s+", "") ~= "" and s or nil
end

local function register_capture_triggers()
  if settings.get("capture_enabled") ~= true then return end
  local name_pat = nonempty(settings.get("capture_room_name"))
  local exits_pat = nonempty(settings.get("capture_exits"))
  local fail_pat = nonempty(settings.get("capture_fail"))

  if name_pat then
    mud.trigger(name_pat, function(m) capture.on_name(m:raw(1)) end)
  end
  if exits_pat then
    mud.trigger(exits_pat, function(m)
      local cap = capture.on_exits(m:raw(1))
      if cap then
        panel:post("capture", { name = cap.name, exits = cap.exits })
      end
    end)
  end
  if fail_pat then
    mud.trigger(fail_pat, function()
      capture.reset()
      panel:post("move_fail", {})
    end)
  end
end
register_capture_triggers()

-- Learn mode: stream every incoming line to the panel so the user can click the
-- room-name and exits lines and have the panel infer the two regexes. A single
-- catch-all trigger, registered on demand and removed when learning stops, so a
-- non-learning session carries no per-line cost.
local function stop_learn()
  if not learn_handle then return false end
  learn_handle:remove()
  learn_handle = nil
  panel:post("learn", { on = false })
  return true
end

local function toggle_learn()
  if stop_learn() then
    mud.note("automapper: learn mode off.")
    return
  end
  learn_handle = mud.trigger("^(.*)$", function(m)
    local text = m:raw(1)
    if text and text:gsub("%s", "") ~= "" then
      panel:post("learn_line", { text = text })
    end
  end)
  panel:post("learn", { on = true })
  mud.note("automapper: learn mode ON. Walk into a room, then in the Map panel "
    .. "click its name line and its exits line. '/map learn' again to stop.")
end

-- The panel's learn-overlay close button stops learning host-side too.
panel:on_message("learn_stop", function() stop_learn() end)

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
  capture.reset()
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
  elseif args == "learn" then
    toggle_learn()
  elseif args == "reset" then
    mud.note("automapper: this erases the saved map for THIS world. "
      .. "Type '/map reset confirm' to proceed.")
  elseif args == "reset confirm" then
    storage.delete("map")
    sendguard.reset()
    capture.reset()
    panel:post("load", { json = nil, cfg = area_cfg(), walk = walk_cfg() })
    if last_room then panel:post("room_seen", last_room) end
    mud.note("automapper: map reset for this world. Re-walk to rebuild it.")
  else
    mud.note("automapper: unknown '/map " .. args .. "'. "
      .. "Try /map, /map path <name>, /map stop, /map learn, or /map reset.")
  end
end)
