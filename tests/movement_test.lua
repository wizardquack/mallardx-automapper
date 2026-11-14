-- tests/movement_test.lua
-- Run with: luajit tests/movement_test.lua
package.path = "src/?.lua;" .. package.path
local movement = require("movement")

local failures = 0
local function check(label, got, want)
  if got == want then
    io.write("ok   " .. label .. "\n")
  else
    failures = failures + 1
    io.write("FAIL " .. label .. " — got " .. tostring(got) .. ", want " .. tostring(want) .. "\n")
  end
end

check("short cardinal", movement.normalize("n"), "n")
check("full word north", movement.normalize("north"), "n")
check("full word southeast", movement.normalize("southeast"), "se")
check("abbrev sw", movement.normalize("sw"), "sw")
check("up", movement.normalize("up"), "u")
check("down", movement.normalize("down"), "d")
check("uppercase + spaces", movement.normalize("  NorthEast  "), "ne")
check("in", movement.normalize("in"), "in")
check("OUT uppercase", movement.normalize(" OUT "), "out")
check("non-movement", movement.normalize("look"), nil)
check("enter is not a move", movement.normalize("enter"), nil)
check("empty", movement.normalize(""), nil)

-- M.exits: normalize a mudstd.room exits table.
local ex = movement.exits({
  N = { id = "1/1/13", inverse = "S" },
  E = { id = "1/1/14" },
  IN = { id = "1/1/99" },        -- kept: a real exit with no vector
  out = { id = "1/1/98" },       -- lowercase too
  PORTAL = { id = "1/1/97" },    -- custom string → dropped
  U = { id = "1/1/20" },
})
check("exits count (PORTAL dropped)", #ex, 5)
check("exits sorted first dir", ex[1].dir, "e")   -- e, in, n, out, u sorted
check("exits first toKey", ex[1].toKey, "1/1/14")
check("exits keeps IN as in", ex[2].dir, "in")
check("exits IN toKey", ex[2].toKey, "1/1/99")
check("exits third dir", ex[3].dir, "n")
check("exits keeps out", ex[4].dir, "out")
check("exits fifth dir", ex[5].dir, "u")
-- An exit with no id is still a way out that way: kept, with no toKey.
local keyless = movement.exits({ W = { inverse = "E" } })
check("exits keeps missing id", #keyless, 1)
check("exits keyless dir", keyless[1].dir, "w")
check("exits keyless toKey", keyless[1].toKey, nil)
check("exits non-table", #movement.exits(nil), 0)

-- An exit's area (mudstd extension), where it leads out of the room's.
local out = movement.exits({
  E = { id = "land.join", area = "surface.tamsin", areaName = "Tamsin" },
  W = { id = "town.square" },
})
check("exit area", out[1].area, "surface.tamsin")
check("exit areaName", out[1].areaName, "Tamsin")
check("no area on an exit within it", out[2].area, nil)

-- An exit's style (mudstd extension): road, path, trail or climb.
local st = movement.exits({
  N = { id = "a", style = "road" }, S = { id = "b", style = "CLIMB" },
  E = { id = "c", style = "highway" }, W = { id = "d" }, U = "bare",
})
local by = {}
for _, e in ipairs(st) do by[e.dir] = e end
check("exit style road", by.n.style, "road")
check("exit style case-folded", by.s.style, "climb")
check("unknown exit style dropped", by.e.style, nil)
check("no exit style", by.w.style, nil)
check("non-table exit survives", by.u and by.u.dir, "u")

if failures > 0 then os.exit(1) end
io.write("\nall movement tests passed\n")
