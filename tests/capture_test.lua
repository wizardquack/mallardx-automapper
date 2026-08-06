-- tests/capture_test.lua
-- Run with: luajit tests/capture_test.lua
package.path = "src/?.lua;" .. package.path
local capture = require("capture")

local failures = 0
local function check(label, got, want)
  if got == want then
    io.write("ok   " .. label .. "\n")
  else
    failures = failures + 1
    io.write("FAIL " .. label .. " — got " .. tostring(got) .. ", want " .. tostring(want) .. "\n")
  end
end

-- Name then exits → one capture.
capture.reset()
capture.on_name("The Town Square")
check("name buffered", capture.has_pending(), true)
local cap = capture.on_exits("north, east and up")
check("emitted name", cap and cap.name, "The Town Square")
check("emitted exits", cap and cap.exits, "north, east and up")
check("buffer cleared after emit", capture.has_pending(), false)

-- Bare exits with no name → nothing.
capture.reset()
check("bare exits ignored", capture.on_exits("n, s"), nil)

-- Second name replaces an un-paired first.
capture.reset()
capture.on_name("First Room")
capture.on_name("Second Room")
local cap2 = capture.on_exits("w")
check("latest name wins", cap2 and cap2.name, "Second Room")

-- reset() drops a half-built room (movement-failure guard).
capture.reset()
capture.on_name("Doomed Room")
capture.reset()
check("reset clears pending", capture.on_exits("n"), nil)

-- Two full rooms in sequence.
capture.reset()
capture.on_name("Room A")
local a = capture.on_exits("n")
capture.on_name("Room B")
local b = capture.on_exits("s")
check("room A", a and a.name, "Room A")
check("room B", b and b.name, "Room B")

if failures > 0 then os.exit(1) end
io.write("\nall capture tests passed\n")
