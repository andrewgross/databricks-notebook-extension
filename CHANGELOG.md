# Changelog

All notable changes to the Databricks Notebook extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
