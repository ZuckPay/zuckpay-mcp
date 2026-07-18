# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [0.2.1] - 2026-07-17

### Corrigido

- `VERSION` em `src/config.ts` estava hardcoded em `"0.2.0"` (não lida do
  `package.json` porque o Dockerfile só copia `dist/` pro estágio final) —
  o bump desta mesma versão esqueceu de atualizar essa constante, então
  `/healthz` reportou "0.2.0" por 2 dias com o código já certo rodando.
- `getCardGateways`: o resumo textual agora interpreta o formato real de
  `GET /v3/card/keys` (objeto com `stripe` e `nationalCard`) — antes dizia
  "nenhum gateway configurado" mesmo com Stripe e cartão nacional ativos.
  O formato legado em array segue suportado como fallback.
- `getBalance`: o saldo bloqueado deixa de ser rotulado "liberação D+2" —
  o prazo real varia por método (PIX D+0; cartão conforme a conta, ex. D+8).

### Alterado

- README: nova seção "Cartão: como o MCP se encaixa" explicando o fluxo de
  recebimento no cartão (Stripe internacional + cartão nacional BRL) e por
  que a cobrança direta de cartão fica fora do MCP (PCI DSS).

## [0.2.0] - 2026-07-17

### Adicionado

- Tools somente-leitura `listTransactions` (filtros por status/tipo/método/período
  + paginação por cursor) e `getBalance` (saldos e limites de saque) — exigem os
  endpoints `GET /v3/transactions` e `GET /v3/balance` da API.
- Modo HTTP multi-tenant (`dist/http.js`): Streamable HTTP stateless em `node:http`
  puro; cada request autentica com a própria credencial via `Authorization: Basic`.
  Rate limit por IP, body máximo de 256 KB, timeouts anti-slowloris, `/healthz`.
- `Dockerfile` (node:22-alpine, usuário non-root, HEALTHCHECK) e `railway.toml`.

## [0.1.0] - 2026-07-17

### Adicionado

- Servidor MCP stdio com 6 tools padrão: `createPixCharge`, `getTransactionStatus`,
  `createSpeiCashin`, `createPayPalOrder`, `capturePayPalOrder`, `getCardGateways`.
- Tool opcional `createPixWithdraw` atrás de `ZUCKPAY_ENABLE_WITHDRAW=true`
  (limites R$ 50,00–R$ 20.000,00, confirmação explícita obrigatória).
- Resource `zuckpay://docs/api` com referência da API v3 e validação do
  webhook assinado (HMAC-SHA256) em Node.js e PHP.
- Prompt guiado `criar-cobranca-pix`.
- Núcleo seguro: máscara de segredos em toda saída, validação zod estrita,
  timeout de 30s, sem retry em POST, `redirect: "error"`.
