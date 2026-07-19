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
}

function M.normalize(cmd)
  if type(cmd) ~= "string" then return nil end
  local trimmed = cmd:gsub("^%s+", ""):gsub("%s+$", ""):lower()
  return ALIASES[trimmed]
end

return M
