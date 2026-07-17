import { describe, expect, it } from "vitest";
import { Buffer } from "node:buffer";
import { createRateLimiter, parseBasicAuth } from "../src/http.js";

function basic(id: string, secret: string): string {
  return "Basic " + Buffer.from(`${id}:${secret}`, "utf8").toString("base64");
}

describe("parseBasicAuth", () => {
  it("extrai credenciais válidas", () => {
    const creds = parseBasicAuth(basic("client_abc123", "secret_XYZ789"));
    expect(creds).toEqual({ clientId: "client_abc123", clientSecret: "secret_XYZ789" });
  });

  it("aceita secret contendo dois-pontos (split só no primeiro)", () => {
    const creds = parseBasicAuth(basic("id1", "se:cr:et"));
    expect(creds).toEqual({ clientId: "id1", clientSecret: "se:cr:et" });
  });

  it("rejeita header ausente, esquema errado e base64 malformado", () => {
    expect(parseBasicAuth(undefined)).toBeUndefined();
    expect(parseBasicAuth("Bearer abc")).toBeUndefined();
    expect(parseBasicAuth("Basic ")).toBeUndefined();
    expect(parseBasicAuth("Basic not@base64!!")).toBeUndefined();
  });

  it("rejeita credencial vazia de um dos lados", () => {
    expect(parseBasicAuth(basic("", "secret"))).toBeUndefined();
    expect(parseBasicAuth(basic("id", ""))).toBeUndefined();
    expect(
      parseBasicAuth("Basic " + Buffer.from("semseparador").toString("base64")),
    ).toBeUndefined();
  });

  it("rejeita credencial com caractere de controle ou espaço interno (CR/LF no fim é trimado)", () => {
    expect(parseBasicAuth(basic("id com espaco", "secret"))).toBeUndefined();
    expect(parseBasicAuth(basic("id", "sec\rret"))).toBeUndefined();
    // Trailing CR/LF (gotcha de .env no Windows) é tolerado via trim:
    expect(parseBasicAuth(basic("id1", "secret2\r\n"))).toEqual({
      clientId: "id1",
      clientSecret: "secret2",
    });
  });

  it("rejeita payload base64 absurdamente grande", () => {
    const huge = "A".repeat(2000);
    expect(parseBasicAuth(`Basic ${huge}`)).toBeUndefined();
  });
});

describe("createRateLimiter", () => {
  it("permite até o limite e bloqueia o excedente com Retry-After", () => {
    const limiter = createRateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(limiter.check("ip1", t0).ok).toBe(true);
    expect(limiter.check("ip1", t0 + 10).ok).toBe(true);
    expect(limiter.check("ip1", t0 + 20).ok).toBe(true);
    const blocked = limiter.check("ip1", t0 + 30);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("janela nova zera a contagem", () => {
    const limiter = createRateLimiter(1, 60_000);
    const t0 = 5_000_000;
    expect(limiter.check("ip1", t0).ok).toBe(true);
    expect(limiter.check("ip1", t0 + 1).ok).toBe(false);
    expect(limiter.check("ip1", t0 + 60_001).ok).toBe(true);
  });

  it("chaves independentes não se afetam", () => {
    const limiter = createRateLimiter(1, 60_000);
    const t0 = 9_000_000;
    expect(limiter.check("ip1", t0).ok).toBe(true);
    expect(limiter.check("ip2", t0).ok).toBe(true);
  });

  it("sweep remove janelas expiradas", () => {
    const limiter = createRateLimiter(1, 60_000);
    const t0 = 7_000_000;
    limiter.check("ip1", t0);
    limiter.check("ip2", t0);
    expect(limiter.size()).toBe(2);
    limiter.sweep(t0 + 120_000);
    expect(limiter.size()).toBe(0);
  });
});
