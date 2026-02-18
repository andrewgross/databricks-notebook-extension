import { ExtensionContext, ExtensionMode, workspace, languages } from 'vscode';
import { DatabricksNotebookFileSystem } from './filesystem';
import { NotebookSyncManager } from './notebookSync';
import { registerCommands } from './commands';
import { SCHEME } from './constants';

let fileSystem: DatabricksNotebookFileSystem | undefined;

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

  // Register notebook sync manager to preserve cell outputs on external .py changes
  const isDev = context.extensionMode === ExtensionMode.Development;
  fileSystem.setDevMode(isDev);
  const syncManager = new NotebookSyncManager(fileSystem, isDev);

  context.subscriptions.push(
    workspace.onDidOpenNotebookDocument(notebook => {
      if (notebook.uri.scheme === SCHEME) {
        syncManager.register(notebook);
      }
    })
  );

  context.subscriptions.push(
    workspace.onDidCloseNotebookDocument(notebook => {
      if (notebook.uri.scheme === SCHEME) {
        syncManager.unregister(notebook);
      }
    })
  );

  context.subscriptions.push({ dispose: () => syncManager.dispose() });

  // Register a persistent no-op inline completion provider.
  // This fixes an issue where VS Code doesn't initialize InlineCompletionsController
  // for notebook cells with custom parent URI schemes. Having any provider registered
  // keeps the inline completion system active for our custom scheme.
  const inlineCompletionProvider = languages.registerInlineCompletionItemProvider(
    { pattern: '**/*' },
    { provideInlineCompletionItems: () => undefined }
  );
  context.subscriptions.push(inlineCompletionProvider);

  if (isDev) {
    console.log('[DEV] Databricks Notebook extension activated');
  }
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  fileSystem?.dispose();
  fileSystem = undefined;
}
