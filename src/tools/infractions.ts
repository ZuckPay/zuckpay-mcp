/**
 * Tool de leitura: GET /v3/infractions.
 *
 * Tool mais sensível a PII da Fase 1 — chargebacks e pedidos de reembolso
 * contêm nome/e-mail/documento de compradores. O backend (v3/infractions.php)
 * já mascara e-mail/CPF e nunca inclui refund_token/proof_urls/campos ai_*,
 * mas `assertNoRawPii` roda aqui como segunda barreira: se o backend
 * regredir e devolver algo cru, a tool falha ruidosamente em vez de
 * repassar o dado ao modelo.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString } from "../utils/format.js";
import { assertNoRawPii } from "../utils/redact.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

const FORBIDDEN_INFRACTION_FIELDS = [
  "refund_token",
  "token_expires_at",
  "proof_urls",
  "proof_file",
  "processed_by",
  "ai_risk_level",
  "ai_recommendation",
  "ai_confidence",
  "ai_risk_flags",
  "ai_reasoning",
  "ai_suggested_reply",
  "ai_analyzed_at",
] as const;

export const INFRACTION_TYPES = ["all", "chargebacks", "refund_requests"] as const;

export const listInfractionsShape = {
  type: z
    .enum(INFRACTION_TYPES)
    .describe("Filtra por tipo: chargebacks, refund_requests, ou all (ambos, padrão)")
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe("Quantidade por lista (1 a 50; padrão 20)")
    .optional(),
};

export const listInfractionsSchema = z.object(listInfractionsShape).strict();

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

function describeChargeback(row: Record<string, unknown>): string {
  const status = pickString(row, "status") ?? "?";
  const amount = pickNumber(row, "amount");
  const reason = pickString(row, "reason") ?? "(sem motivo)";
  const id = pickString(row, "id") ?? "(sem id)";
  const parts = [
    status,
    amount !== undefined ? formatMoney(amount) : "(sem valor)",
    reason,
    `id ${id}`,
  ];
  return `• ${parts.join(" · ")}`;
}

function describeRefundRequest(row: Record<string, unknown>): string {
  const status = pickString(row, "status") ?? "?";
  const reason = pickString(row, "reason") ?? "(sem motivo)";
  const id = pickString(row, "id") ?? "(sem id)";
  return `• ${status} · ${reason} · id ${id}`;
}

async function handleListInfractions(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = listInfractionsSchema.parse(args);

    const query: Record<string, string> = {};
    if (input.type !== undefined) query.type = input.type;
    if (input.limit !== undefined) query.limit = String(input.limit);

    const response = await client.get("/v3/infractions", query);

    assertNoRawPii(response, FORBIDDEN_INFRACTION_FIELDS);

    const chargebacks = pickObjectArray(response, "chargebacks");
    const refundRequests = pickObjectArray(response, "refund_requests");

    const lines: string[] = [];
    lines.push(`Chargebacks (${chargebacks.length}) ⚠️`);
    if (chargebacks.length === 0) {
      lines.push("Nenhum chargebacks encontrado.");
    } else {
      for (const row of chargebacks) lines.push(describeChargeback(row));
    }

    lines.push("", `Pedidos de reembolso (${refundRequests.length}) ↩️`);
    if (refundRequests.length === 0) {
      lines.push("Nenhum pedido de reembolso encontrado.");
    } else {
      for (const row of refundRequests) lines.push(describeRefundRequest(row));
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerInfractionTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listInfractions",
    {
      title: "Listar infrações e MED",
      description:
        "Lista chargebacks e pedidos de reembolso (Infrações e MED) da conta ZuckPay autenticada. " +
        "Somente leitura. Documento e e-mail do comprador vêm sempre mascarados; nunca retorna o token " +
        "de reembolso nem campos internos da triagem por IA.",
      inputSchema: listInfractionsShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListInfractions(client, args),
  );
}
