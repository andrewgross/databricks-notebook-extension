import { ParsedCell } from './types';

/**
 * A cell representation for diffing purposes.
 * Source is the display-format source (with %%sql etc. prefixed).
 */
export interface DisplayCell {
  source: string;
  cellKind: 'code' | 'markup';
  languageId: string;
}

export type DiffOperation =
  | { type: 'keep'; oldIndex: number; newIndex: number }
  | { type: 'modify'; oldIndex: number; newIndex: number; newSource: string }
  | { type: 'insert'; atIndex: number; newIndex: number }
  | { type: 'delete'; oldIndex: number };

export interface CellDiffResult {
  operations: DiffOperation[];
}

/**
 * Create a fingerprint string for a cell, used for LCS matching.
 */
function cellFingerprint(cell: DisplayCell): string {
  return `${cell.cellKind}:${cell.languageId}:${cell.source}`;
}

/**
 * Compute the longest common subsequence of two arrays using fingerprints.
 * Returns pairs of (oldIndex, newIndex) for matched elements.
 */
function lcs(oldCells: DisplayCell[], newCells: DisplayCell[]): [number, number][] {
  const n = oldCells.length;
  const m = newCells.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0) as number[]);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (cellFingerprint(oldCells[i - 1]!) === cellFingerprint(newCells[j - 1]!)) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to find matched pairs
  const pairs: [number, number][] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (cellFingerprint(oldCells[i - 1]!) === cellFingerprint(newCells[j - 1]!)) {
      pairs.push([i - 1, j - 1]);
      i--;
      j--;
    } else if (dp[i - 1]![j]! > dp[i]![j - 1]!) {
      i--;
    } else {
      j--;
    }
  }

  pairs.reverse();
  return pairs;
}

/**
 * Compute a minimal diff between old and new cell lists.
 *
 * Uses LCS to find unchanged cells, then pairs unmatched cells by position
 * and kind for 'modify' operations (content changed but cell identity preserved).
 * Remaining unmatched cells become 'insert' or 'delete' operations.
 */
export function computeCellDiff(
  oldCells: DisplayCell[],
  newCells: DisplayCell[]
): CellDiffResult {
  const matched = lcs(oldCells, newCells);
  const operations: DiffOperation[] = [];

  const matchedOld = new Set(matched.map(([o]) => o));
  const matchedNew = new Set(matched.map(([, n]) => n));

  // Collect unmatched indices
  const unmatchedOld: number[] = [];
  for (let i = 0; i < oldCells.length; i++) {
    if (!matchedOld.has(i)) {
      unmatchedOld.push(i);
    }
  }
  const unmatchedNew: number[] = [];
  for (let j = 0; j < newCells.length; j++) {
    if (!matchedNew.has(j)) {
      unmatchedNew.push(j);
    }
  }

  // Try to pair unmatched old/new cells as 'modify' when they have the same cellKind
  // and languageId. Greedy positional pairing.
  const pairedAsModify = new Map<number, number>(); // oldIndex -> newIndex
  const pairedNewAsModify = new Set<number>();

  let ui = 0;
  let uj = 0;
  while (ui < unmatchedOld.length && uj < unmatchedNew.length) {
    const oi = unmatchedOld[ui]!;
    const nj = unmatchedNew[uj]!;
    const oldCell = oldCells[oi]!;
    const newCell = newCells[nj]!;
    if (oldCell.cellKind === newCell.cellKind && oldCell.languageId === newCell.languageId) {
      pairedAsModify.set(oi, nj);
      pairedNewAsModify.add(nj);
      ui++;
      uj++;
    } else {
      // Advance whichever index is smaller to keep positional alignment
      if (oi <= nj) {
        ui++;
      } else {
        uj++;
      }
    }
  }

  // Build operations by walking through both lists in order.
  let oldIdx = 0;
  let newIdx = 0;
  let matchIdx = 0;

  while (oldIdx < oldCells.length || newIdx < newCells.length) {
    // Check if current old/new are an LCS match
    if (
      matchIdx < matched.length &&
      matched[matchIdx]![0] === oldIdx &&
      matched[matchIdx]![1] === newIdx
    ) {
      operations.push({ type: 'keep', oldIndex: oldIdx, newIndex: newIdx });
      oldIdx++;
      newIdx++;
      matchIdx++;
      continue;
    }

    // Process unmatched old cells (deletes or modifies) before the next LCS anchor
    const nextMatchOld = matchIdx < matched.length ? matched[matchIdx]![0] : oldCells.length;
    const nextMatchNew = matchIdx < matched.length ? matched[matchIdx]![1] : newCells.length;

    // Handle old cells that need to be deleted or modified
    while (oldIdx < nextMatchOld) {
      if (pairedAsModify.has(oldIdx)) {
        const pairedNewIdx = pairedAsModify.get(oldIdx)!;
        // Emit any inserts for new cells before this paired one
        while (newIdx < pairedNewIdx) {
          if (!pairedNewAsModify.has(newIdx) && !matchedNew.has(newIdx)) {
            operations.push({ type: 'insert', atIndex: oldIdx, newIndex: newIdx });
          }
          newIdx++;
        }
        operations.push({
          type: 'modify',
          oldIndex: oldIdx,
          newIndex: pairedNewIdx,
          newSource: newCells[pairedNewIdx]!.source,
        });
        newIdx = pairedNewIdx + 1;
      } else {
        operations.push({ type: 'delete', oldIndex: oldIdx });
      }
      oldIdx++;
    }

    // Handle remaining new cells that need to be inserted before the next LCS anchor
    while (newIdx < nextMatchNew) {
      if (!pairedNewAsModify.has(newIdx) && !matchedNew.has(newIdx)) {
        operations.push({ type: 'insert', atIndex: oldIdx, newIndex: newIdx });
      }
      newIdx++;
    }
  }

  return { operations };
}

/**
 * Convert a ParsedCell to its display format, matching what pyToIpynb produces.
 * This adds %%sql, %%bash prefixes for non-Python code cells.
 */
export function cellToDisplayFormat(cell: ParsedCell): DisplayCell {
  let source = cell.source;

  if (cell.cellKind === 'code') {
    if (cell.languageId === 'sql') {
      source = '%%sql\n' + cell.source;
    } else if (cell.languageId === 'shellscript') {
      const firstLine = cell.source.trim().split('\n')[0] ?? '';
      if (!firstLine.startsWith('%pip')) {
        source = '%%bash\n' + cell.source;
      }
    }
  }

  return {
    source,
    cellKind: cell.cellKind,
    languageId: cell.languageId,
  };
}
