import {
  FileSystemProvider,
  Uri,
  FileType,
  FileStat,
  FileChangeEvent,
  FileChangeType,
  EventEmitter,
  Disposable,
  NotebookCellKind,
  workspace,
} from 'vscode';
import { pyToIpynb, ipynbToPy } from './ipynbConverter';
import { computeCellDiff, cellToDisplayFormat } from './cellDiff';
import { parseNotebook } from './parser';

/** Minimal ipynb cell structure for output merging */
interface IpynbCellForMerge {
  outputs?: unknown[];
  execution_count?: number | null;
  [key: string]: unknown;
}

/** Minimal ipynb structure for output merging */
interface IpynbForMerge {
  cells: IpynbCellForMerge[];
  [key: string]: unknown;
}

/**
 * Virtual filesystem provider for databricks-notebook:// URIs
 *
 * This maps virtual notebook URIs back to real .py files on disk,
 * transforming between Databricks .py format and .ipynb JSON format.
 *
 * The transformation allows VS Code's built-in jupyter-notebook serializer
 * to handle our files, which means we get Jupyter kernel support for free.
 */
export class DatabricksNotebookFileSystem implements FileSystemProvider {
  private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly watchers = new Map<string, Disposable>();
  private readonly changeHandlers = new Map<string, (uri: Uri) => void>();
  private log: (...args: unknown[]) => void = () => {};

  /**
   * Tracks the last writeFile time per URI. Used to distinguish self-triggered
   * file changes from external edits. Timestamps expire after WRITE_GRACE_MS
   * to prevent stale entries from consuming external change events.
   *
   * Previous approach used a Set<string> which leaked entries when writeFile
   * was called multiple times between change events (OS coalesces events)
   * or when the watcher was disposed before the event fired.
   */
  private readonly lastWriteTime = new Map<string, number>();
  private readonly WRITE_GRACE_MS = 2000;

  setDevMode(enabled: boolean): void {
    this.log = enabled ? (...args: unknown[]) => console.log('[DEV] [FS]', ...args) : () => {};
  }

  /**
   * Register a change handler for a managed URI.
   * When this URI's file changes on disk, the handler is called
   * instead of firing onDidChangeFile (which would trigger a destructive reload).
   */
  setChangeHandler(uri: Uri, handler: (uri: Uri) => void): void {
    this.log('setChangeHandler', uri.toString());
    this.changeHandlers.set(uri.toString(), handler);
  }

  /**
   * Remove the change handler for a URI, reverting to default onDidChangeFile behavior.
   */
  removeChangeHandler(uri: Uri): void {
    this.changeHandlers.delete(uri.toString());
  }

  /**
   * Convert virtual URI to real file URI
   * databricks-notebook:///path/to/file.py → file:///path/to/file.py
   */
  private toRealUri(uri: Uri): Uri {
    return Uri.file(uri.path);
  }

  /**
   * Check if a change event was caused by our own writeFile within the grace period.
   */
  private isSelfWrite(key: string): boolean {
    const writeTime = this.lastWriteTime.get(key);
    if (writeTime && Date.now() - writeTime < this.WRITE_GRACE_MS) {
      this.lastWriteTime.delete(key);
      return true;
    }
    // Clean up expired entries
    if (writeTime) {
      this.lastWriteTime.delete(key);
    }
    return false;
  }

  async stat(uri: Uri): Promise<FileStat> {
    return workspace.fs.stat(this.toRealUri(uri));
  }

  /**
   * Read the .py file and transform it to .ipynb JSON format.
   * VS Code's built-in jupyter-notebook serializer will then parse the JSON.
   *
   * When a notebook is already open (managed), this merges the new .py content
   * with existing cell outputs so that VS Code's reload doesn't wipe them.
   */
  async readFile(uri: Uri): Promise<Uint8Array> {
    this.log('readFile', uri.toString());
    const pyBytes = await workspace.fs.readFile(this.toRealUri(uri));
    const pyContent = new TextDecoder().decode(pyBytes);

    // If this notebook is managed and currently open, preserve cell outputs
    if (this.changeHandlers.has(uri.toString())) {
      const notebook = workspace.notebookDocuments.find(
        nb => nb.uri.toString() === uri.toString()
      );
      if (notebook && notebook.cellCount > 0) {
        this.log('readFile preserving outputs for managed notebook');
        const merged = this.mergeWithOutputs(pyContent, notebook);
        if (merged) {
          return new TextEncoder().encode(merged);
        }
      }
    }

    // Default path: transform .py format to .ipynb JSON format (empty outputs)
    const ipynbContent = pyToIpynb(pyContent);
    return new TextEncoder().encode(ipynbContent);
  }

  /**
   * Merge new .py content with existing notebook cell outputs.
   * Returns ipynb JSON with outputs preserved for unchanged cells.
   */
  private mergeWithOutputs(
    pyContent: string,
    notebook: import('vscode').NotebookDocument
  ): string | null {
    try {
      // Parse the new .py content and generate base ipynb
      const parsed = parseNotebook(pyContent);
      const baseIpynb = JSON.parse(pyToIpynb(pyContent)) as IpynbForMerge;

      // Extract current notebook state for diffing
      const oldCells = [];
      for (let i = 0; i < notebook.cellCount; i++) {
        const cell = notebook.cellAt(i);
        oldCells.push({
          source: cell.document.getText(),
          cellKind: cell.kind === NotebookCellKind.Code ? 'code' as const : 'markup' as const,
          languageId: cell.document.languageId,
        });
      }

      const newCells = parsed.cells.map(cellToDisplayFormat);
      const diff = computeCellDiff(oldCells, newCells);

      // Apply outputs from matched cells
      for (const op of diff.operations) {
        if (op.type === 'keep' || op.type === 'modify') {
          const notebookCell = notebook.cellAt(op.oldIndex);
          const ipynbCell = baseIpynb.cells[op.newIndex];
          if (ipynbCell && notebookCell.outputs.length > 0) {
            ipynbCell.outputs = serializeOutputs(notebookCell.outputs);
            ipynbCell.execution_count = notebookCell.executionSummary?.executionOrder ?? null;
          }
        }
      }

      return JSON.stringify(baseIpynb, null, 1);
    } catch (e) {
      this.log('mergeWithOutputs failed, falling back to default', e);
      return null;
    }
  }

  /**
   * Receive .ipynb JSON from VS Code and transform it back to .py format
   * before writing to the actual file on disk.
   */
  async writeFile(
    uri: Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    this.log('writeFile', uri.toString());
    this.lastWriteTime.set(uri.toString(), Date.now());

    const ipynbContent = new TextDecoder().decode(content);

    // Transform .ipynb JSON format back to .py format
    const pyContent = ipynbToPy(ipynbContent);

    await workspace.fs.writeFile(this.toRealUri(uri), new TextEncoder().encode(pyContent));
  }

  watch(uri: Uri): Disposable {
    const key = uri.toString();
    this.log('watch called', key);

    // Don't duplicate watchers
    const existing = this.watchers.get(key);
    if (existing) {
      this.log('watch already exists for', key);
      return existing;
    }

    const realUri = this.toRealUri(uri);
    this.log('watch creating watcher for real path', realUri.fsPath);
    const watcher = workspace.createFileSystemWatcher(realUri.fsPath);

    const disposables: Disposable[] = [];

    disposables.push(
      watcher.onDidChange(() => {
        this.log('onDidChange fired', key);
        if (this.isSelfWrite(key)) {
          this.log('onDidChange skipped (self-write)');
          return;
        }

        const handler = this.changeHandlers.get(key);
        if (handler) {
          this.log('onDidChange routed to sync handler');
          handler(uri);
          return;
        }

        this.log('onDidChange firing onDidChangeFile (unmanaged)');
        this._onDidChangeFile.fire([{ type: FileChangeType.Changed, uri }]);
      })
    );

    disposables.push(
      watcher.onDidDelete(() => {
        this.log('onDidDelete fired', key);
        // Managed URIs: suppress delete events. On macOS, atomic saves
        // (write temp + rename) fire delete+create instead of change.
        // The transient delete would trigger a destructive reload.
        if (this.changeHandlers.has(key)) {
          this.log('onDidDelete suppressed (managed)');
          return;
        }

        this._onDidChangeFile.fire([{ type: FileChangeType.Deleted, uri }]);
        this.watchers.delete(key);
      })
    );

    disposables.push(
      watcher.onDidCreate(() => {
        this.log('onDidCreate fired', key);
        if (this.isSelfWrite(key)) {
          this.log('onDidCreate skipped (self-write)');
          return;
        }

        const handler = this.changeHandlers.get(key);
        if (handler) {
          this.log('onDidCreate routed to sync handler');
          handler(uri);
          return;
        }

        this.log('onDidCreate firing onDidChangeFile (unmanaged)');
        this._onDidChangeFile.fire([{ type: FileChangeType.Created, uri }]);
      })
    );

    const disposable = Disposable.from(watcher, ...disposables);
    this.watchers.set(key, disposable);

    return {
      dispose: () => {
        this.log('watch disposed', key);
        disposable.dispose();
        this.watchers.delete(key);
        this.lastWriteTime.delete(key);
      },
    };
  }

  // Required by interface but not used for our purposes
  readDirectory(_uri: Uri): [string, FileType][] {
    return [];
  }

  createDirectory(_uri: Uri): void {
    // Not supported - we only work with existing files
  }

  delete(_uri: Uri): void {
    // Not supported - delete the real file manually
  }

  rename(_oldUri: Uri, _newUri: Uri): void {
    // Not supported - rename the real file manually
  }

  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.dispose();
    }
    this.watchers.clear();
    this._onDidChangeFile.dispose();
  }
}

/**
 * Serialize VS Code NotebookCellOutput[] to ipynb output format.
 * Handles the common output types: execute_result, stream, display_data, error.
 */
function serializeOutputs(outputs: readonly import('vscode').NotebookCellOutput[]): unknown[] {
  const result: unknown[] = [];

  for (const output of outputs) {
    const items = output.items;
    if (items.length === 0) {
      continue;
    }

    // Check for stream output (stdout/stderr)
    const stdoutItem = items.find(i => i.mime === 'application/vnd.code.notebook.stdout');
    const stderrItem = items.find(i => i.mime === 'application/vnd.code.notebook.stderr');
    if (stdoutItem) {
      result.push({
        output_type: 'stream',
        name: 'stdout',
        text: splitOutputText(new TextDecoder().decode(stdoutItem.data)),
      });
      continue;
    }
    if (stderrItem) {
      result.push({
        output_type: 'stream',
        name: 'stderr',
        text: splitOutputText(new TextDecoder().decode(stderrItem.data)),
      });
      continue;
    }

    // Check for error output
    const errorItem = items.find(i => i.mime === 'application/vnd.code.notebook.error');
    if (errorItem) {
      try {
        const raw: unknown = JSON.parse(new TextDecoder().decode(errorItem.data));
        const errorData = raw as Record<string, unknown>;
        const name = typeof errorData['name'] === 'string' ? errorData['name'] : 'Error';
        const message = typeof errorData['message'] === 'string' ? errorData['message'] : '';
        const stack = typeof errorData['stack'] === 'string' ? errorData['stack'].split('\n') : [];
        result.push({
          output_type: 'error',
          ename: name,
          evalue: message,
          traceback: stack,
        });
      } catch {
        result.push({
          output_type: 'error',
          ename: 'Error',
          evalue: '',
          traceback: [],
        });
      }
      continue;
    }

    // Regular data output (execute_result / display_data)
    const data: Record<string, string[]> = {};
    for (const item of items) {
      const text = new TextDecoder().decode(item.data);
      data[item.mime] = splitOutputText(text);
    }

    result.push({
      output_type: 'execute_result',
      data,
      metadata: {},
      execution_count: null,
    });
  }

  return result;
}

/**
 * Split text into lines array for ipynb format (each line ends with \n except possibly the last).
 */
function splitOutputText(text: string): string[] {
  if (!text) {
    return [];
  }
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (i < lines.length - 1) {
      return line + '\n';
    }
    return line;
  });
}
