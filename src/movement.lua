-- src/movement.lua
-- Pure direction normalization: raw sent command -> canonical dir or nil.
-- No host-API dependencies, so it runs under a vanilla Lua interpreter.

local M = {}

local ALIASES = {
  n = "n", north = "n",
  s = "s", south = "s",
  e = "e", east = "e",
  w = "w", west = "w",
  ne = "ne", northeast = "ne",
  nw = "nw", northwest = "nw",
  se = "se", southeast = "se",
  sw = "sw", southwest = "sw",
  u = "u", up = "u",
  d = "d", down = "d",
  -- No vector, but real exits: the engine stores them as edges and routes
  -- (and speedwalks) through them; it just doesn't place or draw by them.
  ["in"] = "in", out = "out",
}

function M.normalize(cmd)
  if type(cmd) ~= "string" then return nil end
  local trimmed = cmd:gsub("^%s+", ""):gsub("%s+$", ""):lower()
  return ALIASES[trimmed]
end

-- Normalize a GMCP exits table (mudstd.room: { DIR = { id = "..", inverse = ".." } })
-- into a deterministic list of { dir = <canonical>, toKey = <target id string> }.
-- Only exits whose direction maps to one of the 10 compass dirs or in/out (so
-- it has a known reverse) and that carry a target id are kept; custom strings
-- are dropped. Sorted by dir for a stable order (Lua `pairs` iteration order
-- is undefined).
function M.exits(exits)
  local out = {}
  if type(exits) ~= "table" then return out end
  for dir, ex in pairs(exits) do
    local canon = M.normalize(dir)
    local to_key = type(ex) == "table" and ex.id or nil
    if canon and to_key ~= nil then
      local e = { dir = canon, toKey = tostring(to_key) }
      -- Where the exit leads out of the room's area (mudstd extension): that
      -- area's key and name, so a card can say where it goes before it's taken.
      if ex.area ~= nil and (type(ex.area) == "string" or type(ex.area) == "number") then
        e.area = tostring(ex.area)
        if type(ex.areaName) == "string" or type(ex.areaName) == "number" then
          e.areaName = tostring(ex.areaName)
        end
      end
      out[#out + 1] = e
    end
  end
  table.sort(out, function(a, b) return a.dir < b.dir end)
  return out
end

return M
