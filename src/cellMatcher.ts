/**
 * Cell Matcher - Pure functions for matching cells by content
 *
 * This module handles the logic of mapping old notebook cells to new cells
 * based on content matching, enabling output preservation during reloads.
 */

/**
 * Minimal cell representation for matching purposes
 */
export interface CellContent {
  /** The text content of the cell */
  content: string;
  /** Unique identifier for tracking (e.g., array index) */
  id: number;
}

/**
 * Result of matching old cells to new cells
 */
export interface CellMatchResult {
  /** Index of the new cell */
  newIndex: number;
  /** Index of the matched old cell, or undefined if no match */
  oldIndex: number | undefined;
}

/**
 * Match new cells to old cells by content.
 *
 * Uses content-based matching with support for duplicate handling:
 * - If multiple old cells have the same content, they're matched in order
 * - Each old cell can only be matched once
 *
 * @param oldCells - The existing cells with their content
 * @param newCells - The new cells to match against old ones
 * @returns Array of match results, one per new cell
 *
 * @example
 * ```ts
 * const oldCells = [
 *   { content: 'print("hello")', id: 0 },
 *   { content: 'x = 1', id: 1 },
 * ];
 * const newCells = [
 *   { content: 'x = 1', id: 0 },      // matches old[1]
 *   { content: 'print("hello")', id: 1 }, // matches old[0]
 *   { content: 'y = 2', id: 2 },      // no match
 * ];
 * const result = matchCellsByContent(oldCells, newCells);
 * // [{ newIndex: 0, oldIndex: 1 }, { newIndex: 1, oldIndex: 0 }, { newIndex: 2, oldIndex: undefined }]
 * ```
 */
export function matchCellsByContent(
  oldCells: CellContent[],
  newCells: CellContent[]
): CellMatchResult[] {
  // Build a multimap of content -> old cell ids
  // Using an array to preserve order for duplicate handling
  const oldCellsByContent = new Map<string, number[]>();
  for (const cell of oldCells) {
    const existing = oldCellsByContent.get(cell.content) || [];
    existing.push(cell.id);
    oldCellsByContent.set(cell.content, existing);
  }

  // Track which old cells have been used
  const usedOldCells = new Set<number>();

  // Match each new cell to an old cell
  return newCells.map((newCell): CellMatchResult => {
    const matchingOldIds = oldCellsByContent.get(newCell.content);

    if (matchingOldIds) {
      // Find first unused matching cell
      const unusedId = matchingOldIds.find(id => !usedOldCells.has(id));
      if (unusedId !== undefined) {
        usedOldCells.add(unusedId);
        return { newIndex: newCell.id, oldIndex: unusedId };
      }
    }

    return { newIndex: newCell.id, oldIndex: undefined };
  });
}

/**
 * Compute statistics about cell matching results.
 * Useful for informing users about what was preserved.
 */
export interface MatchStats {
  /** Total number of new cells */
  totalNew: number;
  /** Number of cells that matched old content */
  matched: number;
  /** Number of new cells without matches */
  unmatched: number;
  /** Number of old cells that weren't matched (deleted) */
  deleted: number;
}

/**
 * Compute statistics from match results.
 *
 * @param results - The match results from matchCellsByContent
 * @param oldCellCount - The number of old cells
 */
export function computeMatchStats(
  results: CellMatchResult[],
  oldCellCount: number
): MatchStats {
  const matched = results.filter(r => r.oldIndex !== undefined).length;
  const matchedOldIds = new Set(
    results.filter(r => r.oldIndex !== undefined).map(r => r.oldIndex)
  );

  return {
    totalNew: results.length,
    matched,
    unmatched: results.length - matched,
    deleted: oldCellCount - matchedOldIds.size,
  };
}
