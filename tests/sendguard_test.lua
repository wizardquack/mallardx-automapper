-- tests/sendguard_test.lua
-- Run with: luajit tests/sendguard_test.lua
package.path = "src/?.lua;" .. package.path
local guard = require("sendguard")

local failures = 0
local function check(label, got, want)
  if got == want then
    io.write("ok   " .. label .. "\n")
  else
    failures = failures + 1
    io.write("FAIL " .. label .. " — got " .. tostring(got) .. ", want " .. tostring(want) .. "\n")
  end
end

guard.reset()
guard.expect("e")
check("self-send is consumed", guard.consume("e"), true)
check("user input passes through", guard.consume("look"), false)

guard.reset()
guard.expect("n")
check("mismatched send is treated as user input", guard.consume("s"), false)
check("expected send still queued after a mismatch", guard.consume("n"), true)

guard.reset()
guard.expect("e;n;w")
check("batched joined send consumed whole", guard.consume("e;n;w"), true)

if failures > 0 then os.exit(1) end
io.write("\nall sendguard tests passed\n")
