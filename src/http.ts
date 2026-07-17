/**
 * Entry HTTP multi-tenant do zuckpay-mcp (Streamable HTTP, modo stateless).
 *
 * Arquitetura:
 * - Cada request POST /mcp cria servidor MCP + transporte descartáveis com as
 *   credenciais DAQUELE request (Authorization: Basic client_id:client_secret).
 *   Nada fica em memória entre requests → escala horizontal sem sticky session.
 * - `node:http` puro — sem express nem middleware de terceiros no caminho
 *   da credencial.
 *
 * Segurança:
 * - Credencial só via header Basic; NUNCA em URL/query e NUNCA logada
 *   (o logger de acesso registra método/rota/status/duração/IP, mais nada).
 * - Rate limit por IP (janela fixa) com resposta 429 + Retry-After.
 * - Body limitado a 256 KB (413 acima disso), timeouts anti-slowloris.
 * - Sem CORS: cliente MCP não é browser; nenhum header Allow-Origin é emitido.
 * - 401 uniforme sem eco de credencial; erros internos sem stack trace.
 * - Saque (createPixWithdraw) NÃO é exposto no modo hospedado a menos que o
 *   OPERADOR do serviço suba com ZUCKPAY_ENABLE_WITHDRAW=true — e mesmo
 *   assim a tool continua exigindo confirm:true por chamada.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createClient } from "./client.js";
import { ConfigError, resolveBaseUrl, validateCredential, VERSION, type Config } from "./config.js";
import { registerPrompts } from "./prompts/index.js";
import { registerDocsResource } from "./resources/docs.js";
import { registerAllTools } from "./tools/index.js";
import { sanitizeText } from "./utils/errors.js";

export const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface BasicCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * Extrai e valida credenciais do header Authorization: Basic.
 * Retorna undefined para header ausente/malformado — nunca lança com o
 * conteúdo do header na mensagem.
 */
export function parseBasicAuth(header: string | undefined): BasicCredentials | undefined {
  if (header === undefined || !header.startsWith("Basic ")) {
    return undefined;
  }
  const encoded = header.slice(6).trim();
  if (encoded === "" || encoded.length > 1024 || !/^[A-Za-z0-9+/=]+$/.test(encoded)) {
    return undefined;
  }
  let decoded: string;
  try {
    decoded = Buffer.from(encoded, "base64").toString("utf8");
  } catch {
    return undefined;
  }
  const sep = decoded.indexOf(":");
  if (sep <= 0 || sep === decoded.length - 1) {
    return undefined;
  }
  try {
    return {
      clientId: validateCredential("client_id", decoded.slice(0, sep)),
      clientSecret: validateCredential("client_secret", decoded.slice(sep + 1)),
    };
  } catch {
    return undefined;
  }
}

/** Rate limiter de janela fixa por chave (IP). Sem dependências, O(1) por hit. */
export function createRateLimiter(limit: number, windowMs: number = RATE_LIMIT_WINDOW_MS) {
  const hits = new Map<string, { count: number; windowStart: number }>();

  function check(key: string, now: number = Date.now()): { ok: boolean; retryAfterSec: number } {
    const entry = hits.get(key);
    if (entry === undefined || now - entry.windowStart >= windowMs) {
      hits.set(key, { count: 1, windowStart: now });
      return { ok: true, retryAfterSec: 0 };
    }
    entry.count += 1;
    if (entry.count > limit) {
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)),
      };
    }
    return { ok: true, retryAfterSec: 0 };
  }

  /** Remove janelas expiradas (chamado por timer, não no hot path). */
  function sweep(now: number = Date.now()): void {
    for (const [key, entry] of hits) {
      if (now - entry.windowStart >= windowMs) {
        hits.delete(key);
      }
    }
  }

  return { check, sweep, size: () => hits.size };
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first !== undefined && first !== "" && first.length <= 45) {
      return first;
    }
  }
  return req.socket.remoteAddress ?? "unknown";
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

function jsonRpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  extraHeaders: Record<string, string> = {},
): void {
  sendJson(res, status, { jsonrpc: "2.0", error: { code, message }, id: null }, extraHeaders);
}

/** Lê o body com teto de tamanho; resolve undefined se estourar (já respondido). */
function readBody(req: IncomingMessage, res: ServerResponse): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;

    req.on("data", (chunk: Buffer) => {
      if (done) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        done = true;
        jsonRpcError(res, 413, -32600, "Body excede o limite de 256 KB.");
        req.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("error", () => {
      if (!done) {
        done = true;
        resolve(undefined);
      }
    });
  });
}

interface HttpEnv {
  readonly port: number;
  readonly baseUrl: string;
  readonly enableWithdraw: boolean;
  readonly trustProxy: boolean;
  readonly rateLimit: number;
}

function loadHttpEnv(env: NodeJS.ProcessEnv = process.env): HttpEnv {
  const port = Number.parseInt(env.PORT ?? "8080", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("PORT inválida.");
  }
  const rateLimit = Number.parseInt(env.MCP_RATE_LIMIT_PER_MINUTE ?? "60", 10);
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 10_000) {
    throw new ConfigError("MCP_RATE_LIMIT_PER_MINUTE inválido (1 a 10000).");
  }
  return {
    port,
    baseUrl: resolveBaseUrl(env),
    enableWithdraw: (env.ZUCKPAY_ENABLE_WITHDRAW ?? "").trim().toLowerCase() === "true",
    trustProxy: (env.MCP_TRUST_PROXY ?? "").trim().toLowerCase() === "true",
    rateLimit,
  };
}

async function handleMcpPost(
  req: IncomingMessage,
  res: ServerResponse,
  httpEnv: HttpEnv,
): Promise<void> {
  const credentials = parseBasicAuth(req.headers.authorization);
  if (credentials === undefined) {
    jsonRpcError(
      res,
      401,
      -32001,
      "Autenticação necessária: header Authorization: Basic base64(client_id:client_secret).",
      { "WWW-Authenticate": 'Basic realm="ZuckPay MCP"' },
    );
    return;
  }

  const raw = await readBody(req, res);
  if (raw === undefined) {
    return; // já respondido (413) ou conexão morreu
  }
  let parsedBody: unknown;
  try {
    parsedBody = raw === "" ? undefined : JSON.parse(raw);
  } catch {
    jsonRpcError(res, 400, -32700, "Body não é JSON válido.");
    return;
  }

  const config: Config = Object.freeze({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    baseUrl: httpEnv.baseUrl,
    enableWithdraw: httpEnv.enableWithdraw,
  });
  const client = createClient(config);

  const server = new McpServer({ name: "zuckpay-mcp", version: VERSION });
  registerAllTools(server, client, config);
  registerDocsResource(server);
  registerPrompts(server);

  // Stateless: sem session id, resposta JSON direta (sem stream SSE).
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      client.redact(`[zuckpay-mcp:http] erro no request MCP: ${sanitizeText(message)}`),
    );
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, "Erro interno do servidor.");
    } else {
      res.end();
    }
  }
}

export function startHttpServer(
  env: NodeJS.ProcessEnv = process.env,
): ReturnType<typeof createServer> {
  const httpEnv = loadHttpEnv(env);
  const limiter = createRateLimiter(httpEnv.rateLimit);
  const sweepTimer = setInterval(() => limiter.sweep(), RATE_LIMIT_WINDOW_MS);
  sweepTimer.unref();

  if (httpEnv.enableWithdraw) {
    console.error(
      "[zuckpay-mcp:http] AVISO: tool de saque habilitada NO SERVIÇO INTEIRO " +
        "(ZUCKPAY_ENABLE_WITHDRAW=true). Em modo hospedado multi-tenant isso vale " +
        "para todos os tenants — recomendado manter desligado.",
    );
  }

  const server = createServer((req, res) => {
    const started = Date.now();
    const method = req.method ?? "GET";
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    const ip = clientIp(req, httpEnv.trustProxy);

    res.on("finish", () => {
      console.error(
        `[zuckpay-mcp:http] ${method} ${path} ${res.statusCode} ${Date.now() - started}ms ip=${ip}`,
      );
    });

    if (path === "/healthz" && method === "GET") {
      sendJson(res, 200, { status: "ok", name: "zuckpay-mcp", version: VERSION });
      return;
    }

    if (path !== "/mcp") {
      jsonRpcError(res, 404, -32601, "Rota não encontrada. Use POST /mcp.");
      return;
    }

    if (method !== "POST") {
      // Stateless: sem sessão nem stream SSE — GET/DELETE não se aplicam.
      jsonRpcError(res, 405, -32601, "Método não permitido. Use POST /mcp.", { Allow: "POST" });
      return;
    }

    const verdict = limiter.check(ip);
    if (!verdict.ok) {
      jsonRpcError(res, 429, -32000, "Limite de requisições atingido. Tente novamente em breve.", {
        "Retry-After": String(verdict.retryAfterSec),
      });
      return;
    }

    void handleMcpPost(req, res, httpEnv).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[zuckpay-mcp:http] erro não tratado: ${sanitizeText(message)}`);
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Erro interno do servidor.");
      }
    });
  });

  // Anti-slowloris: headers em 10s, request completo em 60s.
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;

  server.listen(httpEnv.port, () => {
    console.error(
      `[zuckpay-mcp:http] v${VERSION} ouvindo na porta ${httpEnv.port} ` +
        `(POST /mcp, GET /healthz; rate limit ${httpEnv.rateLimit}/min/IP).`,
    );
  });

  const shutdown = (): void => {
    console.error("[zuckpay-mcp:http] encerrando...");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return server;
}

// Entry direto (dist/http.js): sobe o servidor; erros de config saem limpos.
if (process.argv[1] !== undefined && /http\.(js|ts)$/.test(process.argv[1])) {
  try {
    startHttpServer();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[zuckpay-mcp:http] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
}
