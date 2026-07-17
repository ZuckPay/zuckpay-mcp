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
