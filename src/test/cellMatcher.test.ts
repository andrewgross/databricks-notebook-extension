import { describe, it, expect } from 'vitest';
import {
  matchCellsByContent,
  computeMatchStats,
  CellContent,
  CellMatchResult,
} from '../cellMatcher';

describe('matchCellsByContent', () => {
  it('matches_identical_cells_returns_correct_indices', () => {
    const oldCells: CellContent[] = [
      { content: 'print("hello")', id: 0 },
      { content: 'x = 1', id: 1 },
    ];
    const newCells: CellContent[] = [
      { content: 'print("hello")', id: 0 },
      { content: 'x = 1', id: 1 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: 0 },
      { newIndex: 1, oldIndex: 1 },
    ]);
  });

  it('matches_reordered_cells_returns_correct_mapping', () => {
    const oldCells: CellContent[] = [
      { content: 'print("hello")', id: 0 },
      { content: 'x = 1', id: 1 },
    ];
    const newCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
      { content: 'print("hello")', id: 1 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: 1 },
      { newIndex: 1, oldIndex: 0 },
    ]);
  });

  it('handles_new_cells_without_match_returns_undefined', () => {
    const oldCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
    ];
    const newCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
      { content: 'y = 2', id: 1 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: 0 },
      { newIndex: 1, oldIndex: undefined },
    ]);
  });

  it('handles_deleted_cells_old_cells_not_in_result', () => {
    const oldCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
      { content: 'y = 2', id: 1 },
      { content: 'z = 3', id: 2 },
    ];
    const newCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
      { content: 'z = 3', id: 1 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: 0 },
      { newIndex: 1, oldIndex: 2 },
    ]);
  });

  it('handles_inserted_cell_in_middle_preserves_surrounding_matches', () => {
    const oldCells: CellContent[] = [
      { content: 'A', id: 0 },
      { content: 'B', id: 1 },
      { content: 'C', id: 2 },
    ];
    const newCells: CellContent[] = [
      { content: 'A', id: 0 },
      { content: 'X', id: 1 }, // inserted
      { content: 'B', id: 2 },
      { content: 'C', id: 3 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: 0 }, // A matches
      { newIndex: 1, oldIndex: undefined }, // X is new
      { newIndex: 2, oldIndex: 1 }, // B matches
      { newIndex: 3, oldIndex: 2 }, // C matches
    ]);
  });

  it('handles_multiple_insertions_and_deletions', () => {
    const oldCells: CellContent[] = [
      { content: 'A', id: 0 },
      { content: 'B', id: 1 }, // will be deleted
      { content: 'C', id: 2 },
      { content: 'D', id: 3 },
    ];
    const newCells: CellContent[] = [
      { content: 'X', id: 0 }, // inserted
      { content: 'A', id: 1 },
      { content: 'C', id: 2 },
      { content: 'Y', id: 3 }, // inserted
      { content: 'D', id: 4 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: undefined }, // X is new
      { newIndex: 1, oldIndex: 0 }, // A matches
      { newIndex: 2, oldIndex: 2 }, // C matches (B was deleted)
      { newIndex: 3, oldIndex: undefined }, // Y is new
      { newIndex: 4, oldIndex: 3 }, // D matches
    ]);
  });

  it('handles_duplicate_content_matches_in_order', () => {
    const oldCells: CellContent[] = [
      { content: 'print("a")', id: 0 },
      { content: 'print("a")', id: 1 },
      { content: 'print("a")', id: 2 },
    ];
    const newCells: CellContent[] = [
      { content: 'print("a")', id: 0 },
      { content: 'print("a")', id: 1 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    // Should match first two old cells in order
    expect(result).toEqual([
      { newIndex: 0, oldIndex: 0 },
      { newIndex: 1, oldIndex: 1 },
    ]);
  });

  it('handles_more_new_duplicates_than_old_returns_undefined_for_extras', () => {
    const oldCells: CellContent[] = [
      { content: 'print("a")', id: 0 },
    ];
    const newCells: CellContent[] = [
      { content: 'print("a")', id: 0 },
      { content: 'print("a")', id: 1 },
      { content: 'print("a")', id: 2 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: 0 },
      { newIndex: 1, oldIndex: undefined },
      { newIndex: 2, oldIndex: undefined },
    ]);
  });

  it('handles_empty_old_cells_returns_all_undefined', () => {
    const oldCells: CellContent[] = [];
    const newCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
      { content: 'y = 2', id: 1 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: undefined },
      { newIndex: 1, oldIndex: undefined },
    ]);
  });

  it('handles_empty_new_cells_returns_empty_array', () => {
    const oldCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
    ];
    const newCells: CellContent[] = [];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([]);
  });

  it('handles_both_empty_returns_empty_array', () => {
    const result = matchCellsByContent([], []);
    expect(result).toEqual([]);
  });

  it('handles_whitespace_differences_as_different_content', () => {
    const oldCells: CellContent[] = [
      { content: 'x = 1', id: 0 },
    ];
    const newCells: CellContent[] = [
      { content: 'x  = 1', id: 0 }, // extra space
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: undefined },
    ]);
  });

  it('handles_multiline_content_matches_correctly', () => {
    const multilineContent = `def foo():
    return 42

foo()`;
    const oldCells: CellContent[] = [
      { content: multilineContent, id: 0 },
    ];
    const newCells: CellContent[] = [
      { content: multilineContent, id: 0 },
    ];

    const result = matchCellsByContent(oldCells, newCells);

    expect(result).toEqual([
      { newIndex: 0, oldIndex: 0 },
    ]);
  });
});

describe('computeMatchStats', () => {
  it('computes_stats_for_full_match', () => {
    const results: CellMatchResult[] = [
      { newIndex: 0, oldIndex: 0 },
      { newIndex: 1, oldIndex: 1 },
    ];

    const stats = computeMatchStats(results, 2);

    expect(stats).toEqual({
      totalNew: 2,
      matched: 2,
      unmatched: 0,
      deleted: 0,
    });
  });

  it('computes_stats_for_partial_match', () => {
    const results: CellMatchResult[] = [
      { newIndex: 0, oldIndex: 0 },
      { newIndex: 1, oldIndex: undefined },
      { newIndex: 2, oldIndex: 2 },
    ];

    const stats = computeMatchStats(results, 4);

    expect(stats).toEqual({
      totalNew: 3,
      matched: 2,
      unmatched: 1,
      deleted: 2, // old cells 1 and 3 weren't matched
    });
  });

  it('computes_stats_for_no_matches', () => {
    const results: CellMatchResult[] = [
      { newIndex: 0, oldIndex: undefined },
      { newIndex: 1, oldIndex: undefined },
    ];

    const stats = computeMatchStats(results, 3);

    expect(stats).toEqual({
      totalNew: 2,
      matched: 0,
      unmatched: 2,
      deleted: 3,
    });
  });

  it('computes_stats_for_empty_results', () => {
    const stats = computeMatchStats([], 2);

    expect(stats).toEqual({
      totalNew: 0,
      matched: 0,
      unmatched: 0,
      deleted: 2,
    });
  });
});
