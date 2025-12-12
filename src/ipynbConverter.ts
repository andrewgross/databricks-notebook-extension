/**
 * Converts between Databricks .py format and .ipynb JSON format.
 *
 * This allows us to use VS Code's built-in jupyter-notebook serializer
 * while storing files in Databricks .py format on disk.
 */

import { parseNotebook, serializeNotebook } from './parser';
import { ParsedCell } from './types';

/**
 * Cell metadata for language tracking
 */
interface CellMetadata {
  // VS Code Jupyter extension reads this for language identification
  vscode?: {
    languageId?: string;
  };
  // Our custom metadata for round-trip
  databricks_language?: string;
  [key: string]: unknown;
}

/**
 * Jupyter notebook cell structure
 */
interface IpynbCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  metadata: CellMetadata;
  execution_count?: number | null;
  outputs?: unknown[];
}

/**
 * Jupyter notebook structure (.ipynb format)
 */
interface IpynbNotebook {
  cells: IpynbCell[];
  metadata: {
    kernelspec?: {
      display_name: string;
      language: string;
      name: string;
    };
    language_info?: {
      name: string;
      version?: string;
    };
    // Store our custom metadata to preserve format info
    databricks_notebook?: {
      format: 'databricks' | 'percent' | 'plain';
      hasDatabricksHeader: boolean;
    };
    [key: string]: unknown;
  };
  nbformat: number;
  nbformat_minor: number;
}

/**
 * Convert Databricks .py content to .ipynb JSON format
 */
export function pyToIpynb(pyContent: string): string {
  const parsed = parseNotebook(pyContent);

  const ipynbCells: IpynbCell[] = parsed.cells.map(cell => {
    // Split source into lines (ipynb stores as array of lines)
    const sourceLines = splitIntoLines(cell.source);

    if (cell.cellKind === 'markup') {
      return {
        cell_type: 'markdown',
        source: sourceLines,
        metadata: {},
      };
    }

    // For non-Python code cells, add the magic command so the kernel
    // knows how to execute them. This means %%sql will be visible in the
    // cell, but it gets stripped when saving back to .py format.
    let finalSource = sourceLines;
    if (cell.languageId === 'sql') {
      finalSource = ['%%sql\n', ...sourceLines];
    } else if (cell.languageId === 'shellscript') {
      finalSource = ['%%bash\n', ...sourceLines];
    }

    // Build metadata for round-trip and VS Code language hints
    const metadata: CellMetadata = {
      databricks_language: cell.languageId,
    };

    // Set VS Code language ID for syntax highlighting
    if (cell.languageId !== 'python') {
      metadata.vscode = {
        languageId: cell.languageId,
      };
    }

    return {
      cell_type: 'code',
      source: finalSource,
      metadata,
      execution_count: null,
      outputs: [],
    };
  });

  const ipynb: IpynbNotebook = {
    cells: ipynbCells,
    metadata: {
      kernelspec: {
        display_name: 'Python 3',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        version: '3.9.0',
      },
      // Preserve format info for round-trip
      databricks_notebook: {
        format: parsed.format,
        hasDatabricksHeader: parsed.hasDatabricksHeader,
      },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };

  return JSON.stringify(ipynb, null, 1);
}

/**
 * Convert .ipynb JSON format back to Databricks .py content
 */
export function ipynbToPy(ipynbContent: string): string {
  const ipynb = JSON.parse(ipynbContent) as IpynbNotebook;

  // Get format info from metadata, defaulting to databricks
  const format = ipynb.metadata.databricks_notebook?.format ?? 'databricks';
  const hasDatabricksHeader = ipynb.metadata.databricks_notebook?.hasDatabricksHeader ?? true;

  const cells: ParsedCell[] = ipynb.cells.map((cell, index) => {
    const source = joinLines(cell.source);

    if (cell.cell_type === 'markdown') {
      return {
        source,
        cellKind: 'markup' as const,
        languageId: 'markdown' as const,
        startLine: index,
        endLine: index + 1,
      };
    }

    // For code cells, detect and strip magic commands
    const { content, language } = extractMagicAndContent(source, cell.metadata);

    return {
      source: content,
      cellKind: 'code' as const,
      languageId: language,
      startLine: index,
      endLine: index + 1,
    };
  });

  return serializeNotebook(cells, format, hasDatabricksHeader);
}

/**
 * Split content into lines, preserving newlines as ipynb expects
 */
function splitIntoLines(content: string): string[] {
  if (!content) {
    return [];
  }

  const lines = content.split('\n');
  // Add newline to all lines except the last (if it doesn't end with newline)
  return lines.map((line, i) => {
    if (i < lines.length - 1) {
      return line + '\n';
    }
    return line;
  });
}

/**
 * Join ipynb lines array back into string
 */
function joinLines(lines: string | string[]): string {
  if (typeof lines === 'string') {
    return lines;
  }
  return lines.join('');
}

/**
 * Extract magic command and return clean content with detected language
 */
function extractMagicAndContent(
  source: string,
  metadata: CellMetadata
): { content: string; language: ParsedCell['languageId'] } {
  // Check if we stored the original language (prefer our custom metadata)
  const storedLanguage = metadata.databricks_language;
  // Also check VS Code metadata as fallback
  const vscodeLanguage = metadata.vscode?.languageId;

  const lines = source.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Check for double-percent cell magic (%%sql)
  if (firstLine === '%%sql') {
    return {
      content: lines.slice(1).join('\n'),
      language: 'sql',
    };
  }

  if (firstLine === '%%bash' || firstLine === '%%sh') {
    return {
      content: lines.slice(1).join('\n'),
      language: 'shellscript',
    };
  }

  if (firstLine === '%%python') {
    return {
      content: lines.slice(1).join('\n'),
      language: 'python',
    };
  }

  // Check for single-percent line magic at start of cell (%sql)
  if (firstLine === '%sql') {
    return {
      content: lines.slice(1).join('\n'),
      language: 'sql',
    };
  }

  if (firstLine === '%sh' || firstLine === '%bash') {
    return {
      content: lines.slice(1).join('\n'),
      language: 'shellscript',
    };
  }

  if (firstLine === '%md') {
    return {
      content: lines.slice(1).join('\n'),
      language: 'markdown',
    };
  }

  // Check for any other single-line % magic (like %restart_python, %pip, %run)
  // These stay as Python cells but we track them so they serialize with # MAGIC
  if (/^%[a-zA-Z_]/.test(firstLine) && !firstLine.startsWith('%%')) {
    // This is a line magic - keep it in the source as-is
    // It will execute as a Python magic and serialize with # MAGIC prefix
    return {
      content: source,
      language: 'python',
    };
  }

  // Use stored language if available, otherwise default to python
  const language = storedLanguage ?? vscodeLanguage ?? 'python';
  return {
    content: source,
    language: language as ParsedCell['languageId'],
  };
}
