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

-- chart: mudstd.map.rooms, each room normalized like mudstd.room.info.
local ch = roomframe.chart({
  chart = "old-town", version = "v1", part = 2,
  rooms = {
    { id = "r1", name = "Gate", area = "town", coords = { x = 1, y = 2 },
      exits = { NORTH = { id = "r2" } }, links = { { id = "r9", name = "lift" } } },
    { name = "no id" },
    { id = 7, name = "Numbered" },
  },
})
check("chart name", ch and ch.chart, "old-town")
check("chart version", ch and ch.version, "v1")
check("chart part", ch and ch.part, 2)
check("chart drops rooms without id", ch and #ch.rooms, 2)
check("chart room key", ch and ch.rooms[1].key, "r1")
check("chart room area", ch and ch.rooms[1].areaTag, "town")
check("chart room coords", ch and ch.rooms[1].coords.y, 2)
check("chart room exits", ch and ch.rooms[1].exits[1].toKey, "r2")
check("chart room exit dir", ch and ch.rooms[1].exits[1].dir, "n")
check("chart room links", ch and ch.rooms[1].links[1].toKey, "r9")
check("chart numeric id", ch and ch.rooms[2].key, "7")
check("chart without rooms", roomframe.chart({ chart = "x" }), nil)
check("chart non-table", roomframe.chart("x"), nil)
check("chart bad part dropped", roomframe.chart({ rooms = {}, part = 1.5 }).part, nil)

-- 0.12.0 extensions: elevation, lat/lon, regionColor.
local rf = roomframe.normalize({ id = "h", elevation = -12.5, lat = 34.12, lon = -5.4,
  region = "q", regionColor = "AABBCC" }, true)
check("elevation", rf.elevation, -12.5)
check("lat", rf.lat, 34.12)
check("lon", rf.lon, -5.4)
check("regionColor normalized", rf.regionColor, "#aabbcc")
local bad = roomframe.normalize({ id = "h", elevation = "412", lat = 0 / 0, lon = math.huge, regionColor = "#abc" }, true)
check("string elevation dropped", bad.elevation, nil)
check("NaN lat dropped", bad.lat, nil)
check("inf lon dropped", bad.lon, nil)
check("short regionColor dropped", bad.regionColor, nil)
check("regionColor with #", roomframe.color("#A0B1C2"), "#a0b1c2")
check("zero elevation kept", roomframe.normalize({ id = "z", elevation = 0 }).elevation, 0)

-- An exit's style survives into charts.
local sc = roomframe.chart({ rooms = { { id = "s1", exits = { N = { id = "s2", style = "Road" }, S = { id = "s3", style = "motorway" } } } } })
check("chart exit style", sc.rooms[1].exits[1].style, "road")
check("chart unknown exit style dropped", sc.rooms[1].exits[2].style, nil)
local cr = roomframe.chart({ rooms = { { id = "c1", elevation = 9, lat = 1, lon = 2, region = "r", regionColor = "#010203" } } })
check("chart elevation", cr.rooms[1].elevation, 9)
check("chart regionColor", cr.rooms[1].regionColor, "#010203")

-- glyph: one or two characters, no whitespace or control, well-formed UTF-8.
check("glyph ascii", roomframe.glyph("$"), "$")
check("glyph two", roomframe.glyph("Ab"), "Ab")
check("glyph multibyte", roomframe.glyph("\226\152\133"), "\226\152\133")          -- ★
check("glyph two multibyte", roomframe.glyph("\226\152\133\226\152\133"), "\226\152\133\226\152\133")
check("glyph astral", roomframe.glyph("\240\159\143\160"), "\240\159\143\160")   -- one code point (the panel turns emoji away)
check("glyph three", roomframe.glyph("abc"), nil)
check("glyph empty", roomframe.glyph(""), nil)
check("glyph space", roomframe.glyph(" a"), nil)
check("glyph control", roomframe.glyph("\n"), nil)
check("glyph bad utf8", roomframe.glyph("\255"), nil)
check("glyph truncated utf8", roomframe.glyph("\226\152"), nil)
check("glyph number", roomframe.glyph(5), nil)

-- mudstd.room.tags: [{ id, label, glyph }] in order.
local td = roomframe.tag_defs({
  { id = "smithy", label = "Smithy", glyph = "S" },
  { id = "well" },
  { label = "no id" },
  { id = "mine", label = "Mine", glyph = "toolong" },
})
check("tag defs count", #td, 3)
check("tag def order", td[1].id, "smithy")
check("tag def label", td[1].label, "Smithy")
check("tag def glyph", td[1].glyph, "S")
check("tag def label falls back to id", td[2].label, "well")
check("tag def no glyph", td[2].glyph, nil)
check("tag def bad glyph dropped", td[3].glyph, nil)
check("tag defs non-table", #roomframe.tag_defs("x"), 0)

-- mudstd.relief.patch: shape and size checks; base64 passed through.
check("b64 len", roomframe.b64_len("AAAA"), 3)
check("b64 len padded", roomframe.b64_len("AAA="), 2)
check("b64 len unpadded", roomframe.b64_len("AAA"), 2)
check("b64 len bad char", roomframe.b64_len("AA!A"), nil)
check("b64 len bad length", roomframe.b64_len("AAAAA"), nil)
local rp = roomframe.relief_patch({ area = "surface.tamsin", cell = 0.5, x = 4, y = 6.5, cols = 2, rows = 1,
  height = "ZAD//w==", ground = { ids = { "dust", "sea" }, data = "AAE=" } })
check("relief area", rp and rp.area, "surface.tamsin")
check("relief z defaults to 0", rp and rp.z, 0)
check("relief height passed through", rp and rp.height, "ZAD//w==")
check("relief ground ids", rp and rp.ground and rp.ground.ids[2], "sea")
check("relief ground data", rp and rp.ground and rp.ground.data, "AAE=")
check("relief height wrong length", roomframe.relief_patch({ area = "a", cell = 1, x = 0, y = 0, cols = 2, rows = 2, height = "ZAD//w==" }), nil)
rp = roomframe.relief_patch({ area = "a", z = 2, cell = 1, x = 0, y = 0, cols = 2, rows = 2,
  height = { 5, nil, 1.5, -32768 }, ground = { ids = { "x" }, data = { 0, 255, 300, 0 } } })
check("relief array z", rp and rp.z, 2)
check("relief array kept", rp and rp.height[1], 5)
check("relief array hole unknown", rp and rp.height[2], -32768)
check("relief array fraction unknown", rp and rp.height[3], -32768)
check("relief array unknown", rp and rp.height[4], -32768)
check("relief ground array", rp and rp.ground.data[3], 255)
check("relief array too long", roomframe.relief_patch({ area = "a", cell = 1, x = 0, y = 0, cols = 1, rows = 1, height = { 1, 2 } }), nil)
check("relief oversize", roomframe.relief_patch({ area = "a", cell = 1, x = 0, y = 0, cols = 65, rows = 1, height = {} }), nil)
check("relief 64 ok", roomframe.relief_patch({ area = "a", cell = 1, x = 0, y = 0, cols = 64, rows = 64, height = {} }) ~= nil, true)
check("relief bad cell", roomframe.relief_patch({ area = "a", cell = 0, x = 0, y = 0, cols = 1, rows = 1, height = { 1 } }), nil)
check("relief fractional z", roomframe.relief_patch({ area = "a", z = 0.5, cell = 1, x = 0, y = 0, cols = 1, rows = 1, height = { 1 } }), nil)
check("relief no area", roomframe.relief_patch({ cell = 1, x = 0, y = 0, cols = 1, rows = 1, height = { 1 } }), nil)
check("relief bad ground dropped", roomframe.relief_patch({ area = "a", cell = 1, x = 0, y = 0, cols = 1, rows = 1, height = { 1 }, ground = { ids = { "x" }, data = "AAAA" } }).ground, nil)
check("relief non-table", roomframe.relief_patch("x"), nil)

if failures > 0 then os.exit(1) end
io.write("\nall roomframe tests passed\n")
