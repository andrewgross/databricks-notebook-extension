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

1. Right-click any `.py` file in the Explorer
2. Select **"Open as Databricks Notebook"**

Or use the Command Palette: `Databricks: Open as Databricks Notebook`

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


## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `databricksNotebook.defaultFormat` | `databricks` | Default format when creating new notebooks (`databricks` or `percent`) |
| `databricksNotebook.preserveFormat` | `true` | Preserve original file format on save |

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