/**
 * Tool de cartão: GET /v3/card/keys — SOMENTE leitura das chaves públicas
 * (publishable keys) dos gateways de cartão da conta.
 *
 * A cobrança direta de cartão (POST /v3/card/charge) é EXCLUÍDA do MCP por
 * design: exigiria PAN+CVV trafegando pelo contexto de um LLM (inviável por
 * PCI DSS e risco de vazamento). Cartão deve ser cobrado pelo checkout
 * hospedado da ZuckPay, onde o dado sensível nunca passa pela IA.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

function describeGateways(response: unknown): string[] {
  const lines: string[] = [];
  if (typeof response !== "object" || response === null) {
    return lines;
  }
  const record = response as Record<string, unknown>;
  const list = Array.isArray(record.gateways)
    ? record.gateways
    : Array.isArray(record.keys)
      ? record.keys
      : [];
  for (const item of list) {
    const gateway = pickString(item, "gateway") ?? pickString(item, "name") ?? "gateway";
    const publishableKey =
      pickString(item, "publishableKey") ?? pickString(item, "publishable_key");
    const national = (item as Record<string, unknown>)?.nationalCard;
    const nationalText =
      national === true ? " (cartão nacional)" : national === false ? " (internacional)" : "";
    lines.push(`• ${gateway}${nationalText}: ${publishableKey ?? "(chave pública não informada)"}`);
  }
  return lines;
}

async function handleGetCardGateways(client: ZuckPayClient): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const response = await client.get("/v3/card/keys", {});

    const gatewayLines = describeGateways(response);
    const lines: string[] = ["Gateways de cartão disponíveis 💳", ""];
    if (gatewayLines.length > 0) {
      lines.push(...gatewayLines);
    } else {
      lines.push("Nenhum gateway de cartão configurado nesta conta.");
    }
    lines.push(
      "",
      "Estas são apenas chaves PÚBLICAS (publishable keys), usadas para tokenizar o cartão no navegador do pagador.",
      "A cobrança direta de cartão não é exposta via MCP por segurança (PCI): dados de cartão nunca devem passar pelo contexto de uma IA.",
      "Para cobrar no cartão, use o checkout hospedado / link de pagamento da ZuckPay.",
    );

    return okResult(client.redact, lines.join("\n"), response);
  });
}

export function registerCardTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "getCardGateways",
    {
      title: "Listar gateways de cartão (chaves públicas)",
      description:
        "Lista os gateways de cartão disponíveis na conta ZuckPay com suas chaves públicas (publishable keys). " +
        "Somente leitura — a cobrança direta de cartão não é exposta via MCP por segurança (PCI); use o checkout hospedado da ZuckPay.",
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    () => handleGetCardGateways(client),
  );
}
