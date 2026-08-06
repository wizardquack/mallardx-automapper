-- src/capture.lua
-- Assemble a non-GMCP room from separate output lines. A MUD without GMCP
-- prints the room name on one line and its exits on another; this pure state
-- machine buffers the name until the exits line arrives, then emits one
-- { name, exits } capture. No host-API dependencies, so it runs under a vanilla
-- Lua interpreter (mirrors src/movement.lua and src/sendguard.lua).

local M = {}
local pending_name = nil  -- a room name awaiting its exits line

-- Room-name trigger fired. Buffer it; a later name replaces an earlier one that
-- never got its exits (e.g. two prompts before the exits line).
function M.on_name(name)
  pending_name = name
end

-- Exits trigger fired. Emit the assembled room iff a name is buffered; a bare
-- exits line with no preceding name (a "glance"/re-look with the name scrolled
-- off) is ignored so we never fingerprint half a room.
function M.on_exits(exits)
  if pending_name == nil then return nil end
  local cap = { name = pending_name, exits = exits }
  pending_name = nil
  return cap
end

-- Drop any half-built room. Called on a movement failure ("you can't go that
-- way") and on manual reset so a failed step leaves no stray name buffered.
function M.reset()
  pending_name = nil
end

-- Test/inspection aid: is a name currently buffered?
function M.has_pending()
  return pending_name ~= nil
end

return M
