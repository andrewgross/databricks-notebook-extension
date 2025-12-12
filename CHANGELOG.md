# Changelog

All notable changes to the Databricks Notebook extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2025-12-12

### Added

- Shadow file mode for Pylance cross-cell type checking (now enabled by default)
- Temporary `.ipynb` files in system temp directory enable full Pylance analysis
- External change detection with read-only mode and prompts
- Status bar indicator showing read-only state when external changes detected
- "Reload Notebook from Disk" command to sync with external changes
- Debounced file watching to handle rapid changes from git operations
- Extension icon (db-icon.png)

### Changed

- Shadow files now enabled by default (`experimentalShadowFiles: true`)
- Improved handling of concurrent edits and external modifications

### Removed

- Redundant `contributes.notebooks` registration from package.json

## [0.1.0] - 2025-12-11

### Added

- Initial release of Databricks Notebook extension
- Open Databricks Python notebooks (`.py` files with `# Databricks notebook source`) as Jupyter notebooks in VS Code
- Support for Databricks format (`# COMMAND ----------`) and Percent format (`# %% [markdown]`) cell separators
- SQL cell support via `%sql` and `%%sql` magic commands
- Shell cell support via `%%bash` and `%%sh` magic commands
- Markdown cell support
- Round-trip editing: changes saved back to original `.py` format
- Preservation of unknown line magics with `# MAGIC` prefix on save
- VS Code cell language metadata support for proper syntax highlighting
- Jupyter kernel compatibility using `jupyter-notebook` document type
