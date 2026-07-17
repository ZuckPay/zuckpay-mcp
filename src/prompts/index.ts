/**
 * Prompts guiados. Argumentos de prompt MCP são sempre strings —
 * a validação forte acontece na tool, não aqui.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "criar-cobranca-pix",
    {
      title: "Criar cobrança PIX guiada",
      description:
        "Guia a criação de uma cobrança PIX: coleta os dados do pagador que faltarem e chama a tool createPixCharge.",
      argsSchema: {
        valor: z.string().describe("Valor da cobrança em reais (ex: 49.90)").optional(),
        nome: z.string().describe("Nome completo do pagador").optional(),
      },
    },
    ({ valor, nome }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text:
              "Quero criar uma cobrança PIX na ZuckPay usando a tool createPixCharge.\n\n" +
              `Dados que já tenho: valor = ${valor ?? "(não informado)"}; nome do pagador = ${nome ?? "(não informado)"}.\n\n` +
              "Antes de chamar a tool: (1) me pergunte os dados obrigatórios que faltarem " +
              "(nome, CPF, e-mail, telefone com DDD e valor); (2) sugira usar external_id_client " +
              "se eu tiver um ID de pedido no meu sistema, para garantir idempotência; " +
              "(3) depois de criada, me entregue o copia-e-cola e o link do checkout hospedado.",
          },
        },
      ],
    }),
  );
}
