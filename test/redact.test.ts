import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { createRedactor, maskSecret } from "../src/utils/redact.js";

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
