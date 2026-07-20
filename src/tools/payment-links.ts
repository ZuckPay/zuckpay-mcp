/**
 * Tool de leitura: GET /v3/payment-links.
 *
 * Somente-leitura. Nenhuma tool de criação/edição existe aqui ainda
 * (Fase 2) — ver plano de expansão do MCP.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

export const listPaymentLinksShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .describe("Quantidade de links por página (1 a 100; padrão 50)")
    .optional(),
};

export const listPaymentLinksSchema = z.object(listPaymentLinksShape).strict();

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

function describeLink(row: Record<string, unknown>): string {
  const name = pickString(row, "name") ?? "(sem nome)";
  const status = pickString(row, "status") ?? "?";
  const amount = pickNumber(row, "amount");
  const slug = pickString(row, "slug");
  const views = pickNumber(row, "views");

  const parts = [name, amount !== undefined ? formatMoney(amount) : "valor livre", status];
  if (slug !== undefined) parts.push(slug);
  if (views !== undefined) parts.push(`${views} view(s)`);
  return `• ${parts.join(" · ")}`;
}

async function handleListPaymentLinks(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = listPaymentLinksSchema.parse(args);

    const query: Record<string, string> = {};
    if (input.limit !== undefined) query.limit = String(input.limit);

    const response = await client.get("/v3/payment-links", query);
    const rows = pickObjectArray(response, "payment_links");

    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push("Nenhum link de pagamento encontrado nesta conta.");
    } else {
      lines.push(`Links de pagamento (${rows.length}) 🔗`, "");
      for (const row of rows) {
        lines.push(describeLink(row));
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerPaymentLinkTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listPaymentLinks",
    {
      title: "Listar links de pagamento",
      description:
        "Lista os links de pagamento (Link de Pagamentos) cadastrados na conta ZuckPay autenticada: nome, " +
        "valor, status, slug e visualizações. Somente leitura — não cria nem edita links.",
      inputSchema: listPaymentLinksShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListPaymentLinks(client, args),
  );
}
