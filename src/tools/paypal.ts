/**
 * Tools PayPal: POST /v3/paypal/order (cria ordem, retorna approvalUrl)
 * e POST /v3/paypal/capture (efetiva após aprovação do pagador).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";
import {
  descricaoSchema,
  emailSchema,
  externalIdSchema,
  httpsUrlSchema,
  moneySchema,
  nomeSchema,
  paypalCurrencySchema,
} from "../utils/schemas.js";

/** Moedas que o PayPal trata sem casas decimais. */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "HUF", "TWD"]);

export const createPayPalOrderShape = {
  nome: nomeSchema,
  email: emailSchema,
  valor: moneySchema({
    min: 0.01,
    description: "Valor da ordem na moeda escolhida (padrão: BRL)",
  }),
  currency: paypalCurrencySchema.optional(),
  descricao: descricaoSchema(127).optional(),
  urlnoty: httpsUrlSchema(
    "URL https do seu sistema que receberá o postback quando a ordem for capturada",
  ).optional(),
  return_url: httpsUrlSchema("URL https para onde o pagador volta após aprovar").optional(),
  cancel_url: httpsUrlSchema("URL https para onde o pagador volta se cancelar").optional(),
  external_id_client: externalIdSchema.optional(),
};

export const createPayPalOrderSchema = z
  .object(createPayPalOrderShape)
  .strict()
  .superRefine((value, ctx) => {
    const currency = value.currency ?? "BRL";
    if (ZERO_DECIMAL_CURRENCIES.has(currency) && !Number.isInteger(value.valor)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["valor"],
        message: `A moeda ${currency} não aceita casas decimais no PayPal — use um valor inteiro.`,
      });
    }
  });

export const capturePayPalOrderShape = {
  orderId: z
    .string()
    .trim()
    .min(5)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, { message: "orderId contém caracteres inválidos." })
    .describe("ID da ordem PayPal retornado por createPayPalOrder"),
};

export const capturePayPalOrderSchema = z.object(capturePayPalOrderShape).strict();

async function handleCreatePayPalOrder(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = createPayPalOrderSchema.parse(args);

    const body: Record<string, unknown> = {
      nome: input.nome,
      email: input.email,
      valor: input.valor,
    };
    if (input.currency !== undefined) body.currency = input.currency;
    if (input.descricao !== undefined) body.descricao = input.descricao;
    if (input.urlnoty !== undefined) body.urlnoty = input.urlnoty;
    if (input.return_url !== undefined) body.return_url = input.return_url;
    if (input.cancel_url !== undefined) body.cancel_url = input.cancel_url;
    if (input.external_id_client !== undefined) body.external_id_client = input.external_id_client;

    const response = await client.post("/v3/paypal/order", body);

    const orderId = pickString(response, "orderId") ?? pickString(response, "id");
    const approvalUrl = pickString(response, "approvalUrl") ?? pickString(response, "approval_url");
    const currency = input.currency ?? "BRL";

    const lines: string[] = ["Ordem PayPal criada ✅", ""];
    lines.push(`• Ordem: ${orderId ?? "(não informada)"}`);
    lines.push(`• Valor: ${formatMoney(input.valor, currency)}`);
    if (approvalUrl !== undefined) {
      lines.push("", `Link de aprovação (envie ao pagador): ${approvalUrl}`);
    }
    lines.push(
      "",
      "Fluxo: o pagador abre o link e aprova o pagamento no PayPal. " +
        "Depois da aprovação, chame capturePayPalOrder com este orderId para efetivar a cobrança.",
    );

    return okResult(client.redact, lines.join("\n"), response);
  });
}

async function handleCapturePayPalOrder(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = capturePayPalOrderSchema.parse(args);

    const response = await client.post("/v3/paypal/capture", { orderId: input.orderId });

    const status = pickString(response, "status");
    const lines: string[] = ["Captura PayPal processada", ""];
    lines.push(`• Ordem: ${input.orderId}`);
    lines.push(`• Status: ${status ?? "(não informado)"}`);
    if (status !== undefined && status.toUpperCase() === "PAID") {
      lines.push("", "Pagamento confirmado ✅ — o valor entrará no saldo da conta ZuckPay.");
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerPayPalTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "createPayPalOrder",
    {
      title: "Criar ordem PayPal",
      description:
        "Cria uma ordem de pagamento no PayPal via ZuckPay e retorna o link de aprovação para o pagador. " +
        "Suporta 25 moedas (padrão: BRL). Após o pagador aprovar, use capturePayPalOrder para efetivar.",
      inputSchema: createPayPalOrderShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => handleCreatePayPalOrder(client, args),
  );

  server.registerTool(
    "capturePayPalOrder",
    {
      title: "Capturar ordem PayPal",
      description:
        "Captura (efetiva) uma ordem PayPal já aprovada pelo pagador. " +
        "Chame somente depois que o pagador abriu o link de aprovação e concluiu o fluxo no PayPal. " +
        "A captura é idempotente do lado do PayPal.",
      inputSchema: capturePayPalOrderShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleCapturePayPalOrder(client, args),
  );
}
