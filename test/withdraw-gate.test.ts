import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../src/client.js";
import type { Config } from "../src/config.js";
import { registerAllTools } from "../src/tools/index.js";

function makeConfig(enableWithdraw: boolean): Config {
  return Object.freeze({
    clientId: "client_test_123456",
    clientSecret: "secret_test_ABCDEF",
    baseUrl: "https://www.example.com/conta",
    enableWithdraw,
  });
}

const stubClient: ZuckPayClient = {
  post: () => Promise.reject(new Error("não deve chamar a API neste teste")),
  get: () => Promise.reject(new Error("não deve chamar a API neste teste")),
  redact: (text: string) => text,
};

function stubServer(): { registered: string[]; server: McpServer } {
  const registered: string[] = [];
  const server = {
    registerTool: (name: string) => {
      registered.push(name);
    },
  } as unknown as McpServer;
  return { registered, server };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gate da tool de saque", () => {
  it("sem a flag, createPixWithdraw NÃO é registrada", () => {
    const { registered, server } = stubServer();
    registerAllTools(server, stubClient, makeConfig(false));

    expect(registered).toContain("createPixCharge");
    expect(registered).toContain("getTransactionStatus");
    expect(registered).toContain("createSpeiCashin");
    expect(registered).toContain("createPayPalOrder");
    expect(registered).toContain("capturePayPalOrder");
    expect(registered).toContain("getCardGateways");
    expect(registered).not.toContain("createPixWithdraw");
  });

  // A flag deixou de registrar a tool: /v3/pix/withdraw exige PIN do vendedor e
  // o PIN não pode trafegar pela conversa do assistente. Ver src/tools/index.ts.
  it("NEM com ZUCKPAY_ENABLE_WITHDRAW=true a tool volta — só avisa", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { registered, server } = stubServer();
    registerAllTools(server, stubClient, makeConfig(true));

    expect(registered).not.toContain("createPixWithdraw");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("não tem mais efeito"));
  });

  it("nenhuma tool registrada movimenta saldo pra fora da conta", () => {
    const { registered, server } = stubServer();
    registerAllTools(server, stubClient, makeConfig(true));

    expect(registered.filter((n) => /withdraw|saque|payout|transfer/i.test(n))).toEqual([]);
  });
});
