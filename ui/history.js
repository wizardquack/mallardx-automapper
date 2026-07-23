// Snapshot-based undo/redo. Snapshots are opaque strings (toJSON(map)).
// push() is called with the PRE-edit snapshot, before mutating the map.

export function createHistory({ limit = 50 } = {}) {
  let undoStack = [];
  let redoStack = [];
  return {
    push(snapshot) {
      undoStack.push(snapshot);
      if (undoStack.length > limit) undoStack.shift();
      redoStack = [];
    },
    undo(currentSnapshot) {
      if (undoStack.length === 0) return null;
      const prev = undoStack.pop();
      redoStack.push(currentSnapshot);
      return prev;
    },
    redo(currentSnapshot) {
      if (redoStack.length === 0) return null;
      const next = redoStack.pop();
      undoStack.push(currentSnapshot);
      return next;
    },
    clear() { undoStack = []; redoStack = []; },
    canUndo() { return undoStack.length > 0; },
    canRedo() { return redoStack.length > 0; },
  };
}
