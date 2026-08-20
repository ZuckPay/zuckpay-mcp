/**
 * Testes de integração do modo HTTP: sobem o servidor de verdade e falam
 * HTTP com ele. As regressões aqui foram todas medidas em ataque real contra
 * a 0.3.1 antes do fix — ver comentários por bloco.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import type { Server } from "node:http";
import { MAX_BODY_BYTES, startHttpServer } from "../src/http.js";

const PORT = 8977;
const BASE = `http://127.0.0.1:${PORT}`;
const RATE_LIMIT = 40;

// Credencial SINTATICAMENTE válida mas falsa: o portão de auth só valida
// formato, então isto chega à camada de protocolo. É exatamente o perfil do
// atacante não autenticado que precisamos manter contido.
const FAKE_AUTH =
  "Basic " + Buffer.from("client_falso_123456:secret_falso_abcdef", "utf8").toString("base64");

const MCP_HEADERS = {
  Authorization: FAKE_AUTH,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

let server: Server;

beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  server = startHttpServer({
    PORT: String(PORT),
    MCP_RATE_LIMIT_PER_MINUTE: String(RATE_LIMIT),
  } as NodeJS.ProcessEnv);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

function rpc(body: unknown): Promise<Response> {
  return fetch(`${BASE}/mcp`, {
    method: "POST",
    headers: MCP_HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("batch JSON-RPC", () => {
  it("REGRESSÃO: array no topo é recusado com -32600", async () => {
    // Medido antes do fix: 249 KB de body com 5.000 entradas devolveram
    // 101 MB em 3,7s valendo UM hit no rate limit (amplificação 406x).
    const batch = Array.from({ length: 500 }, (_, i) => ({
      jsonrpc: "2.0",
      id: i,
      method: "tools/list",
    }));
    const res = await rpc(batch);
    const text = await res.text();

    expect(res.status).toBe(400);
    expect(text).toMatch(/-32600/);
    expect(text).toMatch(/[Bb]atch/);
    // O corpo tem que ser o erro curto, não 500 respostas.
    expect(text.length).toBeLessThan(1000);
  });

  it("array vazio também é recusado", async () => {
    expect((await rpc([])).status).toBe(400);
  });

  it("chamada única continua funcionando", async () => {
    const res = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    });
    const body = (await res.json()) as { result?: { serverInfo?: { name?: string } } };

    expect(res.status).toBe(200);
    expect(body.result?.serverInfo?.name).toBe("zuckpay-mcp");
  });

  it("uma resposta única não passa de ~64 KB (teto da amplificação residual)", async () => {
    const res = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect((await res.text()).length).toBeLessThan(64 * 1024);
  });
});

describe("portão de entrada", () => {
  it("401 sem Authorization, sem eco do header", async () => {
    const res = await fetch(`${BASE}/mcp`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/Basic/);
  });

  it("404 em rota desconhecida e 405 em GET /mcp", async () => {
    expect((await fetch(`${BASE}/qualquer`)).status).toBe(404);
    expect((await fetch(`${BASE}/mcp`)).status).toBe(405);
  });

  it("413 acima do teto de body", async () => {
    const res = await rpc("x".repeat(MAX_BODY_BYTES + 1024));
    expect(res.status).toBe(413);
  });

  it("400 em JSON inválido", async () => {
    expect((await rpc("{nao é json")).status).toBe(400);
  });

  it("não emite CORS (cliente MCP não é browser)", async () => {
    const res = await fetch(`${BASE}/healthz`);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("rate limit", () => {
  it("REGRESSÃO: /healthz também é limitado (antes ficava fora do limiter)", async () => {
    const codes: number[] = [];
    for (let i = 0; i < RATE_LIMIT + 15; i += 1) {
      codes.push((await fetch(`${BASE}/healthz`)).status);
    }
    const blocked = codes.filter((c) => c === 429);

    expect(blocked.length).toBeGreaterThan(0);
    expect(codes.filter((c) => c === 200).length).toBeLessThanOrEqual(RATE_LIMIT);
  });

  it("o 429 traz Retry-After", async () => {
    let res = await fetch(`${BASE}/healthz`);
    for (let i = 0; i < RATE_LIMIT + 5 && res.status !== 429; i += 1) {
      res = await fetch(`${BASE}/healthz`);
    }
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
