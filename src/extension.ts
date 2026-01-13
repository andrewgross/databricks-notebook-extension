import { ExtensionContext, workspace, languages } from 'vscode';
import { DatabricksNotebookFileSystem } from './filesystem';
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

  // Register a persistent no-op inline completion provider.
  // This fixes an issue where VS Code doesn't initialize InlineCompletionsController
  // for notebook cells with custom parent URI schemes. Having any provider registered
  // keeps the inline completion system active for our custom scheme.
  const inlineCompletionProvider = languages.registerInlineCompletionItemProvider(
    { pattern: '**/*' },
    { provideInlineCompletionItems: () => undefined }
  );
  context.subscriptions.push(inlineCompletionProvider);

  console.log('Databricks Notebook extension activated');
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  fileSystem?.dispose();
  fileSystem = undefined;
}
