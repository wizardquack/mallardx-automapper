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

-- wrap: a ring's x comes round at a whole number above 1.
check("wrap", roomframe.wrap({ x = 24 }) and roomframe.wrap({ x = 24 }).x, 24)
check("wrap fraction", roomframe.wrap({ x = 2.5 }), nil)
check("wrap too small", roomframe.wrap({ x = 1 }), nil)
check("wrap missing", roomframe.wrap(nil), nil)
check("normalize wrap", roomframe.normalize({ id = "r", coords = { x = 23, y = 0, z = 0 }, wrap = { x = 24 } }).wrap.x, 24)

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

-- links: { id, name?, cmd? } -> { toKey, name, cmd }; no id, dropped.
local l = roomframe.links({ { id = "tiss.hub", name = "Lift 12" }, { id = 7, cmd = "enter portal" }, { name = "x" }, "junk" })
check("links count", l and #l, 2)
check("links toKey", l and l[1].toKey, "tiss.hub")
check("links name", l and l[1].name, "Lift 12")
check("links number id", l and l[2].toKey, "7")
check("links cmd", l and l[2].cmd, "enter portal")
check("links missing", roomframe.links(nil), nil)
check("normalize links", roomframe.normalize({ id = "r", links = { { id = "h" } } }).links[1].toKey, "h")

-- tags: mudstd `tags`, else IRE `details`; non-strings dropped; numbers kept.
r = roomframe.normalize({ id = "m", tags = { "market", "", 7, {} } }, true)
check("tags kept", r.tags and r.tags[1], "market")
check("tags number stringified", r.tags and r.tags[2], "7")
check("tags junk dropped", r.tags and #r.tags, 2)
r = roomframe.normalize({ num = 1, details = { "shop", "bank" } }, false)
check("IRE details as tags", r.tags and r.tags[2], "bank")
r = roomframe.normalize({ id = "t", tags = { "lift" }, details = { "shop" } }, true)
check("tags win over details", r.tags and r.tags[1], "lift")
check("no tags → nil", roomframe.normalize({ id = "x" }, true).tags, nil)
check("empty tags stay empty", #roomframe.normalize({ id = "x", tags = {} }, true).tags, 0)

-- region / regionName.
r = roomframe.normalize({ id = "c", region = "concourse", regionName = "the Concourse" }, true)
check("region", r.region, "concourse")
check("regionName", r.regionName, "the Concourse")
check("no region", roomframe.normalize({ id = "x" }, true).region, nil)
check("empty region → nil", roomframe.normalize({ id = "x", region = "" }, true).region, nil)

-- terrain id passes through as env (as before).
check("terrain → env", roomframe.normalize({ id = "x", terrain = "corridor" }, true).env, "corridor")

-- mudstd.room.terrain definitions.
local ts = roomframe.terrains({
  { id = "city", label = "City", color = "C0C0C0" },
  { id = "forest", color = "#00ff00", tile_url = "x" },
  { id = "bad", label = "Bad", color = "red" },
  { label = "no id" },
  "junk",
})
check("terrains count", #ts, 3)
check("terrain color normalized", ts[1].color, "#c0c0c0")
check("terrain label fallback", ts[2].label, "forest")
check("terrain # accepted", ts[2].color, "#00ff00")
check("terrain bad color dropped", ts[3].color, nil)
check("terrains non-table", #roomframe.terrains("x"), 0)

if failures > 0 then os.exit(1) end
io.write("\nall roomframe tests passed\n")
