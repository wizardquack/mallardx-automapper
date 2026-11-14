-- src/roomframe.lua
-- Pure GMCP room normalization: a room.info / mudstd.room.info payload ->
-- the engine's room_seen shape. No host-API dependencies, so it runs under a
-- vanilla Lua interpreter (mirrors src/movement.lua).

local movement = require("movement")

local M = {}

-- Pick a generic area signal from room.info: prefer a real zone name, fall
-- back to a coarse boundary flag. The engine (ui/area.js) decides semantics
-- from the field NAME, so the adapter stays game-agnostic.
local AREA_FIELDS = { "area", "zone", "domain", "kind" }
function M.area_signal(data)
  for _, f in ipairs(AREA_FIELDS) do
    if data[f] ~= nil then return f, tostring(data[f]) end
  end
  return nil, nil
end

local function finite(v)
  return type(v) == "number" and v == v and v ~= math.huge and v ~= -math.huge
end

-- Server-sent grid coordinates, as an object { x, y, z } (mudstd extension)
-- or a [x, y, z] array (room.info). A missing z is 0. Anything else — absent,
-- null, a string like IRE's "area,x,y,building", non-numeric parts — is nil,
-- and the engine places the room by movement as usual.
function M.coords(c)
  if type(c) ~= "table" then return nil end
  local x, y, z
  if c.x ~= nil or c.y ~= nil then
    x, y, z = c.x, c.y, c.z
  else
    x, y, z = c[1], c[2], c[3]
  end
  if z == nil then z = 0 end
  if not (finite(x) and finite(y) and finite(z)) then return nil end
  return { x = x, y = y, z = z }
end

-- Where a layout's x comes round (extension `wrap`, { x = n }), on a ring: a
-- whole number above 1, else nil.
function M.wrap(w)
  if type(w) ~= "table" or not finite(w.x) then return nil end
  if w.x ~= math.floor(w.x) or w.x < 2 then return nil end
  return { x = w.x }
end

local function str(v)
  if type(v) == "string" and v ~= "" then return v end
  if type(v) == "number" then return tostring(v) end
  return nil
end

-- A room's features (mudstd extension `tags`, else IRE's `details`): a list of
-- non-empty strings, or nil when there's no list. An empty list stays empty,
-- so a room that lost its last tag is cleared.
function M.tags(data)
  local list = data.tags
  if type(list) ~= "table" then list = data.details end
  if type(list) ~= "table" then return nil end
  local out = {}
  for _, t in ipairs(list) do
    local s = str(t)
    if s then out[#out + 1] = s end
  end
  return out
end

-- Ways to other rooms that aren't exits (extension `links`): a list of
-- { id, name?, cmd? } -> a list of { toKey, name, cmd }, or nil when there's
-- no list. Entries without an id are dropped.
function M.links(list)
  if type(list) ~= "table" then return nil end
  local out = {}
  for _, l in ipairs(list) do
    if type(l) == "table" then
      local to = str(l.id)
      if to then out[#out + 1] = { toKey = to, name = str(l.name), cmd = str(l.cmd) } end
    end
  end
  return out
end

-- A colour sent as "#rrggbb" or "rrggbb" -> "#rrggbb" (lower case), else nil.
function M.color(v)
  if type(v) ~= "string" then return nil end
  local hex = v:match("^#?(%x%x%x%x%x%x)$")
  return hex and ("#" .. hex:lower()) or nil
end

-- A finite number, else nil (extensions `elevation`, `lat`, `lon`).
function M.number(v)
  if finite(v) then return v end
  return nil
end

-- mudstd.room.terrain: a list of { id, label, color?, tile_url? } -> a list of
-- { id, label, color } with color as "#rrggbb" or nil. Entries without an id
-- are dropped; a missing label falls back to the id.
function M.terrains(data)
  if type(data) ~= "table" then return {} end
  local out = {}
  for _, t in ipairs(data) do
    if type(t) == "table" then
      local id = str(t.id)
      if id then
        out[#out + 1] = { id = id, label = str(t.label) or id, color = M.color(t.color) }
      end
    end
  end
  return out
end

-- A tag's glyph: one or two characters (UTF-8 code points), none of them
-- whitespace or control characters, else nil. The panel also turns away
-- emoji, which Lua can't tell.
function M.glyph(v)
  if type(v) ~= "string" or v == "" then return nil end
  if v:find("[%z\1-\32\127]") then return nil end
  -- Well-formed UTF-8 only: each code point a lead byte and its continuations.
  local n, i, len = 0, 1, #v
  while i <= len do
    local b = v:byte(i)
    local extra
    if b < 0x80 then extra = 0
    elseif b >= 0xC2 and b <= 0xDF then extra = 1
    elseif b >= 0xE0 and b <= 0xEF then extra = 2
    elseif b >= 0xF0 and b <= 0xF4 then extra = 3
    else return nil end
    for k = 1, extra do
      local c = v:byte(i + k)
      if not c or c < 0x80 or c > 0xBF then return nil end
    end
    i = i + 1 + extra
    n = n + 1
  end
  if n < 1 or n > 2 then return nil end
  return v
end

-- mudstd.room.tags: a list of { id, label?, glyph? } -> a list of
-- { id, label, glyph }, in the server's order, with glyph nil where it isn't
-- one or two characters. Entries without an id are dropped; a missing label
-- falls back to the id.
function M.tag_defs(data)
  if type(data) ~= "table" then return {} end
  local out = {}
  for _, t in ipairs(data) do
    if type(t) == "table" then
      local id = str(t.id)
      if id then
        out[#out + 1] = { id = id, label = str(t.label) or id, glyph = M.glyph(t.glyph) }
      end
    end
  end
  return out
end

-- Normalize a GMCP room payload into the engine's room_seen shape. Handles both
-- the generic `room.info` package (Discworld/IRE — `identifier`, exits derived
-- from movement) and the mudstandards `mudstd.room.info` package (string `id`,
-- explicit `exits` map of { DIR = { id, inverse } }). `with_exits` forwards the
-- explicit exits so the engine can close loops without walking every edge.
function M.normalize(data, with_exits)
  if type(data) ~= "table" then return nil end
  local key = data.identifier or data.id or data.num or data.vnum
  if key == nil then return nil end
  local area_field, area_tag = M.area_signal(data)
  local room = {
    key = tostring(key),
    name = data.name or "",
    env = tostring(data.terrain or data.environment or ""),
    areaField = area_field,
    areaTag = area_tag,
    coords = M.coords(data.coords),
    wrap = M.wrap(data.wrap),
    -- The area's display name (mudstd extension); `area` stays its key.
    -- Strings and numbers only: a JSON null may arrive as a userdata sentinel.
    areaName = (type(data.areaName) == "string" or type(data.areaName) == "number")
      and tostring(data.areaName) or nil,
    -- What's here, and the part of the area it's in (extensions).
    tags = M.tags(data),
    region = str(data.region),
    regionName = str(data.regionName),
    regionColor = M.color(data.regionColor),
    -- Height above the world's datum in metres (not a floor: coords.z is),
    -- and degrees north and east (extensions).
    elevation = M.number(data.elevation),
    lat = M.number(data.lat),
    lon = M.number(data.lon),
    -- Lifts, portals and the like: ways that aren't exits (extension).
    links = M.links(data.links),
  }
  if with_exits then room.exits = movement.exits(data.exits) end
  return room
end

-- mudstd.map.rooms: a chart, many rooms at once, each in the
-- mudstd.room.info shape. -> { chart, version, part, rooms = { room_seen... } },
-- or nil when there's no rooms list. Rooms without an id are dropped.
function M.chart(data)
  if type(data) ~= "table" or type(data.rooms) ~= "table" then return nil end
  local rooms = {}
  for _, r in ipairs(data.rooms) do
    local room = M.normalize(r, true)
    if room then rooms[#rooms + 1] = room end
  end
  local part = data.part
  if not (finite(part) and part == math.floor(part) and part >= 1) then part = nil end
  return {
    chart = str(data.chart),
    version = str(data.version),
    part = part,
    rooms = rooms,
  }
end

return M
