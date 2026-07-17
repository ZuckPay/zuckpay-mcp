# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

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
