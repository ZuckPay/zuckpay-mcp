/**
 * Tool de saldo: GET /v3/balance.
 *
 * Somente-leitura, sem parâmetros — retorna os saldos da conta autenticada
 * (total, disponível pra saque e bloqueado em liberação; o prazo varia por
 * método — PIX D+0, cartão conforme a conta, ex. D+8/D+15) e os limites de
 * saque vigentes pra essa conta. Nenhum dado de terceiros trafega aqui.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

/** Extrai sub-objeto plano de uma resposta desconhecida sem lançar. */
function pickRecord(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo passado pelo nosso código
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

async function handleGetBalance(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    // Tool sem parâmetros: rejeita qualquer campo extra em vez de ignorar.
    if (typeof args === "object" && args !== null && Object.keys(args).length > 0) {
      throw new Error("getBalance não aceita parâmetros.");
    }

    const response = await client.get("/v3/balance", {});

    const currency = pickString(response, "currency") ?? "BRL";
    const total = pickNumber(response, "total");
    const available = pickNumber(response, "available");
    const locked = pickNumber(response, "locked");

    const withdraw = pickRecord(response, "withdraw");
    const min = pickNumber(withdraw, "min");
    const max = pickNumber(withdraw, "max");
    const fee = pickRecord(withdraw, "fee");
    const feePercent = pickNumber(fee, "percent");
    const feeFixed = pickNumber(fee, "fixed");

    const lines: string[] = ["Saldo da conta 💰", ""];
    if (available !== undefined) {
      lines.push(`• Disponível para saque: ${formatMoney(available, currency)}`);
    }
    if (locked !== undefined) {
      lines.push(`• Bloqueado (em liberação): ${formatMoney(locked, currency)}`);
    }
    if (total !== undefined) {
      lines.push(`• Total: ${formatMoney(total, currency)}`);
    }
    if (min !== undefined || max !== undefined) {
      lines.push("");
      lines.push(
        "Limites de saque desta conta: " +
          `${min !== undefined ? `mínimo ${formatMoney(min, currency)}` : ""}` +
          `${min !== undefined && max !== undefined ? " · " : ""}` +
          `${max !== undefined ? `máximo ${formatMoney(max, currency)}` : ""}`,
      );
    }
    if (feePercent !== undefined || feeFixed !== undefined) {
      const parts: string[] = [];
      if (feePercent !== undefined && feePercent > 0) parts.push(`${feePercent}%`);
      if (feeFixed !== undefined && feeFixed > 0) parts.push(formatMoney(feeFixed, currency));
      if (parts.length > 0) {
        lines.push(`Taxa de saque: ${parts.join(" ou ")} (prevalece a maior).`);
      }
    }
    if (locked !== undefined && locked > 0) {
      lines.push(
        "",
        "O valor bloqueado é liberado automaticamente conforme o prazo de cada método: " +
          "PIX libera na hora (D+0); cartão segue o prazo configurado na sua conta (ex.: D+8 ou D+15).",
      );
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerBalanceTool(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "getBalance",
    {
      title: "Consultar saldo da conta",
      description:
        "Consulta os saldos da conta ZuckPay autenticada: disponível para saque, bloqueado (em liberação — PIX libera em D+0; " +
        "cartão segue o prazo da conta, ex.: D+8) e total, além dos limites e taxa de saque vigentes. Somente leitura, sem parâmetros.",
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleGetBalance(client, args),
  );
}
