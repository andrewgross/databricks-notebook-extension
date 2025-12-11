import { commands, window, Uri, ExtensionContext } from 'vscode';
import { NOTEBOOK_TYPE, SCHEME } from './constants';

/**
 * Register all extension commands
 */
export function registerCommands(context: ExtensionContext): void {
  context.subscriptions.push(
    commands.registerCommand('databricks.openAsNotebook', openAsNotebook)
  );
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

  // Create virtual notebook URI
  const notebookUri = Uri.from({
    scheme: SCHEME,
    path: uri.path,
  });

  // Open in notebook editor
  try {
    await commands.executeCommand('vscode.openWith', notebookUri, NOTEBOOK_TYPE);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void window.showErrorMessage(`Failed to open notebook: ${message}`);
  }
}
