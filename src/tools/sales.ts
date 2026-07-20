/**
 * Tool de leitura: GET /v3/sales-today.
 *
 * Resumo agregado do dia — nunca a lista de transações individuais
 * (para isso existe listTransactions, que já não expõe PII).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

export const getSalesTodayShape = {};

export const getSalesTodaySchema = z.object(getSalesTodayShape).strict();

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

async function handleGetSalesToday(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    getSalesTodaySchema.parse(args);

    const response = await client.get("/v3/sales-today", {});
    const currency = pickString(response, "currency") ?? "BRL";
    const paid = pickObject(response, "paid");
    const pending = pickObject(response, "pending");
    const date = pickString(response, "date") ?? "hoje";

    const lines: string[] = [`Vendas de ${date} 💰`, ""];

    if (paid) {
      const total = pickNumber(paid, "total") ?? 0;
      const count = pickNumber(paid, "count") ?? 0;
      const avg = pickNumber(paid, "avg_ticket") ?? 0;
      lines.push(
        `Pago: ${formatMoney(total, currency)} em ${count} venda(s) — ticket médio ${formatMoney(avg, currency)}`,
      );
      const byMethod = pickObjectArray(paid, "by_method");
      for (const row of byMethod) {
        const method = pickString(row, "payment_method") ?? "pix";
        const methodTotal = pickNumber(row, "total") ?? 0;
        const methodCount = pickNumber(row, "count") ?? 0;
        lines.push(`  • ${method}: ${formatMoney(methodTotal, currency)} (${methodCount})`);
      }
    }

    if (pending) {
      const total = pickNumber(pending, "total") ?? 0;
      const count = pickNumber(pending, "count") ?? 0;
      lines.push(
        "",
        `Pendente: ${formatMoney(total, currency)} em ${count} cobrança(s) aguardando pagamento`,
      );
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerSalesTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "getSalesToday",
    {
      title: "Vendas de hoje",
      description:
        "Resumo agregado das vendas do dia (horário de Brasília) da conta ZuckPay autenticada: total pago, " +
        "contagem, ticket médio, breakdown por método de pagamento e total pendente. Somente leitura, " +
        "não retorna transações individuais nem dado de comprador.",
      inputSchema: getSalesTodayShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleGetSalesToday(client, args),
  );
}
