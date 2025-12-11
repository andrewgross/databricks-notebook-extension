import { ExtensionContext, workspace } from 'vscode';
import { DatabricksNotebookFileSystem } from './filesystem';
import { registerCommands } from './commands';
import { SCHEME } from './constants';

let fileSystem: DatabricksNotebookFileSystem | undefined;

/**
 * Extension activation
 *
 * We do NOT register a NotebookSerializer because VS Code's built-in ipynb
 * extension already provides one for 'jupyter-notebook' type. Instead, our
 * FileSystemProvider transforms between .py and .ipynb formats, letting the
 * built-in serializer handle the actual notebook parsing.
 *
 * This approach gives us Jupyter kernel support without conflicting with
 * the built-in serializer registration.
 */
export function activate(context: ExtensionContext): void {
  // Register filesystem provider that transforms .py <-> .ipynb
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
