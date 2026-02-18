import { describe, it, expect } from 'vitest';
import { computeCellDiff, cellToDisplayFormat, DisplayCell } from '../cellDiff';
import { ParsedCell } from '../types';

function makeCell(source: string, cellKind: 'code' | 'markup' = 'code', languageId = 'python'): DisplayCell {
  return { source, cellKind, languageId };
}

describe('computeCellDiff', () => {
  it('identical_cells_returns_all_keep', () => {
    const cells = [
      makeCell('print("hello")'),
      makeCell('x = 1'),
    ];

    const result = computeCellDiff(cells, cells);

    expect(result.operations).toHaveLength(2);
    expect(result.operations.every(op => op.type === 'keep')).toBe(true);
  });

  it('single_cell_added_at_end_returns_keeps_and_insert', () => {
    const oldCells = [
      makeCell('print("hello")'),
      makeCell('x = 1'),
    ];
    const newCells = [
      makeCell('print("hello")'),
      makeCell('x = 1'),
      makeCell('y = 2'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    const keeps = result.operations.filter(op => op.type === 'keep');
    const inserts = result.operations.filter(op => op.type === 'insert');
    expect(keeps).toHaveLength(2);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.type === 'insert' && inserts[0]!.newIndex).toBe(2);
  });

  it('single_cell_added_in_middle_returns_keeps_and_insert', () => {
    const oldCells = [
      makeCell('print("hello")'),
      makeCell('x = 1'),
    ];
    const newCells = [
      makeCell('print("hello")'),
      makeCell('y = 2'),
      makeCell('x = 1'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    const keeps = result.operations.filter(op => op.type === 'keep');
    const inserts = result.operations.filter(op => op.type === 'insert');
    expect(keeps).toHaveLength(2);
    expect(inserts).toHaveLength(1);
  });

  it('single_cell_deleted_returns_keeps_and_delete', () => {
    const oldCells = [
      makeCell('print("hello")'),
      makeCell('x = 1'),
      makeCell('y = 2'),
    ];
    const newCells = [
      makeCell('print("hello")'),
      makeCell('y = 2'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    const keeps = result.operations.filter(op => op.type === 'keep');
    const deletes = result.operations.filter(op => op.type === 'delete');
    expect(keeps).toHaveLength(2);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.type === 'delete' && deletes[0]!.oldIndex).toBe(1);
  });

  it('single_cell_modified_returns_keeps_and_modify', () => {
    const oldCells = [
      makeCell('print("hello")'),
      makeCell('x = 1'),
      makeCell('y = 2'),
    ];
    const newCells = [
      makeCell('print("hello")'),
      makeCell('x = 999'),
      makeCell('y = 2'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    const keeps = result.operations.filter(op => op.type === 'keep');
    const modifies = result.operations.filter(op => op.type === 'modify');
    expect(keeps).toHaveLength(2);
    expect(modifies).toHaveLength(1);
    expect(modifies[0]!.type === 'modify' && modifies[0]!.newSource).toBe('x = 999');
  });

  it('multiple_cells_added_and_deleted_simultaneously', () => {
    const oldCells = [
      makeCell('a = 1'),
      makeCell('b = 2'),
      makeCell('c = 3'),
    ];
    const newCells = [
      makeCell('a = 1'),
      makeCell('d = 4'),
      makeCell('c = 3'),
      makeCell('e = 5'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    const keeps = result.operations.filter(op => op.type === 'keep');
    expect(keeps).toHaveLength(2); // a=1 and c=3

    // b=2 should be either modified to d=4 or deleted+inserted
    const hasChange = result.operations.some(
      op => op.type === 'modify' || op.type === 'delete' || op.type === 'insert'
    );
    expect(hasChange).toBe(true);
  });

  it('complete_replacement_produces_correct_operations', () => {
    const oldCells = [
      makeCell('a = 1'),
      makeCell('b = 2'),
    ];
    const newCells = [
      makeCell('x = 10'),
      makeCell('y = 20'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    // No keeps since all cells changed
    const keeps = result.operations.filter(op => op.type === 'keep');
    expect(keeps).toHaveLength(0);

    // Should have modifies (same cellKind/languageId, different source)
    const modifies = result.operations.filter(op => op.type === 'modify');
    expect(modifies).toHaveLength(2);
  });

  it('empty_old_list_returns_all_inserts', () => {
    const oldCells: DisplayCell[] = [];
    const newCells = [
      makeCell('a = 1'),
      makeCell('b = 2'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    expect(result.operations).toHaveLength(2);
    expect(result.operations.every(op => op.type === 'insert')).toBe(true);
  });

  it('empty_new_list_returns_all_deletes', () => {
    const oldCells = [
      makeCell('a = 1'),
      makeCell('b = 2'),
    ];
    const newCells: DisplayCell[] = [];

    const result = computeCellDiff(oldCells, newCells);

    expect(result.operations).toHaveLength(2);
    expect(result.operations.every(op => op.type === 'delete')).toBe(true);
  });

  it('both_empty_returns_no_operations', () => {
    const result = computeCellDiff([], []);
    expect(result.operations).toHaveLength(0);
  });

  it('different_cell_kinds_are_not_paired_as_modify', () => {
    const oldCells = [
      makeCell('# Title', 'markup', 'markdown'),
    ];
    const newCells = [
      makeCell('print("hello")', 'code', 'python'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    // Should not be a modify since cellKind differs
    const modifies = result.operations.filter(op => op.type === 'modify');
    expect(modifies).toHaveLength(0);

    // Should be delete + insert
    const deletes = result.operations.filter(op => op.type === 'delete');
    const inserts = result.operations.filter(op => op.type === 'insert');
    expect(deletes).toHaveLength(1);
    expect(inserts).toHaveLength(1);
  });

  it('mixed_language_cells_are_not_paired_as_modify', () => {
    const oldCells = [
      makeCell('SELECT 1', 'code', 'sql'),
    ];
    const newCells = [
      makeCell('print(1)', 'code', 'python'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    const modifies = result.operations.filter(op => op.type === 'modify');
    expect(modifies).toHaveLength(0);
  });

  it('preserves_ordering_with_interleaved_changes', () => {
    const oldCells = [
      makeCell('a = 1'),
      makeCell('b = 2'),
      makeCell('c = 3'),
      makeCell('d = 4'),
    ];
    const newCells = [
      makeCell('a = 1'),
      makeCell('NEW'),
      makeCell('c = 3'),
      makeCell('d = 4'),
    ];

    const result = computeCellDiff(oldCells, newCells);

    const keeps = result.operations.filter(op => op.type === 'keep');
    expect(keeps).toHaveLength(3); // a=1, c=3, d=4

    // b=2 should be modified to NEW or deleted+inserted
    const nonKeeps = result.operations.filter(op => op.type !== 'keep');
    expect(nonKeeps.length).toBeGreaterThan(0);
  });
});

describe('cellToDisplayFormat', () => {
  it('python_cell_returns_source_unchanged', () => {
    const cell: ParsedCell = {
      source: 'print("hello")',
      cellKind: 'code',
      languageId: 'python',
      startLine: 0,
      endLine: 1,
    };

    const result = cellToDisplayFormat(cell);

    expect(result.source).toBe('print("hello")');
    expect(result.cellKind).toBe('code');
    expect(result.languageId).toBe('python');
  });

  it('sql_cell_adds_percent_percent_sql_prefix', () => {
    const cell: ParsedCell = {
      source: 'SELECT * FROM table',
      cellKind: 'code',
      languageId: 'sql',
      startLine: 0,
      endLine: 1,
    };

    const result = cellToDisplayFormat(cell);

    expect(result.source).toBe('%%sql\nSELECT * FROM table');
  });

  it('shellscript_cell_adds_percent_percent_bash_prefix', () => {
    const cell: ParsedCell = {
      source: 'ls -la',
      cellKind: 'code',
      languageId: 'shellscript',
      startLine: 0,
      endLine: 1,
    };

    const result = cellToDisplayFormat(cell);

    expect(result.source).toBe('%%bash\nls -la');
  });

  it('pip_cell_does_not_add_bash_prefix', () => {
    const cell: ParsedCell = {
      source: '%pip install pandas',
      cellKind: 'code',
      languageId: 'shellscript',
      startLine: 0,
      endLine: 1,
    };

    const result = cellToDisplayFormat(cell);

    expect(result.source).toBe('%pip install pandas');
  });

  it('markdown_cell_returns_source_unchanged', () => {
    const cell: ParsedCell = {
      source: '# Title',
      cellKind: 'markup',
      languageId: 'markdown',
      startLine: 0,
      endLine: 1,
    };

    const result = cellToDisplayFormat(cell);

    expect(result.source).toBe('# Title');
    expect(result.cellKind).toBe('markup');
  });
});
