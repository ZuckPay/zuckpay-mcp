/**
 * Máscara de segredos: nenhuma string sai do processo (tool result,
 * structuredContent ou stderr) sem passar por aqui.
 */

import { Buffer } from "node:buffer";

const MIN_SECRET_LENGTH = 6;

export function maskSecret(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  return `****${value.slice(-4)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Redactor = (text: string) => string;

/**
 * Cria uma função que substitui qualquer ocorrência dos segredos
 * informados (e da sua forma base64, usada no header Basic) pela máscara.
 */
export function createRedactor(secrets: readonly string[]): Redactor {
  const patterns: { regex: RegExp; mask: string }[] = [];

  for (const secret of secrets) {
    if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
      continue;
    }
    patterns.push({
      // eslint-disable-next-line security/detect-non-literal-regexp -- valor escapado por escapeRegExp; sem metacaracteres
      regex: new RegExp(escapeRegExp(secret), "g"),
      mask: maskSecret(secret),
    });
    // Forma base64 (aparece dentro do header Authorization: Basic ...)
    const b64 = Buffer.from(secret, "utf8").toString("base64");
    if (b64.length >= MIN_SECRET_LENGTH) {
      // eslint-disable-next-line security/detect-non-literal-regexp -- valor escapado por escapeRegExp; sem metacaracteres
      patterns.push({ regex: new RegExp(escapeRegExp(b64), "g"), mask: "****" });
    }
  }

  return (text: string): string => {
    let out = text;
    for (const { regex, mask } of patterns) {
      out = out.replace(regex, mask);
    }
    return out;
  };
}

/**
 * Mascaramento de PII (CPF/CNPJ, e-mail, telefone) — defesa em profundidade.
 *
 * A fonte da verdade é o mascaramento do lado servidor
 * (public_html/conta/libs/funcoes/pii_mask_helper.php). Estas funções
 * espelham a mesma lógica no lado MCP; elas não substituem o servidor —
 * servem para normalizar/validar o que já deveria vir mascarado, e para
 * `assertNoRawPii` detectar regressão do backend.
 */

export function maskCpf(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.***.***-**`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.***.***/****-**`;
  }
  return digits.slice(0, 2) + "*".repeat(Math.max(0, digits.length - 2));
}

export function maskEmail(value: string): string {
  const trimmed = value.trim();
  const at = trimmed.indexOf("@");
  if (at <= 0) {
    return trimmed === "" ? "" : "***";
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const visible = local.slice(0, 2);
  return visible + "*".repeat(Math.max(1, local.length - visible.length)) + "@" + domain;
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) {
    return "*".repeat(digits.length);
  }
  const ddd = digits.slice(0, 2);
  const last = digits.slice(-2);
  const middleLen = digits.length - ddd.length - last.length;
  return ddd + "*".repeat(Math.max(0, middleLen)) + last;
}

/**
 * Regex de detecção "solta" (não valida dígito verificador) usada só como
 * rede de segurança contra vazamento acidental de PII crua em qualquer
 * posição de um payload — inclusive campos livres não documentados
 * (ex.: `descricao` de uma transação onde o comprador colou o e-mail).
 */
const CPF_LIKE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/;
const CNPJ_LIKE = /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/;
// Local-part SEM `*`: um e-mail mascarado pelo servidor sempre termina com
// pelo menos um `*` antes do `@` (zuckMaskEmail garante max(1, ...)), então
// ele NÃO pode casar aqui — senão toda resposta legítima já mascarada
// lançaria RawPiiError e a tool quebraria sempre.
//
// GOTCHA: a versão anterior era um regex único
// (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/) com backtracking
// quadrático — o `.` pertence às duas classes vizinhas, então cada ponto de
// corte era retentado. 24 KB de texto travavam o event loop por ~400ms e
// 100 KB por segundos; como isto varre TODA string de TODO payload e o modo
// HTTP é single-thread compartilhado, uma descrição longa de um tenant
// congelava o serviço pra todos. Agora ancoramos no `@` e olhamos janelas de
// tamanho fixo (limites do RFC 5321), o que torna o custo linear no texto.
const EMAIL_LOCAL_MAX = 64;
const EMAIL_DOMAIN_MAX = 253;
const EMAIL_LOCAL_TAIL = /[A-Za-z0-9._%+-]$/;

function isDomainLabel(label: string): boolean {
  if (label === "") {
    return false;
  }
  for (const ch of label) {
    const c = ch.codePointAt(0) ?? 0;
    const alnum = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    if (!alnum && c !== 45 /* - */) {
      return false;
    }
  }
  return true;
}

/**
 * O label COMEÇA com um TLD (2+ letras)? É prefixo, não igualdade: o e-mail
 * pode estar colado em pontuação ("<joao@gmail.com>", "joao@gmail.com;") e o
 * lixo depois das letras não pode fazer a detecção falhar.
 */
function startsWithTld(label: string): boolean {
  let alpha = 0;
  for (const ch of label) {
    const c = ch.codePointAt(0) ?? 0;
    if (!((c >= 65 && c <= 90) || (c >= 97 && c <= 122))) {
      break;
    }
    alpha += 1;
    if (alpha >= 2) {
      return true;
    }
  }
  return false;
}

/**
 * Um domínio começa na posição dada? Percorre label a label em vez de usar
 * regex: `(?:\.[a-z0-9-]+)*\.[a-z]{2,}` tem quantificador aninhado, que é o
 * formato que explode em backtracking. Aqui cada caractere é visto uma vez.
 *
 * Casa por PREFIXO, como o regex antigo: "gmail.com." e "gmail.com fim"
 * contam, senão e-mail no fim de frase escaparia da detecção.
 */
function startsWithDomain(candidate: string): boolean {
  const labels = candidate.split(".");
  if (labels.length < 2 || !isDomainLabel(labels[0] ?? "")) {
    return false;
  }
  for (let i = 1; i < labels.length; i += 1) {
    const label = labels.at(i) ?? "";
    if (startsWithTld(label)) {
      return true;
    }
    if (!isDomainLabel(label)) {
      return false;
    }
  }
  return false;
}

/** Detecta e-mail cru sem backtracking ilimitado: janela fixa em torno de cada `@`. */
export function looksLikeRawEmail(value: string): boolean {
  for (let at = value.indexOf("@"); at !== -1; at = value.indexOf("@", at + 1)) {
    const local = value.slice(Math.max(0, at - EMAIL_LOCAL_MAX), at);
    if (local === "" || !EMAIL_LOCAL_TAIL.test(local)) {
      continue;
    }
    // A janela para no primeiro espaço: sem isso, "a@b umtexto.com" casaria
    // pelo ".com" de outra palavra e viraria falso positivo.
    const window = value.slice(at + 1, at + 1 + EMAIL_DOMAIN_MAX).split(/\s/)[0] ?? "";
    if (startsWithDomain(window)) {
      return true;
    }
  }
  return false;
}
// URLs podem ter userinfo ("https://user@host.com/...") que parece e-mail —
// é config do próprio seller (ex.: URL de webhook), não PII de comprador.
const URL_LIKE = /^https?:\/\//i;

export class RawPiiError extends Error {
  constructor(path: string, kind: string) {
    super(`PII não mascarada detectada em "${path}" (${kind}). Resposta bloqueada por segurança.`);
    this.name = "RawPiiError";
  }
}

/**
 * Varre recursivamente um payload já desserializado (JSON) atrás de campos
 * proibidos (por nome, ex. "refund_token") e de padrões de PII crua
 * (CPF/CNPJ/e-mail) em qualquer string, inclusive aninhada. Lança
 * `RawPiiError` — a chamada deve falhar ruidosamente, nunca vazar
 * silenciosamente. Use nas tools que leem infrações, assinaturas e
 * indique&ganhe, antes de devolver o resultado ao modelo.
 */
export function assertNoRawPii(payload: unknown, forbiddenKeys: readonly string[]): void {
  const forbidden = new Set(forbiddenKeys.map((k) => k.toLowerCase()));

  function walk(node: unknown, path: string): void {
    if (node === null || node === undefined) {
      return;
    }
    if (typeof node === "string") {
      if (CPF_LIKE.test(node) || CNPJ_LIKE.test(node)) {
        throw new RawPiiError(path, "CPF/CNPJ não mascarado");
      }
      if (!URL_LIKE.test(node) && looksLikeRawEmail(node)) {
        throw new RawPiiError(path, "e-mail não mascarado");
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof node === "object") {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (forbidden.has(key.toLowerCase())) {
          throw new RawPiiError(`${path}.${key}`, "campo proibido presente");
        }
        walk(value, `${path}.${key}`);
      }
    }
  }

  walk(payload, "$");
}
