/**
 * Converts between Databricks .py format and .ipynb JSON format.
 *
 * This allows us to use VS Code's built-in jupyter-notebook serializer
 * while storing files in Databricks .py format on disk.
 */

import { parseNotebook, serializeNotebook } from './parser';
import { ParsedCell } from './types';

/**
 * Jupyter notebook cell structure
 */
interface IpynbCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  metadata: Record<string, unknown>;
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

    // For non-Python code cells, we need to add the magic command
    // so the kernel knows how to execute them
    let finalSource = sourceLines;
    if (cell.languageId === 'sql') {
      finalSource = ['%%sql\n', ...sourceLines];
    } else if (cell.languageId === 'shellscript') {
      finalSource = ['%%bash\n', ...sourceLines];
    }

    return {
      cell_type: 'code',
      source: finalSource,
      metadata: {
        // Store original language for round-trip
        databricks_language: cell.languageId,
      },
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
  metadata: Record<string, unknown>
): { content: string; language: ParsedCell['languageId'] } {
  // Check if we stored the original language
  const storedLanguage = metadata.databricks_language as string | undefined;

  const lines = source.split('\n');
  const firstLine = lines[0]?.trim() ?? '';

  // Check for cell magic
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

  // Use stored language if available, otherwise default to python
  return {
    content: source,
    language: (storedLanguage as ParsedCell['languageId']) ?? 'python',
  };
}
