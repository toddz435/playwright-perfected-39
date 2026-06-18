// Flat control-flow markers for if/else blocks (L2) and loops (L3). Steps stay a flat array;
// `if`/`else`/`endif` and `repeat`/`endrepeat` are marker steps and the runner tracks nesting
// with a stack. This module holds the pure, client-safe helpers shared by the editor (UI) and
// the runner (validation/matching).

export const MARKER_ACTIONS = new Set(["if", "else", "endif", "repeat", "endrepeat"]);
export const isBlockMarker = (action: string) => MARKER_ACTIONS.has(action);

type HasAction = { action: string };

// Validates balanced, properly-nested if/else and repeat blocks (catches crossed nesting like
// `if … repeat … endif … endrepeat`). Returns an error message, or null when valid.
export function validateBlocks(steps: HasAction[]): string | null {
  const stack: { kind: "if" | "repeat"; elseSeen?: boolean }[] = [];
  for (let i = 0; i < steps.length; i++) {
    const a = steps[i].action;
    if (a === "if") stack.push({ kind: "if", elseSeen: false });
    else if (a === "repeat") stack.push({ kind: "repeat" });
    else if (a === "else") {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== "if") return `Step ${i + 1}: "else" is outside an if-block.`;
      if (top.elseSeen) return `Step ${i + 1}: an if-block can have only one "else".`;
      top.elseSeen = true;
    } else if (a === "endif") {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== "if") return `Step ${i + 1}: "endif" has no matching "if".`;
      stack.pop();
    } else if (a === "endrepeat") {
      const top = stack[stack.length - 1];
      if (!top || top.kind !== "repeat")
        return `Step ${i + 1}: "endrepeat" has no matching "repeat".`;
      stack.pop();
    }
  }
  if (stack.length) return `${stack.length} block(s) missing their end marker.`;
  return null;
}

// Indentation depth per step for the editor/list. Block bodies indent one deeper than their
// markers; `else` and the end markers sit at the block's outer level.
export function computeDepths(steps: HasAction[]): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const s of steps) {
    const a = s.action;
    if (a === "endif" || a === "endrepeat") {
      depth = Math.max(0, depth - 1);
      depths.push(depth);
    } else if (a === "else") {
      depths.push(Math.max(0, depth - 1));
    } else if (a === "if" || a === "repeat") {
      depths.push(depth);
      depth++;
    } else {
      depths.push(depth);
    }
  }
  return depths;
}

// Nearest enclosing opener of `openType` for the marker just after `fromExclusive`
// (scans backward, depth-aware over that opener/closer pair).
function findMatchingOpener(
  steps: HasAction[],
  fromExclusive: number,
  openType: "if" | "repeat",
  closeType: "endif" | "endrepeat",
): number {
  let depth = 0;
  for (let i = fromExclusive - 1; i >= 0; i--) {
    const a = steps[i].action;
    if (a === closeType) depth++;
    else if (a === openType) {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

// For an if-marker (if/else/endif) at markerIndex, returns its block's if/else/endif indices.
export function blockBounds(
  steps: HasAction[],
  markerIndex: number,
): { ifIndex: number; elseIndex: number | null; endifIndex: number } | null {
  const a = steps[markerIndex]?.action;
  if (a !== "if" && a !== "else" && a !== "endif") return null;
  const ifIndex = a === "if" ? markerIndex : findMatchingOpener(steps, markerIndex, "if", "endif");
  if (ifIndex < 0) return null;

  let depth = 0;
  let elseIndex: number | null = null;
  let endifIndex = -1;
  for (let i = ifIndex; i < steps.length; i++) {
    const act = steps[i].action;
    if (act === "if") depth++;
    else if (act === "else" && depth === 1 && elseIndex === null) elseIndex = i;
    else if (act === "endif") {
      depth--;
      if (depth === 0) {
        endifIndex = i;
        break;
      }
    }
  }
  if (endifIndex < 0) return null;
  return { ifIndex, elseIndex, endifIndex };
}

// For a loop marker (repeat/endrepeat) at markerIndex, returns the repeat/endrepeat indices.
export function loopBounds(
  steps: HasAction[],
  markerIndex: number,
): { repeatIndex: number; endrepeatIndex: number } | null {
  const a = steps[markerIndex]?.action;
  if (a !== "repeat" && a !== "endrepeat") return null;
  const repeatIndex =
    a === "repeat" ? markerIndex : findMatchingOpener(steps, markerIndex, "repeat", "endrepeat");
  if (repeatIndex < 0) return null;

  let depth = 0;
  let endrepeatIndex = -1;
  for (let i = repeatIndex; i < steps.length; i++) {
    const act = steps[i].action;
    if (act === "repeat") depth++;
    else if (act === "endrepeat") {
      depth--;
      if (depth === 0) {
        endrepeatIndex = i;
        break;
      }
    }
  }
  if (endrepeatIndex < 0) return null;
  return { repeatIndex, endrepeatIndex };
}
