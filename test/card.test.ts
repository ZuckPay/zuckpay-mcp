import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../src/client.js";
import { describeGateways, registerCardTools } from "../src/tools/card.js";
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

/** Shape real de GET /v3/card/keys em produção (objeto único). */
const realKeysFixture = {
  publishableKey: "pk_live_EXEMPLO123",
  gateway: "auto",
  stripe: { enabled: true, mode: "international", requires: "payment_method" },
  nationalCard: {
    enabled: true,
    mode: "brl",
    requires: "card_raw",
    endpoint: "https://www.zuckpay.com.br/conta/v3/card/charge",
    supportedCurrencies: ["BRL"],
  },
};

describe("describeGateways", () => {
  it("interpreta o shape real (objeto) com Stripe + cartão nacional ativos", () => {
    const lines = describeGateways(realKeysFixture);
    const text = lines.join("\n");
    expect(text).toContain("Stripe (internacional): habilitado");
    expect(text).toContain("pk_live_EXEMPLO123");
    expect(text).toContain("Cartão nacional: habilitado");
    expect(text).toContain("BRL");
    expect(text).toContain("Roteamento: automático");
  });

  it("marca Stripe desabilitada quando só o cartão nacional está ativo", () => {
    const lines = describeGateways({
      publishableKey: null,
      gateway: "auto",
      stripe: { enabled: false },
      nationalCard: { enabled: true, supportedCurrencies: ["BRL"] },
    });
    const text = lines.join("\n");
    expect(text).toContain("Stripe (internacional): desabilitado");
    expect(text).toContain("Cartão nacional: habilitado");
  });

  it("marca cartão nacional desabilitado quando só a Stripe está ativa", () => {
    const lines = describeGateways({
      publishableKey: "pk_live_XYZ",
      gateway: "stripe",
      stripe: { enabled: true },
      nationalCard: { enabled: false },
    });
    const text = lines.join("\n");
    expect(text).toContain("Stripe (internacional): habilitado");
    expect(text).toContain("pk_live_XYZ");
    expect(text).toContain("Cartão nacional: desabilitado");
  });

  it("mantém o fallback para o shape legado em array", () => {
    const lines = describeGateways({
      gateways: [{ gateway: "stripe", publishableKey: "pk_live_ABC", nationalCard: false }],
    });
    expect(lines.join("\n")).toContain("stripe (internacional): pk_live_ABC");
  });

  it("retorna vazio para resposta sem gateways", () => {
    expect(describeGateways({})).toEqual([]);
    expect(describeGateways(null)).toEqual([]);
    expect(describeGateways("texto")).toEqual([]);
  });
});

describe("handler getCardGateways", () => {
  it("consulta /v3/card/keys e resume Stripe + nacional com o aviso PCI", async () => {
    const { handlers, server } = captureServer();
    const { client, calls } = mockClient(realKeysFixture);
    registerCardTools(server, client);

    const handler = handlers.get("getCardGateways");
    expect(handler).toBeDefined();
    const result = await (handler as Handler)({});

    expect(calls).toHaveLength(1);
    expect(calls[0]?.path).toBe("/v3/card/keys");

    const text = result.content[0]?.text ?? "";
    expect(result.isError).toBeUndefined();
    expect(text).toContain("Stripe (internacional): habilitado");
    expect(text).toContain("Cartão nacional: habilitado");
    expect(text).not.toContain("Nenhum gateway de cartão configurado");
    expect(text).toContain("chaves PÚBLICAS");
    expect(text).toContain("checkout hospedado");
    expect(result.structuredContent).toMatchObject({ gateway: "auto" });
  });

  it("informa quando não há gateway configurado", async () => {
    const { handlers, server } = captureServer();
    const { client } = mockClient({ statusCode: 200 });
    registerCardTools(server, client);

    const result = await (handlers.get("getCardGateways") as Handler)({});
    expect(result.content[0]?.text).toContain("Nenhum gateway de cartão configurado");
  });
});
