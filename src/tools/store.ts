/**
 * Tool de leitura: GET /v3/store.
 *
 * Somente-leitura. Não expõe custom_css/custom_html/custom_js nem
 * config de pagamento/publicação — ver plano de expansão do MCP.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

export const getStoreShape = {};

export const getStoreSchema = z.object(getStoreShape).strict();

function pickObject(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo passado pelo nosso código
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function handleGetStore(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    getStoreSchema.parse(args);

    const response = await client.get("/v3/store", {});
    const store = pickObject(response, "store");

    if (!store) {
      return okResult(client.redact, "Esta conta ainda não tem uma loja criada.", response);
    }

    const name = pickString(store, "name") ?? "(sem nome)";
    const status = pickString(store, "status") ?? "?";
    const slug = pickString(store, "slug");
    const domain = pickString(store, "domain");

    const lines = [`Loja: ${name}`, `Status: ${status}`];
    if (slug !== undefined) lines.push(`Slug: ${slug}`);
    if (domain !== undefined) lines.push(`Domínio: ${domain}`);

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerStoreTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "getStore",
    {
      title: "Detalhar loja",
      description:
        "Retorna os dados da loja (storefront) da conta ZuckPay autenticada: nome, status, slug, domínio, " +
        "descrição e redes sociais. Somente leitura — não retorna código customizado nem config de pagamento.",
      inputSchema: getStoreShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleGetStore(client, args),
  );
}
