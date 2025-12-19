import { ExtensionContext, workspace } from 'vscode';
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

  console.log('Databricks Notebook extension activated');
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  fileSystem?.dispose();
  fileSystem = undefined;
}
