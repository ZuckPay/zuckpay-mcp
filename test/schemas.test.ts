import { describe, expect, it } from "vitest";
import { createPixChargeSchema, getTransactionStatusSchema } from "../src/tools/pix.js";
import { createPayPalOrderSchema } from "../src/tools/paypal.js";
import { createSpeiCashinSchema } from "../src/tools/spei.js";
import {
  createPixWithdrawSchema,
  WITHDRAW_MAX_BRL,
  WITHDRAW_MIN_BRL,
} from "../src/tools/withdraw.js";

const validPix = {
  nome: "Cliente de Teste",
  cpf: "123.456.789-01",
  email: "cliente@example.com",
  telefone: "(11) 99999-8888",
  valor: 49.9,
};

describe("createPixChargeSchema", () => {
  it("aceita cobrança mínima válida", () => {
    expect(createPixChargeSchema.safeParse(validPix).success).toBe(true);
  });

  it("rejeita campo desconhecido (.strict)", () => {
    const result = createPixChargeSchema.safeParse({ ...validPix, hack: "x" });
    expect(result.success).toBe(false);
  });

  it("rejeita valor com mais de 2 casas decimais, zero e negativo", () => {
    expect(createPixChargeSchema.safeParse({ ...validPix, valor: 10.555 }).success).toBe(false);
    expect(createPixChargeSchema.safeParse({ ...validPix, valor: 0 }).success).toBe(false);
    expect(createPixChargeSchema.safeParse({ ...validPix, valor: -5 }).success).toBe(false);
  });

  it("rejeita CPF sem 11 dígitos e telefone curto", () => {
    expect(createPixChargeSchema.safeParse({ ...validPix, cpf: "123456" }).success).toBe(false);
    expect(createPixChargeSchema.safeParse({ ...validPix, telefone: "999" }).success).toBe(false);
  });

  it("valida splits: soma 100, entre 2 e 10 recebedores", () => {
    const ok = {
      ...validPix,
      splits: [
        { email: "a@example.com", percentage: 60 },
        { email: "b@example.com", percentage: 40 },
      ],
    };
    expect(createPixChargeSchema.safeParse(ok).success).toBe(true);

    const somaErrada = {
      ...validPix,
      splits: [
        { email: "a@example.com", percentage: 60 },
        { email: "b@example.com", percentage: 39.9 },
      ],
    };
    expect(createPixChargeSchema.safeParse(somaErrada).success).toBe(false);

    const umSo = { ...validPix, splits: [{ email: "a@example.com", percentage: 100 }] };
    expect(createPixChargeSchema.safeParse(umSo).success).toBe(false);
  });

  it("rejeita urlnoty http e external_id_client com caracteres inválidos", () => {
    expect(
      createPixChargeSchema.safeParse({ ...validPix, urlnoty: "http://meusite.com/hook" }).success,
    ).toBe(false);
    expect(
      createPixChargeSchema.safeParse({ ...validPix, external_id_client: "ORDER 123 <x>" }).success,
    ).toBe(false);
    expect(
      createPixChargeSchema.safeParse({ ...validPix, external_id_client: "ORDER-123" }).success,
    ).toBe(true);
  });
});

describe("getTransactionStatusSchema", () => {
  it("exige exatamente um identificador", () => {
    expect(getTransactionStatusSchema.safeParse({ transactionId: "tx_1" }).success).toBe(true);
    expect(getTransactionStatusSchema.safeParse({ externalIdClient: "ORDER-1" }).success).toBe(
      true,
    );
    expect(getTransactionStatusSchema.safeParse({}).success).toBe(false);
    expect(
      getTransactionStatusSchema.safeParse({ transactionId: "tx_1", externalIdClient: "o1" })
        .success,
    ).toBe(false);
  });
});

describe("createSpeiCashinSchema", () => {
  const validSpei = {
    nome: "Pagador Mexicano",
    documento: "GODE561231GR8",
    email: "pagador@example.mx",
    valor: 100,
  };

  it("aceita cash-in válido e normaliza documento para maiúsculas", () => {
    const result = createSpeiCashinSchema.safeParse({ ...validSpei, documento: "gode561231gr8" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documento).toBe("GODE561231GR8");
    }
  });

  it("rejeita valor abaixo de MX$5 e documento com símbolo", () => {
    expect(createSpeiCashinSchema.safeParse({ ...validSpei, valor: 4.99 }).success).toBe(false);
    expect(
      createSpeiCashinSchema.safeParse({ ...validSpei, documento: "GODE-561231!" }).success,
    ).toBe(false);
  });
});

describe("createPayPalOrderSchema", () => {
  const validOrder = {
    nome: "Comprador Teste",
    email: "comprador@example.com",
    valor: 100.5,
  };

  it("aceita ordem válida em BRL (default) com decimais", () => {
    expect(createPayPalOrderSchema.safeParse(validOrder).success).toBe(true);
  });

  it("rejeita decimais em moeda zero-decimal (JPY) e aceita inteiro", () => {
    expect(
      createPayPalOrderSchema.safeParse({ ...validOrder, currency: "JPY", valor: 100.5 }).success,
    ).toBe(false);
    expect(
      createPayPalOrderSchema.safeParse({ ...validOrder, currency: "JPY", valor: 100 }).success,
    ).toBe(true);
  });

  it("rejeita moeda fora do enum e descricao acima de 127", () => {
    expect(createPayPalOrderSchema.safeParse({ ...validOrder, currency: "XyZ" }).success).toBe(
      false,
    );
    expect(
      createPayPalOrderSchema.safeParse({ ...validOrder, descricao: "x".repeat(128) }).success,
    ).toBe(false);
  });
});

describe("createPixWithdrawSchema", () => {
  const validWithdraw = {
    chave_pix: "123.456.789-01",
    pix_key_type: "CPF" as const,
    valor: 100,
    confirm: true as const,
  };

  it("aceita saque válido dentro dos limites", () => {
    expect(createPixWithdrawSchema.safeParse(validWithdraw).success).toBe(true);
    expect(
      createPixWithdrawSchema.safeParse({ ...validWithdraw, valor: WITHDRAW_MIN_BRL }).success,
    ).toBe(true);
    expect(
      createPixWithdrawSchema.safeParse({ ...validWithdraw, valor: WITHDRAW_MAX_BRL }).success,
    ).toBe(true);
  });

  it("aplica limites: mínimo R$50 e máximo R$20.000", () => {
    expect(createPixWithdrawSchema.safeParse({ ...validWithdraw, valor: 49.99 }).success).toBe(
      false,
    );
    expect(createPixWithdrawSchema.safeParse({ ...validWithdraw, valor: 20_000.01 }).success).toBe(
      false,
    );
  });

  it("exige confirm === true literal", () => {
    expect(createPixWithdrawSchema.safeParse({ ...validWithdraw, confirm: false }).success).toBe(
      false,
    );
    const semConfirm: Record<string, unknown> = { ...validWithdraw };
    delete semConfirm.confirm;
    expect(createPixWithdrawSchema.safeParse(semConfirm).success).toBe(false);
  });

  it("valida a chave contra o tipo declarado", () => {
    expect(
      createPixWithdrawSchema.safeParse({ ...validWithdraw, chave_pix: "12345" }).success,
    ).toBe(false);
    expect(
      createPixWithdrawSchema.safeParse({
        ...validWithdraw,
        pix_key_type: "EMAIL",
        chave_pix: "nao-e-email",
      }).success,
    ).toBe(false);
    expect(
      createPixWithdrawSchema.safeParse({
        ...validWithdraw,
        pix_key_type: "EMAIL",
        chave_pix: "saque@example.com",
      }).success,
    ).toBe(true);
    expect(
      createPixWithdrawSchema.safeParse({
        ...validWithdraw,
        pix_key_type: "EVP",
        chave_pix: "9f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8",
      }).success,
    ).toBe(true);
    expect(
      createPixWithdrawSchema.safeParse({
        ...validWithdraw,
        pix_key_type: "EVP",
        chave_pix: "nao-e-uuid",
      }).success,
    ).toBe(false);
  });

  it("rejeita campo desconhecido (.strict)", () => {
    expect(createPixWithdrawSchema.safeParse({ ...validWithdraw, force: true }).success).toBe(
      false,
    );
  });
});
