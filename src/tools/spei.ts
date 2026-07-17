/**
 * Tool SPEI (México): POST /v3/spei/cashin.
 * Requer conta com SPEI habilitado (403 SPEI_NOT_ENABLED caso contrário —
 * traduzido em mensagem amigável por utils/errors.ts).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";
import { emailSchema, moneySchema, nomeSchema } from "../utils/schemas.js";

export const createSpeiCashinShape = {
  nome: nomeSchema.describe("Nome completo do pagador mexicano"),
  documento: z
    .string()
    .trim()
    .toUpperCase()
    .min(10, "Documento muito curto.")
    .max(18, "Documento muito longo.")
    .regex(/^[A-Z0-9&Ñ]+$/, {
      message: "Documento (RFC/CURP) deve conter apenas letras e números.",
    })
    .describe("RFC (12–13 caracteres) ou CURP (18 caracteres) do pagador"),
  email: emailSchema,
  valor: moneySchema({
    min: 5,
    description:
      "Valor em pesos mexicanos (MXN), mínimo MX$ 5,00. Atenção: a adquirente XPAG exige mínimo de MX$ 20,00 — a API recusa se for o caso.",
  }),
};

export const createSpeiCashinSchema = z.object(createSpeiCashinShape).strict();

async function handleCreateSpeiCashin(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = createSpeiCashinSchema.parse(args);

    const body = {
      nome: input.nome,
      documento: input.documento,
      email: input.email,
      valor: input.valor,
    };

    const response = await client.post("/v3/spei/cashin", body);

    const clabe = pickString(response, "clabe");
    const transactionId =
      pickString(response, "transactionId") ?? pickString(response, "id") ?? undefined;

    const lines: string[] = ["Cobrança SPEI criada ✅", ""];
    lines.push(`• Transação: ${transactionId ?? "(não informada)"}`);
    lines.push(`• Valor: ${formatMoney(input.valor, "MXN")}`);
    if (clabe !== undefined) {
      lines.push("", "CLABE para transferência (18 dígitos):", "```", clabe, "```");
      lines.push("Envie a CLABE ao pagador — ele transfere de qualquer banco mexicano via SPEI.");
    }
    lines.push("", "Acompanhe o pagamento com a tool getTransactionStatus.");

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerSpeiTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "createSpeiCashin",
    {
      title: "Criar cobrança SPEI (México)",
      description:
        "Cria uma cobrança SPEI em pesos mexicanos (MXN) e retorna a CLABE de 18 dígitos para o pagador transferir de qualquer banco do México. " +
        "Requer conta ZuckPay com SPEI habilitado. Documento do pagador: RFC ou CURP.",
      inputSchema: createSpeiCashinShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => handleCreateSpeiCashin(client, args),
  );
}
