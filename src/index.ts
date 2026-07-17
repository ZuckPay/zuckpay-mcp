/**
 * Entry stdio do zuckpay-mcp.
 *
 * stdout é EXCLUSIVO do protocolo MCP — qualquer diagnóstico vai para
 * stderr, sempre passado pelo redactor de segredos.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createClient } from "./client.js";
import { ConfigError, loadConfig, VERSION } from "./config.js";
import { registerPrompts } from "./prompts/index.js";
import { registerDocsResource } from "./resources/docs.js";
import { registerAllTools } from "./tools/index.js";
import { sanitizeText } from "./utils/errors.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[zuckpay-mcp] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }

  const client = createClient(config);

  const server = new McpServer({
    name: "zuckpay-mcp",
    version: VERSION,
  });

  registerAllTools(server, client, config);
  registerDocsResource(server);
  registerPrompts(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[zuckpay-mcp] v${VERSION} conectado via stdio.`);

  // Falhas do processo nunca podem ecoar segredos.
  process.on("uncaughtException", (err) => {
    console.error(client.redact(`[zuckpay-mcp] erro fatal: ${sanitizeText(err.message)}`));
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error(client.redact(`[zuckpay-mcp] rejeição não tratada: ${sanitizeText(message)}`));
    process.exit(1);
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[zuckpay-mcp] falha na inicialização: ${sanitizeText(message)}`);
  process.exit(1);
});
