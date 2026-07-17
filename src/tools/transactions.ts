/**
 * Tool de listagem: GET /v3/transactions.
 *
 * Somente-leitura, com paginação keyset (cursor opaco devolvido pela API).
 * Todos os filtros são validados por enum/regex ANTES de virar query string —
 * nada de valor livre chega à API.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString, statusLabel } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";
import { externalIdSchema } from "../utils/schemas.js";

export const TRANSACTION_STATUSES = [
  "PAID",
  "PENDING",
  "WAITING_PAYMENT",
  "REFUSED",
  "EXPIRED",
  "REFUNDED",
  "CHARGEBACK",
  "FAILED",
] as const;

export const TRANSACTION_TYPES = ["DEPOSIT", "WITHDRAW"] as const;

export const PAYMENT_METHODS = [
  "pix",
  "spei",
  "credit_card",
  "paypal",
  "crypto",
  "mercadopago",
] as const;

const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use o formato YYYY-MM-DD." })
  .refine(
    (v) => {
      const [y, m, d] = v.split("-").map(Number);
      const dt = new Date(Date.UTC(y as number, (m as number) - 1, d));
      return (
        dt.getUTCFullYear() === y && dt.getUTCMonth() === (m as number) - 1 && dt.getUTCDate() === d
      );
    },
    { message: "Data inexistente no calendário." },
  );

export const listTransactionsShape = {
  status: z
    .enum(TRANSACTION_STATUSES)
    .describe("Filtra por status da transação (ex: PAID, PENDING)")
    .optional(),
  type: z
    .enum(TRANSACTION_TYPES)
    .describe("Filtra por tipo: DEPOSIT (vendas/cobranças) ou WITHDRAW (saques)")
    .optional(),
  payment_method: z.enum(PAYMENT_METHODS).describe("Filtra por método de pagamento").optional(),
  external_id_client: externalIdSchema
    .describe("Filtra pelo ID externo do SEU sistema (external_id_client)")
    .optional(),
  date_from: dateSchema
    .describe("Data inicial (YYYY-MM-DD, horário de Brasília, inclusive)")
    .optional(),
  date_to: dateSchema
    .describe("Data final (YYYY-MM-DD, horário de Brasília, inclusive)")
    .optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .describe("Quantidade por página (1 a 50; padrão 20)")
    .optional(),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9+/=_-]+$/, { message: "Cursor inválido." })
    .describe("Cursor opaco retornado em pagination.next_cursor da página anterior")
    .optional(),
};

export const listTransactionsSchema = z
  .object(listTransactionsShape)
  .strict()
  .refine((v) => v.date_from === undefined || v.date_to === undefined || v.date_from <= v.date_to, {
    message: "date_from deve ser anterior ou igual a date_to.",
  });

/** Extrai array de objetos de uma resposta desconhecida sem lançar. */
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

function pickPagination(obj: unknown): { hasMore: boolean; nextCursor?: string } {
  if (typeof obj !== "object" || obj === null) {
    return { hasMore: false };
  }
  const pagination = (obj as Record<string, unknown>).pagination;
  if (typeof pagination !== "object" || pagination === null) {
    return { hasMore: false };
  }
  const record = pagination as Record<string, unknown>;
  return {
    hasMore: record.has_more === true,
    nextCursor: typeof record.next_cursor === "string" ? record.next_cursor : undefined,
  };
}

function describeRow(row: Record<string, unknown>): string {
  const created = pickString(row, "created_at") ?? "(sem data)";
  const status = statusLabel(pickString(row, "status"));
  const amount = pickNumber(row, "amount");
  const currency = pickString(row, "original_currency") ?? "BRL";
  const method = pickString(row, "payment_method") ?? "pix";
  const id = pickString(row, "id") ?? "(sem id)";
  const externalId = pickString(row, "external_id_client");
  const type = pickString(row, "type");

  const parts = [
    `${created} — ${status}`,
    amount !== undefined ? formatMoney(amount, currency) : "(sem valor)",
    type === "WITHDRAW" ? "saque" : method,
    `id ${id}`,
  ];
  if (externalId !== undefined) {
    parts.push(`ext ${externalId}`);
  }
  return `• ${parts.join(" · ")}`;
}

async function handleListTransactions(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = listTransactionsSchema.parse(args);

    const query: Record<string, string> = {};
    if (input.status !== undefined) query.status = input.status;
    if (input.type !== undefined) query.type = input.type;
    if (input.payment_method !== undefined) query.payment_method = input.payment_method;
    if (input.external_id_client !== undefined) {
      query.external_id_client = input.external_id_client;
    }
    if (input.date_from !== undefined) query.date_from = input.date_from;
    if (input.date_to !== undefined) query.date_to = input.date_to;
    if (input.limit !== undefined) query.limit = String(input.limit);
    if (input.cursor !== undefined) query.cursor = input.cursor;

    const response = await client.get("/v3/transactions", query);

    const rows = pickObjectArray(response, "transactions");
    const { hasMore, nextCursor } = pickPagination(response);

    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push("Nenhuma transação encontrada com esses filtros.");
    } else {
      lines.push(`Transações (${rows.length} nesta página) 📋`, "");
      for (const row of rows) {
        lines.push(describeRow(row));
      }
    }
    if (hasMore && nextCursor !== undefined) {
      lines.push(
        "",
        "Há mais resultados. Para a próxima página, chame listTransactions novamente " +
          `com os MESMOS filtros e cursor="${nextCursor}".`,
      );
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerTransactionTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listTransactions",
    {
      title: "Listar transações",
      description:
        "Lista as transações da conta ZuckPay autenticada (vendas e saques), da mais recente para a mais antiga, " +
        "com filtros por status, tipo, método de pagamento, ID externo e período (datas no horário de Brasília). " +
        "Paginada por cursor: traga uma página por vez (padrão 20, máx 50) e use pagination.next_cursor para avançar — " +
        "NÃO tente carregar tudo de uma vez.",
      inputSchema: listTransactionsShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListTransactions(client, args),
  );
}
