# Changelog

All notable changes to the Databricks Notebook extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2025-12-19

### Fixed

- Annotated git tags now properly dereferenced when comparing to HEAD using ^{commit} suffix (2bbd6c9)

### Changed

- Upgraded ESLint from v8 to v9 and migrated to flat config format (eslint.config.mjs) (a499b4d)
- Upgraded typescript-eslint packages from v6 to v8 (a499b4d)
- Eliminated npm install warnings from deprecated transitive dependencies (a499b4d)

## [0.4.0] - 2025-12-19

### Added

- Open VSX Registry publishing support alongside VS Code Marketplace (da09641)
- Automatic git tagging during publish process to correlate versions with commits (71d3d74)
- Tag validation ensuring HEAD matches version tag before publishing (71d3d74)

### Changed

- Updated @vscode/vsce to v3.7.1 (c546007)
- Updated esbuild to v0.27.2 to fix security vulnerability GHSA-67mh-4wv8-2f99 (df203cc)
- Publishing tokens now read automatically from ~/.vsce-token and ~/.ovsx-token (da09641)
- Makefile publish target no longer runs redundant build step (da09641, c88841b)
- Package step now performs clean build to ensure fresh artifacts (71d3d74)
- Same .vsix file is now published to both VS Code and Open VSX registries (71d3d74)
- Publish targets now require version tag to exist before uploading (71d3d74)

## [0.3.0] - 2025-12-19

### Added

- Support for `%pip` magic cells with shellscript syntax highlighting (c5ff2e4)
- Smart reload that preserves cell outputs when external changes detected (2af65b5)
- Tab focus detection for automatic external change checking (2af65b5)
- Auto-reload for clean notebooks when switching tabs (2af65b5)
- Pure function cell matching logic for testable output preservation (5ac3a70)

### Changed

- Notebook now reloads in-place using NotebookEdit API instead of closing and reopening (2af65b5)
- Cell matching logic extracted into dedicated module with 17 unit tests (5ac3a70)
- Upgraded vitest to v4.0.15 to fix CJS deprecation warning (acd1df6)
- Renamed vitest.config.ts to vitest.config.mts to force ESM loading (acd1df6)

### Fixed

- MAGIC cells with empty lines missing trailing space now correctly parsed (fa4aba3)

### Removed

- Shadow files implementation in favor of FileSystemProvider-only approach (3ac1c4d)
- Removed 1800+ lines of shadow file management code (3ac1c4d)
- Removed `experimentalShadowFiles` configuration setting (3ac1c4d)

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
