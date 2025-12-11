# Databricks notebook source

# COMMAND ----------

# MAGIC %md
# MAGIC # Example Databricks Notebook
# MAGIC
# MAGIC This notebook demonstrates the cell types supported by the extension.

# COMMAND ----------

# Python code cell
import pandas as pd
import numpy as np

df = pd.DataFrame({
    'name': ['Alice', 'Bob', 'Charlie'],
    'age': [25, 30, 35]
})

print(df)

# COMMAND ----------

# MAGIC %sql
# MAGIC -- SQL cell (will be converted to %%sql magic for kernel execution)
# MAGIC SELECT * FROM my_table LIMIT 10

# COMMAND ----------

# MAGIC %md
# MAGIC ## Another Markdown Section
# MAGIC
# MAGIC - Item 1
# MAGIC - Item 2
# MAGIC - Item 3

# COMMAND ----------

# More Python code
result = df['age'].mean()
print(f"Average age: {result}")

# COMMAND ----------

# MAGIC %sh
# MAGIC # Shell command cell
# MAGIC echo "Hello from bash!"
# MAGIC ls -la
