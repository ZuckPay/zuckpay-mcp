/**
 * Erros tipados + tradução para mensagens amigáveis SEM vazamento:
 * nada de stack trace, corpo bruto ou credenciais no texto que chega ao modelo.
 */

import { ZodError } from "zod";
import type { Redactor } from "./redact.js";

export class ZuckPayApiError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ZuckPayApiError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

const MAX_ERROR_LENGTH = 300;

/**
 * Remove caracteres de controle (mantém quebras de linha) e trunca.
 * Implementado por code point para não depender de regex com ranges de controle.
 */
export function sanitizeText(text: string, maxLength: number = MAX_ERROR_LENGTH): string {
  const kept: string[] = [];
  for (const ch of text) {
    if (kept.length >= maxLength) {
      kept.push("...");
      break;
    }
    const code = ch.codePointAt(0) ?? 0;
    const isNewline = code === 0x0a;
    const isPrintable = code >= 0x20 && code !== 0x7f;
    if (isNewline || isPrintable) {
      kept.push(ch);
    }
  }
  return kept.join("");
}

/** Converte qualquer erro em mensagem PT-BR segura para o tool result. */
export function toUserMessage(err: unknown, redact: Redactor): string {
  if (err instanceof ZodError) {
    const issues = err.issues
      .map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join(".") : "(raiz)";
        return `${path}: ${issue.message}`;
      })
      .join("; ");
    return `Parâmetros inválidos — nada foi enviado à API. ${redact(sanitizeText(issues))}`;
  }
  if (err instanceof ZuckPayApiError) {
    const msg = redact(sanitizeText(err.message));
    if (err.statusCode === 401) {
      return (
        "Credenciais recusadas pela ZuckPay (HTTP 401). " +
        "Verifique ZUCKPAY_CLIENT_ID e ZUCKPAY_CLIENT_SECRET na configuração do cliente MCP."
      );
    }
    if (err.statusCode === 403 && /SPEI_NOT_ENABLED/i.test(msg)) {
      return (
        "SPEI não está habilitado nesta conta ZuckPay (HTTP 403 SPEI_NOT_ENABLED). " +
        "Solicite a ativação ao suporte da plataforma."
      );
    }
    if (/saldo/i.test(msg)) {
      return `Operação não realizada: ${msg}`;
    }
    return `Erro da API ZuckPay (HTTP ${err.statusCode}): ${msg}`;
  }
  if (err instanceof TimeoutError || err instanceof NetworkError) {
    return redact(sanitizeText(err.message));
  }
  const fallback = err instanceof Error ? err.message : "erro desconhecido";
  return `Erro inesperado no zuckpay-mcp: ${redact(sanitizeText(fallback))}`;
}
