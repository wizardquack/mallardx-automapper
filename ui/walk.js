// ui/walk.js
// Pure speedwalk state machine. No timers, no IO: the caller feeds it events
// (start / onRoomSeen / onTick / onUserInput / stop) and applies the returned
// actions. Actions: {type:"send",cmd} | {type:"done"} | {type:"aborted",reason}.
//
// Modes:
//   safe    — one step at a time; advance when the expected room confirms;
//             abort on per-step timeout or an unexpected room.
//   delay   — fire steps on a fixed clock; arrivals don't gate advancement.
//   batched — one command-separated line; then consume the planned dir sequence
//             against arrivals so mapping stays correct on known routes.

export function createWalk(cfg) {
  const mode = cfg.mode || "safe";
  const delayMs = cfg.delayMs ?? 250;
  const separator = cfg.separator || ";";
  const timeoutMs = cfg.timeoutMs ?? 4000;
  const abortOnInput = cfg.abortOnInput !== false;

  let path = [];
  let index = 0;      // safe: step in flight; delay: last step sent
  let drain = 0;      // batched: planned-dir cursor for arrivals
  let active = false;
  let awaiting = false;   // safe: sent a step, waiting for its confirmation
  let lastAt = 0;         // ms of the last send (safe/delay) or last arrival (batched)

  function done() { active = false; return [{ type: "done" }]; }
  function abort(reason) { active = false; return [{ type: "aborted", reason }]; }

  function sendStep(i, now) {
    lastAt = now || 0;
    if (mode === "safe") awaiting = true;
    return [{ type: "send", cmd: path[i].dir }];
  }

  function start(p, now) {
    path = Array.isArray(p) ? p : [];
    index = 0; drain = 0; awaiting = false; lastAt = now || 0;
    if (path.length === 0) { active = false; return [{ type: "done" }]; }
    active = true;
    if (mode === "batched") {
      lastAt = now || 0;
      return [{ type: "send", cmd: path.map((s) => s.dir).join(separator) }];
    }
    return sendStep(0, now);
  }

  function onRoomSeen(currentId, now) {
    if (!active) return [];
    if (mode === "batched") {
      drain++;
      if (drain >= path.length) return done();
      lastAt = now || 0;
      return [];
    }
    if (mode === "safe") {
      if (!awaiting) return [];
      if (currentId !== path[index].toId) return abort("off-route");
      awaiting = false;
      index++;
      if (index >= path.length) return done();
      return sendStep(index, now);
    }
    return [];   // delay: arrivals don't advance
  }

  function onTick(now) {
    if (!active) return [];
    if (mode === "safe") {
      if (awaiting && now - lastAt >= timeoutMs) return abort("timeout");
      return [];
    }
    if (mode === "delay") {
      if (now - lastAt >= delayMs) {
        index++;
        if (index >= path.length) return done();
        return sendStep(index, now);
      }
      return [];
    }
    // batched: if arrivals stall, stop draining after a generous window.
    if (now - lastAt >= timeoutMs * Math.max(1, path.length)) return done();
    return [];
  }

  function onUserInput() {
    if (!active || !abortOnInput) return [];
    return abort("user-input");
  }

  function stop() {
    if (!active) return [];
    return abort("stopped");
  }

  function pendingDir() {
    if (!active) return null;
    if (mode === "batched") return path[drain] ? path[drain].dir : null;
    return path[index] ? path[index].dir : null;
  }

  return { start, onRoomSeen, onTick, onUserInput, stop, pendingDir, isActive: () => active };
}
