-- tests/roomframe_test.lua
-- Run with: luajit tests/roomframe_test.lua
package.path = "src/?.lua;" .. package.path
local roomframe = require("roomframe")

local failures = 0
local function check(label, got, want)
  if got == want then
    io.write("ok   " .. label .. "\n")
  else
    failures = failures + 1
    io.write("FAIL " .. label .. " — got " .. tostring(got) .. ", want " .. tostring(want) .. "\n")
  end
end

-- coords: mudstd object, room.info array, missing z, and rejects.
local c = roomframe.coords({ x = 3, y = -2, z = 1 })
check("object x", c and c.x, 3)
check("object y", c and c.y, -2)
check("object z", c and c.z, 1)
c = roomframe.coords({ 4, 5, 6 })
check("array x", c and c.x, 4)
check("array y", c and c.y, 5)
check("array z", c and c.z, 6)
c = roomframe.coords({ x = 1, y = 2 })
check("missing z defaults to 0", c and c.z, 0)
check("nil coords", roomframe.coords(nil), nil)
check("IRE string coords ignored", roomframe.coords("12,3,4,0"), nil)
check("non-numeric part", roomframe.coords({ x = "1", y = 2, z = 0 }), nil)
check("NaN part", roomframe.coords({ 0 / 0, 1, 0 }), nil)
check("empty table", roomframe.coords({}), nil)

-- normalize: key, area signal, coords passthrough, exits only when asked.
local r = roomframe.normalize({
  id = "tiss:rim-3", name = "Rim 3:00", area = "tiss",
  coords = { x = 6, y = 0, z = 0 },
  exits = { E = { id = "tiss:rim-3-30" } },
}, true)
check("normalize key", r.key, "tiss:rim-3")
check("normalize name", r.name, "Rim 3:00")
check("normalize areaField", r.areaField, "area")
check("normalize areaTag", r.areaTag, "tiss")
check("normalize coords x", r.coords and r.coords.x, 6)
check("normalize exits", #r.exits, 1)
check("normalize no areaName", r.areaName, nil)
r = roomframe.normalize({ id = "a", area = "tiss", areaName = "T.I.S.S." }, true)
check("normalize areaName", r.areaName, "T.I.S.S.")
check("areaName leaves the key alone", r.areaTag, "tiss")
r = roomframe.normalize({ num = 7, name = "Hall", coords = { 1, 2, 3 } }, false)
check("room.info numeric key stringified", r.key, "7")
check("room.info coords array", r.coords and r.coords.z, 3)
check("room.info no exits", r.exits, nil)
check("no coords → nil", roomframe.normalize({ id = "x" }, false).coords, nil)
check("no key → nil", roomframe.normalize({ name = "x" }, true), nil)

if failures > 0 then os.exit(1) end
io.write("\nall roomframe tests passed\n")
