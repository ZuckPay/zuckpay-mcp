import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import type { Config } from "../src/config.js";
import { NetworkError, TimeoutError, ZuckPayApiError } from "../src/utils/errors.js";

const CONFIG: Config = Object.freeze({
  clientId: "client_test_123456",
  clientSecret: "secret_test_ABCDEF",
  baseUrl: "https://www.example.com/conta",
  enableWithdraw: false,
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createClient", () => {
  it("envia POST com Basic auth, JSON e sem seguir redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { transactionId: "tx_1" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const result = await client.post("/v3/pix/qrcode", { valor: 10 });

    expect(result).toEqual({ transactionId: "tx_1" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://www.example.com/conta/v3/pix/qrcode");
    expect(init.redirect).toBe("error");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    const expectedAuth =
      "Basic " +
      Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`, "utf8").toString("base64");
    expect(headers.Authorization).toBe(expectedAuth);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ valor: 10 }));
  });

  it("monta query string em GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { status: "PAID" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    await client.get("/v3/pix/status", { transactionId: "tx_9" });

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("https://www.example.com/conta/v3/pix/status?transactionId=tx_9");
  });

  it("converte 401 em ZuckPayApiError sem vazar o secret", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { statusCode: 401, message: "Unauthorized" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const err = await client.post("/v3/pix/qrcode", {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ZuckPayApiError);
    expect((err as ZuckPayApiError).statusCode).toBe(401);
    expect((err as Error).message).not.toContain(CONFIG.clientSecret);
  });

  it("rejeita resposta não-JSON com erro sanitizado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<html>erro</html>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const err = await client.get("/v3/pix/status", { transactionId: "x" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ZuckPayApiError);
    expect((err as Error).message).toContain("não-JSON");
    expect((err as Error).message).not.toContain("<html>");
  });

  it("NUNCA retenta POST após falha de rede", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const err = await client.post("/v3/pix/withdraw", { valor: 100 }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NetworkError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retenta GET exatamente 1 vez em falha de rede", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse(200, { status: "PENDING" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const result = await client.get("/v3/pix/status", { transactionId: "tx" });

    expect(result).toEqual({ status: "PENDING" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("não retenta GET em resposta HTTP de erro (só falha de REDE)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(500, { statusCode: 500, message: "interno" }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const err = await client.get("/v3/pix/status", { transactionId: "x" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ZuckPayApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("traduz redirect bloqueado em dica sobre o www obrigatório", async () => {
    const redirectError = new TypeError("fetch failed");
    (redirectError as { cause?: unknown }).cause = new Error("unexpected redirect");
    const fetchMock = vi.fn().mockRejectedValue(redirectError);
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const err = await client.post("/v3/pix/qrcode", {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(NetworkError);
    expect((err as Error).message).toContain("www");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("converte abort em TimeoutError", async () => {
    const abortError = new Error("This operation was aborted");
    abortError.name = "AbortError";
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient(CONFIG);
    const err = await client.post("/v3/pix/qrcode", {}).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TimeoutError);
  });

  it("o redactor do client mascara id, secret e forma base64", () => {
    const client = createClient(CONFIG);
    const b64 = Buffer.from(`${CONFIG.clientId}:${CONFIG.clientSecret}`, "utf8").toString("base64");
    const leaked = `id=${CONFIG.clientId} secret=${CONFIG.clientSecret} basic=${b64}`;
    const output = client.redact(leaked);
    expect(output).not.toContain(CONFIG.clientId);
    expect(output).not.toContain(CONFIG.clientSecret);
  });
});
