-- src/roomsource.lua
-- Which GMCP room package to map from. A server may send both room.info and
-- mudstd.room.info for every move; once a session has seen mudstd.room.info
-- (explicit exits, coords, area name) room.info is ignored, so each move is
-- resolved once and from the richer frame. Pure state, no host-API
-- dependencies (mirrors src/sendguard.lua); main.lua resets it on connect.

local M = {}
local MUDSTD = "mudstd.room.info"
local seen_mudstd = false

-- Should a frame of package `pkg` be mapped? Seeing mudstd flips the session.
function M.accept(pkg)
  if pkg == MUDSTD then
    seen_mudstd = true
    return true
  end
  return not seen_mudstd
end

function M.reset()
  seen_mudstd = false
end

return M
