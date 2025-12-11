/**
 * Supported notebook formats
 */
export type NotebookFormat = 'databricks' | 'percent' | 'plain';

/**
 * Supported cell languages
 */
export type CellLanguage = 'python' | 'sql' | 'markdown' | 'shellscript' | 'r' | 'scala';

/**
 * A parsed cell from a notebook file
 */
export interface ParsedCell {
  /** Cell content (without markers/magic prefixes) */
  source: string;
  /** Whether this is a code or markup cell */
  cellKind: 'code' | 'markup';
  /** Language identifier for the cell */
  languageId: CellLanguage;
  /** Starting line number in the original file (0-indexed) */
  startLine: number;
  /** Ending line number in the original file (0-indexed, exclusive) */
  endLine: number;
}

/**
 * Result of parsing a notebook file
 */
export interface ParsedNotebook {
  /** The parsed cells */
  cells: ParsedCell[];
  /** Detected format of the notebook */
  format: NotebookFormat;
  /** Whether the file had a Databricks header */
  hasDatabricksHeader: boolean;
}

/**
 * Constants for cell markers and magic commands
 */
export const MARKERS = {
  /** Databricks notebook header */
  DATABRICKS_HEADER: '# Databricks notebook source',
  /** Databricks cell delimiter */
  DATABRICKS_CELL: '# COMMAND ----------',
  /** Databricks cell delimiter regex (handles varying dash counts) */
  DATABRICKS_CELL_REGEX: /^# COMMAND -+$/,
  /** Percent format cell marker */
  PERCENT_CELL: '# %%',
  /** Percent format cell regex (with optional metadata) */
  PERCENT_CELL_REGEX: /^# %%\s*(?:\[(\w+)\])?(.*)$/,
  /** Databricks MAGIC prefix */
  MAGIC_PREFIX: '# MAGIC ',
} as const;

/**
 * Magic command patterns for detecting cell types
 */
export const MAGIC_PATTERNS = {
  /** Markdown magic (Databricks format) */
  MARKDOWN_MAGIC: /^%md\b/,
  /** SQL magic (Databricks format) */
  SQL_MAGIC: /^%sql\b/,
  /** Python magic (Databricks format) */
  PYTHON_MAGIC: /^%python\b/,
  /** Shell magic (Databricks format) */
  SHELL_MAGIC: /^%(sh|bash)\b/,
  /** R magic (Databricks format) */
  R_MAGIC: /^%r\b/,
  /** Scala magic (Databricks format) */
  SCALA_MAGIC: /^%scala\b/,
  /** Cell magic (%%magic at start of cell) */
  CELL_MAGIC_SQL: /^%%sql\s*$/m,
  /** Cell magic python */
  CELL_MAGIC_PYTHON: /^%%python\s*$/m,
  /** Cell magic shell */
  CELL_MAGIC_SHELL: /^%%(bash|sh)\s*$/m,
} as const;
