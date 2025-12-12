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
- Enables Pylance cross-cell type checking (variables defined in one cell are recognized in subsequent cells)

## Usage

Open a `.py` file as a notebook using any of these methods:

1. Right-click any `.py` file in the Explorer and select **"Open as Databricks Notebook"**
2. Right-click in an open `.py` file editor and select **"Open as Databricks Notebook"**
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

%%sql
SELECT * FROM my_table
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
- **Shell**: `%%bash`, `%%sh`
- **Markdown**: `# MAGIC %md` or `# %% [markdown]`
- **Other magics**: Preserved as `# MAGIC %command` on save

**NOTE:** Actual human chiming in here. The reason for these magic commands is because I have custom Jupyter `cell_magic` functions registered to these prefixes to do things like running SQL commands via Databricks Connect.  The catchall `# MAGIC` is to handle things like `%restart_python` or `%run` for databricks notebooks.


## Commands

| Command | Description |
|---------|-------------|
| `Databricks: Open as Databricks Notebook` | Open a `.py` file in the Notebook Editor |
| `Databricks: Reload Notebook from Disk` | Reload the current notebook after external changes (requires shadow files enabled) |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `databricksNotebook.defaultFormat` | `databricks` | Default format when creating new notebooks (`databricks` or `percent`) |
| `databricksNotebook.preserveFormat` | `true` | Preserve original file format on save |
| `databricksNotebook.experimentalShadowFiles` | `true` | Enable shadow file mode for Pylance cross-cell type checking. When disabled, uses a virtual file system provider which provides basic notebook editing but no cross-cell analysis. |

## How It Works

### Shadow File Mode (Default)

When shadow files are enabled (the default), the extension uses a "shadow file" approach to enable full Pylance support:

1. When you open a `.py` file as a notebook, the extension creates a temporary `.ipynb` file in your system's temp directory
2. You edit the notebook normally - all changes are automatically saved back to the original `.py` file
3. Because Pylance sees a real `.ipynb` file (not a virtual one), it can perform cross-cell analysis

This means variables, imports, and type information flow between cells just like in a regular Jupyter notebook.

### External Changes

If the `.py` file is modified externally (e.g., by git, another editor, or a teammate):
- You'll be prompted to reload or continue in read-only mode
- A status bar indicator appears showing "Read-only" with a lock icon when external changes are detected
- If you have unsaved changes, you can choose to discard them or keep editing in read-only mode
- Click the status bar indicator or use the command `Databricks: Reload Notebook from Disk` to sync with the latest `.py` content

### FileSystemProvider Mode (Legacy)

If you disable shadow files (`experimentalShadowFiles: false`), the extension falls back to a virtual file system provider. This mode provides basic notebook editing but does not support Pylance cross-cell type checking.

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