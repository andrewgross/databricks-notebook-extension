import { commands, window, Uri, ExtensionContext, workspace } from 'vscode';
import { NOTEBOOK_TYPE, SCHEME } from './constants';
import { ShadowManager } from './shadowManager';

let shadowManager: ShadowManager | undefined;

/**
 * Initialize the shadow manager
 */
export function initializeShadowManager(manager: ShadowManager): void {
  shadowManager = manager;
}

/**
 * Register all extension commands
 */
export function registerCommands(context: ExtensionContext): void {
  context.subscriptions.push(
    commands.registerCommand('databricks.openAsNotebook', openAsNotebook),
    commands.registerCommand('databricks.reloadNotebook', reloadNotebook)
  );
}

/**
 * Check if shadow files feature is enabled
 */
function useShadowFiles(): boolean {
  return workspace
    .getConfiguration('databricksNotebook')
    .get<boolean>('experimentalShadowFiles', false);
}

/**
 * Open the current file or selected file as a Databricks notebook
 */
async function openAsNotebook(uri?: Uri): Promise<void> {
  // Get URI from context menu or active editor
  uri = uri ?? window.activeTextEditor?.document.uri;

  if (!uri) {
    void window.showErrorMessage('No file selected');
    return;
  }

  // Verify it's a Python file
  if (!uri.fsPath.endsWith('.py')) {
    void window.showErrorMessage('Not a Python file');
    return;
  }

  // Use shadow file approach if enabled
  if (useShadowFiles() && shadowManager) {
    try {
      await shadowManager.openAsNotebook(uri);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void window.showErrorMessage(`Failed to open notebook: ${message}`);
    }
    return;
  }

  // Fall back to FileSystemProvider approach
  const notebookUri = Uri.from({
    scheme: SCHEME,
    path: uri.path,
  });

  try {
    await commands.executeCommand('vscode.openWith', notebookUri, NOTEBOOK_TYPE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void window.showErrorMessage(`Failed to open notebook: ${message}`);
  }
}

/**
 * Reload the current notebook from disk
 */
async function reloadNotebook(): Promise<void> {
  if (!shadowManager) {
    void window.showErrorMessage('Shadow files not enabled');
    return;
  }

  await shadowManager.reloadNotebook();
}
