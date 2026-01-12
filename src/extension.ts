import { ExtensionContext, workspace, window, languages } from 'vscode';
import { DatabricksNotebookFileSystem } from './filesystem';
import { registerCommands } from './commands';
import { SCHEME } from './constants';

let fileSystem: DatabricksNotebookFileSystem | undefined;

// Track notebooks that have been kicked to avoid repeated initialization
const kickedNotebooks = new Set<string>();

/**
 * Extension activation
 *
 * Uses a FileSystemProvider with databricks-notebook:// URI scheme to
 * open Databricks .py notebooks in VS Code's Notebook Editor.
 * The original .py file remains the source of truth.
 */
export function activate(context: ExtensionContext): void {
  // Register filesystem provider
  fileSystem = new DatabricksNotebookFileSystem();
  context.subscriptions.push(
    workspace.registerFileSystemProvider(SCHEME, fileSystem, {
      isCaseSensitive: true,
    })
  );
  context.subscriptions.push(fileSystem);

  // Register commands
  registerCommands(context);

  // Auto-kick inline completions for Databricks notebook cells
  // This fixes an issue where VS Code doesn't initialize InlineCompletionsController
  // for notebook cells with custom parent URI schemes
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((editor) => {
      if (!editor) return;

      const uri = editor.document.uri;
      if (uri.scheme !== 'vscode-notebook-cell') return;

      // Decode fragment to check parent notebook scheme
      // Fragment format: W<cell-handle>s<base64-encoded-parent-scheme>
      const fragment = uri.fragment;
      const idx = fragment.indexOf('s');
      if (idx === -1) return;

      const encodedScheme = fragment.substring(idx + 1);
      let parentScheme: string;
      try {
        parentScheme = Buffer.from(encodedScheme, 'base64').toString('utf-8');
      } catch {
        return;
      }

      if (parentScheme !== SCHEME) return;

      // Only kick once per notebook
      const notebookKey = uri.path;
      if (kickedNotebooks.has(notebookKey)) return;

      // Briefly register and dispose a no-op provider to trigger initialization
      const provider = languages.registerInlineCompletionItemProvider(
        { pattern: '**/*' },
        { provideInlineCompletionItems: () => undefined }
      );
      provider.dispose();

      kickedNotebooks.add(notebookKey);
      console.log(`Databricks: Kicked inline completions for ${notebookKey}`);
    })
  );

  console.log('Databricks Notebook extension activated');
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  fileSystem?.dispose();
  fileSystem = undefined;
  kickedNotebooks.clear();
}
