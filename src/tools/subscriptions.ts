/**
 * Tool de leitura: GET /v3/subscriptions.
 *
 * Contém PII de comprador (nome/e-mail/telefone) já mascarada pelo backend.
 * `assertNoRawPii` roda como segunda barreira antes de repassar ao modelo.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString } from "../utils/format.js";
import { assertNoRawPii } from "../utils/redact.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

const FORBIDDEN_SUBSCRIPTION_FIELDS = ["sub_key", "stripe_sub", "pagarme_sub"] as const;

export const listSubscriptionsShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe("Quantidade por página (1 a 50; padrão 20)")
    .optional(),
};

export const listSubscriptionsSchema = z.object(listSubscriptionsShape).strict();

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

function describeSubscription(row: Record<string, unknown>): string {
  const product = pickString(row, "product_name") ?? "(produto desconhecido)";
  const status = pickString(row, "status") ?? "?";
  const amount = pickNumber(row, "amount");
  const period = pickString(row, "billing_period") ?? "monthly";
  const customer = pickString(row, "customer_name") ?? "(sem nome)";
  const count = pickNumber(row, "payment_count");

  const parts = [
    product,
    status,
    amount !== undefined ? formatMoney(amount) : "(sem valor)",
    period,
    customer,
  ];
  if (count !== undefined) {
    parts.push(`${count} pagamento(s)`);
  }
  return `• ${parts.join(" · ")}`;
}

async function handleListSubscriptions(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = listSubscriptionsSchema.parse(args);

    const query: Record<string, string> = {};
    if (input.limit !== undefined) query.limit = String(input.limit);

    const response = await client.get("/v3/subscriptions", query);

    assertNoRawPii(response, FORBIDDEN_SUBSCRIPTION_FIELDS);

    const rows = pickObjectArray(response, "subscriptions");

    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push("Nenhuma assinatura encontrada nesta conta.");
    } else {
      lines.push(`Assinaturas (${rows.length}) 🔁`, "");
      for (const row of rows) {
        lines.push(describeSubscription(row));
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerSubscriptionTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listSubscriptions",
    {
      title: "Listar assinaturas",
      description:
        "Lista as assinaturas (recorrências) da conta ZuckPay autenticada: produto, status (ativa/cancelada/" +
        "inativa/pendente), valor, periodicidade e dados do assinante (mascarados). Somente leitura.",
      inputSchema: listSubscriptionsShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListSubscriptions(client, args),
  );
}
