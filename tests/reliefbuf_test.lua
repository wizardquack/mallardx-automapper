-- tests/reliefbuf_test.lua
-- Run with: luajit tests/reliefbuf_test.lua
package.path = "src/?.lua;" .. package.path
local buf = require("reliefbuf")

local failures = 0
local function check(label, got, want)
  if got == want then
    io.write("ok   " .. label .. "\n")
  else
    failures = failures + 1
    io.write("FAIL " .. label .. " — got " .. tostring(got) .. ", want " .. tostring(want) .. "\n")
  end
end

local a = buf.push({ area = "a" })
local b = buf.push({ area = "b" })
local c = buf.push({ area = "c" })
check("numbered in order", a.seq < b.seq and b.seq < c.seq, true)
check("all pending", #buf.pending(), 3)

buf.ack(b.seq)
check("ack drops what's saved", #buf.pending(), 1)
check("keeps what isn't", buf.pending()[1], c)

buf.ack("junk")
check("a bad ack drops nothing", #buf.pending(), 1)

buf.reset()
check("reset forgets", #buf.pending(), 0)
local d = buf.push({ area = "d" })
check("numbering carries on after reset", d.seq > c.seq, true)
buf.ack(c.seq)   -- a late ack from before the reset
check("a late ack keeps newer patches", #buf.pending(), 1)

buf.reset()
for i = 1, buf.KEEP + 5 do buf.push({ i = i }) end
check("kept at most KEEP", #buf.pending(), buf.KEEP)
check("oldest dropped", buf.pending()[1].i, 6)

if failures > 0 then os.exit(1) end
