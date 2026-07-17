/**
 * Tool de saque PIX (POST /v3/pix/withdraw) — MOVIMENTA DINHEIRO REAL.
 *
 * Camadas de proteção:
 * 1. A tool só é registrada com ZUCKPAY_ENABLE_WITHDRAW=true (opt-in);
 * 2. O schema exige `confirm: true` e a descrição instrui o modelo a
 *    confirmar valor+chave+tipo com o usuário humano ANTES de chamar;
 * 3. Limites validados localmente: mínimo R$ 50,00, máximo R$ 20.000,00;
 * 4. A chave é validada contra o tipo declarado (CPF/EMAIL/PHONE/EVP);
 * 5. O gateway valida server-side o saldo disponível do seller — saldo
 *    insuficiente vira erro claro, nunca saque a descoberto;
 * 6. Nenhum retry automático (client.post não retenta jamais).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";
import { digitsOnly, moneySchema, pixKeyTypeSchema } from "../utils/schemas.js";

export const WITHDRAW_MIN_BRL = 50;
export const WITHDRAW_MAX_BRL = 20_000;

const EVP_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const createPixWithdrawShape = {
  chave_pix: z
    .string()
    .trim()
    .min(3)
    .max(140)
    .describe("Chave PIX de destino do saque (deve corresponder ao tipo informado)"),
  pix_key_type: pixKeyTypeSchema,
  valor: moneySchema({
    min: WITHDRAW_MIN_BRL,
    max: WITHDRAW_MAX_BRL,
    description: `Valor do saque em reais (mínimo ${formatMoney(WITHDRAW_MIN_BRL)}, máximo ${formatMoney(WITHDRAW_MAX_BRL)} por saque)`,
  }),
  confirm: z
    .literal(true)
    .describe(
      "Confirmação explícita. Envie true SOMENTE depois de o usuário humano confirmar na conversa o valor exato, a chave PIX e o tipo da chave.",
    ),
};

export const createPixWithdrawSchema = z
  .object(createPixWithdrawShape)
  .strict()
  .superRefine((value, ctx) => {
    const addKeyIssue = (message: string): void => {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["chave_pix"], message });
    };
    switch (value.pix_key_type) {
      case "CPF":
        if (digitsOnly(value.chave_pix).length !== 11) {
          addKeyIssue("Chave do tipo CPF deve conter exatamente 11 dígitos.");
        }
        break;
      case "EMAIL":
        if (!EMAIL_REGEX.test(value.chave_pix)) {
          addKeyIssue("Chave do tipo EMAIL deve ser um e-mail válido.");
        }
        break;
      case "PHONE": {
        const digits = digitsOnly(value.chave_pix);
        if (digits.length < 10 || digits.length > 13) {
          addKeyIssue("Chave do tipo PHONE deve conter de 10 a 13 dígitos (inclua o DDD).");
        }
        break;
      }
      case "EVP":
        if (!EVP_REGEX.test(value.chave_pix)) {
          addKeyIssue("Chave do tipo EVP deve ser um UUID (chave aleatória) válido.");
        }
        break;
    }
  });

async function handleCreatePixWithdraw(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = createPixWithdrawSchema.parse(args);

    // `confirm` é um contrato com o modelo — NUNCA vai no body da API.
    const chave =
      input.pix_key_type === "CPF" || input.pix_key_type === "PHONE"
        ? digitsOnly(input.chave_pix)
        : input.chave_pix;

    const body = {
      chave_pix: chave,
      pix_key_type: input.pix_key_type,
      valor: input.valor,
    };

    const response = await client.post("/v3/pix/withdraw", body);

    const status = pickString(response, "status");
    const withdrawId =
      pickString(response, "transactionId") ??
      pickString(response, "id") ??
      pickString(response, "withdraw_id");

    const lines: string[] = ["Saque PIX solicitado ✅", ""];
    lines.push(`• Valor: ${formatMoney(input.valor)}`);
    lines.push(`• Chave (${input.pix_key_type}): ${chave}`);
    if (withdrawId !== undefined) lines.push(`• Identificador: ${withdrawId}`);
    if (status !== undefined) lines.push(`• Status: ${status}`);
    lines.push(
      "",
      "O processamento do saque é assíncrono. NÃO repita a chamada se houver demora — " +
        "consulte o extrato no painel ZuckPay antes de qualquer nova tentativa.",
    );

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerWithdrawTool(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "createPixWithdraw",
    {
      title: "Solicitar saque PIX (movimenta dinheiro real)",
      description:
        "⚠️ MOVIMENTA DINHEIRO REAL: solicita um saque PIX do saldo disponível da conta ZuckPay para a chave informada. " +
        `Limites: mínimo ${formatMoney(WITHDRAW_MIN_BRL)} e máximo ${formatMoney(WITHDRAW_MAX_BRL)} por saque; o gateway ainda valida o saldo disponível do vendedor antes de executar. ` +
        "REGRA OBRIGATÓRIA: antes de chamar esta tool, apresente ao usuário o valor exato, a chave PIX e o tipo da chave, e aguarde a confirmação explícita dele na conversa — só então envie confirm=true. " +
        "NUNCA chame novamente de forma automática após erro ou demora.",
      inputSchema: createPixWithdrawShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (args) => handleCreatePixWithdraw(client, args),
  );
}
