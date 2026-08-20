/** Formatação PT-BR dos outputs das tools. */

export function formatMoney(value: number, currency: string = "BRL"): string {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

const STATUS_LABELS = new Map<string, string>([
  ["PAID", "PAGO ✅"],
  ["PENDING", "PENDENTE ⏳"],
  ["PENDING_3DS", "AGUARDANDO 3D SECURE 🔐"],
  ["FAILED", "FALHOU ❌"],
  ["REFUSED", "RECUSADO ❌"],
  ["EXPIRADO", "EXPIRADO ⌛"],
  ["EXPIRED", "EXPIRADO ⌛"],
  ["CHARGEBACK", "CHARGEBACK ⚠️"],
  ["REFUNDED", "ESTORNADO ↩️"],
  ["UNKNOWN", "DESCONHECIDO"],
]);

export function statusLabel(status: unknown): string {
  if (typeof status !== "string" || status.trim() === "") {
    return "DESCONHECIDO";
  }
  const key = status.trim().toUpperCase();
  return STATUS_LABELS.get(key) ?? key;
}

/** Extrai string de um objeto desconhecido sem lançar. */
export function pickString(obj: unknown, key: string): string | undefined {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo passado pelo nosso código
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Extrai número (aceita string numérica) de um objeto desconhecido. */
/**
 * Lê um booleano da resposta da API. Aceita as formas que o PHP emite pro
 * mesmo campo conforme o caminho (`true`, `"true"`, `1`) — tratar `1` como
 * ausente faria a flag de idempotência passar batida.
 */
export function pickBoolean(obj: unknown, key: string): boolean | undefined {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo do nosso código
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  return undefined;
}

export function pickNumber(obj: unknown, key: string): number | undefined {
  if (typeof obj !== "object" || obj === null) {
    return undefined;
  }
  // eslint-disable-next-line security/detect-object-injection -- `key` é literal fixo passado pelo nosso código
  const value = (obj as Record<string, unknown>)[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
