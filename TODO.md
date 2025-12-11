# Databricks Notebook Extension - TODO

## Phase 1: Core Functionality (Current)
- [x] Project scaffolding and build system
- [x] Cell parser for Databricks format
- [x] Cell parser for percent format
- [x] NotebookSerializer implementation
- [x] FileSystemProvider implementation
- [x] "Open as Notebook" command
- [x] Unit tests for parser

## Phase 2: Robustness & Edge Cases
- [ ] Handle empty cells gracefully
- [ ] Preserve trailing newlines/whitespace from original file
- [ ] Handle files without any cell markers (single-cell mode)
- [ ] Handle mixed marker styles in same file
- [ ] Better error messages for malformed files
- [ ] Handle very large files (streaming parser?)
- [ ] Preserve comments before first cell delimiter

## Phase 3: Enhanced Language Support
- [ ] R cell detection (`%r` magic)
- [ ] Scala cell detection (`%scala` magic)
- [ ] pip magic commands (`%pip install`)
- [ ] run magic commands (`%run`)
- [ ] fs magic commands (`%fs`)
- [ ] Widget commands (`dbutils.widgets`)

## Phase 4: Integration & Polish
- [ ] File watching for external changes (refresh notebook when .py changes)
- [ ] Proper error handling with user-friendly messages
- [ ] Configuration options:
  - [ ] Default format for new notebooks
  - [ ] Preserve vs normalize format on save
  - [ ] SQL magic style (cell magic vs line magic)
- [ ] Context menu integration improvements
- [ ] Keyboard shortcut for opening as notebook
- [ ] Status bar indicator showing current format

## Phase 5: Testing & Quality
- [ ] Integration tests with VS Code test runner
- [ ] End-to-end tests for open/edit/save cycle
- [ ] Test with real Databricks notebook files
- [ ] Performance benchmarks
- [ ] Test with Jupyter extension installed (kernel execution)

## Phase 6: Documentation & Release
- [ ] README with usage instructions
- [ ] CHANGELOG
- [ ] Screenshots/GIFs for marketplace
- [ ] Extension icon
- [ ] Publish to VS Code marketplace

## Future Considerations (Out of Scope for v1)

### Cell Output Persistence
- Could store outputs in a sidecar file (e.g., `.py.outputs.json`)
- Databricks doesn't natively support this, so probably not worth it
- Users can re-run cells in the notebook UI

### Databricks Extension Integration
- The official Databricks extension handles remote execution
- Could detect if it's installed and suggest kernel selection
- Could integrate with Databricks Connect for local execution

### Kernel Association
- Jupyter extension handles kernel management
- Could add a setting for suggested kernel name
- Could detect Python interpreter from workspace settings

### Format Auto-Detection on File Open
- VS Code doesn't support content-based editor selection
- Would need a language server or proposed API
- Current manual "Open as Notebook" is acceptable

### Bidirectional Sync
- Currently: edit notebook → save → .py updated
- Could add: edit .py → notebook view refreshes
- FileSystemWatcher is implemented but UI refresh needs work

## Known Issues

### Magic Command Stripping
The parser strips `# MAGIC ` prefix for display. On save, it re-adds the prefix.
This means whitespace-only MAGIC lines might not round-trip perfectly.

### Cell Metadata
Databricks format doesn't support cell metadata (execution count, etc.).
VS Code notebook API allows metadata, but we ignore it completely.

### Percent Format Variations
There are multiple percent format variants:
- `# %%` (bare)
- `# %% [markdown]` (with type)
- `# %% title` (with title)
- `# %% [markdown] title` (both)
We only handle the basic cases currently.
