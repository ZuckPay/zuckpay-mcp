/**
 * Tools de leitura: GET /v3/integrations/keys e GET /v3/integrations/webhooks.
 *
 * Somente-leitura. `listIntegrationKeys` nunca recebe o client_secret do
 * backend (allowlist server-side já exclui) — `assertNoRawPii` roda como
 * segunda barreira contra regressão.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { pickString } from "../utils/format.js";
import { assertNoRawPii } from "../utils/redact.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

const FORBIDDEN_KEY_FIELDS = [
  "client_secret",
  "client_secret_hash",
  "client_secret_last4",
  "crypt_version",
] as const;

export const listIntegrationKeysShape = {};
export const listIntegrationKeysSchema = z.object(listIntegrationKeysShape).strict();

export const listWebhooksShape = {};
export const listWebhooksSchema = z.object(listWebhooksShape).strict();

function pickObjectArray(obj: unknown, key: string): Record<string, unknown>[] {
  if (typeof obj !== "object" || obj === null) {
    return [];
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo passado pelo nosso código
  const value = (obj as Record<string, unknown>)[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is Record<string, unknown> =>
      typeof item === "object" && item !== null && !Array.isArray(item),
  );
}

async function handleListIntegrationKeys(
  client: ZuckPayClient,
  args: unknown,
): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    listIntegrationKeysSchema.parse(args);

    const response = await client.get("/v3/integrations/keys", {});
    assertNoRawPii(response, FORBIDDEN_KEY_FIELDS);

    const rows = pickObjectArray(response, "keys");
    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push("Nenhuma chave de integração cadastrada nesta conta.");
    } else {
      lines.push(`Chaves de integração (${rows.length}) 🔑`, "");
      for (const row of rows) {
        const name = pickString(row, "name") ?? "(sem nome)";
        const domain = pickString(row, "domain") ?? "(sem domínio)";
        const clientId = pickString(row, "client_id") ?? "(sem client_id)";
        lines.push(`• ${name} · ${domain} · client_id ${clientId}`);
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

async function handleListWebhooks(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    listWebhooksSchema.parse(args);

    const response = await client.get("/v3/integrations/webhooks", {});
    const rows = pickObjectArray(response, "webhooks");

    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push("Nenhum webhook cadastrado nesta conta.");
    } else {
      lines.push(`Webhooks (${rows.length}) 🪝`, "");
      for (const row of rows) {
        const name = pickString(row, "name") ?? "(sem nome)";
        const url = pickString(row, "url") ?? "(sem url)";
        const status = pickString(row, "status") ?? "active";
        lines.push(`• ${name} · ${url} · ${status}`);
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerIntegrationTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listIntegrationKeys",
    {
      title: "Listar chaves de integração",
      description:
        "Lista os metadados das chaves de integração (API keys) da conta ZuckPay autenticada: nome, domínio, " +
        "client_id e data de criação. Somente leitura — NUNCA retorna o client_secret. Não existe tool para " +
        "revelar, criar, rotacionar ou apagar chaves via MCP.",
      inputSchema: listIntegrationKeysShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListIntegrationKeys(client, args),
  );

  server.registerTool(
    "listWebhooks",
    {
      title: "Listar webhooks",
      description:
        "Lista os webhooks configurados na conta ZuckPay autenticada (nome, URL, eventos, status). Somente " +
        "leitura — criação/exclusão de webhook não está disponível via MCP nesta fase.",
      inputSchema: listWebhooksShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListWebhooks(client, args),
  );
}
