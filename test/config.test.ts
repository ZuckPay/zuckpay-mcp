import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError, DEFAULT_BASE_URL, loadConfig } from "../src/config.js";

const BASE_ENV = {
  ZUCKPAY_CLIENT_ID: "client_abc123",
  ZUCKPAY_CLIENT_SECRET: "secret_def456",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadConfig", () => {
  it("carrega credenciais válidas com defaults seguros", () => {
    const config = loadConfig({ ...BASE_ENV });
    expect(config.clientId).toBe("client_abc123");
    expect(config.clientSecret).toBe("secret_def456");
    expect(config.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(config.enableWithdraw).toBe(false);
  });

  it("falha sem client id e sem ecoar valores", () => {
    expect(() => loadConfig({ ZUCKPAY_CLIENT_SECRET: "x_secret_1" })).toThrow(ConfigError);
  });

  it("falha com secret vazio", () => {
    expect(() => loadConfig({ ZUCKPAY_CLIENT_ID: "abc123", ZUCKPAY_CLIENT_SECRET: "   " })).toThrow(
      ConfigError,
    );
  });

  it("tolera CRLF no FINAL (trim) mas rejeita controle INTERNO", () => {
    const ok = loadConfig({
      ZUCKPAY_CLIENT_ID: "client_abc123\r\n",
      ZUCKPAY_CLIENT_SECRET: "secret_def456\r",
    });
    expect(ok.clientId).toBe("client_abc123");

    expect(() => loadConfig({ ...BASE_ENV, ZUCKPAY_CLIENT_ID: "client\r\nabc" })).toThrow(
      /quebra de linha|controle/,
    );
  });

  it("rejeita base URL http e com credenciais embutidas", () => {
    expect(() =>
      loadConfig({ ...BASE_ENV, ZUCKPAY_BASE_URL: "http://www.zuckpay.com.br/conta" }),
    ).toThrow(/https/);
    expect(() =>
      loadConfig({ ...BASE_ENV, ZUCKPAY_BASE_URL: "https://user:pass@evil.example/conta" }),
    ).toThrow(/credenciais/);
    expect(() => loadConfig({ ...BASE_ENV, ZUCKPAY_BASE_URL: "not-a-url" })).toThrow(/inválida/);
  });

  it("aceita override https válido, removendo barra final, com aviso em stderr", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const config = loadConfig({ ...BASE_ENV, ZUCKPAY_BASE_URL: "https://lab.example/api/" });
    expect(config.baseUrl).toBe("https://lab.example/api");
    expect(errSpy).toHaveBeenCalled();
  });

  it("só habilita saque com o literal true", () => {
    expect(loadConfig({ ...BASE_ENV, ZUCKPAY_ENABLE_WITHDRAW: "true" }).enableWithdraw).toBe(true);
    expect(loadConfig({ ...BASE_ENV, ZUCKPAY_ENABLE_WITHDRAW: " TRUE " }).enableWithdraw).toBe(
      true,
    );
    expect(loadConfig({ ...BASE_ENV, ZUCKPAY_ENABLE_WITHDRAW: "1" }).enableWithdraw).toBe(false);
    expect(loadConfig({ ...BASE_ENV, ZUCKPAY_ENABLE_WITHDRAW: "yes" }).enableWithdraw).toBe(false);
  });
});
