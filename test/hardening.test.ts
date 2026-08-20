/**
 * Regressões das correções de segurança da 0.3.1.
 *
 * Cada bloco aqui existe porque a versão anterior tinha uma brecha concreta;
 * o comentário diz qual, pra ninguém "simplificar" o fix de volta pro bug.
 */

import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { clientIp, createRateLimiter, credentialKey, normalizeForwardedHop } from "../src/http.js";
import { assertNoRawPii, looksLikeRawEmail } from "../src/utils/redact.js";

/** IncomingMessage mínimo: só o que clientIp lê. */
function fakeReq(socketIp: string, xff?: string | string[]): IncomingMessage {
  return {
    headers: xff === undefined ? {} : { "x-forwarded-for": xff },
    socket: { remoteAddress: socketIp },
  } as unknown as IncomingMessage;
}

describe("clientIp — chave de rate limit não pode ser forjável", () => {
  it("ignora o XFF inteiro quando trustProxy=false", () => {
    expect(clientIp(fakeReq("203.0.113.7", "1.2.3.4"), false)).toBe("203.0.113.7");
  });

  it("usa o hop da DIREITA, não o da esquerda (que o cliente escreve)", () => {
    // O proxy confiável anexa o peer real no fim. "9.9.9.9" é texto do atacante.
    const req = fakeReq("10.0.0.1", "9.9.9.9, 198.51.100.22");
    expect(clientIp(req, true)).toBe("198.51.100.22");
  });

  it("com 2 hops confiáveis pega o penúltimo", () => {
    const req = fakeReq("10.0.0.1", "9.9.9.9, 198.51.100.22, 10.0.0.9");
    expect(clientIp(req, true, 2)).toBe("198.51.100.22");
  });

  it("cai pro socket quando a cadeia é mais curta que os hops esperados", () => {
    expect(clientIp(fakeReq("203.0.113.7", "198.51.100.22"), true, 3)).toBe("203.0.113.7");
  });

  it("cai pro socket quando o hop não é um IP (chave arbitrária = inflar o mapa)", () => {
    expect(clientIp(fakeReq("203.0.113.7", "x".repeat(400)), true)).toBe("203.0.113.7");
    expect(clientIp(fakeReq("203.0.113.7", "não-é-ip"), true)).toBe("203.0.113.7");
    expect(clientIp(fakeReq("203.0.113.7", ""), true)).toBe("203.0.113.7");
  });

  it("REGRESSÃO: XFF diferente por request não zera mais a janela", () => {
    const limiter = createRateLimiter(3);
    let allowed = 0;
    for (let i = 0; i < 50; i += 1) {
      // Atacante troca o hop da esquerda a cada request; o real continua o mesmo.
      const req = fakeReq("10.0.0.1", `10.9.9.${i % 250}, 198.51.100.22`);
      if (limiter.check(clientIp(req, true)).ok) allowed += 1;
    }
    expect(allowed).toBe(3);
    expect(limiter.size()).toBe(1);
  });
});

describe("normalizeForwardedHop", () => {
  it("aceita as formas que proxies emitem", () => {
    expect(normalizeForwardedHop("198.51.100.22")).toBe("198.51.100.22");
    expect(normalizeForwardedHop(" 198.51.100.22:4433 ")).toBe("198.51.100.22");
    expect(normalizeForwardedHop("[2001:db8::1]")).toBe("2001:db8::1");
    expect(normalizeForwardedHop("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(normalizeForwardedHop("2001:db8::1")).toBe("2001:db8::1");
  });

  it("rejeita qualquer outra coisa", () => {
    expect(normalizeForwardedHop("")).toBeUndefined();
    expect(normalizeForwardedHop("localhost")).toBeUndefined();
    expect(normalizeForwardedHop("999.999.999.999")).toBeUndefined();
    expect(normalizeForwardedHop("a".repeat(46))).toBeUndefined();
  });
});

describe("createRateLimiter — teto de memória", () => {
  it("conta dentro da janela e libera na janela seguinte", () => {
    const limiter = createRateLimiter(2, 1000);
    expect(limiter.check("k", 0).ok).toBe(true);
    expect(limiter.check("k", 10).ok).toBe(true);
    const blocked = limiter.check("k", 20);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
    expect(limiter.check("k", 1100).ok).toBe(true);
  });

  it("REGRESSÃO: não cresce além do teto (era OOM com chave forjável)", () => {
    const limiter = createRateLimiter(10, 60_000, 100);
    for (let i = 0; i < 5_000; i += 1) {
      limiter.check(`chave-${i}`, 1000);
    }
    expect(limiter.size()).toBeLessThanOrEqual(100);
  });

  it("volta a aceitar chaves novas depois que a janela expira", () => {
    const limiter = createRateLimiter(10, 1000, 2);
    expect(limiter.check("a", 0).ok).toBe(true);
    expect(limiter.check("b", 0).ok).toBe(true);
    expect(limiter.check("c", 0).ok).toBe(false); // cheio
    expect(limiter.check("c", 2000).ok).toBe(true); // sweep liberou
  });
});

describe("credentialKey", () => {
  it("é estável e não contém o valor cru", () => {
    const id = "client_id_super_secreto";
    expect(credentialKey(id)).toBe(credentialKey(id));
    expect(credentialKey(id)).not.toContain(id);
    expect(credentialKey(id)).toHaveLength(22);
  });

  it("separa credenciais diferentes", () => {
    expect(credentialKey("a")).not.toBe(credentialKey("b"));
  });
});

describe("looksLikeRawEmail", () => {
  it("detecta e-mail cru", () => {
    expect(looksLikeRawEmail("joao@gmail.com")).toBe(true);
    expect(looksLikeRawEmail("texto joao.silva+x@sub.dominio.com.br fim")).toBe(true);
    expect(looksLikeRawEmail("a@bc.de")).toBe(true);
  });

  it("NÃO acusa e-mail já mascarado pelo servidor (senão toda tool quebra)", () => {
    expect(looksLikeRawEmail("jo****@gmail.com")).toBe(false);
    expect(looksLikeRawEmail("j*@dominio.com.br")).toBe(false);
  });

  it("detecta e-mail no fim de frase e antes de pontuação", () => {
    // O casamento é por PREFIXO do domínio; sem isso um e-mail seguido de
    // ponto final ou de qualquer texto escaparia da detecção.
    expect(looksLikeRawEmail("contato: joao@gmail.com.")).toBe(true);
    expect(looksLikeRawEmail("joao@gmail.com fim da frase")).toBe(true);
    expect(looksLikeRawEmail("<joao@gmail.com>")).toBe(true);
  });

  it("não confunde palavra com ponto depois de um @ solto", () => {
    expect(looksLikeRawEmail("a@b umtexto.com")).toBe(false);
    expect(looksLikeRawEmail("preço @ 10 reais no site.com")).toBe(false);
  });

  it("não trata host numérico como e-mail", () => {
    expect(looksLikeRawEmail("user@1.2.3.4")).toBe(false);
  });

  it("não acusa texto sem e-mail", () => {
    expect(looksLikeRawEmail("nada aqui")).toBe(false);
    expect(looksLikeRawEmail("a@b")).toBe(false);
    expect(looksLikeRawEmail("arroba@ solto")).toBe(false);
    expect(looksLikeRawEmail("fim@")).toBe(false);
  });

  it("REGRESSÃO ReDoS: era quadrático (24KB = ~400ms, 100KB travava)", () => {
    const t0 = Date.now();
    looksLikeRawEmail("a@" + "a".repeat(400_000));
    looksLikeRawEmail("@".repeat(200_000));
    looksLikeRawEmail("a".repeat(200_000) + "@" + "b".repeat(200_000));
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe("assertNoRawPii", () => {
  it("bloqueia PII crua e campo proibido", () => {
    expect(() => assertNoRawPii({ c: { email: "joao@gmail.com" } }, [])).toThrow(/e-mail/);
    expect(() => assertNoRawPii({ c: { cpf: "12345678901" } }, [])).toThrow(/CPF/);
    expect(() => assertNoRawPii({ x: { refund_token: "abc" } }, ["refund_token"])).toThrow(
      /campo proibido/,
    );
  });

  it("deixa passar payload mascarado e URL com userinfo", () => {
    expect(() =>
      assertNoRawPii(
        {
          cliente: { email: "jo****@gmail.com", cpf: "123.***.***-**" },
          webhook: "https://user@host.com/hook",
        },
        ["refund_token"],
      ),
    ).not.toThrow();
  });
});
