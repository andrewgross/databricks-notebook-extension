import { describe, it, expect } from 'vitest';
import { parseNotebook, serializeNotebook } from '../parser';
import { MARKERS } from '../types';

describe('parseNotebook', () => {
  describe('format detection', () => {
    it('detect_databricks_format_with_header_returns_databricks', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

import pandas as pd`;

      const result = parseNotebook(input);
      expect(result.format).toBe('databricks');
      expect(result.hasDatabricksHeader).toBe(true);
    });

    it('detect_databricks_format_without_header_returns_databricks', () => {
      const input = `import os
# COMMAND ----------

import pandas as pd`;

      const result = parseNotebook(input);
      expect(result.format).toBe('databricks');
      expect(result.hasDatabricksHeader).toBe(false);
    });

    it('detect_percent_format_returns_percent', () => {
      const input = `# %%
import pandas as pd

# %%
print("hello")`;

      const result = parseNotebook(input);
      expect(result.format).toBe('percent');
    });

    it('detect_plain_python_returns_plain', () => {
      const input = `import pandas as pd
print("hello")`;

      const result = parseNotebook(input);
      expect(result.format).toBe('plain');
      expect(result.cells).toHaveLength(1);
    });
  });

  describe('databricks format parsing', () => {
    it('parse_multiple_code_cells_returns_correct_count', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

import pandas as pd

# COMMAND ----------

df = pd.DataFrame()

# COMMAND ----------

print(df)`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(3);
      expect(result.cells[0]?.cellKind).toBe('code');
      expect(result.cells[0]?.languageId).toBe('python');
    });

    it('parse_markdown_magic_cell_returns_markup', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

# MAGIC %md
# MAGIC # Title
# MAGIC This is markdown`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.cellKind).toBe('markup');
      expect(result.cells[0]?.languageId).toBe('markdown');
      expect(result.cells[0]?.source).toContain('Title');
    });

    it('parse_sql_magic_cell_returns_sql_language', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT * FROM my_table
# MAGIC WHERE id > 0`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.cellKind).toBe('code');
      expect(result.cells[0]?.languageId).toBe('sql');
      expect(result.cells[0]?.source).toContain('SELECT');
    });

    it('parse_cell_magic_sql_returns_sql_language', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

%%sql
SELECT * FROM table`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.languageId).toBe('sql');
      expect(result.cells[0]?.source).toContain('SELECT');
    });

    it('parse_shell_magic_returns_shellscript', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

# MAGIC %sh
# MAGIC ls -la`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.languageId).toBe('shellscript');
    });

    it('parse_pip_magic_returns_shellscript', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

# MAGIC %pip install pyspark-toolkit>=0.9.0`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.cellKind).toBe('code');
      expect(result.cells[0]?.languageId).toBe('shellscript');
      expect(result.cells[0]?.source).toContain('%pip install pyspark-toolkit');
      expect(result.cells[0]?.source).not.toContain('# MAGIC');
    });

    it('parse_markdown_magic_with_empty_lines_no_trailing_space_returns_markup', () => {
      // Empty lines in magic cells often appear as '# MAGIC' without trailing space
      const input = `# Databricks notebook source
# COMMAND ----------

# MAGIC %md
# MAGIC # Title
# MAGIC
# MAGIC This is after an empty line`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.cellKind).toBe('markup');
      expect(result.cells[0]?.languageId).toBe('markdown');
      expect(result.cells[0]?.source).toContain('Title');
      expect(result.cells[0]?.source).toContain('This is after an empty line');
    });

    it('parse_markdown_magic_multiline_with_formatting_returns_markup', () => {
      // Real-world example with multiple empty lines and formatting
      const input = `# Databricks notebook source
# COMMAND ----------

# MAGIC %md
# MAGIC # Brand Search Vector Query Pipeline
# MAGIC
# MAGIC This pipeline runs vector searches against brand content with support for
# MAGIC two backends:
# MAGIC - **SQL**: Uses Databricks SQL LATERAL join (serverless)
# MAGIC - **FDTF**: Uses pyspark_toolkit.fdtf with ThreadPoolExecutor (supports filters)
# MAGIC
# MAGIC **Input Table:** \`yd_crdt.data_science_sandbox.brand_search_content_1\`
# MAGIC **Index:** \`yd_crdt.data_science_sandbox.brand_search_content_index_1_1\`
# MAGIC
# MAGIC Two query modes:
# MAGIC 1. \`search_content\` - Uses the full search_content column
# MAGIC 2. \`brand\` - Uses only the brand name`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.cellKind).toBe('markup');
      expect(result.cells[0]?.languageId).toBe('markdown');
      expect(result.cells[0]?.source).toContain('Brand Search Vector Query Pipeline');
      expect(result.cells[0]?.source).toContain('**SQL**');
      expect(result.cells[0]?.source).toContain('Two query modes:');
    });

    it('handle_varying_dash_counts_in_delimiter', () => {
      const input = `# Databricks notebook source
# COMMAND -----

cell1

# COMMAND --------------------

cell2`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(2);
    });
  });

  describe('percent format parsing', () => {
    it('parse_percent_code_cells_returns_python', () => {
      const input = `# %%
import pandas as pd

# %%
print("hello")`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(2);
      expect(result.cells[0]?.languageId).toBe('python');
    });

    it('parse_percent_markdown_cell_returns_markup', () => {
      const input = `# %%
import pandas as pd

# %% [markdown]
# Title`;

      const result = parseNotebook(input);
      expect(result.cells).toHaveLength(2);
      expect(result.cells[1]?.cellKind).toBe('markup');
      expect(result.cells[1]?.languageId).toBe('markdown');
    });
  });

  describe('multi-cell parsing with mixed types', () => {
    it('parse_notebook_with_pip_markdown_and_python_cells_returns_correct_types', () => {
      const input = `# Databricks notebook source

# COMMAND ----------

# MAGIC %pip install pyspark-toolkit>=0.9.0

# COMMAND ----------

# MAGIC %md
# MAGIC # Foo Search Data Preparation
# MAGIC
# MAGIC Prepares foo data for foo search to identify duplicate foos across retailers.
# MAGIC This creates the foo content table used by the foo search pipeline.

# COMMAND ----------

import pyspark.sql.functions as F
from pyspark.sql import Window
from pyspark.sql.dataframe import DataFrame
from pyspark_toolkit.uuid import uuid5
from foo import create_table`;

      const result = parseNotebook(input);

      expect(result.format).toBe('databricks');
      expect(result.hasDatabricksHeader).toBe(true);
      expect(result.cells).toHaveLength(3);

      // First cell: %pip magic (should be shell, keeping full %pip command)
      expect(result.cells[0]?.cellKind).toBe('code');
      expect(result.cells[0]?.languageId).toBe('shellscript');
      expect(result.cells[0]?.source).toContain('%pip install pyspark-toolkit');
      expect(result.cells[0]?.source).not.toContain('# MAGIC');

      // Second cell: markdown
      expect(result.cells[1]?.cellKind).toBe('markup');
      expect(result.cells[1]?.languageId).toBe('markdown');
      expect(result.cells[1]?.source).toContain('Foo Search Data Preparation');
      expect(result.cells[1]?.source).not.toContain('# MAGIC');

      // Third cell: Python imports
      expect(result.cells[2]?.cellKind).toBe('code');
      expect(result.cells[2]?.languageId).toBe('python');
      expect(result.cells[2]?.source).toContain('import pyspark.sql.functions');
    });

    it('parse_markdown_with_title_and_body_text_returns_markup', () => {
      const input = `# Databricks notebook source

# COMMAND ----------

# MAGIC %md
# MAGIC # Title Here
# MAGIC Some regular text after the title.`;

      const result = parseNotebook(input);

      expect(result.cells).toHaveLength(1);
      expect(result.cells[0]?.cellKind).toBe('markup');
      expect(result.cells[0]?.languageId).toBe('markdown');
      expect(result.cells[0]?.source).toContain('Title Here');
      expect(result.cells[0]?.source).toContain('Some regular text');
      expect(result.cells[0]?.source).not.toContain('# MAGIC');
    });
  });

  describe('edge cases', () => {
    it('parse_empty_file_returns_single_empty_cell', () => {
      const input = '';
      const result = parseNotebook(input);
      expect(result.format).toBe('plain');
      expect(result.cells).toHaveLength(1);
    });

    it('parse_file_with_only_header_returns_empty_cells', () => {
      const input = `# Databricks notebook source`;
      const result = parseNotebook(input);
      expect(result.format).toBe('databricks');
    });

    it('strip_magic_prefix_from_content', () => {
      const input = `# Databricks notebook source
# COMMAND ----------

# MAGIC %md
# MAGIC Hello world`;

      const result = parseNotebook(input);
      // Should not contain the MAGIC prefix in the output
      expect(result.cells[0]?.source).not.toContain('# MAGIC');
    });
  });
});

describe('serializeNotebook', () => {
  describe('databricks format', () => {
    it('serialize_code_cells_with_header', () => {
      const cells = [
        {
          source: 'import pandas as pd',
          cellKind: 'code' as const,
          languageId: 'python' as const,
          startLine: 0,
          endLine: 1,
        },
      ];

      const result = serializeNotebook(cells, 'databricks', true);
      expect(result).toContain(MARKERS.DATABRICKS_HEADER);
      expect(result).toContain(MARKERS.DATABRICKS_CELL);
      expect(result).toContain('import pandas as pd');
    });

    it('serialize_markdown_cell_adds_magic_prefix', () => {
      const cells = [
        {
          source: '# Title\nSome text',
          cellKind: 'markup' as const,
          languageId: 'markdown' as const,
          startLine: 0,
          endLine: 1,
        },
      ];

      const result = serializeNotebook(cells, 'databricks', true);
      expect(result).toContain('# MAGIC %md');
      expect(result).toContain('# MAGIC # Title');
    });

    it('serialize_sql_cell_adds_magic_prefix', () => {
      const cells = [
        {
          source: 'SELECT * FROM table',
          cellKind: 'code' as const,
          languageId: 'sql' as const,
          startLine: 0,
          endLine: 1,
        },
      ];

      const result = serializeNotebook(cells, 'databricks', true);
      expect(result).toContain('# MAGIC %sql');
    });
  });

  describe('percent format', () => {
    it('serialize_code_cells_with_percent_marker', () => {
      const cells = [
        {
          source: 'import pandas as pd',
          cellKind: 'code' as const,
          languageId: 'python' as const,
          startLine: 0,
          endLine: 1,
        },
      ];

      const result = serializeNotebook(cells, 'percent');
      expect(result).toContain('# %%');
      expect(result).toContain('import pandas as pd');
    });

    it('serialize_markdown_with_metadata', () => {
      const cells = [
        {
          source: '# Title',
          cellKind: 'markup' as const,
          languageId: 'markdown' as const,
          startLine: 0,
          endLine: 1,
        },
      ];

      const result = serializeNotebook(cells, 'percent');
      expect(result).toContain('# %% [markdown]');
    });
  });

  describe('round-trip', () => {
    it('roundtrip_databricks_preserves_content', () => {
      const input = `# Databricks notebook source

# COMMAND ----------

import pandas as pd

# COMMAND ----------

# MAGIC %md
# MAGIC # Title
`;

      const parsed = parseNotebook(input);
      const serialized = serializeNotebook(
        parsed.cells,
        'databricks',
        parsed.hasDatabricksHeader
      );
      const reparsed = parseNotebook(serialized);

      expect(reparsed.cells.length).toBe(parsed.cells.length);
      expect(reparsed.cells[0]?.source).toBe(parsed.cells[0]?.source);
      expect(reparsed.cells[1]?.cellKind).toBe(parsed.cells[1]?.cellKind);
    });

    it('roundtrip_percent_preserves_content', () => {
      const input = `# %%
import pandas as pd

# %% [markdown]
# Title
`;

      const parsed = parseNotebook(input);
      const serialized = serializeNotebook(parsed.cells, 'percent');
      const reparsed = parseNotebook(serialized);

      expect(reparsed.cells.length).toBe(parsed.cells.length);
    });

    it('roundtrip_databricks_markdown_with_empty_lines_preserves_content', () => {
      // Test round-trip with empty lines in markdown (represented as '# MAGIC' without trailing space)
      const input = `# Databricks notebook source

# COMMAND ----------

# MAGIC %md
# MAGIC # Title
# MAGIC
# MAGIC Paragraph after empty line
# MAGIC
# MAGIC - Item 1
# MAGIC - Item 2
`;

      const parsed = parseNotebook(input);
      expect(parsed.cells).toHaveLength(1);
      expect(parsed.cells[0]?.cellKind).toBe('markup');

      const serialized = serializeNotebook(
        parsed.cells,
        'databricks',
        parsed.hasDatabricksHeader
      );
      const reparsed = parseNotebook(serialized);

      expect(reparsed.cells.length).toBe(parsed.cells.length);
      expect(reparsed.cells[0]?.cellKind).toBe('markup');
      expect(reparsed.cells[0]?.source).toContain('Title');
      expect(reparsed.cells[0]?.source).toContain('Paragraph after empty line');
      expect(reparsed.cells[0]?.source).toContain('Item 1');
    });
  });
});
