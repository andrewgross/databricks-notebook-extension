# Shadow .ipynb Files Specification

## Overview

This document specifies an approach to enable Pylance cross-cell type checking for Databricks notebooks by using ephemeral shadow `.ipynb` files with `file://` URI scheme.

## Problem Statement

The current implementation uses a custom `databricks-notebook://` URI scheme via `FileSystemProvider`. While this enables full Jupyter notebook functionality, Pylance cannot perform cross-cell analysis because:

1. Pylance requires synchronous file I/O, but `FileSystemProvider` is async
2. Pylance has hardcoded support for `file://` scheme only
3. Cell URIs embed the notebook's scheme, so cells inherit the `databricks-notebook://` scheme

This results in imports from one cell not being recognized in subsequent cells.

## Solution

Create ephemeral shadow `.ipynb` files in `/tmp` with `file://` URIs. The original `.py` file remains the source of truth, with the shadow being derived state that is always regenerable.

## Architecture

### Current Flow (FileSystemProvider)

```
foo.py (Databricks format)
    ↓
databricks-notebook:///path/to/foo.py
    ↓
FileSystemProvider.readFile() → returns ipynb JSON
    ↓
VS Code jupyter-notebook serializer parses JSON
    ↓
Cell URIs: vscode-notebook-cell:///databricks-notebook/...
    ↓
Pylance: ❌ Cannot analyze (custom scheme)
```

### New Flow (Shadow Files)

```
foo.py (Databricks format)
    ↓
Extension generates: /tmp/databricks-notebooks-<session>/.../foo.ipynb
    ↓
Extension opens: file:///tmp/databricks-notebooks-<session>/.../foo.ipynb
    ↓
VS Code jupyter-notebook serializer parses JSON
    ↓
Cell URIs: vscode-notebook-cell:///tmp/databricks-notebooks-<session>/.../foo.ipynb#...
    ↓
Pylance: ✅ Cross-cell analysis works (file:// scheme)
```

## Shadow File Location

### Path Structure

```
/tmp/databricks-notebooks-<session-id>/
  └── <workspace-path-hash>/
      └── <relative-path>/
          └── <filename>.ipynb
```

### Components

| Component | Description | Example |
|-----------|-------------|---------|
| Base | System temp directory | `/tmp/` (macOS/Linux) or `%TEMP%` (Windows) |
| Namespace | Extension identifier with session | `databricks-notebooks-a1b2c3d4` |
| Workspace Hash | First 8 chars of SHA256 of workspace root | `e5f6a7b8/` |
| Relative Path | Path from workspace root to file | `notebooks/analysis/` |
| Filename | Original filename with .ipynb extension | `foo.ipynb` |

### Session ID

The session ID is a random identifier generated when the extension activates. This prevents conflicts when multiple VS Code windows are open.

```typescript
const sessionId = crypto.randomBytes(4).toString('hex'); // e.g., "a1b2c3d4"
```

### Example

```
Original file:
  /Users/dev/myproject/notebooks/analysis/foo.py

Workspace root:
  /Users/dev/myproject/

Shadow file:
  /tmp/databricks-notebooks-a1b2c3d4/e5f6a7b8/notebooks/analysis/foo.ipynb
```

## Lifecycle

### Opening a Notebook

```
1. User triggers "Open as Databricks Notebook" on foo.py

2. Extension computes shadow path:
   shadowPath = getShadowPath(pyUri)

3. Extension generates shadow .ipynb:
   - Read foo.py from disk
   - Parse Databricks format into cells
   - Convert to ipynb JSON (no outputs)
   - Write to shadowPath

4. Extension registers file watcher on foo.py:
   - Watch for changes (content or inode replacement)
   - Store mapping: shadowPath → pyUri

5. Extension opens shadow as notebook:
   vscode.commands.executeCommand('vscode.openWith', shadowUri, 'jupyter-notebook')

6. Pylance sees file:// URI, performs cross-cell analysis
```

### Saving a Notebook

```
1. User saves notebook (Cmd+S)

2. VS Code writes to shadow .ipynb (automatic)

3. Extension intercepts save via onDidSaveNotebookDocument:
   - Read shadow .ipynb content
   - Convert ipynb → Databricks .py format
   - Write to original foo.py

4. Update internal state:
   - Record that .py is in sync with shadow
   - Update "last known" .py content hash
```

### External Change Detection

```
1. FileSystemWatcher detects change to foo.py

2. Extension checks if corresponding notebook is open:
   - If not open: ignore (shadow will regenerate on next open)
   - If open: continue to step 3

3. Compare change to last known state:
   - If change matches our last write: ignore (we caused it)
   - If change is external: continue to step 4

4. Prompt user with options:
   - "foo.py changed on disk. Reload notebook?"
   - [Reload] [Ignore (Read-Only)]

5a. If user chooses "Reload":
    - Regenerate shadow from updated .py
    - Reload notebook in editor
    - Notebook remains editable

5b. If user chooses "Ignore (Read-Only)":
    - Mark notebook as read-only
    - User can still view and copy code
    - Show indicator in status bar: "Read-only (external changes)"
    - Provide command to reload when ready
```

### Read-Only Mode

When a notebook enters read-only mode due to external changes:

1. **Visual Indicator**: Status bar item shows "Databricks: Read-only (file changed externally)"

2. **Behavior**:
   - Cell editing is disabled
   - Cell execution still works (users can run existing code)
   - Copy/paste from cells works
   - Save is disabled (greyed out, shows tooltip explaining why)

3. **Exiting Read-Only Mode**:
   - User clicks status bar item or runs command "Databricks: Reload from Disk"
   - Shadow is regenerated from current .py
   - Notebook becomes editable again

### Closing a Notebook

```
1. User closes notebook tab

2. Extension cleanup:
   - Unregister file watcher for this .py
   - Remove mapping from shadow → py
   - Shadow file remains in /tmp (OS will clean on reboot)

3. If notebook has unsaved changes:
   - VS Code prompts "Save changes?"
   - If yes: save flow executes, then close
   - If no: changes lost (shadow and .py unchanged)
```

## File Watching

### Watcher Registration

```typescript
interface WatchedFile {
  pyUri: vscode.Uri;
  shadowUri: vscode.Uri;
  lastKnownHash: string;  // SHA256 of .py content we last wrote/read
  isReadOnly: boolean;
}

const watchedFiles = new Map<string, WatchedFile>();  // keyed by pyUri.toString()

function registerWatcher(pyUri: vscode.Uri, shadowUri: vscode.Uri, contentHash: string) {
  const watcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(pyUri, ''),  // Watch specific file
    false,  // ignoreCreateEvents
    false,  // ignoreChangeEvents
    false   // ignoreDeleteEvents
  );

  watcher.onDidChange(() => handlePyFileChanged(pyUri));
  watcher.onDidDelete(() => handlePyFileDeleted(pyUri));

  watchedFiles.set(pyUri.toString(), {
    pyUri,
    shadowUri,
    lastKnownHash: contentHash,
    isReadOnly: false
  });

  return watcher;
}
```

### Change Detection

```typescript
async function handlePyFileChanged(pyUri: vscode.Uri) {
  const watched = watchedFiles.get(pyUri.toString());
  if (!watched) return;

  // Read current .py content
  const currentContent = await vscode.workspace.fs.readFile(pyUri);
  const currentHash = computeHash(currentContent);

  // Check if we caused this change
  if (currentHash === watched.lastKnownHash) {
    return;  // This was our write, ignore
  }

  // External change detected
  const notebook = findOpenNotebook(watched.shadowUri);
  if (!notebook) return;

  // Prompt user
  const choice = await vscode.window.showWarningMessage(
    `${path.basename(pyUri.fsPath)} changed on disk.`,
    { modal: false },
    'Reload',
    'Ignore (Read-Only)'
  );

  if (choice === 'Reload') {
    await reloadNotebook(watched, currentContent, currentHash);
  } else {
    await setReadOnly(watched, true);
  }
}
```

### Deletion Handling

```typescript
async function handlePyFileDeleted(pyUri: vscode.Uri) {
  const watched = watchedFiles.get(pyUri.toString());
  if (!watched) return;

  const notebook = findOpenNotebook(watched.shadowUri);
  if (!notebook) return;

  // File was deleted - mark read-only and warn
  await setReadOnly(watched, true);

  vscode.window.showWarningMessage(
    `${path.basename(pyUri.fsPath)} was deleted. Notebook is now read-only.`,
    'Close Notebook'
  ).then(choice => {
    if (choice === 'Close Notebook') {
      vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }
  });
}
```

## Read-Only Implementation

### Setting Read-Only State

```typescript
async function setReadOnly(watched: WatchedFile, readOnly: boolean) {
  watched.isReadOnly = readOnly;

  if (readOnly) {
    // Show status bar indicator
    readOnlyStatusBarItem.text = "$(lock) Databricks: Read-only";
    readOnlyStatusBarItem.tooltip = "File changed externally. Click to reload.";
    readOnlyStatusBarItem.command = 'databricks.reloadNotebook';
    readOnlyStatusBarItem.show();

    // TODO: Investigate VS Code API for making notebook read-only
    // May need to use custom editor provider or workspace edit interception
  } else {
    readOnlyStatusBarItem.hide();
  }
}
```

### Read-Only Enforcement Options

VS Code doesn't have a direct "make notebook read-only" API. Options:

1. **Intercept edits**: Use `vscode.workspace.onWillSaveNotebookDocument` to prevent saves
2. **Custom editor state**: Track read-only state and show warning on edit attempts
3. **Close and reopen**: Close notebook, regenerate shadow with read-only flag in metadata
4. **File system permissions**: Make shadow file read-only on disk (may cause VS Code issues)

Recommended: Option 1 + visual feedback. Intercept save operations and show clear UI indicating read-only state.

## Conversion Functions

### .py to .ipynb (Shadow Generation)

```typescript
async function generateShadow(pyUri: vscode.Uri, shadowUri: vscode.Uri): Promise<string> {
  // Read .py file
  const pyContent = await vscode.workspace.fs.readFile(pyUri);
  const pyText = new TextDecoder().decode(pyContent);

  // Parse Databricks format into cells (existing parser.ts logic)
  const cells = parseNotebook(pyText);

  // Convert to ipynb JSON (existing ipynbConverter.ts logic)
  const ipynbJson = pyToIpynb(pyText);

  // Ensure shadow directory exists
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(shadowUri.fsPath)));

  // Write shadow file
  await vscode.workspace.fs.writeFile(shadowUri, new TextEncoder().encode(ipynbJson));

  // Return content hash for change detection
  return computeHash(pyContent);
}
```

### .ipynb to .py (Save Back)

```typescript
async function saveToPy(shadowUri: vscode.Uri, pyUri: vscode.Uri): Promise<string> {
  // Read shadow .ipynb
  const ipynbContent = await vscode.workspace.fs.readFile(shadowUri);
  const ipynbText = new TextDecoder().decode(ipynbContent);

  // Convert to .py format (existing ipynbConverter.ts logic)
  const pyText = ipynbToPy(ipynbText);
  const pyContent = new TextEncoder().encode(pyText);

  // Write to original .py
  await vscode.workspace.fs.writeFile(pyUri, pyContent);

  // Return new hash (so we can ignore our own change event)
  return computeHash(pyContent);
}
```

## Edge Cases

### Multiple VS Code Windows

Each VS Code window has its own session ID, so shadow paths don't collide:

```
Window 1: /tmp/databricks-notebooks-a1b2c3d4/.../foo.ipynb
Window 2: /tmp/databricks-notebooks-e5f6g7h8/.../foo.ipynb
```

Both can have the same .py open. Each tracks its own state. This mirrors how VS Code handles the same file in multiple windows normally.

### Same .py Opened Multiple Times in Same Window

Prevent this - if notebook for foo.py is already open, focus it instead of creating a new shadow.

```typescript
function openAsNotebook(pyUri: vscode.Uri) {
  // Check if already open
  const existing = findNotebookForPy(pyUri);
  if (existing) {
    vscode.window.showNotebookDocument(existing);
    return;
  }

  // Generate shadow and open
  // ...
}
```

### Workspace Not Trusted

If workspace is not trusted, VS Code restricts certain operations. Shadow generation should still work (read .py, write to /tmp), but kernel execution will be restricted by Jupyter extension.

### Large Files

For very large .py files:
- Shadow generation may take noticeable time
- Show progress indicator during generation
- Consider streaming/chunked conversion for files > 1MB

### Invalid .py Format

If .py file is not valid Databricks format:
- Fall back to single-cell notebook (entire file as one code cell)
- Or show error and don't open as notebook

Current parser already handles this - plain Python files become single-cell notebooks.

## Configuration Options

```json
{
  "databricksNotebook.shadowLocation": {
    "type": "string",
    "default": "temp",
    "enum": ["temp", "workspace"],
    "description": "Where to store shadow .ipynb files. 'temp' uses system temp directory (cleaned on reboot), 'workspace' uses .databricks/ in workspace root."
  },
  "databricksNotebook.autoReloadOnExternalChange": {
    "type": "boolean",
    "default": false,
    "description": "Automatically reload notebook when .py file changes externally (without prompting). Only applies when notebook has no unsaved changes."
  }
}
```

## Migration Path

### Phase 1: Implement Shadow Files (MVP)

1. Add shadow file generation logic
2. Change "Open as Notebook" to use shadow approach
3. Add file watcher for external changes
4. Implement save-back to .py
5. Keep existing FileSystemProvider as fallback (feature flag)

### Phase 2: Polish

1. Add read-only mode UI
2. Add status bar indicators
3. Handle edge cases (deletion, rename, etc.)
4. Add configuration options

### Phase 3: Cleanup

1. Remove FileSystemProvider approach (or keep as option)
2. Update documentation
3. Add tests for shadow lifecycle

## Testing Strategy

### Unit Tests

- Shadow path generation
- .py → .ipynb conversion (existing tests)
- .ipynb → .py conversion (existing tests)
- Hash computation and comparison

### Integration Tests

- Open .py as notebook → shadow created
- Edit and save → .py updated
- External change → prompt shown
- Read-only mode → edits blocked
- Reload → shadow regenerated

### Manual Test Cases

1. Open notebook, edit, save → verify .py updated
2. Open notebook, edit externally with vim → verify prompt
3. Open notebook, git pull changes file → verify prompt
4. Choose read-only → verify can't edit but can copy
5. Reload from read-only → verify editable again
6. Reboot machine → verify /tmp cleaned, re-open works

## Open Questions

1. **Read-only enforcement**: What's the best VS Code API for making a notebook read-only? May need investigation.

2. **Kernel state**: When reloading after external change, should we preserve kernel state (variables in memory) or restart? Preserving could cause confusion if code changed significantly.

3. **Outputs on reload**: When regenerating shadow, we lose outputs. Should we try to preserve outputs from the previous shadow if cell content matches?

4. **Rename handling**: If user renames .py file via VS Code, should we automatically update shadow path and keep notebook open?

## Appendix: Why Not Other Approaches?

### NotebookSerializer with Custom Type

Would require rebuilding all Jupyter functionality (kernels, outputs, magics). Massive effort for no additional benefit.

### Patch Pylance

Pylance maintainers have deprioritized custom scheme support. No ETA, focused on web scenarios.

### extraPaths Configuration

Only fixes import resolution, not cross-cell variable visibility. Partial solution at best.

### Accept Limitation

Valid option, but users have expressed desire for proper type checking in notebooks.
