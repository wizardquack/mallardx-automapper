-- tests/roomsource_test.lua
-- Run with: luajit tests/roomsource_test.lua
package.path = "src/?.lua;" .. package.path
local roomsource = require("roomsource")

local failures = 0
local function check(label, got, want)
  if got == want then
    io.write("ok   " .. label .. "\n")
  else
    failures = failures + 1
    io.write("FAIL " .. label .. " — got " .. tostring(got) .. ", want " .. tostring(want) .. "\n")
  end
end

roomsource.reset()
check("room.info accepted before any mudstd", roomsource.accept("room.info"), true)
check("room.info still accepted", roomsource.accept("room.info"), true)
check("mudstd accepted", roomsource.accept("mudstd.room.info"), true)
check("room.info ignored after mudstd", roomsource.accept("room.info"), false)
check("mudstd still accepted", roomsource.accept("mudstd.room.info"), true)
roomsource.reset()
check("reset (reconnect) accepts room.info again", roomsource.accept("room.info"), true)

if failures > 0 then os.exit(1) end
io.write("\nall roomsource tests passed\n")
