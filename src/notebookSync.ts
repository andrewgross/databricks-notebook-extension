import {
  workspace,
  NotebookDocument,
  NotebookEdit,
  NotebookRange,
  NotebookCellData,
  NotebookCellKind,
  WorkspaceEdit,
  Range,
  Uri,
  window,
  commands,
} from 'vscode';
import { parseNotebook } from './parser';
import { ParsedCell } from './types';
import { DatabricksNotebookFileSystem } from './filesystem';
import { SCHEME } from './constants';
import { computeCellDiff, cellToDisplayFormat, DisplayCell, DiffOperation } from './cellDiff';

/**
 * Extract DisplayCell representations from an open notebook document.
 */
function extractCellsFromNotebook(notebook: NotebookDocument): DisplayCell[] {
  const cells: DisplayCell[] = [];
  for (let i = 0; i < notebook.cellCount; i++) {
    const cell = notebook.cellAt(i);
    cells.push({
      source: cell.document.getText(),
      cellKind: cell.kind === NotebookCellKind.Code ? 'code' : 'markup',
      languageId: cell.document.languageId,
    });
  }
  return cells;
}

/**
 * Convert a ParsedCell to a NotebookCellData for insertion.
 */
function cellToNotebookCellData(cell: ParsedCell): NotebookCellData {
  const display = cellToDisplayFormat(cell);
  const kind = display.cellKind === 'code' ? NotebookCellKind.Code : NotebookCellKind.Markup;

  const languageId = cell.cellKind === 'markup' ? 'markdown' : cell.languageId;
  return new NotebookCellData(kind, display.source, languageId);
}

/**
 * Apply a cell diff to a notebook document using WorkspaceEdit.
 *
 * - 'keep' operations are no-ops (outputs preserved)
 * - 'modify' operations use TextEdit to replace cell content (outputs preserved)
 * - 'insert' operations add new cells via NotebookEdit
 * - 'delete' operations remove cells via NotebookEdit
 *
 * Operations are processed in reverse order so index shifts from
 * deletions/insertions don't affect subsequent operations.
 */
async function applyDiff(
  notebook: NotebookDocument,
  operations: DiffOperation[],
  newParsedCells: ParsedCell[]
): Promise<boolean> {
  const edit = new WorkspaceEdit();
  const notebookEdits: NotebookEdit[] = [];

  // Process in reverse for stable indices
  const reversed = [...operations].reverse();
  for (const op of reversed) {
    switch (op.type) {
      case 'keep':
        break;

      case 'modify': {
        const cell = notebook.cellAt(op.oldIndex);
        const lastLine = cell.document.lineCount - 1;
        const lastChar = cell.document.lineAt(lastLine).text.length;
        const fullRange = new Range(0, 0, lastLine, lastChar);
        edit.replace(cell.document.uri, fullRange, op.newSource);
        break;
      }

      case 'insert': {
        const cellData = cellToNotebookCellData(newParsedCells[op.newIndex]!);
        notebookEdits.push(NotebookEdit.insertCells(op.atIndex, [cellData]));
        break;
      }

      case 'delete': {
        notebookEdits.push(
          NotebookEdit.deleteCells(new NotebookRange(op.oldIndex, op.oldIndex + 1))
        );
        break;
      }
    }
  }

  if (notebookEdits.length > 0) {
    edit.set(notebook.uri, notebookEdits);
  }

  return workspace.applyEdit(edit);
}

/**
 * Manages synchronization between .py files on disk and open notebook views.
 *
 * When an external process modifies the .py file, this class intercepts the
 * file change event, computes a minimal cell diff, and applies only the
 * actual changes to the notebook -- preserving cell outputs and execution state.
 */
export class NotebookSyncManager {
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly DEBOUNCE_MS = 300;

  private log: (...args: unknown[]) => void;

  constructor(private filesystem: DatabricksNotebookFileSystem, devMode = false) {
    this.log = devMode ? (...args: unknown[]) => console.log('[DEV] [NotebookSync]', ...args) : () => {};
  }

  register(notebook: NotebookDocument): void {
    if (notebook.uri.scheme !== SCHEME) {
      return;
    }

    this.log('register', notebook.uri.toString());
    this.filesystem.setChangeHandler(
      notebook.uri,
      (uri) => this.onFileChanged(uri)
    );
  }

  unregister(notebook: NotebookDocument): void {
    if (notebook.uri.scheme !== SCHEME) {
      return;
    }

    const key = notebook.uri.toString();
    const timer = this.debounceTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(key);
    }

    this.log('unregister', notebook.uri.toString());
    this.filesystem.removeChangeHandler(notebook.uri);
  }

  private onFileChanged(uri: Uri): void {
    const key = uri.toString();
    const existing = this.debounceTimers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(key, setTimeout(() => {
      this.debounceTimers.delete(key);
      void this.syncNotebook(uri);
    }, this.DEBOUNCE_MS));
  }

  private async syncNotebook(uri: Uri): Promise<void> {
    const notebook = workspace.notebookDocuments.find(
      nb => nb.uri.toString() === uri.toString()
    );
    if (!notebook) {
      this.log('sync skipped, notebook not found for', uri.toString());
      return;
    }

    this.log('syncing', uri.toString());

    if (notebook.isDirty) {
      const choice = await window.showWarningMessage(
        'The .py file changed on disk, but this notebook has unsaved changes.',
        'Reload from disk',
        'Keep my changes'
      );
      if (choice === 'Reload from disk') {
        await commands.executeCommand('workbench.action.files.revert');
      }
      return;
    }

    // Read new .py content from the real file
    const realUri = Uri.file(uri.path);
    const pyBytes = await workspace.fs.readFile(realUri);
    const pyContent = new TextDecoder().decode(pyBytes);

    // Parse into cells
    const parsed = parseNotebook(pyContent);

    // Extract current notebook cells for comparison
    const oldCells = extractCellsFromNotebook(notebook);

    // Convert new parsed cells to display format (with %%sql etc.)
    const newCells = parsed.cells.map(cellToDisplayFormat);

    // Compute diff
    const diff = computeCellDiff(oldCells, newCells);

    // Apply if there are actual changes
    const hasChanges = diff.operations.some(op => op.type !== 'keep');
    if (hasChanges) {
      const summary = diff.operations.reduce((acc, op) => {
        acc[op.type] = (acc[op.type] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      this.log('applying diff:', summary);
      await applyDiff(notebook, diff.operations, parsed.cells);
    } else {
      this.log('no changes detected');
    }
  }

  dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }
}
