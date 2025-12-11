# Databricks .py Notebook Editor for VS Code

## Problem Statement

Databricks uses `.py` files with special cell markers (`# Databricks notebook source` header and `# COMMAND ----------` cell delimiters) as their notebook format. These files are plain Python that can be version-controlled and diffed easily, but they're intended to be executed as notebooks with cell-by-cell execution.

### Current Situation

When opening these files in VS Code with the Jupyter extension:

1. **Interactive Window mode**: The Jupyter extension recognizes the cell markers and provides CodeLens buttons ("Run Cell", "Run Above", etc.) that execute cells in an Interactive Window pane. The file remains open in the standard text editor.

2. **The pyright/pylance problem**: Because the file is treated as a plain `.py` file, the language server (pyright/pylance) parses the entire file as Python. This causes syntax errors for any IPython magic commands like `%%sql`, `%pip`, `%run`, etc. These are valid Jupyter/IPython syntax but invalid Python syntax.

3. **Why .ipynb doesn't have this problem**: When you open a `.ipynb` file, VS Code uses the Notebook Editor, which treats each cell as a separate virtual document. Cells with magic commands have their errors filtered out at the extension level before being shown to the user. The language server receives cells through a notebook-aware protocol that can handle per-cell language modes.

### The Core Architectural Issue

VS Code's notebook system associates file extensions with editors via `package.json` declarations:

```json
{
  "contributes": {
    "notebooks": [{
      "type": "jupyter-notebook",
      "selector": [{ "filenamePattern": "*.ipynb" }]
    }]
  }
}
```

There is **no content-based detection** — the decision is purely extension-based. Since `.py` is used by millions of regular Python scripts, no extension can claim it as a notebook format without breaking normal Python development.

### Why Existing Solutions Fall Short

1. **vscode-jupytext extension** (donjayamanne/congyiwu forks):
   - Last updated 2021, uses deprecated proposed APIs
   - Requires Python runtime (shells out to `jupytext` CLI)
   - Tied to jupytext's percent format (`# %%`), not Databricks markers
   - Manual "Open as Notebook" command (acceptable, but implementation is stale)

2. **Excluding notebooks from pyright**:
   - Loses all type checking in notebooks
   - Not a real solution

3. **Commenting magic commands**:
   - Breaks execution in Databricks
   - Requires manual editing

## Goals

### Primary Goals

1. **Open Databricks `.py` notebooks in VS Code's Notebook Editor** — not the text editor with Interactive Window, but the actual notebook UI used for `.ipynb` files. Its fine if the user has to right click a file to activate this view.

2. **Eliminate pyright errors for magic commands** — by using the Notebook Editor, magic cells get the same error filtering treatment as `.ipynb` files

3. **Preserve the `.py` file as source of truth** — edits in the notebook UI sync back to the `.py` file, maintaining git-friendliness

4. **No Python runtime dependency** — parse cell markers in pure TypeScript

5. **Support Databricks cell marker format**:
   - Header: `# Databricks notebook source`
   - Cell delimiter: `# COMMAND ----------`
   - Also support standard jupytext percent format: `# %%`

### Secondary Goals

1. **Support `%%sql` cells** — detect cell magic and set appropriate cell language mode (SQL, markdown, etc.)

2. **Work with stable VS Code APIs** — no proposed APIs, works in stable VS Code (not just Insiders)

3. **Minimal scope** — focus on the editor experience, not execution (rely on existing Jupyter extension for kernel/execution)

### Non-Goals

1. **Replace the Jupyter extension** — we want to complement it, using its kernel infrastructure
2. **Support all jupytext formats** — focus on percent format and Databricks format only
3. **Automatic file association** — manual "Open as Notebook" is acceptable and avoids breaking normal `.py` files

## Constraints

1. **Cannot register `.py` as a notebook file extension** — would break all normal Python development

2. **Must coexist with standard Python/Jupyter extensions** — users will have both installed

3. **Virtual FileSystem approach required** — to make VS Code's notebook system work with `.py` files, we need to present them via a custom URI scheme (e.g., `databricks-notebook://`)

4. **Cell parsing must handle edge cases**:
   - Files without the Databricks header (just `# COMMAND ----------` delimiters)
   - Mixed marker styles in same file
   - Markdown cells (`# COMMAND ----------` followed by `# MAGIC %md`)
   - SQL cells (`%%sql` magic)
   - Empty cells
   - Cells with only comments

## Proposed Solution: Pure TypeScript Extension

Build a focused VS Code extension that opens Databricks `.py` files in the Notebook Editor.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     VS Code                                  │
│  ┌─────────────────┐     ┌─────────────────────────────┐   │
│  │   .py file      │     │     Notebook Editor          │   │
│  │   (on disk)     │◄───►│   (databricks-notebook://)   │   │
│  └─────────────────┘     └─────────────────────────────┘   │
│          ▲                           ▲                      │
│          │                           │                      │
│          ▼                           ▼                      │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Extension                               │   │
│  │  ┌───────────────┐  ┌───────────────────────────┐   │   │
│  │  │ Cell Parser   │  │ FileSystemProvider        │   │   │
│  │  │ (TypeScript)  │  │ (databricks-notebook://)  │   │   │
│  │  └───────────────┘  └───────────────────────────┘   │   │
│  │  ┌───────────────┐  ┌───────────────────────────┐   │   │
│  │  │ Notebook      │  │ Commands                  │   │   │
│  │  │ Serializer    │  │ (Open as Notebook)        │   │   │
│  │  └───────────────┘  └───────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Cell Parser (`src/parser.ts`)

Pure TypeScript module that parses `.py` content into notebook cells.

**Input**: Raw `.py` file content as string

**Output**: Array of cell objects:

```typescript
interface ParsedCell {
  source: string;           // Cell content (without marker)
  cellKind: 'code' | 'markup';
  languageId: string;       // 'python', 'sql', 'markdown', etc.
  startLine: number;        // For source mapping
  endLine: number;
}

interface ParsedNotebook {
  cells: ParsedCell[];
  format: 'databricks' | 'percent' | 'plain';
}
```

**Parsing Logic**:

1. Detect file format:
   - If starts with `# Databricks notebook source` → Databricks format
   - If contains `# %%` markers → percent format
   - Otherwise → single code cell (entire file)

2. Split on cell markers:
   - Databricks: `# COMMAND ----------`
   - Percent: `# %%` (with optional metadata like `[markdown]`)

3. For each cell, detect type:
   - `# MAGIC %md` or `# %% [markdown]` → markdown cell
   - `%%sql` at start → SQL code cell
   - `%%python` at start → Python code cell (strip magic)
   - Default → Python code cell

4. Handle Databricks MAGIC prefix:
   - Lines starting with `# MAGIC ` have the prefix stripped for display
   - Restored on save

#### 2. Notebook Serializer (`src/serializer.ts`)

Implements VS Code's `NotebookSerializer` interface.

```typescript
import {
  NotebookSerializer,
  NotebookData,
  NotebookCellData,
  NotebookCellKind,
  CancellationToken,
} from 'vscode';
import { parseNotebook, serializeNotebook } from './parser';

export class DatabricksNotebookSerializer implements NotebookSerializer {
  // Called when opening a notebook
  async deserializeNotebook(
    content: Uint8Array,
    token: CancellationToken
  ): Promise<NotebookData> {
    const text = new TextDecoder().decode(content);
    const parsed = parseNotebook(text);

    return new NotebookData(
      parsed.cells.map(cell => new NotebookCellData(
        cell.cellKind === 'markup'
          ? NotebookCellKind.Markup
          : NotebookCellKind.Code,
        cell.source,
        cell.languageId
      ))
    );
  }

  // Called when saving a notebook
  async serializeNotebook(
    data: NotebookData,
    token: CancellationToken
  ): Promise<Uint8Array> {
    const pyContent = serializeNotebook(data.cells);
    return new TextEncoder().encode(pyContent);
  }
}
```

#### 3. FileSystem Provider (`src/filesystem.ts`)

Creates a virtual `databricks-notebook://` scheme that maps to real `.py` files.

```typescript
import {
  FileSystemProvider,
  Uri,
  FileType,
  FileStat,
  FileChangeEvent,
  EventEmitter,
  Disposable,
  workspace,
} from 'vscode';

export class DatabricksNotebookFileSystem implements FileSystemProvider {
  private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  // Convert virtual URI to real file URI
  // databricks-notebook:///path/to/file.py → file:///path/to/file.py
  private toRealUri(uri: Uri): Uri {
    return Uri.file(uri.path);
  }

  async stat(uri: Uri): Promise<FileStat> {
    return workspace.fs.stat(this.toRealUri(uri));
  }

  async readFile(uri: Uri): Promise<Uint8Array> {
    return workspace.fs.readFile(this.toRealUri(uri));
  }

  async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
    return workspace.fs.writeFile(this.toRealUri(uri), content);
  }

  watch(uri: Uri): Disposable {
    // Watch the real file for changes
    const realUri = this.toRealUri(uri);
    const watcher = workspace.createFileSystemWatcher(realUri.fsPath);

    watcher.onDidChange(() => {
      this._onDidChangeFile.fire([{ type: 1, uri }]); // FileChangeType.Changed
    });

    return watcher;
  }

  // Required but not used for our purposes
  readDirectory(uri: Uri): [string, FileType][] { return []; }
  createDirectory(uri: Uri): void {}
  delete(uri: Uri): void {}
  rename(oldUri: Uri, newUri: Uri): void {}
}
```

#### 4. Commands (`src/commands.ts`)

Register the "Open as Databricks Notebook" command.

```typescript
import { commands, window, Uri, ExtensionContext } from 'vscode';

const NOTEBOOK_TYPE = 'databricks-notebook';
const SCHEME = 'databricks-notebook';

export function registerCommands(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand('databricks.openAsNotebook', async (uri?: Uri) => {
      // Get URI from context menu or active editor
      uri = uri || window.activeTextEditor?.document.uri;
      if (!uri) {
        window.showErrorMessage('No file selected');
        return;
      }

      // Verify it's a Python file
      if (!uri.fsPath.endsWith('.py')) {
        window.showErrorMessage('Not a Python file');
        return;
      }

      // Create virtual notebook URI
      const notebookUri = Uri.from({
        scheme: SCHEME,
        path: uri.path,
      });

      // Open in notebook editor
      await commands.executeCommand(
        'vscode.openWith',
        notebookUri,
        NOTEBOOK_TYPE
      );
    })
  );
}
```

#### 5. Extension Entry Point (`src/extension.ts`)

```typescript
import { ExtensionContext, workspace } from 'vscode';
import { DatabricksNotebookSerializer } from './serializer';
import { DatabricksNotebookFileSystem } from './filesystem';
import { registerCommands } from './commands';

const NOTEBOOK_TYPE = 'databricks-notebook';
const SCHEME = 'databricks-notebook';

export function activate(context: ExtensionContext) {
  // Register notebook serializer
  context.subscriptions.push(
    workspace.registerNotebookSerializer(
      NOTEBOOK_TYPE,
      new DatabricksNotebookSerializer(),
      { transientOutputs: true }
    )
  );

  // Register filesystem provider
  context.subscriptions.push(
    workspace.registerFileSystemProvider(
      SCHEME,
      new DatabricksNotebookFileSystem(),
      { isCaseSensitive: true }
    )
  );

  // Register commands
  registerCommands(context);

  console.log('Databricks Notebook extension activated');
}

export function deactivate() {}
```

#### 6. Package Manifest (`package.json`)

```json
{
  "name": "databricks-notebook",
  "displayName": "Databricks Notebook",
  "description": "Open Databricks .py notebooks in VS Code's Notebook Editor",
  "version": "0.1.0",
  "publisher": "your-publisher",
  "engines": {
    "vscode": "^1.75.0"
  },
  "categories": [
    "Notebooks",
    "Data Science"
  ],
  "activationEvents": [
    "onCommand:databricks.openAsNotebook",
    "onFileSystem:databricks-notebook",
    "onNotebook:databricks-notebook"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "notebooks": [
      {
        "type": "databricks-notebook",
        "displayName": "Databricks Notebook",
        "selector": [
          {
            "filenamePattern": "*.py"
          }
        ],
        "priority": "option"
      }
    ],
    "commands": [
      {
        "command": "databricks.openAsNotebook",
        "title": "Open as Databricks Notebook",
        "category": "Databricks"
      }
    ],
    "menus": {
      "explorer/context": [
        {
          "command": "databricks.openAsNotebook",
          "when": "resourceLangId == python",
          "group": "navigation"
        }
      ],
      "editor/title/context": [
        {
          "command": "databricks.openAsNotebook",
          "when": "resourceLangId == python"
        }
      ],
      "commandPalette": [
        {
          "command": "databricks.openAsNotebook",
          "when": "editorLangId == python"
        }
      ]
    }
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./",
    "lint": "eslint src --ext ts",
    "test": "node ./out/test/runTest.js"
  },
  "devDependencies": {
    "@types/node": "^18.x",
    "@types/vscode": "^1.75.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

### File Format Support

#### Databricks Format (Primary)

```python
# Databricks notebook source
# COMMAND ----------

import pandas as pd

# COMMAND ----------

# MAGIC %md
# MAGIC # My Notebook
# MAGIC This is a markdown cell

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT * FROM my_table

# COMMAND ----------

%%sql
SELECT * FROM another_table
```

#### Percent Format (Secondary)

```python
# %%
import pandas as pd

# %% [markdown]
# # My Notebook
# This is a markdown cell

# %%
%%sql
SELECT * FROM my_table
```

### Cell Language Detection

| Pattern | Cell Type | Language ID |
|---------|-----------|-------------|
| `# MAGIC %md` lines | Markup | `markdown` |
| `# %% [markdown]` | Markup | `markdown` |
| `%%sql` first line | Code | `sql` |
| `# MAGIC %sql` | Code | `sql` |
| `%%python` first line | Code | `python` |
| `%%bash` / `%%sh` | Code | `shellscript` |
| Default | Code | `python` |

### Serialization (Save) Logic

When saving, convert cells back to `.py` format:

1. Add `# Databricks notebook source` header (if original had it, or as default)
2. For each cell:
   - Add `# COMMAND ----------` separator (with blank line before for readability)
   - If markdown: prefix each line with `# MAGIC %md` (first line) then `# MAGIC ` (subsequent)
   - If SQL: either preserve `%%sql` magic or convert to `# MAGIC %sql` format based on config
   - If Python: output as-is

### Edge Cases to Handle

1. **Empty files**: Create single empty code cell
2. **No markers**: Treat entire file as single code cell
3. **Trailing newlines**: Preserve original file's trailing newline behavior
4. **Mixed marker styles**: Detect on open, preserve or normalize on save (configurable)
5. **Cell metadata**: Databricks doesn't support cell metadata, ignore/strip
6. **File watching**: If `.py` file changes externally, refresh notebook view
7. **Whitespace in cell markers**: Handle `# COMMAND ----------` with varying dash counts
8. **Comments before first cell**: Preserve file header comments

### Testing Strategy

#### Unit Tests (`src/test/parser.test.ts`)

```typescript
import { parseNotebook, serializeNotebook } from '../parser';

describe('parseNotebook', () => {
  it('parses Databricks format', () => {
    const input = `# Databricks notebook source
# COMMAND ----------

import pandas as pd

# COMMAND ----------

# MAGIC %md
# MAGIC # Title`;

    const result = parseNotebook(input);
    expect(result.format).toBe('databricks');
    expect(result.cells).toHaveLength(2);
    expect(result.cells[0].languageId).toBe('python');
    expect(result.cells[1].cellKind).toBe('markup');
  });

  it('parses percent format', () => {
    const input = `# %%
import pandas as pd

# %% [markdown]
# Title`;

    const result = parseNotebook(input);
    expect(result.format).toBe('percent');
    expect(result.cells).toHaveLength(2);
  });

  it('handles SQL magic cells', () => {
    const input = `# Databricks notebook source
# COMMAND ----------

%%sql
SELECT * FROM table`;

    const result = parseNotebook(input);
    expect(result.cells[0].languageId).toBe('sql');
  });

  it('round-trips without data loss', () => {
    const input = `# Databricks notebook source
# COMMAND ----------

import pandas as pd

# COMMAND ----------

# MAGIC %md
# MAGIC # Title
`;

    const parsed = parseNotebook(input);
    const serialized = serializeNotebook(parsed.cells, 'databricks');
    const reparsed = parseNotebook(serialized);

    expect(reparsed.cells).toEqual(parsed.cells);
  });
});
```

#### Integration Tests

1. Open file as notebook via command
2. Edit cell, save, verify `.py` file updated correctly
3. External edit to `.py` file, verify notebook refreshes
4. Create new cells, delete cells, reorder cells
5. Test with Jupyter extension installed (kernel execution)

### Project Structure

```
databricks-notebook/
├── package.json
├── tsconfig.json
├── .eslintrc.json
├── .vscodeignore
├── README.md
├── CHANGELOG.md
├── src/
│   ├── extension.ts        # Entry point
│   ├── parser.ts           # Cell parsing logic
│   ├── serializer.ts       # NotebookSerializer implementation
│   ├── filesystem.ts       # FileSystemProvider implementation
│   ├── commands.ts         # Command registrations
│   └── test/
│       ├── runTest.ts
│       ├── parser.test.ts
│       └── integration.test.ts
└── .vscode/
    ├── launch.json         # Debug configuration
    └── tasks.json          # Build tasks
```

### Dependencies

**Runtime**: None (pure VS Code API)

**Development**:
- `typescript` ^5.0.0
- `@types/vscode` ^1.75.0
- `@types/node` ^18.x
- `eslint` + TypeScript plugins
- `@vscode/test-electron` for integration tests

### Configuration Options (Future)

```json
{
  "databricksNotebook.defaultFormat": {
    "type": "string",
    "enum": ["databricks", "percent"],
    "default": "databricks",
    "description": "Default format when creating new notebooks"
  },
  "databricksNotebook.preserveFormat": {
    "type": "boolean",
    "default": true,
    "description": "Preserve original file format on save (vs normalizing)"
  },
  "databricksNotebook.sqlMagicStyle": {
    "type": "string",
    "enum": ["cellMagic", "lineMagic"],
    "default": "cellMagic",
    "description": "Use %%sql (cellMagic) or # MAGIC %sql (lineMagic) for SQL cells"
  }
}
```

### Open Questions

1. **Kernel association**: Should we try to associate with a specific kernel (Databricks Connect, local Python)? Or leave kernel selection to user?
   - Recommendation: Leave to user, but could add a "suggested kernel" setting

2. **Format normalization**: If user opens a percent-format file, should we convert to Databricks format on save?
   - Recommendation: Preserve original format by default, add setting to normalize

3. **Coexistence with Databricks extension**: The official Databricks extension exists — should we integrate with it or remain independent?
   - Recommendation: Remain independent initially, consider integration later

4. **SQL cell handling**: Should `%%sql` cells use a SQL language server for IntelliSense?
   - Recommendation: Out of scope for v1, but setting the correct `languageId` enables this if user has SQL extension

5. **Cell output persistence**: Should we support persisting cell outputs in a sidecar file?
   - Recommendation: Out of scope for v1, outputs are transient

### Implementation Phases

#### Phase 1: Core Functionality
- Cell parser for Databricks format
- NotebookSerializer
- FileSystemProvider
- "Open as Notebook" command
- Basic round-trip (open, edit, save)

#### Phase 2: Format Support
- Percent format parsing
- Format preservation on save
- SQL/markdown cell detection
- Proper language IDs per cell

#### Phase 3: Polish
- File watching for external changes
- Error handling and user feedback
- Configuration options
- Documentation

#### Phase 4: Future
- Cell output persistence (sidecar file?)
- Databricks extension integration
- Kernel suggestions
