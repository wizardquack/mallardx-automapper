// ui/walk.js
// Pure speedwalk state machine. No timers, no IO: the caller feeds it events
// (start / onRoomSeen / onTick / onUserInput / stop) and applies the returned
// actions. Actions: {type:"send",cmd} | {type:"manual",step} | {type:"done"} |
// {type:"aborted",reason}.
//
// Modes:
//   safe    — one step at a time; advance when the expected room confirms;
//             abort on per-step timeout or an unexpected room.
//   delay   — fire steps on a fixed clock; arrivals don't gate advancement.
//   batched — one command-separated line; then consume the planned dir sequence
//             against arrivals so mapping stays correct on known routes.
//
// A step over a link (pathfind.js) sends the link's `cmd`. A link without
// one is taken by hand: the walk stops before it with a "manual" action and
// waits — no timeout, typing doesn't cancel it — for the room it leads to,
// then carries on (in batched mode, with the next stretch as one line).
// Arriving anywhere but there, or back where it starts, stops the walk.

export function createWalk(cfg) {
  const mode = cfg.mode || "safe";
  const delayMs = cfg.delayMs ?? 250;
  const separator = cfg.separator || ";";
  const timeoutMs = cfg.timeoutMs ?? 4000;
  const abortOnInput = cfg.abortOnInput !== false;

  let path = [];
  let index = 0;      // safe: step in flight; delay: last step sent; batched: next stretch's start
  let drain = 0;      // batched/delay: planned-step cursor for arrivals
  let active = false;
  let awaiting = false;   // safe: sent a step, waiting for its confirmation
  let manual = false;     // stopped before a by-hand link at path[index] (batched: path[drain])
  let lastAt = 0;         // ms of the last send (safe/delay) or last arrival (batched)

  const cmdOf = (s) => s.dir || (s.link && s.link.cmd) || null;
  const byHand = (s) => !s.dir && !(s.link && s.link.cmd);

  function done() { active = false; manual = false; return [{ type: "done" }]; }
  function abort(reason) { active = false; manual = false; return [{ type: "aborted", reason }]; }

  function stopAt(i) {
    manual = true; awaiting = false;
    return [{ type: "manual", step: path[i] }];
  }

  function sendStep(i, now) {
    lastAt = now ?? 0;
    if (byHand(path[i])) return stopAt(i);
    if (mode === "safe") awaiting = true;
    return [{ type: "send", cmd: cmdOf(path[i]) }];
  }

  // batched: send path[from…] up to the next by-hand link as one line, or
  // stop at that link when it's the first step.
  function sendStretch(from, now) {
    lastAt = now ?? 0;
    let end = from;
    while (end < path.length && !byHand(path[end])) end++;
    index = end;
    if (end === from) return stopAt(from);
    return [{ type: "send", cmd: path.slice(from, end).map(cmdOf).join(separator) }];
  }

  // Stopped before a by-hand link: its far end resumes the walk, its near
  // end (a reprint, a look) is waited out, anywhere else stops it.
  function onManualRoom(step, currentId, resume) {
    if (currentId === step.toId) { manual = false; return resume(); }
    if (currentId === step.fromId) return [];
    return abort("off-route");
  }

  function start(p, now) {
    path = Array.isArray(p) ? p : [];
    index = 0; drain = 0; awaiting = false; manual = false; lastAt = now ?? 0;
    if (path.length === 0) { active = false; return [{ type: "done" }]; }
    active = true;
    if (mode === "batched") return sendStretch(0, now);
    return sendStep(0, now);
  }

  function onRoomSeen(currentId, now) {
    if (!active) return [];
    if (mode === "batched") {
      if (manual) {
        return onManualRoom(path[drain], currentId, () => {
          drain++;
          if (drain >= path.length) return done();
          return sendStretch(drain, now);
        });
      }
      drain++;
      if (drain >= path.length) return done();
      lastAt = now ?? 0;
      if (drain === index) return stopAt(drain);   // the stretch is walked; a link is next
      return [];
    }
    if (mode === "safe") {
      if (manual) {
        return onManualRoom(path[index], currentId, () => {
          index++;
          if (index >= path.length) return done();
          return sendStep(index, now);
        });
      }
      if (!awaiting) return [];
      if (currentId !== path[index].toId) return abort("off-route");
      awaiting = false;
      index++;
      if (index >= path.length) return done();
      return sendStep(index, now);
    }
    // delay: arrivals advance the placement cursor (not the send clock),
    // so each room is placed along the dir that actually reached it even
    // when the clock has already sent later steps. Stopped at a link, the
    // steps before it land first; then the link's far end resumes the clock.
    if (manual && drain >= index) {
      return onManualRoom(path[index], currentId, () => {
        drain = index + 1;
        index++;
        if (index >= path.length) return done();
        return sendStep(index, now);
      });
    }
    if (drain < path.length) drain++;
    return [];
  }

  function onTick(now) {
    if (!active || manual) return [];
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
    if (!active || !abortOnInput || manual) return [];
    return abort("user-input");
  }

  function stop() {
    if (!active) return [];
    return abort("stopped");
  }

  // The direction the next arrival came by, for placing it: null for a link.
  function pendingDir() {
    if (!active) return null;
    const i = mode === "safe" ? index : drain;
    return path[i] ? path[i].dir || null : null;
  }

  return { start, onRoomSeen, onTick, onUserInput, stop, pendingDir, isActive: () => active };
}
