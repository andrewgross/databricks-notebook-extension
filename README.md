# Databricks Notebook Extension for VS Code

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

## License

MIT
