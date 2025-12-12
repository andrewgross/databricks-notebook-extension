/**
 * Shadow File Manager
 *
 * Manages ephemeral shadow .ipynb files that enable Pylance cross-cell analysis.
 * The .py file is always the source of truth; shadows are derived state.
 *
 * User-facing messages always reference the .py file since users don't need
 * to know about the shadow file implementation.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as crypto from 'crypto';
import { pyToIpynb, ipynbToPy } from './ipynbConverter';
import { parseNotebook } from './parser';
import { ParsedCell } from './types';
import { NOTEBOOK_TYPE } from './constants';

/**
 * Metadata stored in shadow .ipynb for crash recovery
 */
interface ShadowMetadata {
  original_path: string;
  original_hash: string;
  session_id: string;
  created_at: string;
}

/**
 * Minimal notebook structure for shadow metadata injection
 */
interface NotebookWithMetadata {
  metadata: {
    databricks_shadow?: ShadowMetadata;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Tracks state for an open notebook
 */
interface WatchedNotebook {
  pyUri: vscode.Uri;
  shadowUri: vscode.Uri;
  lastKnownPyHash: string;
  isReadOnly: boolean;
  watcher: vscode.FileSystemWatcher;
}

/**
 * Debounce state for file watcher events
 */
interface PendingChange {
  timeout: NodeJS.Timeout;
  pyUri: vscode.Uri;
}

/**
 * Manages shadow files for Databricks notebooks
 */
export class ShadowManager implements vscode.Disposable {
  private readonly sessionId: string;
  private readonly shadowBaseDir: string;
  private readonly watchedNotebooks = new Map<string, WatchedNotebook>();
  private readonly pendingChanges = new Map<string, PendingChange>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly statusBarItem: vscode.StatusBarItem;

  /** Debounce delay for file watcher events (ms) */
  private static readonly DEBOUNCE_MS = 200;

  constructor() {
    this.sessionId = crypto.randomBytes(4).toString('hex');
    this.shadowBaseDir = path.join(os.tmpdir(), `databricks-notebooks-${this.sessionId}`);

    // Create status bar item for read-only indicator
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = 'databricks.reloadNotebook';
    this.disposables.push(this.statusBarItem);

    // Register save handler
    this.disposables.push(
      vscode.workspace.onDidSaveNotebookDocument(doc => this.handleNotebookSaved(doc))
    );

    // Register close handler
    this.disposables.push(
      vscode.workspace.onDidCloseNotebookDocument(doc => this.handleNotebookClosed(doc))
    );

    // Update status bar when active editor changes and check for external changes
    this.disposables.push(
      vscode.window.onDidChangeActiveNotebookEditor(editor => {
        this.updateStatusBar(editor?.notebook);
        // Check for external changes when notebook tab becomes active
        if (editor?.notebook) {
          void this.checkForExternalChanges(editor.notebook);
        }
      })
    );
  }

  /**
   * Open a .py file as a notebook using shadow files
   */
  async openAsNotebook(pyUri: vscode.Uri): Promise<void> {
    // Check if already open
    const existing = this.findNotebookForPy(pyUri);
    if (existing) {
      await vscode.window.showNotebookDocument(existing);
      return;
    }

    // Generate shadow file
    const shadowUri = this.getShadowUri(pyUri);
    const pyHash = await this.generateShadow(pyUri, shadowUri);

    // Set up file watcher on the .py file
    const watcher = this.createPyWatcher(pyUri);

    // Track this notebook
    this.watchedNotebooks.set(shadowUri.toString(), {
      pyUri,
      shadowUri,
      lastKnownPyHash: pyHash,
      isReadOnly: false,
      watcher,
    });

    // Open the shadow file as a notebook
    await vscode.commands.executeCommand('vscode.openWith', shadowUri, NOTEBOOK_TYPE);
  }

  /**
   * Reload notebook from disk, preserving outputs for unchanged cells.
   * Returns true if reload was successful.
   */
  async reloadNotebook(shadowUri?: vscode.Uri): Promise<boolean> {
    // Get shadow URI from active editor if not provided
    if (!shadowUri) {
      const activeNotebook = vscode.window.activeNotebookEditor?.notebook;
      if (activeNotebook) {
        shadowUri = activeNotebook.uri;
      }
    }

    if (!shadowUri) {
      return false;
    }

    const watched = this.watchedNotebooks.get(shadowUri.toString());
    if (!watched) {
      return false;
    }

    const notebook = this.findOpenNotebook(watched.shadowUri);
    if (!notebook) {
      return false;
    }

    const pyFileName = path.basename(watched.pyUri.fsPath);

    try {
      // Read and parse new .py content
      const pyContent = await vscode.workspace.fs.readFile(watched.pyUri);
      const pyText = new TextDecoder().decode(pyContent);
      const parsed = parseNotebook(pyText);

      // Build edits that preserve outputs for unchanged cells
      const edit = new vscode.WorkspaceEdit();
      const notebookEdits = this.buildPreservingEdits(notebook, parsed.cells);

      // Apply edits
      edit.set(notebook.uri, notebookEdits);
      const success = await vscode.workspace.applyEdit(edit);

      if (success) {
        // Update shadow file to match new content
        await this.generateShadow(watched.pyUri, watched.shadowUri);
        watched.lastKnownPyHash = this.computeHash(pyContent);
        watched.isReadOnly = false;
        this.updateStatusBar(notebook);
      }

      return success;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to reload ${pyFileName}: ${message}`
      );
      return false;
    }
  }

  /**
   * Build notebook edits that preserve outputs for cells with matching content.
   * Uses content-based matching to map old cells to new cells.
   */
  private buildPreservingEdits(
    notebook: vscode.NotebookDocument,
    newCells: ParsedCell[]
  ): vscode.NotebookEdit[] {
    const oldCells = notebook.getCells();

    // Build a map of old cell content -> cell data (including outputs)
    // Use a multimap since the same content could appear multiple times
    const oldCellsByContent = new Map<string, vscode.NotebookCell[]>();
    for (const cell of oldCells) {
      const content = cell.document.getText();
      const existing = oldCellsByContent.get(content) || [];
      existing.push(cell);
      oldCellsByContent.set(content, existing);
    }

    // Track which old cells we've used (to handle duplicates correctly)
    const usedOldCells = new Set<vscode.NotebookCell>();

    // Build new notebook cells, preserving outputs where content matches
    const newNotebookCells: vscode.NotebookCellData[] = newCells.map(newCell => {
      const cellKind = newCell.cellKind === 'markup'
        ? vscode.NotebookCellKind.Markup
        : vscode.NotebookCellKind.Code;

      const cellData = new vscode.NotebookCellData(
        cellKind,
        newCell.source,
        newCell.languageId
      );

      // Try to find a matching old cell to preserve its outputs
      const matchingOldCells = oldCellsByContent.get(newCell.source);
      if (matchingOldCells) {
        // Find first unused matching cell
        const unusedMatch = matchingOldCells.find(c => !usedOldCells.has(c));
        if (unusedMatch) {
          usedOldCells.add(unusedMatch);

          // Copy outputs and execution summary
          if (unusedMatch.outputs.length > 0) {
            cellData.outputs = unusedMatch.outputs.map(output =>
              new vscode.NotebookCellOutput(
                output.items.map(item =>
                  new vscode.NotebookCellOutputItem(item.data, item.mime)
                ),
                output.metadata
              )
            );
          }
          if (unusedMatch.executionSummary) {
            cellData.executionSummary = {
              executionOrder: unusedMatch.executionSummary.executionOrder,
              success: unusedMatch.executionSummary.success,
              timing: unusedMatch.executionSummary.timing
            };
          }
        }
      }

      return cellData;
    });

    // Replace all cells with new cells
    return [
      vscode.NotebookEdit.replaceCells(
        new vscode.NotebookRange(0, oldCells.length),
        newNotebookCells
      )
    ];
  }

  /**
   * Check for external changes when notebook tab becomes active.
   * Silently reloads if no unsaved changes, otherwise prompts user.
   */
  private async checkForExternalChanges(notebook: vscode.NotebookDocument): Promise<void> {
    const watched = this.watchedNotebooks.get(notebook.uri.toString());
    if (!watched || watched.isReadOnly) {
      return; // Not our notebook or already marked read-only
    }

    // Read current .py content
    let currentPyContent: Uint8Array;
    try {
      currentPyContent = await vscode.workspace.fs.readFile(watched.pyUri);
    } catch {
      return; // File might be temporarily unavailable
    }

    const currentHash = this.computeHash(currentPyContent);

    // Check if file actually changed
    if (currentHash === watched.lastKnownPyHash) {
      return; // No changes
    }

    const pyFileName = path.basename(watched.pyUri.fsPath);

    // Check if notebook has unsaved changes
    if (notebook.isDirty) {
      // Has unsaved changes - must prompt user
      const choice = await vscode.window.showWarningMessage(
        `${pyFileName} changed on disk, but you have unsaved edits. ` +
        `What would you like to do?`,
        { modal: true },
        'Discard my edits and reload',
        'Keep my edits (read-only)'
      );

      if (choice === 'Discard my edits and reload') {
        await this.reloadNotebook(watched.shadowUri);
      } else {
        watched.isReadOnly = true;
        this.updateStatusBar(notebook);
        void vscode.window.showInformationMessage(
          `Notebook is now read-only. Reload from disk to continue editing.`
        );
      }
    } else {
      // No unsaved changes - auto-reload with smart merge to preserve outputs
      const success = await this.reloadNotebook(watched.shadowUri);
      if (success) {
        void vscode.window.showInformationMessage(
          `${pyFileName} updated from disk. Cell outputs preserved where possible.`
        );
      }
    }
  }

  /**
   * Check if a URI is a shadow file managed by this extension
   */
  isShadowFile(uri: vscode.Uri): boolean {
    return uri.fsPath.startsWith(this.shadowBaseDir);
  }

  /**
   * Get the .py URI for a shadow file
   */
  getPyUriForShadow(shadowUri: vscode.Uri): vscode.Uri | undefined {
    return this.watchedNotebooks.get(shadowUri.toString())?.pyUri;
  }

  dispose(): void {
    // Clean up all watchers
    for (const watched of this.watchedNotebooks.values()) {
      watched.watcher.dispose();
    }
    this.watchedNotebooks.clear();

    // Clear pending debounce timers
    for (const pending of this.pendingChanges.values()) {
      clearTimeout(pending.timeout);
    }
    this.pendingChanges.clear();

    // Dispose other resources
    for (const disposable of this.disposables) {
      disposable.dispose();
    }

    // Note: We don't delete shadow files here - OS will clean /tmp on reboot
    // This also allows crash recovery if VS Code restarts
  }

  // ============================================================
  // Private: Shadow Path Management
  // ============================================================

  /**
   * Compute shadow URI for a .py file
   */
  private getShadowUri(pyUri: vscode.Uri): vscode.Uri {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(pyUri);
    let relativePath: string;

    if (workspaceFolder) {
      // Hash workspace root for uniqueness
      const workspaceHash = crypto
        .createHash('sha256')
        .update(workspaceFolder.uri.fsPath)
        .digest('hex')
        .slice(0, 8);

      relativePath = path.relative(workspaceFolder.uri.fsPath, pyUri.fsPath);
      const shadowPath = path.join(
        this.shadowBaseDir,
        workspaceHash,
        relativePath.replace(/\.py$/, '.ipynb')
      );
      return vscode.Uri.file(shadowPath);
    }

    // No workspace - use full path hash
    const pathHash = crypto
      .createHash('sha256')
      .update(pyUri.fsPath)
      .digest('hex')
      .slice(0, 16);

    const fileName = path.basename(pyUri.fsPath, '.py') + '.ipynb';
    const shadowPath = path.join(this.shadowBaseDir, 'standalone', pathHash, fileName);
    return vscode.Uri.file(shadowPath);
  }

  // ============================================================
  // Private: Shadow File Generation
  // ============================================================

  /**
   * Generate shadow .ipynb from .py file
   * Returns the hash of the .py content for change detection
   */
  private async generateShadow(pyUri: vscode.Uri, shadowUri: vscode.Uri): Promise<string> {
    // Read .py file
    const pyContent = await vscode.workspace.fs.readFile(pyUri);
    const pyText = new TextDecoder().decode(pyContent);
    const pyHash = this.computeHash(pyContent);

    // Convert to ipynb JSON
    let ipynbJson = pyToIpynb(pyText);

    // Add shadow metadata for crash recovery
    const notebook = JSON.parse(ipynbJson) as NotebookWithMetadata;
    notebook.metadata.databricks_shadow = {
      original_path: pyUri.fsPath,
      original_hash: pyHash,
      session_id: this.sessionId,
      created_at: new Date().toISOString(),
    } satisfies ShadowMetadata;
    ipynbJson = JSON.stringify(notebook, null, 1);

    // Ensure shadow directory exists
    const shadowDir = path.dirname(shadowUri.fsPath);
    await fs.promises.mkdir(shadowDir, { recursive: true });

    // Write shadow file
    await fs.promises.writeFile(shadowUri.fsPath, ipynbJson, 'utf8');

    return pyHash;
  }

  // ============================================================
  // Private: Save Handling
  // ============================================================

  /**
   * Handle notebook save - write back to .py file
   */
  private async handleNotebookSaved(notebook: vscode.NotebookDocument): Promise<void> {
    const watched = this.watchedNotebooks.get(notebook.uri.toString());
    if (!watched) {
      return; // Not our notebook
    }

    if (watched.isReadOnly) {
      // This shouldn't happen if UI properly prevents saves, but guard anyway
      void vscode.window.showWarningMessage(
        `Cannot save: ${path.basename(watched.pyUri.fsPath)} has been modified externally. ` +
        `Reload from disk to continue editing.`
      );
      return;
    }

    const pyFileName = path.basename(watched.pyUri.fsPath);

    try {
      // Read the saved shadow content
      const shadowContent = await fs.promises.readFile(notebook.uri.fsPath, 'utf8');

      // Validate JSON before proceeding
      try {
        JSON.parse(shadowContent);
      } catch {
        void vscode.window.showErrorMessage(
          `Failed to save ${pyFileName}: Internal error (invalid notebook data)`
        );
        return;
      }

      // Convert to .py format
      const pyText = ipynbToPy(shadowContent);
      const pyContent = new TextEncoder().encode(pyText);
      const newPyHash = this.computeHash(pyContent);

      // Race condition check: verify .py hasn't changed since we last read it
      const currentPyContent = await vscode.workspace.fs.readFile(watched.pyUri);
      const currentPyHash = this.computeHash(currentPyContent);

      if (currentPyHash !== watched.lastKnownPyHash) {
        // External change detected during save
        const choice = await vscode.window.showWarningMessage(
          `${pyFileName} was modified while you were editing. ` +
          `Saving will overwrite those changes.`,
          { modal: true },
          'Overwrite',
          'Cancel'
        );

        if (choice !== 'Overwrite') {
          void vscode.window.showInformationMessage(
            `Save cancelled. ${pyFileName} was not modified.`
          );
          return;
        }
      }

      // Atomic write: write to temp file, then rename
      const tempPath = `${watched.pyUri.fsPath}.tmp.${Date.now()}`;
      await fs.promises.writeFile(tempPath, pyText, 'utf8');
      await fs.promises.rename(tempPath, watched.pyUri.fsPath);

      // Update our tracking
      watched.lastKnownPyHash = newPyHash;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `Failed to save ${pyFileName}: ${message}`
      );
    }
  }

  // ============================================================
  // Private: File Watching
  // ============================================================

  /**
   * Create a file watcher for external changes to the .py file
   */
  private createPyWatcher(pyUri: vscode.Uri): vscode.FileSystemWatcher {
    const pattern = new vscode.RelativePattern(
      vscode.Uri.file(path.dirname(pyUri.fsPath)),
      path.basename(pyUri.fsPath)
    );

    const watcher = vscode.workspace.createFileSystemWatcher(pattern);

    watcher.onDidChange(() => this.debouncedHandlePyChange(pyUri));
    watcher.onDidDelete(() => this.handlePyDeleted(pyUri));

    return watcher;
  }

  /**
   * Debounce rapid file change events (e.g., from git operations)
   */
  private debouncedHandlePyChange(pyUri: vscode.Uri): void {
    const key = pyUri.toString();

    // Clear any pending check
    const pending = this.pendingChanges.get(key);
    if (pending) {
      clearTimeout(pending.timeout);
    }

    // Schedule new check
    const timeout = setTimeout(() => {
      this.pendingChanges.delete(key);
      void this.handlePyChanged(pyUri);
    }, ShadowManager.DEBOUNCE_MS);

    this.pendingChanges.set(key, { timeout, pyUri });
  }

  /**
   * Handle external changes to the .py file
   */
  private async handlePyChanged(pyUri: vscode.Uri): Promise<void> {
    // Find the watched notebook for this .py file
    const watched = this.findWatchedByPy(pyUri);
    if (!watched) {
      return;
    }

    const pyFileName = path.basename(pyUri.fsPath);

    // Read current .py content and check hash
    let currentPyContent: Uint8Array;
    try {
      currentPyContent = await vscode.workspace.fs.readFile(pyUri);
    } catch {
      // File might be temporarily unavailable during git operations
      return;
    }

    const currentHash = this.computeHash(currentPyContent);

    // Check if we caused this change (our save)
    if (currentHash === watched.lastKnownPyHash) {
      return;
    }

    // External change detected - find the notebook
    const notebook = this.findOpenNotebook(watched.shadowUri);
    if (!notebook) {
      // Notebook was closed - update hash and return
      watched.lastKnownPyHash = currentHash;
      return;
    }

    // Check if notebook has unsaved changes
    const hasUnsavedChanges = notebook.isDirty;

    if (hasUnsavedChanges) {
      // Notebook has unsaved changes - more complex decision
      const choice = await vscode.window.showWarningMessage(
        `${pyFileName} changed on disk, but you have unsaved edits in the notebook. ` +
        `What would you like to do?`,
        { modal: true },
        'Discard my edits and reload',
        'Keep my edits (read-only)'
      );

      if (choice === 'Discard my edits and reload') {
        // Use smart reload to preserve outputs where possible
        await this.reloadNotebook(watched.shadowUri);
      } else {
        // Keep edits but mark read-only to prevent accidental overwrite
        watched.isReadOnly = true;
        this.updateStatusBar(notebook);
        void vscode.window.showInformationMessage(
          `Notebook is now read-only. Your edits are preserved but cannot be saved ` +
          `until you reload from disk.`
        );
      }
    } else {
      // No unsaved changes - auto-reload with smart merge to preserve outputs
      const success = await this.reloadNotebook(watched.shadowUri);
      if (success) {
        void vscode.window.showInformationMessage(
          `${pyFileName} updated from disk. Cell outputs preserved where possible.`
        );
      }
    }
  }

  /**
   * Handle .py file deletion
   */
  private async handlePyDeleted(pyUri: vscode.Uri): Promise<void> {
    const watched = this.findWatchedByPy(pyUri);
    if (!watched) {
      return;
    }

    const pyFileName = path.basename(pyUri.fsPath);

    // Mark as read-only
    watched.isReadOnly = true;

    const notebook = this.findOpenNotebook(watched.shadowUri);
    if (notebook) {
      this.updateStatusBar(notebook);
    }

    const choice = await vscode.window.showWarningMessage(
      `${pyFileName} was deleted. The notebook is now read-only. ` +
      `You can copy your code but cannot save changes.`,
      'Close notebook',
      'Keep open (read-only)'
    );

    if (choice === 'Close notebook') {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  }

  /**
   * Handle notebook close
   */
  private handleNotebookClosed(notebook: vscode.NotebookDocument): void {
    const watched = this.watchedNotebooks.get(notebook.uri.toString());
    if (!watched) {
      return;
    }

    // Clean up watcher
    watched.watcher.dispose();

    // Clear any pending change timers
    const pendingKey = watched.pyUri.toString();
    const pending = this.pendingChanges.get(pendingKey);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingChanges.delete(pendingKey);
    }

    // Remove from tracking
    this.watchedNotebooks.delete(notebook.uri.toString());

    // Update status bar if needed
    this.updateStatusBar(undefined);
  }

  // ============================================================
  // Private: Status Bar
  // ============================================================

  /**
   * Update status bar to reflect current notebook state
   */
  private updateStatusBar(notebook: vscode.NotebookDocument | undefined): void {
    if (!notebook) {
      this.statusBarItem.hide();
      return;
    }

    const watched = this.watchedNotebooks.get(notebook.uri.toString());
    if (!watched) {
      this.statusBarItem.hide();
      return;
    }

    if (watched.isReadOnly) {
      const pyFileName = path.basename(watched.pyUri.fsPath);
      this.statusBarItem.text = '$(lock) Read-only';
      this.statusBarItem.tooltip = `${pyFileName} changed externally. Click to reload.`;
      this.statusBarItem.backgroundColor = new vscode.ThemeColor(
        'statusBarItem.warningBackground'
      );
      this.statusBarItem.show();
    } else {
      this.statusBarItem.hide();
    }
  }

  // ============================================================
  // Private: Utilities
  // ============================================================

  /**
   * Compute SHA256 hash of content
   */
  private computeHash(content: Uint8Array): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Find an open notebook document by its shadow URI
   */
  private findOpenNotebook(shadowUri: vscode.Uri): vscode.NotebookDocument | undefined {
    return vscode.workspace.notebookDocuments.find(
      doc => doc.uri.toString() === shadowUri.toString()
    );
  }

  /**
   * Find an open notebook by its original .py URI
   */
  private findNotebookForPy(pyUri: vscode.Uri): vscode.NotebookDocument | undefined {
    for (const watched of this.watchedNotebooks.values()) {
      if (watched.pyUri.toString() === pyUri.toString()) {
        return this.findOpenNotebook(watched.shadowUri);
      }
    }
    return undefined;
  }

  /**
   * Find watched notebook entry by .py URI
   */
  private findWatchedByPy(pyUri: vscode.Uri): WatchedNotebook | undefined {
    for (const watched of this.watchedNotebooks.values()) {
      if (watched.pyUri.toString() === pyUri.toString()) {
        return watched;
      }
    }
    return undefined;
  }
}
