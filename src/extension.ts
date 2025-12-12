import { ExtensionContext, workspace } from 'vscode';
import { DatabricksNotebookFileSystem } from './filesystem';
import { registerCommands, initializeShadowManager } from './commands';
import { ShadowManager } from './shadowManager';
import { SCHEME } from './constants';

let fileSystem: DatabricksNotebookFileSystem | undefined;
let shadowManager: ShadowManager | undefined;

/**
 * Extension activation
 *
 * We support two modes:
 *
 * 1. FileSystemProvider (default): Uses databricks-notebook:// URI scheme.
 *    Works well for basic editing but Pylance cannot do cross-cell analysis.
 *
 * 2. Shadow Files (experimental): Creates real .ipynb files in /tmp.
 *    Enables Pylance cross-cell analysis via file:// URIs.
 *    Enable with: databricksNotebook.experimentalShadowFiles = true
 *
 * Both modes keep the original .py file as the source of truth.
 */
export function activate(context: ExtensionContext): void {
  // Initialize shadow manager (used when experimentalShadowFiles is enabled)
  shadowManager = new ShadowManager();
  context.subscriptions.push(shadowManager);
  initializeShadowManager(shadowManager);

  // Register filesystem provider (fallback when shadow files disabled)
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
  shadowManager?.dispose();
  shadowManager = undefined;
  fileSystem?.dispose();
  fileSystem = undefined;
}
