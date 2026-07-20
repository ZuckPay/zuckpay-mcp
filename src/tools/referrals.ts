/**
 * Tool de leitura: GET /v3/referrals.
 *
 * Estatísticas de Indique&Ganhe do próprio seller. O backend nunca inclui
 * o ranking global (dado de outros sellers) e mascara nome/e-mail dos
 * leads referidos — `assertNoRawPii` roda como segunda barreira.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString } from "../utils/format.js";
import { assertNoRawPii } from "../utils/redact.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

const FORBIDDEN_REFERRAL_FIELDS = ["ranking"] as const;

export const getReferralStatsShape = {};

export const getReferralStatsSchema = z.object(getReferralStatsShape).strict();

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

async function handleGetReferralStats(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    getReferralStatsSchema.parse(args);

    const response = await client.get("/v3/referrals", {});

    assertNoRawPii(response, FORBIDDEN_REFERRAL_FIELDS);

    const total = pickNumber(response, "total_indicados") ?? 0;
    const comissaoTotal = pickNumber(response, "comissao_total") ?? 0;
    const comissaoPendente = pickNumber(response, "comissao_pendente") ?? 0;
    const comissaoLiberada = pickNumber(response, "comissao_liberada") ?? 0;
    const indicados = pickObjectArray(response, "indicados");

    const lines: string[] = [
      `Indique&Ganhe 🤝`,
      "",
      `Indicados ativos: ${total}`,
      `Comissão total: ${formatMoney(comissaoTotal)} (pendente ${formatMoney(comissaoPendente)}, liberada ${formatMoney(comissaoLiberada)})`,
    ];

    if (indicados.length > 0) {
      lines.push("", "Indicados:");
      for (const row of indicados) {
        const nome = pickString(row, "nome") ?? "(sem nome)";
        const vendas = pickNumber(row, "total_vendas") ?? 0;
        const comissao = pickNumber(row, "comissao_gerada") ?? 0;
        lines.push(
          `• ${nome} — vendas ${formatMoney(vendas)} · comissão gerada ${formatMoney(comissao)}`,
        );
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerReferralTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "getReferralStats",
    {
      title: "Indique e Ganhe",
      description:
        "Estatísticas do programa Indique&Ganhe do seller autenticado: total de indicados, comissões " +
        "(total/pendente/liberada), lista de indicados e histórico de comissões. Somente leitura, escopado " +
        "estritamente ao próprio seller — nunca retorna ranking ou dado de outros sellers.",
      inputSchema: getReferralStatsShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleGetReferralStats(client, args),
  );
}
