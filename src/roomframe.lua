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
        local color = nil
        if type(t.color) == "string" then
          local hex = t.color:match("^#?(%x%x%x%x%x%x)$")
          if hex then color = "#" .. hex:lower() end
        end
        out[#out + 1] = { id = id, label = str(t.label) or id, color = color }
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
  }
  if with_exits then room.exits = movement.exits(data.exits) end
  return room
end

return M
