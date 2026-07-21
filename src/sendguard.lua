-- src/sendguard.lua
-- Distinguish the automapper's own speedwalk sends from genuine user input.
-- Pure FIFO of expected self-send command strings; no host-API dependencies,
-- so it runs under a vanilla Lua interpreter (mirrors src/movement.lua).

local M = {}
local queue = {}

-- Record a command the adapter is about to send on the engine's behalf.
function M.expect(cmd)
  queue[#queue + 1] = cmd
end

-- True if `cmd` matches the head of the expected queue (and consumes it) —
-- i.e. it's our own walk send. False means genuine user input.
function M.consume(cmd)
  if queue[1] ~= nil and queue[1] == cmd then
    table.remove(queue, 1)
    return true
  end
  return false
end

function M.reset()
  queue = {}
end

return M
