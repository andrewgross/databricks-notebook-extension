import { ExtensionContext, workspace } from 'vscode';
import { DatabricksNotebookSerializer } from './serializer';
import { DatabricksNotebookFileSystem } from './filesystem';
import { registerCommands } from './commands';
import { NOTEBOOK_TYPE, SCHEME } from './constants';

let fileSystem: DatabricksNotebookFileSystem | undefined;

/**
 * Extension activation
 */
export function activate(context: ExtensionContext): void {
  // Register notebook serializer
  context.subscriptions.push(
    workspace.registerNotebookSerializer(
      NOTEBOOK_TYPE,
      new DatabricksNotebookSerializer(),
      { transientOutputs: true }
    )
  );

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
