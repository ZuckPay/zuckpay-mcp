/**
 * Leitura e validação das variáveis de ambiente.
 *
 * Regras de segurança:
 * - Credenciais NUNCA chegam via argv (vazam em listagem de processos) — só env.
 * - Valores nunca são ecoados em mensagens de erro.
 * - Rejeita CR/LF, espaços e caracteres de controle internos
 *   (gotcha clássico de .env editado no Windows).
 */

// Hardcoded (não lida do package.json) porque o estágio final do Dockerfile
// só copia dist/ — package.json não está disponível em runtime no container.
// Atualizar junto com "version" no package.json a cada release (não há
// verificação automática — esqueceram no bump pra 0.2.1, healthz reportou
// 0.2.0 por 2 dias enquanto o código já estava certo).
export const VERSION = "0.2.1";

export const DEFAULT_BASE_URL = "https://www.zuckpay.com.br/conta";

export interface Config {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly baseUrl: string;
  readonly enableWithdraw: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/** true se contém espaço, caractere de controle (inclui CR/LF) ou DEL. */
function hasForbiddenChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Valida uma credencial vinda de qualquer origem (env no stdio, header
 * Basic no modo HTTP). Lança ConfigError sem nunca ecoar o valor.
 */
export function validateCredential(name: string, raw: string | undefined): string {
  if (raw === undefined || raw.trim() === "") {
    throw new ConfigError(
      `Credencial ${name} ausente. ` +
        `Gere suas credenciais no painel ZuckPay (Desenvolvedores > Credenciais API).`,
    );
  }
  const value = raw.trim();
  if (hasForbiddenChar(value)) {
    throw new ConfigError(
      `Credencial ${name} contém espaço, quebra de linha ou caractere de controle. ` +
        `Confira se o valor não foi colado com CR/LF no final.`,
    );
  }
  if (value.length > 256) {
    throw new ConfigError(`Credencial ${name} excede o tamanho máximo esperado (256 caracteres).`);
  }
  return value;
}

function readCredential(env: NodeJS.ProcessEnv, name: string): string {
  // eslint-disable-next-line security/detect-object-injection -- `name` é constante interna, nunca vem do modelo
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    throw new ConfigError(
      `Variável de ambiente ${name} ausente. ` +
        `Gere suas credenciais no painel ZuckPay (Desenvolvedores > Credenciais API) ` +
        `e configure-as no bloco "env" do seu cliente MCP.`,
    );
  }
  return validateCredential(name, raw);
}

/** Resolve a base URL (default ou override validado do env). */
export function resolveBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const override = (env.ZUCKPAY_BASE_URL ?? "").trim();
  if (override === "") {
    return DEFAULT_BASE_URL;
  }
  let parsed: URL;
  try {
    parsed = new URL(override);
  } catch {
    throw new ConfigError("ZUCKPAY_BASE_URL inválida: não é uma URL válida.");
  }
  if (parsed.protocol !== "https:") {
    throw new ConfigError("ZUCKPAY_BASE_URL deve usar https:// (http não é permitido).");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new ConfigError("ZUCKPAY_BASE_URL não pode conter credenciais embutidas.");
  }
  const baseUrl = override.replace(/\/+$/, "");
  // Aviso em stderr (stdout é reservado pro protocolo MCP no modo stdio)
  console.error(`[zuckpay-mcp] AVISO: usando base URL customizada: ${baseUrl}`);
  return baseUrl;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const clientId = readCredential(env, "ZUCKPAY_CLIENT_ID");
  const clientSecret = readCredential(env, "ZUCKPAY_CLIENT_SECRET");
  const baseUrl = resolveBaseUrl(env);
  const enableWithdraw = (env.ZUCKPAY_ENABLE_WITHDRAW ?? "").trim().toLowerCase() === "true";

  return Object.freeze({ clientId, clientSecret, baseUrl, enableWithdraw });
}
