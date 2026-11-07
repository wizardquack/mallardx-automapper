// Movement commands the user has sent that the MUD hasn't answered yet, oldest
// first. MUDs that pace movement (Discworld's command queue, any server with a
// move delay) accept a burst of directions at once and then answer them one
// room at a time; a single "last direction sent" slot would pair the first
// arrival with the LAST command and every later arrival with none. Each
// arrival takes the oldest queued direction instead.
//
// A failed move gives no arrival, which would leave the queue one step behind
// for good. `move_fail` (a configured failure pattern) drops that step; for the
// rest, the caller checks each queued direction against what the map already
// knows (`contradicts` in identity.js) and clears the queue when they disagree,
// so a lost step degrades to direction inference instead of forged links.

export const MAX_QUEUED = 64;

export function createMoveQueue(max = MAX_QUEUED) {
  let q = [];
  return {
    push(dir) {
      q.push(dir);
      if (q.length > max) q.shift();   // nothing answers 64 moves late
    },
    peek() { return q.length ? q[0] : null; },
    shift() { return q.length ? q.shift() : null; },
    clear() { q = []; },
    size() { return q.length; },
  };
}
