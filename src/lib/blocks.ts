// Flat control-flow markers for if/else blocks (L2). Steps stay a flat array; `if`/`else`/
// `endif` are marker steps and the runner tracks nesting with a stack. This module holds the
// pure, client-safe helpers shared by the editor (UI) and the runner (validation).

export const BLOCK_ACTIONS = new Set(["if", "else", "endif"]);
export const isBlockMarker = (action: string) => BLOCK_ACTIONS.has(action);

type HasAction = { action: string };

// Validates balanced if/else/endif. Returns an error message, or null when balanced.
export function validateBlocks(steps: HasAction[]): string | null {
  let depth = 0;
  const elseSeen: boolean[] = []; // per-depth: has this if-block already had an else?
  for (let i = 0; i < steps.length; i++) {
    const a = steps[i].action;
    if (a === "if") {
      depth++;
      elseSeen[depth] = false; // reset per if so sibling blocks at the same depth each allow an else
    } else if (a === "else") {
      if (depth === 0) return `Step ${i + 1}: "else" is outside an if-block.`;
      if (elseSeen[depth]) return `Step ${i + 1}: an if-block can have only one "else".`;
      elseSeen[depth] = true;
    } else if (a === "endif") {
      if (depth === 0) return `Step ${i + 1}: "endif" has no matching "if".`;
      depth--;
    }
  }
  if (depth !== 0) return `${depth} "if" block(s) missing an "endif".`;
  return null;
}

// Indentation depth per step for the editor/list. Markers sit at their block's outer level;
// the body between them is indented one deeper.
export function computeDepths(steps: HasAction[]): number[] {
  const depths: number[] = [];
  let depth = 0;
  for (const s of steps) {
    const a = s.action;
    if (a === "endif") {
      depth = Math.max(0, depth - 1);
      depths.push(depth);
    } else if (a === "else") {
      depths.push(Math.max(0, depth - 1));
    } else if (a === "if") {
      depths.push(depth);
      depth++;
    } else {
      depths.push(depth);
    }
  }
  return depths;
}

// Nearest enclosing `if` for the marker just after `fromExclusive` (scans backward, depth-aware).
function findMatchingIf(steps: HasAction[], fromExclusive: number): number {
  let depth = 0;
  for (let i = fromExclusive - 1; i >= 0; i--) {
    const a = steps[i].action;
    if (a === "endif") depth++;
    else if (a === "if") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

// For any marker (if/else/endif) at markerIndex, returns its block's if/else/endif indices,
// or null if it isn't a marker / the block is unbalanced around it. Used for "add else" and
// for removing a whole block atomically.
export function blockBounds(
  steps: HasAction[],
  markerIndex: number,
): { ifIndex: number; elseIndex: number | null; endifIndex: number } | null {
  const a = steps[markerIndex]?.action;
  if (!isBlockMarker(a)) return null;
  const ifIndex = a === "if" ? markerIndex : findMatchingIf(steps, markerIndex);
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
