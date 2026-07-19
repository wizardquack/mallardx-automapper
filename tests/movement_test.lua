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

if failures > 0 then os.exit(1) end
io.write("\nall movement tests passed\n")
