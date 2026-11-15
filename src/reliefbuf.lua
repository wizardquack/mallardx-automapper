-- src/reliefbuf.lua
-- This session's mudstd.relief.patch messages the panel hasn't saved yet,
-- for replay when the panel (re)mounts: a refill sent at login before the
-- panel is up isn't lost. Each patch gets a sequence number (`seq`) that
-- only grows; the panel's save says the highest it has merged into the
-- saved map (ack), and those are dropped. So a remount replays only what
-- the saved map lacks: it neither resends what's saved nor brings back
-- relief the user cleared since. Pure, no host APIs.

local M = {}
local KEEP = 600  -- at most this many kept (oldest dropped)
local list = {}
local seq = 0

-- Number `patch` (sets patch.seq), keep it, and return it.
function M.push(patch)
  seq = seq + 1
  patch.seq = seq
  list[#list + 1] = patch
  if #list > KEEP then table.remove(list, 1) end
  return patch
end

-- The panel has saved every patch up to `n`: forget them.
function M.ack(n)
  if type(n) ~= "number" then return end
  local keep = {}
  for _, p in ipairs(list) do
    if p.seq > n then keep[#keep + 1] = p end
  end
  list = keep
end

-- The patches to replay, oldest first.
function M.pending()
  return list
end

-- A new session: forget the patches (the numbering carries on, so a late
-- ack from before can't drop new ones).
function M.reset()
  list = {}
end

M.KEEP = KEEP
return M
