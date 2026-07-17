/**
 * Schemas zod compartilhados entre as tools.
 * Toda entrada do modelo passa por aqui ANTES de tocar a API.
 */

import { z } from "zod";

export function digitsOnly(value: string): string {
  return value.replace(/\D+/g, "");
}

/** true se o número tem no máximo 2 casas decimais (tolerância de float). */
export function centsExact(value: number): boolean {
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6;
}

export function moneySchema(options: { min: number; max?: number; description: string }) {
  return z
    .number()
    .finite()
    .positive()
    .refine(centsExact, { message: "Use no máximo 2 casas decimais." })
    .refine((v) => v >= options.min, {
      message: `Valor mínimo permitido: ${options.min.toFixed(2)}.`,
    })
    .refine((v) => options.max === undefined || v <= options.max, {
      message: `Valor máximo permitido: ${options.max?.toFixed(2) ?? ""}.`,
    })
    .describe(options.description);
}

export const nomeSchema = z
  .string()
  .trim()
  .min(3, "Nome muito curto.")
  .max(120, "Nome muito longo.")
  .describe("Nome completo do pagador");

export const emailSchema = z
  .string()
  .trim()
  .email("E-mail inválido.")
  .max(160)
  .describe("E-mail do pagador");

export const cpfSchema = z
  .string()
  .trim()
  .min(11)
  .max(18)
  .refine((v) => digitsOnly(v).length === 11, {
    message: "CPF deve conter exatamente 11 dígitos.",
  })
  .describe("CPF do pagador (11 dígitos; pontuação é removida automaticamente)");

export const telefoneSchema = z
  .string()
  .trim()
  .min(8)
  .max(20)
  .refine(
    (v) => {
      const d = digitsOnly(v);
      return d.length >= 10 && d.length <= 13;
    },
    { message: "Telefone deve conter de 10 a 13 dígitos (inclua o DDD)." },
  )
  .describe("Telefone do pagador com DDD (ex: 11999998888)");

export function httpsUrlSchema(description: string) {
  return z
    .string()
    .trim()
    .max(500)
    .url("URL inválida.")
    .refine((v) => v.startsWith("https://"), { message: "A URL deve usar https://." })
    .describe(description);
}

export const externalIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._:-]+$/, {
    message: "Use apenas letras, números, ponto, hífen, underline e dois-pontos.",
  })
  .describe(
    "ID externo do seu sistema (ex: ORDER-123). Garante idempotência: repetir o mesmo ID retorna a mesma cobrança pendente.",
  );

export const descricaoSchema = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .describe(`Descrição/motivo do pagamento (até ${max} caracteres)`);

export const productIdSchema = z
  .number()
  .int()
  .positive()
  .describe("ID de um produto cadastrado na conta ZuckPay (vincula a transação ao produto)");

export const splitsSchema = z
  .array(
    z
      .object({
        email: z.string().trim().email("E-mail de recebedor inválido.").max(160),
        percentage: z
          .number()
          .positive()
          .max(100)
          .refine(centsExact, { message: "Percentual com no máximo 2 casas decimais." }),
      })
      .strict(),
  )
  .min(2, "Split exige no mínimo 2 recebedores.")
  .max(10, "Split permite no máximo 10 recebedores.")
  .refine(
    (arr) => {
      const sum = arr.reduce((acc, item) => acc + item.percentage, 0);
      return Math.abs(sum - 100) < 0.001;
    },
    { message: "A soma dos percentuais do split deve ser exatamente 100." },
  )
  .describe(
    "Divisão de receita entre contas ZuckPay (2 a 10 recebedores; soma dos percentuais = 100). Calculada sobre o valor líquido.",
  );

export const pixKeyTypeSchema = z
  .enum(["CPF", "EMAIL", "PHONE", "EVP"])
  .describe("Tipo da chave PIX de destino");

export const PAYPAL_CURRENCIES = [
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "EUR",
  "GBP",
  "HKD",
  "HUF",
  "ILS",
  "INR",
  "JPY",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "SEK",
  "SGD",
  "THB",
  "TWD",
  "USD",
] as const;

export const paypalCurrencySchema = z
  .enum(PAYPAL_CURRENCIES)
  .describe("Moeda ISO 4217 (padrão: BRL)");

/** Campos de rastreio aceitos pelo /v3/pix/qrcode (mesmo padrão do checkout). */
export const TRACKING_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "src",
  "sck",
  "fbclid",
  "fbc",
  "fbp",
  "gclid",
  "wbraid",
  "gbraid",
  "ttclid",
  "kclid",
  "click_id",
] as const;

export type TrackingField = (typeof TRACKING_FIELDS)[number];

const trackingValue = z.string().trim().min(1).max(255);

export function trackingShape(): Record<TrackingField, z.ZodOptional<typeof trackingValue>> {
  const shape = {} as Record<TrackingField, z.ZodOptional<typeof trackingValue>>;
  for (const field of TRACKING_FIELDS) {
    // eslint-disable-next-line security/detect-object-injection -- `field` vem do array const TRACKING_FIELDS
    shape[field] = trackingValue
      .describe(`Parâmetro de rastreio ${field} (opcional)`)
      .optional() as z.ZodOptional<typeof trackingValue>;
  }
  return shape;
}
