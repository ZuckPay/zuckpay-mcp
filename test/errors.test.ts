import { describe, expect, it } from "vitest";
import { z } from "zod";
import { NetworkError, sanitizeText, toUserMessage, ZuckPayApiError } from "../src/utils/errors.js";
import { createRedactor } from "../src/utils/redact.js";

const identity = (text: string): string => text;

describe("sanitizeText", () => {
  it("remove caracteres de controle preservando quebras de linha", () => {
    expect(sanitizeText("ab" + String.fromCharCode(7) + "c\nd")).toBe("abc\nd");
  });

  it("trunca textos longos", () => {
    const out = sanitizeText("x".repeat(1000));
    expect(out.length).toBeLessThan(320);
    expect(out.endsWith("...")).toBe(true);
  });
});

describe("toUserMessage", () => {
  it("401 vira orientação de credenciais sem detalhes técnicos", () => {
    const msg = toUserMessage(new ZuckPayApiError(401, "Unauthorized"), identity);
    expect(msg).toContain("401");
    expect(msg).toContain("ZUCKPAY_CLIENT_ID");
  });

  it("403 SPEI_NOT_ENABLED vira explicação de ativação", () => {
    const msg = toUserMessage(new ZuckPayApiError(403, "SPEI_NOT_ENABLED"), identity);
    expect(msg).toContain("SPEI");
    expect(msg).toContain("ativação");
  });

  it("erro de saldo é repassado com destaque", () => {
    const msg = toUserMessage(new ZuckPayApiError(400, "Saldo insuficiente para saque"), identity);
    expect(msg).toContain("Saldo insuficiente");
  });

  it("ZodError lista caminho e mensagem sem enviar nada à API", () => {
    const schema = z.object({ valor: z.number().positive() }).strict();
    const result = schema.safeParse({ valor: -1, extra: true });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = toUserMessage(result.error, identity);
      expect(msg).toContain("Parâmetros inválidos");
      expect(msg).toContain("valor");
    }
  });

  it("mensagem de erro da API passa pelo redactor (segredo nunca vaza)", () => {
    const secret = "secret_super_XYZ_999";
    const redact = createRedactor([secret]);
    const msg = toUserMessage(new ZuckPayApiError(500, `debug secret=${secret}`), redact);
    expect(msg).not.toContain(secret);
  });

  it("NetworkError passa a mensagem amigável adiante", () => {
    const msg = toUserMessage(new NetworkError("Falha de rede ao contatar a API."), identity);
    expect(msg).toContain("Falha de rede");
  });
});
