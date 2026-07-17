import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../src/client.js";
import { registerBalanceTool } from "../src/tools/balance.js";
import { listTransactionsSchema, registerTransactionTools } from "../src/tools/transactions.js";
import type { ToolResult } from "../src/utils/result.js";

type Handler = (args: unknown) => Promise<ToolResult>;

function captureServer(): { handlers: Map<string, Handler>; server: McpServer } {
  const handlers = new Map<string, Handler>();
  const server = {
    registerTool: (name: string, _meta: unknown, handler: Handler) => {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return { handlers, server };
}

function mockClient(response: unknown): {
  client: ZuckPayClient;
  calls: { path: string; query: Record<string, string> }[];
} {
  const calls: { path: string; query: Record<string, string> }[] = [];
  const client: ZuckPayClient = {
    post: () => Promise.reject(new Error("não deve usar POST")),
    get: (path, query) => {
      calls.push({ path, query: { ...query } });
      return Promise.resolve(response);
    },
    redact: (text: string) => text,
  };
  return { client, calls };
}

describe("listTransactionsSchema", () => {
  it("aceita objeto vazio (todos os filtros opcionais)", () => {
    expect(listTransactionsSchema.parse({})).toEqual({});
  });

  it("aceita o conjunto completo de filtros válidos", () => {
    const input = {
      status: "PAID",
      type: "DEPOSIT",
      payment_method: "pix",
      external_id_client: "ORDER-123",
      date_from: "2026-07-01",
      date_to: "2026-07-17",
      limit: 50,
      cursor: "MjAyNi0wNy0xNyAxMDowMDowMHxBQkMxMjM=",
    };
    expect(listTransactionsSchema.parse(input)).toEqual(input);
  });

  it("rejeita campo desconhecido (strict)", () => {
    expect(() => listTransactionsSchema.parse({ foo: 1 })).toThrow();
  });

  it("rejeita status fora do enum", () => {
    expect(() => listTransactionsSchema.parse({ status: "PAGO" })).toThrow();
  });

  it("rejeita type fora do enum", () => {
    expect(() => listTransactionsSchema.parse({ type: "PAYMENT" })).toThrow();
  });

  it("rejeita data malformada e data inexistente", () => {
    expect(() => listTransactionsSchema.parse({ date_from: "17/07/2026" })).toThrow();
    expect(() => listTransactionsSchema.parse({ date_from: "2026-02-30" })).toThrow();
  });

  it("rejeita intervalo invertido (date_from > date_to)", () => {
    expect(() =>
      listTransactionsSchema.parse({ date_from: "2026-07-17", date_to: "2026-07-01" }),
    ).toThrow();
  });

  it("rejeita limit fora de 1–50 e não-inteiro", () => {
    expect(() => listTransactionsSchema.parse({ limit: 0 })).toThrow();
    expect(() => listTransactionsSchema.parse({ limit: 51 })).toThrow();
    expect(() => listTransactionsSchema.parse({ limit: 2.5 })).toThrow();
  });

  it("rejeita cursor com caracteres fora de base64/base64url", () => {
    expect(() => listTransactionsSchema.parse({ cursor: "abc$;drop" })).toThrow();
  });
});

describe("handler listTransactions", () => {
  const fixture = {
    statusCode: 200,
    transactions: [
      {
        id: "20260717093000ABCD1234",
        external_id_client: "ORDER-9",
        status: "PAID",
        type: "DEPOSIT",
        amount: 149.9,
        amount_liquid: 143.2,
        payment_method: "pix",
        original_currency: "BRL",
        created_at: "2026-07-17 09:30:00",
        confirmed_date: "2026-07-17 09:31:12",
      },
    ],
    pagination: { limit: 20, has_more: true, next_cursor: "MjAyNi0wNy0xN3xYWVo=" },
  };

  it("monta a query só com filtros informados e formata a saída", async () => {
    const { handlers, server } = captureServer();
    const { client, calls } = mockClient(fixture);
    registerTransactionTools(server, client);

    const handler = handlers.get("listTransactions");
    expect(handler).toBeDefined();
    const result = await (handler as Handler)({ status: "PAID", limit: 20 });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v3/transactions");
    expect(calls[0]?.query).toEqual({ status: "PAID", limit: "20" });

    const text = result.content[0]?.text ?? "";
    expect(result.isError).toBeUndefined();
    expect(text).toContain("PAGO ✅");
    expect(text).toContain("R$");
    expect(text).toContain("ORDER-9");
    expect(text).toContain('cursor="MjAyNi0wNy0xN3xYWVo="');
  });

  it("responde com erro amigável (sem chamar a API) para input inválido", async () => {
    const { handlers, server } = captureServer();
    const { client, calls } = mockClient(fixture);
    registerTransactionTools(server, client);

    const result = await (handlers.get("listTransactions") as Handler)({ status: "INVALIDO" });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("lista vazia gera mensagem clara", async () => {
    const { handlers, server } = captureServer();
    const { client } = mockClient({ statusCode: 200, transactions: [], pagination: {} });
    registerTransactionTools(server, client);

    const result = await (handlers.get("listTransactions") as Handler)({});
    expect(result.content[0]?.text).toContain("Nenhuma transação encontrada");
  });
});

describe("handler getBalance", () => {
  const fixture = {
    statusCode: 200,
    total: 1500.5,
    available: 1200.0,
    locked: 300.5,
    currency: "BRL",
    withdraw: { min: 50, max: 20000, fee: { percent: 0, fixed: 0 } },
  };

  it("consulta /v3/balance sem query e formata saldos e limites", async () => {
    const { handlers, server } = captureServer();
    const { client, calls } = mockClient(fixture);
    registerBalanceTool(server, client);

    const handler = handlers.get("getBalance");
    expect(handler).toBeDefined();
    const result = await (handler as Handler)({});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v3/balance");
    expect(calls[0]?.query).toEqual({});

    const text = result.content[0]?.text ?? "";
    expect(result.isError).toBeUndefined();
    expect(text).toContain("Disponível para saque");
    expect(text).toContain("Bloqueado");
    expect(text).toContain("mínimo");
    expect(text).toContain("máximo");
  });

  it("rejeita parâmetros extras sem tocar a API", async () => {
    const { handlers, server } = captureServer();
    const { client, calls } = mockClient(fixture);
    registerBalanceTool(server, client);

    const result = await (handlers.get("getBalance") as Handler)({ foo: "bar" });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
