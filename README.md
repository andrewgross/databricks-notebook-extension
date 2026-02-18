# Databricks Notebook Extension for VS Code

**NOTE:** This codebase dictated but not read.\*

Open Databricks `.py` notebook files in VS Code's native Notebook Editor.

## Problem

Databricks uses `.py` files with special cell markers as their notebook format:
- Header: `# Databricks notebook source`
- Cell delimiter: `# COMMAND ----------`

When opened in VS Code, pyright/pylance reports errors for magic commands like `%%sql`, `%pip`, etc. because they're valid Jupyter/IPython syntax but invalid Python.

## Solution

This extension lets you open these files in VS Code's Notebook Editor (the same UI used for `.ipynb` files), which:
- Treats each cell as a separate document
- Filters out pyright errors for magic cells
- Provides a native notebook editing experience

## Usage

Open a `.py` file as a notebook using any of these methods:

1. Right-click any `.py` file in the Explorer and select **"Open as Databricks Notebook"**
2. Right-click an open `.py` file's **editor tab** and select **"Open as Databricks Notebook"**
3. Use the Command Palette: `Databricks: Open as Databricks Notebook`

## Supported Formats

### Databricks Format (Primary)
```python
# Databricks notebook source
# COMMAND ----------

import pandas as pd

# COMMAND ----------

# MAGIC %md
# MAGIC # My Notebook

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT * FROM my_table
```

### Percent Format (Jupytext)
```python
# %%
import pandas as pd

# %% [markdown]
# # My Notebook

# %%
%%sql
SELECT * FROM my_table
```

### Supported Magic Commands

- **SQL**: `%sql` (single line) and `%%sql` (cell)
- **Python**: `%%python` (cell)
- **Shell**: `%%bash`, `%%sh`
- **Pip**: `%pip` (displayed as shell for syntax highlighting)
- **Markdown**: `# MAGIC %md` or `# %% [markdown]`
- **Other magics**: Single-`%` line magics (e.g., `%restart_python`, `%run`) are preserved as `# MAGIC %command` in Databricks format on save

**NOTE:** Actual human chiming in here. The reason for these magic commands is because I have custom Jupyter `cell_magic` functions registered to these prefixes to do things like running SQL commands via Databricks Connect.  The catchall `# MAGIC` is to handle things like `%restart_python` or `%run` for databricks notebooks.


## Commands

| Command | Description |
|---------|-------------|
| `Databricks: Open as Databricks Notebook` | Open a `.py` file in the Notebook Editor |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `databricksNotebook.defaultFormat` | `databricks` | Default format when creating new notebooks (`databricks` or `percent`) |
| `databricksNotebook.preserveFormat` | `true` | Preserve original file format on save |

## How It Works

The extension uses a FileSystemProvider to create a virtual `databricks-notebook://` URI scheme. When you open a `.py` file as a notebook:

1. The extension converts the Databricks `.py` format to `.ipynb` format in memory
2. VS Code's built-in Jupyter notebook renderer displays the content
3. On save, the extension converts the notebook back to the original `.py` format

The original `.py` file remains the source of truth.

## External File Changes and Cell Output Preservation

When a coding agent, external editor, or any other process modifies the `.py` file while you have it open as a notebook, the extension preserves your cell outputs (execution results, printed output, etc.) for cells whose content didn't change.

### How it works

When VS Code detects the underlying `.py` file has changed, it asks the extension to re-read the file. Instead of returning cells with empty outputs (the default behavior, since `.py` files don't store outputs), the extension:

1. Parses the new `.py` content into cells
2. Diffs the new cells against the currently displayed notebook cells using an LCS-based algorithm
3. For cells that are unchanged or only modified in content, copies the existing outputs and execution counts into the response
4. Returns the merged result so VS Code's reload preserves the visual state

### Behavior by scenario

| Scenario | Result |
|----------|--------|
| External process adds a cell | New cell appears, all existing outputs preserved |
| External process modifies a cell's content | Cell content updates, output from that cell preserved (since the cell identity is maintained) |
| External process deletes a cell | Cell disappears, surrounding cells keep their outputs |
| External process rewrites the entire file | Outputs preserved for any cells that still match |
| You save from the notebook view | Self-write detection prevents the change from triggering a reload |
| Rapid edits (e.g., git operations) | Handled gracefully via VS Code's built-in file watching |

### Limitations

- Outputs are only preserved for cells that can be matched between the old and new versions. If a cell's language type changes (e.g., Python to SQL), it's treated as a delete + insert and the output is lost.
- The `.py` file format does not store outputs. Outputs exist only in the VS Code notebook view's runtime state. Closing and reopening the notebook always starts with empty outputs.

## Development

```bash
# Install dependencies
make install

# Build
make build

# Watch mode
make watch

# Run tests
make test

# Type check
make typecheck

# Lint
make lint

# Package extension
make package
```

-----------

\* AKA Claude wrote most of this at my prompting. I am not a master of typescript or JS, and do not have the ability to review it at a deep level. That said, I am still responsible for errors in the codebase, notwithstanding the the original meaning of the introductory phrase.
