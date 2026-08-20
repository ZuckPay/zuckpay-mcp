# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [0.3.1] - 2026-08-20

Passada de segurança. Nada aqui muda a forma de chamar as tools de leitura.

### Segurança

- **Rate limit era burlável por header.** `clientIp()` lia o PRIMEIRO valor de
  `X-Forwarded-For`, que é escrito pelo cliente. Com `MCP_TRUST_PROXY=true`
  (o caso do Railway), bastava mandar um XFF diferente por request pra abrir
  janela nova toda vez e, de quebra, inflar o mapa de contadores até derrubar
  o processo por memória. Agora o IP vem do fim da cadeia pra dentro, com
  `MCP_TRUST_PROXY_HOPS` (padrão 1) dizendo quantos proxies são confiáveis, e
  todo hop passa por `net.isIP()` antes de virar chave.
- **Teto de memória no rate limiter.** O mapa de janelas agora tem limite de
  chaves (20.000); cheio, faz sweep e só então recusa. Negar request é
  degradação temporária; OOM derruba todos os tenants.
- **Rate limit por credencial**, além do por IP (4x o limite de IP), para um
  tenant vindo de muitos IPs não consumir o serviço compartilhado sozinho.
  A chave é hash SHA-256 truncado do `client_id` — nunca o valor cru.
- **ReDoS na varredura de PII.** O regex de e-mail em `assertNoRawPii` tinha
  backtracking quadrático (24 KB de texto = ~400ms; 100 KB travava por
  segundos). Como ele varre toda string de todo payload e o modo HTTP é
  single-thread compartilhado, uma descrição longa de um tenant congelava o
  serviço pra todos. A detecção agora é linear, ancorada no `@` e limitada
  às janelas do RFC 5321, com a mesma semântica de antes.
- **DDoS por batch JSON-RPC (o mais grave desta rodada).** O rate limit conta
  requests HTTP, mas o transporte da SDK processava arrays JSON-RPC no topo do
  body. Medido em ataque contra esta versão antes do fix: um POST de 249 KB com
  5.000 entradas devolveu **101 MB em 3,7s valendo 1 hit no limiter** —
  amplificação de 406x, com credencial FALSA, porque o portão de auth valida
  formato e não a credencial. A 60 req/min isso é ~6 GB/min de egress e mais
  CPU do que o processo tem, partindo de um IP só; com credencial válida
  seriam 5.000 chamadas à API ZuckPay num único POST. Batch agora é recusado
  com -32600 (o MCP removeu batching na revisão 2025-06-18, então recusar é o
  comportamento correto). Resposta máxima por request caiu de 101 MB para
  ~20 KB.
- **Rate limit passou a valer em todas as rotas.** `limiter.check()` rodava
  depois dos returns de `/healthz`, 404 e 405 — essas rotas aceitavam flood
  sem teto nenhum.
- **Teto de conexões simultâneas** (`MCP_MAX_CONNECTIONS`, padrão 512): o rate
  limit conta requests, então sockets abertos que nunca completam um request
  não passavam por ele.
- **Stack trace com credencial em erro não tratado.** O modo HTTP não tinha
  handler de `uncaughtException`/`unhandledRejection`, e o padrão do Node
  imprime a stack inteira em stderr. Somado a isso, o catch externo logava
  `err.message` sem redação (o redactor é por tenant e não está em escopo
  ali). Nos três pontos agora sai só o NOME do erro; o diagnóstico completo e
  redigido continua saindo de dentro de `handleMcpPost`.
- Dependências: piso de `@modelcontextprotocol/sdk` subiu de `^1.12.0` para
  `^1.29.0` e `tsup` de `^8.2.0` para `^8.5.1`. O piso antigo permitia
  resolver versões com advisory conhecido, e era o que scanners de registry
  reportavam. `npm audit` agora zera em prod e em dev.

### Removido

- **Tool `createPixWithdraw`.** `/v3/pix/withdraw` passou a exigir PIN do
  vendedor e o MCP nunca enviou esse campo — a tool respondia 400 em 100% das
  chamadas. A correção NÃO é aceitar o PIN por parâmetro: isso colocaria o
  segundo fator do vendedor na conversa do assistente e no histórico do
  cliente MCP. `ZUCKPAY_ENABLE_WITHDRAW` continua aceita, mas só emite aviso.
  Saques seguem pelo painel. O módulo continua versionado e testado para o dia
  em que o gateway tiver um token de saque pré-autorizado, com escopo e prazo.

### Corrigido

- **Cobranças duplicadas em retry.** `createPixCharge` e `createSpeiCashin`
  agora instruem o modelo a sempre mandar `external_id_client` e a reusar o
  mesmo valor ao repetir uma chamada — é a chave de idempotência que a API já
  implementa (`GET_LOCK` + reuso da cobrança pendente). `createSpeiCashin`
  nem sequer expunha o campo, então toda cobrança SPEI era duplicável. O
  resultado agora diz quando a cobrança foi REAPROVEITADA em vez de criada, e
  avisa explicitamente quando foi criada sem chave de idempotência.
- Os 21 tools declaram os quatro hints (`readOnlyHint`, `destructiveHint`,
  `idempotentHint`, `openWorldHint`) explicitamente; 13 declaravam só dois.
- `VERSION` e a `version` do `package.json` agora têm teste de sincronia — a
  divergência já custou 2 dias de `/healthz` reportando versão errada.

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
