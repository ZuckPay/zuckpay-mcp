import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  assertNoRawPii,
  createRedactor,
  maskCpf,
  maskEmail,
  maskPhone,
  maskSecret,
  RawPiiError,
} from "../src/utils/redact.js";

describe("maskSecret", () => {
  it("mostra só os 4 últimos caracteres", () => {
    expect(maskSecret("super_secret_9876")).toBe("****9876");
  });

  it("mascara tudo quando o valor é curto", () => {
    expect(maskSecret("abcd")).toBe("****");
  });
});

describe("createRedactor", () => {
  const secret = "sk_live_ABCDEF123456";
  const clientId = "ci_9988776655";
  const redact = createRedactor([clientId, secret]);

  it("substitui toda ocorrência do segredo em texto", () => {
    const input = `Authorization falhou para ${secret} e ${secret}.`;
    const output = redact(input);
    expect(output).not.toContain(secret);
    expect(output).toContain("****3456");
  });

  it("substitui a forma base64 (header Basic)", () => {
    const b64 = Buffer.from(secret, "utf8").toString("base64");
    const output = redact(`header: Basic ${b64}`);
    expect(output).not.toContain(b64);
  });

  it("mascara os dois segredos ao mesmo tempo", () => {
    const output = redact(`${clientId}:${secret}`);
    expect(output).not.toContain(clientId);
    expect(output).not.toContain(secret);
  });

  it("ignora segredos curtos demais (evita mascarar texto comum)", () => {
    const short = createRedactor(["ab"]);
    expect(short("abacate")).toBe("abacate");
  });

  it("não altera texto sem segredos", () => {
    expect(redact("mensagem limpa")).toBe("mensagem limpa");
  });
});

describe("maskCpf", () => {
  it("mascara CPF (11 dígitos)", () => {
    expect(maskCpf("12345678901")).toBe("123.***.***-**");
    expect(maskCpf("123.456.789-01")).toBe("123.***.***-**");
  });

  it("mascara CNPJ (14 dígitos)", () => {
    expect(maskCpf("12345678000190")).toBe("12.***.***/****-**");
  });
});

describe("maskEmail", () => {
  it("mantém os 2 primeiros chars do local-part e o domínio completo", () => {
    expect(maskEmail("cadubimports@gmail.com")).toBe("ca**********@gmail.com");
  });

  it("lida com local-part de 1 caractere", () => {
    expect(maskEmail("a@b.com")).toBe("a*@b.com");
  });
});

describe("maskPhone", () => {
  it("mantém DDD e os 2 últimos dígitos", () => {
    expect(maskPhone("11987654321")).toBe("11*******21");
  });

  it("mascara tudo quando é muito curto", () => {
    expect(maskPhone("123")).toBe("***");
  });
});

describe("assertNoRawPii", () => {
  it("não lança para payload limpo", () => {
    expect(() =>
      assertNoRawPii({ nome: "Cliente", cpf: "123.***.***-**" }, ["refund_token"]),
    ).not.toThrow();
  });

  it("lança para CPF cru em qualquer posição aninhada", () => {
    expect(() =>
      assertNoRawPii({ items: [{ descricao: "doc 123.456.789-01 anexo" }] }, []),
    ).toThrow(RawPiiError);
  });

  it("lança para e-mail cru", () => {
    expect(() => assertNoRawPii({ contato: "fulano@example.com" }, [])).toThrow(RawPiiError);
  });

  it("lança quando um campo proibido está presente, mesmo mascarado", () => {
    expect(() => assertNoRawPii({ refund_token: "abc123" }, ["refund_token"])).toThrow(RawPiiError);
  });

  it("NÃO lança para e-mail já mascarado pelo servidor (regressão crítica)", () => {
    // O servidor sempre deixa >=1 `*` antes do `@` — a resposta legítima das
    // tools de infrações/assinaturas/indique&ganhe é exatamente assim.
    expect(() =>
      assertNoRawPii(
        {
          subscriptions: [
            { customer_email: "ca***@gmail.com", customer_name: "Carlos S." },
            { customer_email: "jo*@x.com.br", customer_phone: "11*******34" },
          ],
        },
        [],
      ),
    ).not.toThrow();
  });

  it("NÃO lança para URL de webhook com userinfo (config do seller, não PII)", () => {
    expect(() =>
      assertNoRawPii({ webhooks: [{ url: "https://user@example.com/hook" }] }, []),
    ).not.toThrow();
  });

  it("lança para e-mail cru mesmo dentro de texto livre aninhado", () => {
    expect(() =>
      assertNoRawPii(
        { refund_requests: [{ reason_detail: "me responde em fulano@gmail.com" }] },
        [],
      ),
    ).toThrow(RawPiiError);
  });
});
