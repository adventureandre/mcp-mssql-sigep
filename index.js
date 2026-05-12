import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sql from "mssql";

const server = new McpServer({
  name: "mcp-mssql-sigep",
  version: "1.0.0",
});

const MAX_ROWS = 50;

function getMssqlConfig(database) {
  return {
    server: process.env.MSSQL_HOST || "localhost",
    port: parseInt(process.env.MSSQL_PORT || "1433"),
    user: process.env.MSSQL_USER || "",
    password: process.env.MSSQL_PASSWORD || "",
    database: database || "master",
    options: {
      encrypt: process.env.MSSQL_ENCRYPT === "true",
      trustServerCertificate: true,
    },
    requestTimeout: 30000,
    connectionTimeout: 15000,
  };
}

function txt(text) {
  return { content: [{ type: "text", text }] };
}
function jsonTxt(obj) {
  return txt(JSON.stringify(obj, null, 2));
}

// ========================================
// Tool: listDatabases
// ========================================

server.tool(
  "listDatabases",
  "Lista todos os bancos de dados disponiveis no servidor MSSQL ",
  {},
  async () => {
    let pool = null;
    try {
      pool = await sql.connect(getMssqlConfig());
      const result = await pool
        .request()
        .query("SELECT name FROM sys.databases ORDER BY name");
      const databases = result.recordset.map((r) => r.name);
      return jsonTxt({
        success: true,
        total: databases.length,
        databases,
      });
    } catch (error) {
      return jsonTxt({ success: false, error: error.message });
    } finally {
      if (pool) await pool.close();
    }
  },
);

// ========================================
// Tool: describeTable
// ========================================

server.tool(
  "describeTable",
  "Descreve a estrutura de uma tabela (colunas, tipos, nullability) no banco MSSQL especificado",
  {
    databaseName: z.string(),
    tableName: z.string(),
  },
  async ({ databaseName, tableName }) => {
    const safeDb = databaseName.replace(/[^a-zA-Z0-9_]/g, "");
    const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, "");
    let pool = null;
    try {
      pool = await sql.connect(getMssqlConfig(safeDb));
      const result = await pool.request().query(`
        SELECT
          COLUMN_NAME as column_name,
          DATA_TYPE as data_type,
          CHARACTER_MAXIMUM_LENGTH as max_length,
          IS_NULLABLE as is_nullable,
          COLUMN_DEFAULT as default_value
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = '${safeTable}'
        ORDER BY ORDINAL_POSITION
      `);
      if (result.recordset.length === 0) {
        return jsonTxt({
          success: false,
          error: `Tabela '${tableName}' nao encontrada no banco '${databaseName}'.`,
        });
      }
      return jsonTxt({
        success: true,
        database: databaseName,
        table: tableName,
        totalColumns: result.recordset.length,
        columns: result.recordset,
      });
    } catch (error) {
      return jsonTxt({ success: false, error: error.message });
    } finally {
      if (pool) await pool.close();
    }
  },
);

// ========================================
// Tool: executeQuery
// ========================================

server.tool(
  "executeQuery",
  "Executa consultas SELECT no banco MSSQL. Apenas SELECT permitido, limite de 50 linhas.",
  {
    databaseName: z.string(),
    query: z.string(),
  },
  async ({ databaseName, query }) => {
    const upper = query.trim().toUpperCase();
    const blocked = [
      "INSERT",
      "UPDATE",
      "DELETE",
      "DROP",
      "ALTER",
      "TRUNCATE",
      "CREATE",
      "EXEC",
      "EXECUTE",
      "GRANT",
      "REVOKE",
    ];
    const firstWord = upper.split(/\s+/)[0];
    if (firstWord && blocked.includes(firstWord)) {
      return jsonTxt({
        success: false,
        error: `Comando '${firstWord}' nao permitido. Apenas SELECT.`,
      });
    }

    const safeDb = databaseName.replace(/[^a-zA-Z0-9_]/g, "");
    let pool = null;
    try {
      pool = await sql.connect(getMssqlConfig(safeDb));
      let safeQuery = query.trim();
      if (upper.startsWith("SELECT") && !upper.includes("TOP")) {
        safeQuery = safeQuery.replace(/^SELECT/i, `SELECT TOP ${MAX_ROWS}`);
      }
      const result = await pool.request().query(safeQuery);
      const rowCount = result.recordset?.length || 0;
      return jsonTxt({
        success: true,
        database: databaseName,
        total: rowCount,
        data: result.recordset || [],
      });
    } catch (error) {
      return jsonTxt({ success: false, error: error.message });
    } finally {
      if (pool) await pool.close();
    }
  },
);

// ========================================
// Start
// ========================================

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("MCP MSSQL SIGEP rodando via STDIO...");
