/**
 * HTTP client da API v3 ZuckPay.
 *
 * Segurança/robustez:
 * - Auth SOMENTE via header Basic (credencial nunca entra no body JSON).
 * - Timeout de 30s em toda chamada (AbortController).
 * - Retry APENAS em GET (idempotente) e apenas para falha de REDE — nunca
 *   em POST (movimenta dinheiro) e nunca em respostas 4xx/5xx.
 * - redirect: "error" — um 301 silencioso converteria POST em GET (gotcha
 *   conhecido do CDN sem "www"); aqui vira erro explícito com dica.
 * - Diagnóstico só em stderr, sempre passado pelo redactor.
 */

import { Buffer } from "node:buffer";
import { VERSION, type Config } from "./config.js";
import { NetworkError, TimeoutError, ZuckPayApiError, sanitizeText } from "./utils/errors.js";
import { createRedactor, type Redactor } from "./utils/redact.js";

export const REQUEST_TIMEOUT_MS = 30_000;

export interface ZuckPayClient {
  post(path: string, body: Readonly<Record<string, unknown>>): Promise<unknown>;
  get(path: string, query: Readonly<Record<string, string>>): Promise<unknown>;
  readonly redact: Redactor;
}

interface RequestOptions {
  query?: Readonly<Record<string, string>>;
  body?: Readonly<Record<string, unknown>>;
  retryOnNetworkError?: boolean;
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const parts = [err.message];
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      parts.push(cause.message);
    }
    return parts.join(" | ");
  }
  return String(err);
}

function extractApiMessage(parsed: unknown): string | undefined {
  if (typeof parsed !== "object" || parsed === null) {
    return undefined;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim() !== "") {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim() !== "") {
    return record.error;
  }
  return undefined;
}

export function createClient(config: Config): ZuckPayClient {
  const redact = createRedactor([config.clientId, config.clientSecret]);
  const authHeader =
    "Basic " + Buffer.from(`${config.clientId}:${config.clientSecret}`, "utf8").toString("base64");

  async function doFetch(
    method: "GET" | "POST",
    url: string,
    body: string | undefined,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Authorization: authHeader,
        Accept: "application/json",
        "User-Agent": `zuckpay-mcp/${VERSION}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      return await fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: "error",
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function request(
    method: "GET" | "POST",
    path: string,
    options: RequestOptions,
  ): Promise<unknown> {
    const url = new URL(config.baseUrl + path);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        url.searchParams.set(key, value);
      }
    }
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const maxAttempts = options.retryOnNetworkError === true ? 2 : 1;

    let lastNetworkError: NetworkError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      let response: Response;
      try {
        response = await doFetch(method, url.toString(), body);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          throw new TimeoutError(
            "A API ZuckPay não respondeu em 30 segundos. Tente novamente em instantes.",
          );
        }
        const detail = describeError(err);
        if (/redirect/i.test(detail)) {
          throw new NetworkError(
            "A API redirecionou a requisição. A base URL deve ser " +
              "https://www.zuckpay.com.br/conta (com www) — sem www o CDN " +
              "faz um 301 que converte POST em GET.",
          );
        }
        lastNetworkError = new NetworkError(
          "Falha de rede ao contatar a API ZuckPay. Verifique sua conexão e tente novamente.",
        );
        console.error(
          redact(
            `[zuckpay-mcp] falha de rede (${method} ${path}, tentativa ${attempt}/${maxAttempts}): ` +
              sanitizeText(detail),
          ),
        );
        continue;
      }

      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text === "" ? {} : JSON.parse(text);
      } catch {
        throw new ZuckPayApiError(
          response.status,
          response.ok
            ? "A API respondeu em formato inesperado (não-JSON)."
            : `Requisição rejeitada (HTTP ${response.status}) com resposta não-JSON.`,
        );
      }

      if (!response.ok) {
        const message =
          extractApiMessage(parsed) ?? `Requisição rejeitada (HTTP ${response.status}).`;
        throw new ZuckPayApiError(response.status, sanitizeText(message));
      }
      return parsed;
    }

    throw lastNetworkError ?? new NetworkError("Falha de rede ao contatar a API ZuckPay.");
  }

  return {
    post: (path, body) => request("POST", path, { body }),
    get: (path, query) => request("GET", path, { query, retryOnNetworkError: true }),
    redact,
  };
}
