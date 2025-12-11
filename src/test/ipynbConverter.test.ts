import { describe, it, expect } from 'vitest';
import { pyToIpynb, ipynbToPy } from '../ipynbConverter';

interface IpynbCell {
  cell_type: 'code' | 'markdown' | 'raw';
  source: string[];
  metadata: Record<string, unknown>;
  execution_count?: number | null;
  outputs?: unknown[];
}

interface IpynbNotebook {
  cells: IpynbCell[];
  metadata: {
    databricks_notebook?: {
      format: string;
      hasDatabricksHeader: boolean;
    };
    [key: string]: unknown;
  };
  nbformat: number;
  nbformat_minor: number;
}

describe('pyToIpynb', () => {
  it('converts simple Databricks notebook to ipynb', () => {
    const pyContent = `# Databricks notebook source

# COMMAND ----------

import pandas as pd

# COMMAND ----------

print("hello")
`;

    const ipynbJson = pyToIpynb(pyContent);
    const ipynb = JSON.parse(ipynbJson) as IpynbNotebook;

    expect(ipynb.nbformat).toBe(4);
    expect(ipynb.cells).toHaveLength(2);
    expect(ipynb.cells[0].cell_type).toBe('code');
    expect(ipynb.cells[0].source.join('')).toContain('import pandas as pd');
    expect(ipynb.cells[1].source.join('')).toContain('print("hello")');
  });

  it('converts markdown cells correctly', () => {
    const pyContent = `# Databricks notebook source

# COMMAND ----------

# MAGIC %md
# MAGIC # Title
# MAGIC Some description

# COMMAND ----------

print("code")
`;

    const ipynbJson = pyToIpynb(pyContent);
    const ipynb = JSON.parse(ipynbJson) as IpynbNotebook;

    expect(ipynb.cells).toHaveLength(2);
    expect(ipynb.cells[0].cell_type).toBe('markdown');
    expect(ipynb.cells[0].source.join('')).toContain('# Title');
    expect(ipynb.cells[1].cell_type).toBe('code');
  });

  it('converts SQL cells with magic prefix', () => {
    const pyContent = `# Databricks notebook source

# COMMAND ----------

# MAGIC %sql
# MAGIC SELECT * FROM table

# COMMAND ----------

print("python")
`;

    const ipynbJson = pyToIpynb(pyContent);
    const ipynb = JSON.parse(ipynbJson) as IpynbNotebook;

    expect(ipynb.cells).toHaveLength(2);
    expect(ipynb.cells[0].cell_type).toBe('code');
    // SQL cells should have %%sql magic added for kernel execution
    expect(ipynb.cells[0].source.join('')).toContain('%%sql');
    expect(ipynb.cells[0].source.join('')).toContain('SELECT * FROM table');
  });

  it('preserves format metadata for round-trip', () => {
    const pyContent = `# Databricks notebook source

# COMMAND ----------

print("hello")
`;

    const ipynbJson = pyToIpynb(pyContent);
    const ipynb = JSON.parse(ipynbJson) as IpynbNotebook;

    expect(ipynb.metadata.databricks_notebook).toBeDefined();
    expect(ipynb.metadata.databricks_notebook?.format).toBe('databricks');
    expect(ipynb.metadata.databricks_notebook?.hasDatabricksHeader).toBe(true);
  });
});

describe('ipynbToPy', () => {
  it('converts ipynb back to Databricks format', () => {
    const ipynb = {
      cells: [
        {
          cell_type: 'code',
          source: ['import pandas as pd'],
          metadata: {},
          execution_count: null,
          outputs: [],
        },
        {
          cell_type: 'code',
          source: ['print("hello")'],
          metadata: {},
          execution_count: null,
          outputs: [],
        },
      ],
      metadata: {
        databricks_notebook: {
          format: 'databricks',
          hasDatabricksHeader: true,
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };

    const pyContent = ipynbToPy(JSON.stringify(ipynb));

    expect(pyContent).toContain('# Databricks notebook source');
    expect(pyContent).toContain('# COMMAND ----------');
    expect(pyContent).toContain('import pandas as pd');
    expect(pyContent).toContain('print("hello")');
  });

  it('converts markdown cells back to MAGIC format', () => {
    const ipynb = {
      cells: [
        {
          cell_type: 'markdown',
          source: ['# Title\n', 'Description'],
          metadata: {},
        },
      ],
      metadata: {
        databricks_notebook: {
          format: 'databricks',
          hasDatabricksHeader: true,
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };

    const pyContent = ipynbToPy(JSON.stringify(ipynb));

    expect(pyContent).toContain('# MAGIC %md');
    expect(pyContent).toContain('# MAGIC # Title');
  });

  it('strips %%sql magic and converts to MAGIC format', () => {
    const ipynb = {
      cells: [
        {
          cell_type: 'code',
          source: ['%%sql\n', 'SELECT * FROM table'],
          metadata: {},
          execution_count: null,
          outputs: [],
        },
      ],
      metadata: {
        databricks_notebook: {
          format: 'databricks',
          hasDatabricksHeader: true,
        },
      },
      nbformat: 4,
      nbformat_minor: 5,
    };

    const pyContent = ipynbToPy(JSON.stringify(ipynb));

    expect(pyContent).toContain('# MAGIC %sql');
    expect(pyContent).toContain('# MAGIC SELECT * FROM table');
    expect(pyContent).not.toContain('%%sql');
  });
});

describe('round-trip conversion', () => {
  it('preserves content through py -> ipynb -> py conversion', () => {
    const originalPy = `# Databricks notebook source

# COMMAND ----------

import pandas as pd

# COMMAND ----------

# MAGIC %md
# MAGIC # Title

# COMMAND ----------

print("hello")
`;

    const ipynb = pyToIpynb(originalPy);
    const roundTrippedPy = ipynbToPy(ipynb);

    // Should contain all the key elements
    expect(roundTrippedPy).toContain('# Databricks notebook source');
    expect(roundTrippedPy).toContain('import pandas as pd');
    expect(roundTrippedPy).toContain('# MAGIC %md');
    expect(roundTrippedPy).toContain('# MAGIC # Title');
    expect(roundTrippedPy).toContain('print("hello")');
  });
});
