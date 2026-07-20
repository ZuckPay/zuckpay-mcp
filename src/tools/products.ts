/**
 * Tools de leitura: GET /v3/products.
 *
 * Somente-leitura. Nenhuma tool de criação/edição/exclusão existe aqui —
 * ver plano de expansão do MCP para o que fica de fora de propósito
 * (toggles de método de pagamento, domínio, exclusão em cascata).
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import { formatMoney, pickNumber, pickString } from "../utils/format.js";
import { okResult, safeRun, type ToolResult } from "../utils/result.js";

export const listProductsShape = {
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .describe("Quantidade de produtos por página (1 a 100; padrão 50)")
    .optional(),
};

export const listProductsSchema = z.object(listProductsShape).strict();

export const getProductShape = {
  id: z.number().int().positive().describe("ID numérico do produto"),
};

export const getProductSchema = z.object(getProductShape).strict();

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

function pickObject(obj: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo passado pelo nosso código
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function describeProduct(row: Record<string, unknown>): string {
  const name = pickString(row, "name") ?? "(sem nome)";
  const status = pickString(row, "status") ?? "?";
  const price = pickNumber(row, "price");
  const currency = pickString(row, "currency") ?? "BRL";
  const id = pickString(row, "id") ?? "(sem id)";
  const type = pickString(row, "type");

  const parts = [
    name,
    price !== undefined ? formatMoney(price, currency) : "(sem preço)",
    status,
    `id ${id}`,
  ];
  if (type !== undefined) {
    parts.push(type);
  }
  return `• ${parts.join(" · ")}`;
}

async function handleListProducts(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = listProductsSchema.parse(args);

    const query: Record<string, string> = {};
    if (input.limit !== undefined) query.limit = String(input.limit);

    const response = await client.get("/v3/products", query);
    const rows = pickObjectArray(response, "products");

    const lines: string[] = [];
    if (rows.length === 0) {
      lines.push("Nenhum produto encontrado nesta conta.");
    } else {
      lines.push(`Produtos (${rows.length}) 📦`, "");
      for (const row of rows) {
        lines.push(describeProduct(row));
      }
    }

    return okResult(client.redact, lines.join("\n"), response);
  });
}

async function handleGetProduct(client: ZuckPayClient, args: unknown): Promise<ToolResult> {
  return safeRun(client.redact, async () => {
    const input = getProductSchema.parse(args);

    const response = await client.get("/v3/products", { id: String(input.id) });
    const product = pickObject(response, "product");

    if (!product) {
      return okResult(client.redact, "Produto não encontrado.", response);
    }

    return okResult(client.redact, describeProduct(product), response);
  });
}

export function registerProductTools(server: McpServer, client: ZuckPayClient): void {
  server.registerTool(
    "listProducts",
    {
      title: "Listar produtos",
      description:
        "Lista os produtos cadastrados na conta ZuckPay autenticada (nome, preço, status, tipo). " +
        "Somente leitura — não cria, edita nem exclui produtos.",
      inputSchema: listProductsShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleListProducts(client, args),
  );

  server.registerTool(
    "getProduct",
    {
      title: "Detalhar produto",
      description:
        "Retorna os detalhes de um produto específico da conta ZuckPay autenticada, pelo ID. Somente leitura.",
      inputSchema: getProductShape,
      annotations: {
        readOnlyHint: true,
        openWorldHint: true,
      },
    },
    (args) => handleGetProduct(client, args),
  );
}
