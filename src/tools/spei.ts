/**
 * Tool SPEI (México): POST /v3/spei/cashin.
 * Requer conta com SPEI habilitado (403 SPEI_NOT_ENABLED caso contrário —
 * traduzido em mensagem amigável por utils/errors.ts).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickBoolean, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";
import { emailSchema, externalIdSchema, moneySchema, nomeSchema } from "../utils/schemas.js";

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
  external_id_client: externalIdSchema.optional(),
};

export const createSpeiCashinSchema = z.object(createSpeiCashinShape).strict();

async function handleCreateSpeiCashin(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = createSpeiCashinSchema.parse(args);

    const body: Record<string, unknown> = {
      nome: input.nome,
      documento: input.documento,
      email: input.email,
      valor: input.valor,
    };
    if (input.external_id_client !== undefined) {
      body.external_id_client = input.external_id_client;
    }

    const response = await client.post("/v3/spei/cashin", body);

    const clabe = pickString(response, "clabe");
    const transactionId =
      pickString(response, "transactionId") ?? pickString(response, "id") ?? undefined;

    // Mesma idempotência do PIX: spei/cashin.php trava em GET_LOCK pelo
    // external_id_client e reaproveita a cobrança pendente em vez de duplicar.
    const reused = pickBoolean(response, "idempotency") === true;

    const lines: string[] = [
      reused ? "Cobrança SPEI já existente ♻️" : "Cobrança SPEI criada ✅",
      "",
    ];
    if (reused) {
      lines.push(
        "Nenhuma cobrança nova foi criada: já havia uma pendente com este " +
          "external_id_client e ela foi reaproveitada. Use os dados abaixo.",
        "",
      );
    }
    lines.push(`• Transação: ${transactionId ?? "(não informada)"}`);
    lines.push(`• Valor: ${formatMoney(input.valor, "MXN")}`);
    if (input.external_id_client !== undefined) {
      lines.push(`• ID externo: ${input.external_id_client}`);
    } else {
      lines.push(
        "• ID externo: (nenhum) — esta cobrança NÃO tem proteção contra duplicidade. " +
          "Se a chamada falhar ou demorar, não repita sem antes conferir em getTransactionStatus.",
      );
    }
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
        "Requer conta ZuckPay com SPEI habilitado. Documento do pagador: RFC ou CURP. " +
        "SEMPRE informe external_id_client: é a chave de idempotência — a API reaproveita a cobrança pendente de mesmo valor de chave " +
        "em vez de criar uma segunda. Se precisar repetir a chamada após erro ou timeout, REUSE exatamente o mesmo external_id_client.",
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
