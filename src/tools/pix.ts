/**
 * Tools PIX: criação de cobrança (POST /v3/pix/qrcode) e consulta de
 * status (GET /v3/pix/status — serve PIX, SPEI e cartão).
 *
 * Padrão de segurança das tools:
 * - O shape zod é passado ao SDK (gera o JSON Schema anunciado ao cliente);
 * - O handler RE-parseia com o schema `.strict()` + refinements — nenhum
 *   campo chega à API sem validação;
 * - O body é montado campo a campo (allowlist), nunca espalhando o input.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString, statusLabel } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";
import {
  cpfSchema,
  descricaoSchema,
  digitsOnly,
  emailSchema,
  externalIdSchema,
  httpsUrlSchema,
  moneySchema,
  nomeSchema,
  productIdSchema,
  splitsSchema,
  telefoneSchema,
  TRACKING_FIELDS,
  trackingShape,
} from "../utils/schemas.js";

export const createPixChargeShape = {
  nome: nomeSchema,
  cpf: cpfSchema,
  email: emailSchema,
  telefone: telefoneSchema,
  valor: moneySchema({
    min: 0.01,
    description:
      "Valor da cobrança em reais (ex: 49.90). Atenção: algumas adquirentes exigem mínimo de R$ 10,00 — a API recusa se for o caso.",
  }),
  descricao: descricaoSchema(255).optional(),
  urlnoty: httpsUrlSchema(
    "URL https do seu sistema que receberá o postback (webhook) quando o pagamento for confirmado",
  ).optional(),
  external_id_client: externalIdSchema.optional(),
  product_id: productIdSchema.optional(),
  splits: splitsSchema.optional(),
  ...trackingShape(),
};

export const createPixChargeSchema = z.object(createPixChargeShape).strict();

export const getTransactionStatusShape = {
  transactionId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._:-]+$/, {
      message: "transactionId contém caracteres inválidos.",
    })
    .describe("ID da transação retornado pela ZuckPay na criação da cobrança")
    .optional(),
  externalIdClient: externalIdSchema
    .describe("ID externo do SEU sistema informado na criação (external_id_client)")
    .optional(),
};

export const getTransactionStatusSchema = z
  .object(getTransactionStatusShape)
  .strict()
  .refine((v) => (v.transactionId !== undefined) !== (v.externalIdClient !== undefined), {
    message: "Informe exatamente um: transactionId OU externalIdClient.",
  });

function pickId(response: unknown): string | undefined {
  return (
    pickString(response, "transactionId") ??
    pickNumber(response, "transactionId")?.toString() ??
    pickString(response, "id") ??
    pickNumber(response, "id")?.toString()
  );
}

async function handleCreatePixCharge(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = createPixChargeSchema.parse(args);

    const body: Record<string, unknown> = {
      nome: input.nome,
      cpf: digitsOnly(input.cpf),
      email: input.email,
      telefone: digitsOnly(input.telefone),
      valor: input.valor,
    };
    if (input.descricao !== undefined) body.descricao = input.descricao;
    if (input.urlnoty !== undefined) body.urlnoty = input.urlnoty;
    if (input.external_id_client !== undefined) body.external_id_client = input.external_id_client;
    if (input.product_id !== undefined) body.product_id = input.product_id;
    if (input.splits !== undefined) body.splits = input.splits;
    for (const field of TRACKING_FIELDS) {
      // eslint-disable-next-line security/detect-object-injection -- `field` vem do array const TRACKING_FIELDS
      const value = input[field];
      // eslint-disable-next-line security/detect-object-injection -- idem; body é objeto plano recém-criado
      if (value !== undefined) body[field] = value;
    }

    const response = await client.post("/v3/pix/qrcode", body);

    const transactionId = pickId(response);
    const amountLiquid = pickNumber(response, "amount_liquid");
    const qrcode = pickString(response, "qrcode");
    const qrcodeImage = pickString(response, "qrcode_image");
    const checkoutUrl = pickString(response, "checkout_url");

    const lines: string[] = ["Cobrança PIX criada ✅", ""];
    lines.push(`• Transação: ${transactionId ?? "(não informada)"}`);
    lines.push(
      `• Valor: ${formatMoney(input.valor)}` +
        (amountLiquid !== undefined ? ` (líquido estimado: ${formatMoney(amountLiquid)})` : ""),
    );
    if (input.external_id_client !== undefined) {
      lines.push(`• ID externo: ${input.external_id_client}`);
    }
    if (qrcode !== undefined) {
      lines.push("", "PIX copia-e-cola:", "```", qrcode, "```");
    }
    if (qrcodeImage !== undefined) {
      lines.push(`• Imagem do QR Code: ${qrcodeImage}`);
    }
    if (checkoutUrl !== undefined) {
      lines.push(`• Checkout hospedado: ${checkoutUrl}`);
      lines.push(
        "  (dica: envie o link do checkout quando não quiser renderizar o QR Code manualmente)",
      );
    }
    lines.push("", "Acompanhe o pagamento com a tool getTransactionStatus.");

    return okResult(client.redact, lines.join("\n"), response);
  });
}

async function handleGetTransactionStatus(
  client: ZuckPayClient,
  args: unknown,
): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = getTransactionStatusSchema.parse(args);

    const query: Record<string, string> =
      input.transactionId !== undefined
        ? { transactionId: input.transactionId }
        : { external_id_client: input.externalIdClient as string };

    const response = await client.get("/v3/pix/status", query);

    const status = pickString(response, "status");
    const transactionId = pickId(response);
    const amount = pickNumber(response, "amount") ?? pickNumber(response, "valor");
    const method = pickString(response, "method") ?? pickString(response, "payment_method");
    const paidAt = pickString(response, "paid_at") ?? pickString(response, "data_pagamento");

    const lines: string[] = ["Status da transação 🔎", ""];
    lines.push(`• Transação: ${transactionId ?? "(não informada)"}`);
    lines.push(`• Status: ${statusLabel(status)}`);
    if (amount !== undefined) lines.push(`• Valor: ${formatMoney(amount)}`);
    if (method !== undefined) lines.push(`• Método: ${method}`);
    if (paidAt !== undefined) lines.push(`• Pago em: ${paidAt}`);
    if (status !== undefined && status.toUpperCase() === "PENDING") {
      lines.push(
        "",
        "A consulta força sincronização com a adquirente quando pendente — " +
          "se o pagador acabou de pagar, consulte novamente em alguns segundos.",
      );
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerPixTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "createPixCharge",
    {
      title: "Criar cobrança PIX",
      description:
        "Cria uma cobrança PIX na ZuckPay e retorna o código copia-e-cola, a imagem do QR Code e o link de checkout hospedado. " +
        "Suporta idempotência (external_id_client), split de receita entre contas, webhook de confirmação (urlnoty) e parâmetros de rastreio (UTMs). " +
        "Valor em reais com até 2 casas decimais.",
      inputSchema: createPixChargeShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => handleCreatePixCharge(client, args),
  );

  server.registerTool(
    "getTransactionStatus",
    {
      title: "Consultar status de transação",
      description:
        "Consulta o status de uma transação ZuckPay (PIX, SPEI ou cartão) pelo transactionId OU pelo external_id_client do seu sistema (exatamente um dos dois). " +
        "Status possíveis: PENDING, PAID, FAILED, EXPIRADO.",
      inputSchema: getTransactionStatusShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleGetTransactionStatus(client, args),
  );
}
