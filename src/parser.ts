import {
  ParsedCell,
  ParsedNotebook,
  NotebookFormat,
  CellLanguage,
  MARKERS,
  MAGIC_PATTERNS,
} from './types';

/**
 * Parse a .py file into notebook cells
 */
export function parseNotebook(content: string): ParsedNotebook {
  const lines = content.split('\n');
  const format = detectFormat(lines);
  const hasDatabricksHeader = lines[0]?.trim() === MARKERS.DATABRICKS_HEADER;

  if (format === 'plain') {
    return {
      cells: [{
        source: content,
        cellKind: 'code',
        languageId: 'python',
        startLine: 0,
        endLine: lines.length,
      }],
      format,
      hasDatabricksHeader: false,
    };
  }

  const cells = format === 'databricks'
    ? parseDatabricksFormat(lines, hasDatabricksHeader)
    : parsePercentFormat(lines);

  return { cells, format, hasDatabricksHeader };
}

/**
 * Detect the format of a notebook file
 */
function detectFormat(lines: string[]): NotebookFormat {
  const firstLine = lines[0]?.trim();

  if (firstLine === MARKERS.DATABRICKS_HEADER) {
    return 'databricks';
  }

  // Check for any Databricks cell markers
  for (const line of lines) {
    if (MARKERS.DATABRICKS_CELL_REGEX.test(line.trim())) {
      return 'databricks';
    }
  }

  // Check for percent format markers
  for (const line of lines) {
    if (line.trim().startsWith(MARKERS.PERCENT_CELL)) {
      return 'percent';
    }
  }

  return 'plain';
}

/**
 * Parse Databricks format notebook
 */
function parseDatabricksFormat(lines: string[], hasDatabricksHeader: boolean): ParsedCell[] {
  const cells: ParsedCell[] = [];
  let currentCellLines: string[] = [];
  let cellStartLine = hasDatabricksHeader ? 1 : 0;

  // Skip header line if present
  const startIndex = hasDatabricksHeader ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line?.trim() ?? '';

    if (MARKERS.DATABRICKS_CELL_REGEX.test(trimmedLine)) {
      // Save the previous cell if it has content
      if (currentCellLines.length > 0 || cells.length > 0) {
        const cell = createCellFromDatabricksLines(currentCellLines, cellStartLine, i);
        if (cell) {
          cells.push(cell);
        }
      }
      currentCellLines = [];
      cellStartLine = i + 1;
    } else {
      currentCellLines.push(line ?? '');
    }
  }

  // Don't forget the last cell
  if (currentCellLines.length > 0) {
    const cell = createCellFromDatabricksLines(currentCellLines, cellStartLine, lines.length);
    if (cell) {
      cells.push(cell);
    }
  }

  return cells;
}

/**
 * Create a cell from Databricks format lines
 */
function createCellFromDatabricksLines(
  lines: string[],
  startLine: number,
  endLine: number
): ParsedCell | null {
  // Trim leading/trailing empty lines
  while (lines.length > 0 && lines[0]?.trim() === '') {
    lines.shift();
    startLine++;
  }
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') {
    lines.pop();
    endLine--;
  }

  if (lines.length === 0) {
    return null;
  }

  // Check if this is a MAGIC cell
  // Handle both '# MAGIC ' (with trailing space) and '# MAGIC' (without trailing space for empty lines)
  const isMagicCell = lines.every(line =>
    line.startsWith(MARKERS.MAGIC_PREFIX) ||
    line === '# MAGIC' ||
    line.trim() === ''
  );

  if (isMagicCell) {
    return parseMagicCell(lines, startLine, endLine);
  }

  // Check for cell magic (%%sql, etc.)
  const firstNonEmpty = lines.find(l => l.trim() !== '');
  if (firstNonEmpty) {
    const cellMagicInfo = detectCellMagic(firstNonEmpty);
    if (cellMagicInfo) {
      // Remove the magic line and return the rest
      const magicLineIndex = lines.indexOf(firstNonEmpty);
      const contentLines = lines.slice(magicLineIndex + 1);
      return {
        source: contentLines.join('\n'),
        cellKind: 'code',
        languageId: cellMagicInfo.language,
        startLine,
        endLine,
      };
    }
  }

  // Regular Python cell
  return {
    source: lines.join('\n'),
    cellKind: 'code',
    languageId: 'python',
    startLine,
    endLine,
  };
}

/**
 * Parse a MAGIC cell (lines prefixed with # MAGIC)
 */
function parseMagicCell(
  lines: string[],
  startLine: number,
  endLine: number
): ParsedCell {
  // Strip MAGIC prefix from each line
  // Handle both '# MAGIC ' (with trailing space) and '# MAGIC' (without trailing space for empty lines)
  const strippedLines = lines.map(line => {
    if (line.startsWith(MARKERS.MAGIC_PREFIX)) {
      return line.slice(MARKERS.MAGIC_PREFIX.length);
    }
    if (line === '# MAGIC') {
      return '';
    }
    return line;
  });

  // Detect the magic type from the first non-empty line
  const firstContent = strippedLines.find(l => l.trim() !== '');

  if (firstContent) {
    if (MAGIC_PATTERNS.MARKDOWN_MAGIC.test(firstContent)) {
      // Remove the %md from the first line and return as markdown
      const contentLines = strippedLines.map((line, i) => {
        if (i === strippedLines.indexOf(firstContent)) {
          return line.replace(MAGIC_PATTERNS.MARKDOWN_MAGIC, '').trim();
        }
        return line;
      });
      return {
        source: contentLines.join('\n').trim(),
        cellKind: 'markup',
        languageId: 'markdown',
        startLine,
        endLine,
      };
    }

    if (MAGIC_PATTERNS.SQL_MAGIC.test(firstContent)) {
      const contentLines = strippedLines.map((line, i) => {
        if (i === strippedLines.indexOf(firstContent)) {
          return line.replace(MAGIC_PATTERNS.SQL_MAGIC, '').trim();
        }
        return line;
      });
      return {
        source: contentLines.join('\n').trim(),
        cellKind: 'code',
        languageId: 'sql',
        startLine,
        endLine,
      };
    }

    if (MAGIC_PATTERNS.SHELL_MAGIC.test(firstContent)) {
      const contentLines = strippedLines.map((line, i) => {
        if (i === strippedLines.indexOf(firstContent)) {
          return line.replace(MAGIC_PATTERNS.SHELL_MAGIC, '').trim();
        }
        return line;
      });
      return {
        source: contentLines.join('\n').trim(),
        cellKind: 'code',
        languageId: 'shellscript',
        startLine,
        endLine,
      };
    }

    // %pip magic - keep the full command in output (don't strip %pip)
    if (MAGIC_PATTERNS.PIP_MAGIC.test(firstContent)) {
      return {
        source: strippedLines.join('\n').trim(),
        cellKind: 'code',
        languageId: 'shellscript',
        startLine,
        endLine,
      };
    }
  }

  // Default to python for unknown magic
  return {
    source: strippedLines.join('\n'),
    cellKind: 'code',
    languageId: 'python',
    startLine,
    endLine,
  };
}

/**
 * Detect cell magic (%%sql, etc.) or line magic (%sql) and return language info
 */
function detectCellMagic(line: string): { language: CellLanguage } | null {
  const trimmed = line.trim();

  // Double-percent cell magics (%%sql)
  if (MAGIC_PATTERNS.CELL_MAGIC_SQL.test(trimmed)) {
    return { language: 'sql' };
  }
  if (MAGIC_PATTERNS.CELL_MAGIC_PYTHON.test(trimmed)) {
    return { language: 'python' };
  }
  if (MAGIC_PATTERNS.CELL_MAGIC_SHELL.test(trimmed)) {
    return { language: 'shellscript' };
  }

  // Single-percent line magics at start of cell (%sql)
  // These indicate the user wants this cell to be treated as that language
  if (MAGIC_PATTERNS.LINE_MAGIC_SQL.test(trimmed)) {
    return { language: 'sql' };
  }
  if (MAGIC_PATTERNS.LINE_MAGIC_SHELL.test(trimmed)) {
    return { language: 'shellscript' };
  }
  if (MAGIC_PATTERNS.LINE_MAGIC_PIP.test(trimmed)) {
    return { language: 'shellscript' };
  }
  if (MAGIC_PATTERNS.LINE_MAGIC_MARKDOWN.test(trimmed)) {
    return { language: 'markdown' };
  }

  return null;
}

/**
 * Parse percent format notebook
 */
function parsePercentFormat(lines: string[]): ParsedCell[] {
  const cells: ParsedCell[] = [];
  let currentCellLines: string[] = [];
  let cellStartLine = 0;
  let currentCellType: 'code' | 'markup' = 'code';
  let currentLanguage: CellLanguage = 'python';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const match = MARKERS.PERCENT_CELL_REGEX.exec(line.trim());

    if (match) {
      // Save previous cell if it has content
      if (currentCellLines.length > 0) {
        cells.push({
          source: currentCellLines.join('\n').trim(),
          cellKind: currentCellType,
          languageId: currentLanguage,
          startLine: cellStartLine,
          endLine: i,
        });
      }

      // Start new cell
      currentCellLines = [];
      cellStartLine = i + 1;

      // Check for metadata like [markdown]
      const metadata = match[1]?.toLowerCase();
      if (metadata === 'markdown' || metadata === 'md') {
        currentCellType = 'markup';
        currentLanguage = 'markdown';
      } else {
        currentCellType = 'code';
        currentLanguage = 'python';
      }
    } else {
      currentCellLines.push(line);
    }
  }

  // Don't forget the last cell
  if (currentCellLines.length > 0) {
    cells.push({
      source: currentCellLines.join('\n').trim(),
      cellKind: currentCellType,
      languageId: currentLanguage,
      startLine: cellStartLine,
      endLine: lines.length,
    });
  }

  return cells;
}

/**
 * Serialize cells back to .py format
 */
export function serializeNotebook(
  cells: ParsedCell[],
  format: NotebookFormat,
  includeHeader: boolean = true
): string {
  if (format === 'plain' || cells.length === 0) {
    return cells.map(c => c.source).join('\n');
  }

  if (format === 'percent') {
    return serializePercentFormat(cells);
  }

  return serializeDatabricksFormat(cells, includeHeader);
}

/**
 * Serialize to Databricks format
 */
function serializeDatabricksFormat(cells: ParsedCell[], includeHeader: boolean): string {
  const lines: string[] = [];

  if (includeHeader) {
    lines.push(MARKERS.DATABRICKS_HEADER);
  }

  for (const cell of cells) {
    lines.push('');
    lines.push(MARKERS.DATABRICKS_CELL);
    lines.push('');

    if (cell.cellKind === 'markup' && cell.languageId === 'markdown') {
      // Convert to MAGIC %md format
      const contentLines = cell.source.split('\n');
      lines.push(`${MARKERS.MAGIC_PREFIX}%md`);
      for (const contentLine of contentLines) {
        lines.push(`${MARKERS.MAGIC_PREFIX}${contentLine}`);
      }
    } else if (cell.languageId === 'sql') {
      // Convert to MAGIC %sql format
      const contentLines = cell.source.split('\n');
      lines.push(`${MARKERS.MAGIC_PREFIX}%sql`);
      for (const contentLine of contentLines) {
        lines.push(`${MARKERS.MAGIC_PREFIX}${contentLine}`);
      }
    } else if (cell.languageId === 'shellscript') {
      // Convert to MAGIC %sh format
      const contentLines = cell.source.split('\n');
      lines.push(`${MARKERS.MAGIC_PREFIX}%sh`);
      for (const contentLine of contentLines) {
        lines.push(`${MARKERS.MAGIC_PREFIX}${contentLine}`);
      }
    } else {
      // Python code
      const firstLine = cell.source.split('\n')[0]?.trim() ?? '';

      // Check if this is a line magic (like %restart_python, %pip, %run)
      // These need to be wrapped in # MAGIC prefix for Databricks format
      if (/^%[a-zA-Z_]/.test(firstLine) && !firstLine.startsWith('%%')) {
        const contentLines = cell.source.split('\n');
        for (const contentLine of contentLines) {
          lines.push(`${MARKERS.MAGIC_PREFIX}${contentLine}`);
        }
      } else {
        // Regular Python code - output as-is
        lines.push(cell.source);
      }
    }
  }

  return lines.join('\n') + '\n';
}

/**
 * Serialize to percent format
 */
function serializePercentFormat(cells: ParsedCell[]): string {
  const lines: string[] = [];

  for (const cell of cells) {
    if (cell.cellKind === 'markup' && cell.languageId === 'markdown') {
      lines.push('# %% [markdown]');
    } else {
      lines.push('# %%');
    }
    lines.push(cell.source);
    lines.push('');
  }

  return lines.join('\n');
}
