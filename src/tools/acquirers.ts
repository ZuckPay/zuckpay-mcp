/**
 * Tool de leitura: GET /v3/acquirers.
 *
 * Rotas de adquirente (PSP/domínio de checkout, conversão) do seller.
 * Nunca credenciais de adquirente — isso é admin-only na plataforma e
 * não existe endpoint pra isso no MCP.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { pickNumber, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

export const listAcquirerRoutesShape = {};

export const listAcquirerRoutesSchema = z.object(listAcquirerRoutesShape).strict();

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

function describeRoute(row: Record<string, unknown>): string {
  const position = pickNumber(row, "position");
  const psp = pickString(row, "psp") ?? "(sem nome)";
  const domain = pickString(row, "domain");
  const conversion = pickNumber(row, "conversion");
  const total = pickNumber(row, "total");
  const paid = pickNumber(row, "paid");

  const parts = [psp];
  if (domain) parts.push(domain);
  if (conversion !== undefined) parts.push(`conversão ${conversion}%`);
  if (paid !== undefined && total !== undefined) parts.push(`${paid}/${total} pagas`);
  return `${position !== undefined ? `${position}. ` : "• "}${parts.join(" · ")}`;
}

async function handleListAcquirerRoutes(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    listAcquirerRoutesSchema.parse(args);

    const response = await client.get("/v3/acquirers", {});
    const routes = pickObjectArray(response, "routes");

    const lines: string[] = [];
    if (routes.length === 0) {
      lines.push("Nenhuma rota de adquirente disponível para esta conta no momento.");
    } else {
      lines.push(`Rotas de adquirente disponíveis (${routes.length}) 🔀`, "");
      for (const row of routes) {
        lines.push(describeRoute(row));
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerAcquirerTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listAcquirerRoutes",
    {
      title: "Listar rotas de adquirente",
      description:
        "Lista as rotas de adquirente disponíveis para a conta ZuckPay autenticada (PSP, domínio de checkout, " +
        "taxa de conversão recente), já filtradas por bloqueios/modo configurados na conta. Somente leitura — " +
        "nunca retorna credenciais de adquirente.",
      inputSchema: listAcquirerRoutesShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListAcquirerRoutes(client, args),
  );
}
