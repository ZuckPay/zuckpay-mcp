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
 * - Rate limit por IP E por credencial (janela fixa), aplicado a TODAS as
 *   rotas, com 429 + Retry-After e teto de memória nos contadores.
 * - Batch JSON-RPC recusado: a contagem do rate limit é por request HTTP, e
 *   um array no topo multiplicaria as chamadas por request (medido: 406x).
 * - Body limitado a 256 KB (413 acima disso), timeouts anti-slowloris e teto
 *   de conexões simultâneas.
 * - Sem CORS: cliente MCP não é browser; nenhum header Allow-Origin é emitido.
 * - 401 uniforme sem eco de credencial; erros internos sem stack trace.
 * - Saque não é exposto: a tool foi removida do registro (ver tools/index.ts).
 *
 * ATENÇÃO ao modelo de ameaça: o portão de auth valida o FORMATO do header
 * Basic, não a credencial — verificar exigiria uma ida à API por request. Com
 * isso, qualquer Basic bem-formado alcança initialize/tools/list/prompts (a
 * lista de tools é pública: o pacote é open source). O que contém isso é o
 * rate limit por IP. E rate limit em processo NÃO é proteção contra DDoS
 * volumétrico nem contra ataque distribuído: isso é trabalho da borda
 * (Cloudflare/WAF) e o limite vale POR INSTÂNCIA — com N réplicas, o teto
 * efetivo é N x MCP_RATE_LIMIT_PER_MINUTE.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
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

/** Teto de chaves distintas nos mapas de rate limit (ver createRateLimiter). */
export const MAX_RATE_LIMIT_KEYS = 20_000;

/**
 * Multiplicador do limite por credencial sobre o limite por IP: um mesmo
 * tenant pode legitimamente chegar de vários IPs (equipe, serverless), mas
 * não pode consumir o serviço compartilhado inteiro sozinho.
 */
const CREDENTIAL_LIMIT_FACTOR = 4;

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

/**
 * Rate limiter de janela fixa por chave. Sem dependências, O(1) por hit.
 *
 * O mapa tem TETO (`maxKeys`): sem ele, uma chave controlável pelo cliente
 * (ver `clientIp`) permite inflar a tabela até estourar a memória do processo.
 * Cheio, tenta um sweep oportunista e só então recusa — negar request é
 * degradação temporária, OOM derruba o serviço inteiro.
 */
export function createRateLimiter(
  limit: number,
  windowMs: number = RATE_LIMIT_WINDOW_MS,
  maxKeys: number = MAX_RATE_LIMIT_KEYS,
) {
  const hits = new Map<string, { count: number; windowStart: number }>();

  /** Remove janelas expiradas (chamado por timer, não no hot path). */
  function sweep(now: number = Date.now()): void {
    for (const [key, entry] of hits) {
      if (now - entry.windowStart >= windowMs) {
        hits.delete(key);
      }
    }
  }

  function check(key: string, now: number = Date.now()): { ok: boolean; retryAfterSec: number } {
    const entry = hits.get(key);

    if (entry !== undefined && now - entry.windowStart < windowMs) {
      entry.count += 1;
      if (entry.count > limit) {
        return {
          ok: false,
          retryAfterSec: Math.max(1, Math.ceil((entry.windowStart + windowMs - now) / 1000)),
        };
      }
      return { ok: true, retryAfterSec: 0 };
    }

    // Janela nova. Se a tabela está no teto, limpa o que expirou antes de crescer.
    if (entry === undefined && hits.size >= maxKeys) {
      sweep(now);
      if (hits.size >= maxKeys) {
        return { ok: false, retryAfterSec: Math.max(1, Math.ceil(windowMs / 1000)) };
      }
    }

    hits.set(key, { count: 1, windowStart: now });
    return { ok: true, retryAfterSec: 0 };
  }

  return { check, sweep, size: () => hits.size };
}

/**
 * Normaliza um hop de X-Forwarded-For para um IP válido, ou undefined.
 * Aceita as formas que proxies emitem na prática: "1.2.3.4", "1.2.3.4:5678",
 * "[::1]" e "[::1]:5678". Qualquer outra coisa é texto arbitrário do cliente
 * e não pode virar chave de rate limit.
 */
export function normalizeForwardedHop(raw: string): string | undefined {
  const value = raw.trim();
  if (value === "" || value.length > 45) {
    return undefined;
  }
  if (isIP(value) !== 0) {
    return value;
  }
  // Parsing sem regex de propósito: isto roda em header controlado pelo
  // cliente, e `isIP` do node já é o validador de verdade. Um regex aqui só
  // adicionaria superfície de backtracking sem decidir nada melhor.
  if (value.startsWith("[")) {
    const close = value.indexOf("]");
    if (close <= 1) {
      return undefined;
    }
    const inner = value.slice(1, close);
    const rest = value.slice(close + 1);
    if ((rest === "" || isPortSuffix(rest)) && isIP(inner) === 6) {
      return inner;
    }
    return undefined;
  }
  // Sem colchete, só IPv4 aparece com porta ("1.2.3.4:5678").
  const colon = value.lastIndexOf(":");
  if (colon > 0 && isPortSuffix(value.slice(colon))) {
    const host = value.slice(0, colon);
    if (isIP(host) === 4) {
      return host;
    }
  }
  return undefined;
}

/** true para ":" seguido de 1–5 dígitos. */
function isPortSuffix(value: string): boolean {
  if (!value.startsWith(":") || value.length < 2 || value.length > 6) {
    return false;
  }
  for (let i = 1; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 48 || code > 57) {
      return false;
    }
  }
  return true;
}

/**
 * IP do cliente para fins de rate limit.
 *
 * GOTCHA: cada proxy ANEXA à direita o peer de quem recebeu, então com N
 * proxies confiáveis na frente o IP real é o N-ésimo a contar do FIM. Tudo à
 * esquerda disso é string que o próprio cliente escreveu — ler `xff[0]`, como
 * fazíamos, entrega a chave do rate limit pro atacante: um valor diferente por
 * request zera a janela toda vez e ainda infla o mapa de contadores.
 *
 * Sem `trustProxy`, o único valor confiável é o socket.
 */
export function clientIp(req: IncomingMessage, trustProxy: boolean, hops: number = 1): string {
  const socketIp = req.socket.remoteAddress ?? "unknown";
  if (!trustProxy) {
    return socketIp;
  }
  const raw = req.headers["x-forwarded-for"];
  const chain = (Array.isArray(raw) ? raw.join(",") : (raw ?? ""))
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (chain.length === 0) {
    return socketIp;
  }
  // Menos hops que o esperado = request não passou pela cadeia inteira;
  // cai pro socket em vez de aceitar o que o cliente mandou.
  const index = chain.length - hops;
  if (index < 0) {
    return socketIp;
  }
  return normalizeForwardedHop(chain.at(index) ?? "") ?? socketIp;
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
  readonly trustProxyHops: number;
  readonly rateLimit: number;
  readonly maxConnections: number;
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
  // Quantos proxies confiáveis existem na frente. Errar pra mais aceitaria um
  // hop forjado pelo cliente, então o default é o mínimo (1: o próprio edge).
  const trustProxyHops = Number.parseInt(env.MCP_TRUST_PROXY_HOPS ?? "1", 10);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 1 || trustProxyHops > 10) {
    throw new ConfigError("MCP_TRUST_PROXY_HOPS inválido (1 a 10).");
  }
  const maxConnections = Number.parseInt(env.MCP_MAX_CONNECTIONS ?? "512", 10);
  if (!Number.isInteger(maxConnections) || maxConnections < 8 || maxConnections > 100_000) {
    throw new ConfigError("MCP_MAX_CONNECTIONS inválido (8 a 100000).");
  }
  return {
    port,
    baseUrl: resolveBaseUrl(env),
    enableWithdraw: (env.ZUCKPAY_ENABLE_WITHDRAW ?? "").trim().toLowerCase() === "true",
    trustProxy: (env.MCP_TRUST_PROXY ?? "").trim().toLowerCase() === "true",
    trustProxyHops,
    rateLimit,
    maxConnections,
  };
}

/**
 * Chave de rate limit derivada da credencial. Hash truncado, nunca o valor
 * cru: a chave vive num Map em memória e aparece em heap dump/core dump.
 */
export function credentialKey(clientId: string): string {
  return createHash("sha256").update(clientId).digest("base64url").slice(0, 22);
}

async function handleMcpPost(
  req: IncomingMessage,
  res: ServerResponse,
  httpEnv: HttpEnv,
  credentialLimiter: ReturnType<typeof createRateLimiter>,
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

  // Rate limit por credencial, além do por IP: um tenant vindo de mil IPs
  // (serverless, VPN) ainda não consome o serviço compartilhado sozinho.
  const credentialVerdict = credentialLimiter.check(credentialKey(credentials.clientId));
  if (!credentialVerdict.ok) {
    jsonRpcError(
      res,
      429,
      -32000,
      "Limite de requisições desta credencial atingido. Tente novamente em breve.",
      { "Retry-After": String(credentialVerdict.retryAfterSec) },
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

  // Batch JSON-RPC (array no topo) é RECUSADO.
  //
  // O MCP removeu batching na revisão 2025-06-18, mas o transporte da SDK
  // ainda processa arrays — e um batch quebra o rate limit inteiro, porque a
  // contagem é por REQUEST HTTP e não por chamada. Medido nesta versão antes
  // do fix: 249 KB de body com 5.000 entradas devolveram 101 MB em 3,7s
  // valendo 1 hit no limiter (amplificação de 406x), e o portão de auth não
  // verifica a credencial contra a API — qualquer Basic bem-formado chega
  // aqui. Um IP sozinho saturava CPU e banda do serviço; com credencial
  // válida seriam 5.000 chamadas à API ZuckPay num único POST.
  if (Array.isArray(parsedBody)) {
    jsonRpcError(
      res,
      400,
      -32600,
      "Batch JSON-RPC não é suportado: envie uma chamada por requisição. " +
        "(Batching foi removido do MCP na revisão 2025-06-18.)",
    );
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
  const credentialLimiter = createRateLimiter(httpEnv.rateLimit * CREDENTIAL_LIMIT_FACTOR);
  const sweepTimer = setInterval(() => {
    limiter.sweep();
    credentialLimiter.sweep();
  }, RATE_LIMIT_WINDOW_MS);
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
    const ip = clientIp(req, httpEnv.trustProxy, httpEnv.trustProxyHops);

    res.on("finish", () => {
      console.error(
        `[zuckpay-mcp:http] ${method} ${path} ${res.statusCode} ${Date.now() - started}ms ip=${ip}`,
      );
    });

    // Rate limit ANTES do roteamento: antes ele só cobria POST /mcp, então
    // /healthz e qualquer 404 aceitavam flood sem nenhum teto.
    const verdict = limiter.check(ip);
    if (!verdict.ok) {
      jsonRpcError(res, 429, -32000, "Limite de requisições atingido. Tente novamente em breve.", {
        "Retry-After": String(verdict.retryAfterSec),
      });
      return;
    }

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

    void handleMcpPost(req, res, httpEnv, credentialLimiter).catch((err: unknown) => {
      // Só o NOME do erro: o redactor por tenant vive dentro de handleMcpPost
      // (é construído com as credenciais daquele request) e não existe aqui.
      // Logar `err.message` sem ele é um caminho de vazamento de credencial —
      // este catch é a rede de segurança, o diagnóstico útil já saiu redigido
      // lá dentro.
      console.error(
        `[zuckpay-mcp:http] erro não tratado (${err instanceof Error ? err.name : "desconhecido"})`,
      );
      if (!res.headersSent) {
        jsonRpcError(res, 500, -32603, "Erro interno do servidor.");
      }
    });
  });

  // Anti-slowloris: headers em 10s, request completo em 60s.
  server.headersTimeout = 10_000;
  server.requestTimeout = 60_000;
  // O rate limit conta REQUESTS; sockets abertos que nunca completam um
  // request não passam por ele. Sem teto, dá pra prender o processo só
  // abrindo conexões e segurando cada uma por headersTimeout.
  server.maxConnections = httpEnv.maxConnections;

  // Sem estes handlers, o comportamento padrão do Node imprime a STACK
  // COMPLETA em stderr — que pode conter credencial de um tenant. Aqui só o
  // nome do erro sai; não há redactor global em modo multi-tenant, e sair é
  // mais seguro que seguir com estado possivelmente corrompido (o supervisor
  // reinicia). Erros de request já são tratados e redigidos em handleMcpPost.
  process.on("uncaughtException", (err: Error) => {
    console.error(`[zuckpay-mcp:http] exceção não capturada (${err.name}) — encerrando.`);
    process.exit(1);
  });
  process.on("unhandledRejection", (reason: unknown) => {
    console.error(
      `[zuckpay-mcp:http] rejeição não tratada (${reason instanceof Error ? reason.name : "desconhecida"}) — encerrando.`,
    );
    process.exit(1);
  });

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
