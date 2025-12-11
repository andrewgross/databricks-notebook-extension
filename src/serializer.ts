import {
  NotebookSerializer,
  NotebookData,
  NotebookCellData,
  NotebookCellKind,
  CancellationToken,
} from 'vscode';
import { parseNotebook, serializeNotebook } from './parser';
import { NotebookFormat, ParsedCell } from './types';

/**
 * Metadata stored with each notebook to preserve original format
 */
interface NotebookMetadata {
  format: NotebookFormat;
  hasDatabricksHeader: boolean;
}

/**
 * VS Code NotebookSerializer implementation for Databricks notebooks
 */
export class DatabricksNotebookSerializer implements NotebookSerializer {
  /**
   * Called when opening a notebook file
   */
  deserializeNotebook(
    content: Uint8Array,
    _token: CancellationToken
  ): NotebookData {
    const text = new TextDecoder().decode(content);
    const parsed = parseNotebook(text);

    const cells = parsed.cells.map(cell =>
      new NotebookCellData(
        cell.cellKind === 'markup' ? NotebookCellKind.Markup : NotebookCellKind.Code,
        cell.source,
        cell.languageId
      )
    );

    const notebookData = new NotebookData(cells);

    // Store format info in metadata so we can preserve it on save
    notebookData.metadata = {
      format: parsed.format,
      hasDatabricksHeader: parsed.hasDatabricksHeader,
    } satisfies NotebookMetadata;

    return notebookData;
  }

  /**
   * Called when saving a notebook file
   */
  serializeNotebook(
    data: NotebookData,
    _token: CancellationToken
  ): Uint8Array {
    const metadata = data.metadata as NotebookMetadata | undefined;
    const format = metadata?.format ?? 'databricks';
    const includeHeader = metadata?.hasDatabricksHeader ?? true;

    const cells: ParsedCell[] = data.cells.map((cell, index) => ({
      source: cell.value,
      cellKind: cell.kind === NotebookCellKind.Markup ? 'markup' : 'code',
      languageId: cell.languageId as ParsedCell['languageId'],
      startLine: index,
      endLine: index + 1,
    }));

    const content = serializeNotebook(cells, format, includeHeader);
    return new TextEncoder().encode(content);
  }
}
