import {
  FileSystemProvider,
  Uri,
  FileType,
  FileStat,
  FileChangeEvent,
  FileChangeType,
  EventEmitter,
  Disposable,
  workspace,
} from 'vscode';
import { pyToIpynb, ipynbToPy } from './ipynbConverter';

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

  /**
   * Convert virtual URI to real file URI
   * databricks-notebook:///path/to/file.py → file:///path/to/file.py
   */
  private toRealUri(uri: Uri): Uri {
    return Uri.file(uri.path);
  }

  async stat(uri: Uri): Promise<FileStat> {
    return workspace.fs.stat(this.toRealUri(uri));
  }

  /**
   * Read the .py file and transform it to .ipynb JSON format.
   * VS Code's built-in jupyter-notebook serializer will then parse the JSON.
   */
  async readFile(uri: Uri): Promise<Uint8Array> {
    const pyBytes = await workspace.fs.readFile(this.toRealUri(uri));
    const pyContent = new TextDecoder().decode(pyBytes);

    // Transform .py format to .ipynb JSON format
    const ipynbContent = pyToIpynb(pyContent);

    return new TextEncoder().encode(ipynbContent);
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
    const ipynbContent = new TextDecoder().decode(content);

    // Transform .ipynb JSON format back to .py format
    const pyContent = ipynbToPy(ipynbContent);

    await workspace.fs.writeFile(this.toRealUri(uri), new TextEncoder().encode(pyContent));
  }

  watch(uri: Uri): Disposable {
    const key = uri.toString();

    // Don't duplicate watchers
    const existing = this.watchers.get(key);
    if (existing) {
      return existing;
    }

    const realUri = this.toRealUri(uri);
    const watcher = workspace.createFileSystemWatcher(realUri.fsPath);

    const disposables: Disposable[] = [];

    disposables.push(
      watcher.onDidChange(() => {
        this._onDidChangeFile.fire([{ type: FileChangeType.Changed, uri }]);
      })
    );

    disposables.push(
      watcher.onDidDelete(() => {
        this._onDidChangeFile.fire([{ type: FileChangeType.Deleted, uri }]);
        this.watchers.delete(key);
      })
    );

    disposables.push(
      watcher.onDidCreate(() => {
        this._onDidChangeFile.fire([{ type: FileChangeType.Created, uri }]);
      })
    );

    const disposable = Disposable.from(watcher, ...disposables);
    this.watchers.set(key, disposable);

    return {
      dispose: () => {
        disposable.dispose();
        this.watchers.delete(key);
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
