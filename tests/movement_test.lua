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
check("non-movement", movement.normalize("look"), nil)
check("empty", movement.normalize(""), nil)

-- M.exits: normalize a mudstd.room exits table.
local ex = movement.exits({
  N = { id = "1/1/13", inverse = "S" },
  E = { id = "1/1/14" },
  IN = { id = "1/1/99" },        -- non-canonical → dropped
  U = { id = "1/1/20" },
})
check("exits count (IN dropped)", #ex, 3)
check("exits sorted first dir", ex[1].dir, "e")   -- e, n, u sorted
check("exits first toKey", ex[1].toKey, "1/1/14")
check("exits second dir", ex[2].dir, "n")
check("exits third dir", ex[3].dir, "u")
check("exits drops missing id", #movement.exits({ W = { inverse = "E" } }), 0)
check("exits non-table", #movement.exits(nil), 0)

if failures > 0 then os.exit(1) end
io.write("\nall movement tests passed\n")
