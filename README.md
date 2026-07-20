<div align="center">
  <a href="https://www.zuckpay.com.br">
    <img src="https://www.zuckpay.com.br/images/zucklogotop.png" alt="Logo da ZuckPay" width="120">
  </a>

  <h1>zuckpay-mcp</h1>

  <p><strong>Servidor MCP oficial da ZuckPay</strong> — pagamentos PIX, SPEI e PayPal direto do seu assistente de IA</p>

  <p>
    <a href="https://www.npmjs.com/package/zuckpay-mcp"><img src="https://img.shields.io/npm/v/zuckpay-mcp?color=cb3837&label=npm" alt="Versão no npm"></a>
    <a href="https://github.com/ZuckPay/zuckpay-mcp/actions/workflows/ci.yml"><img src="https://github.com/ZuckPay/zuckpay-mcp/actions/workflows/ci.yml/badge.svg" alt="Status do CI"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/licen%C3%A7a-MIT-green" alt="Licença MIT"></a>
    <img src="https://img.shields.io/badge/node-%E2%89%A518.17-brightgreen" alt="Node 18.17 ou superior">
  </p>

  <p>
    <a href="https://www.zuckpay.com.br">Site</a> ·
    <a href="https://www.zuckpay.com.br/conta/dev/">Documentação da API</a> ·
    <a href="#modo-http-hospedado-multi-tenant">MCP hospedado</a>
  </p>
</div>

---

Servidor [MCP](https://modelcontextprotocol.io) oficial da **ZuckPay** — crie cobranças PIX, SPEI (México) e PayPal, acompanhe vendas no cartão (Stripe e cartão nacional), consulte transações e saldo, e gerencie sua conta (produtos, cursos, assinaturas, infrações, indique&ganhe e mais) direto do seu assistente de IA (Claude Code, Claude Desktop, Cursor e qualquer cliente MCP).

- **Node puro** — funciona com `npx`/`node`, sem Bun nem build extra.
- **Seguro por padrão** — credenciais só via variáveis de ambiente, máscara de segredos em toda saída, saque desabilitado por padrão, dados de cartão jamais trafegam pela IA.
- **2 dependências de runtime** — `@modelcontextprotocol/sdk` e `zod`.

## Tools

### Pagamentos

| Tool                   | O que faz                                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `createPixCharge`      | Cria cobrança PIX (copia-e-cola + QR Code + checkout hospedado). Suporta idempotência, split, webhook e UTMs    |
| `getTransactionStatus` | Consulta status por `transactionId` ou pelo seu `external_id_client` (PIX, SPEI e cartão)                       |
| `createSpeiCashin`     | Cria cobrança SPEI em MXN e retorna a CLABE de 18 dígitos (México)                                              |
| `createPayPalOrder`    | Cria ordem PayPal em 25 moedas e retorna o link de aprovação                                                    |
| `capturePayPalOrder`   | Captura a ordem depois que o pagador aprova                                                                     |
| `getCardGateways`      | Mostra os gateways de cartão da conta — Stripe (internacional) e cartão nacional (BRL) — com as chaves públicas |
| `listTransactions`     | Lista as transações da conta com filtros (status, tipo, método, período) e paginação por cursor                 |
| `getBalance`           | Saldos da conta (disponível, bloqueado em liberação, total) e limites de saque                                  |
| `createPixWithdraw`    | ⚠️ Saque PIX — **só existe com `ZUCKPAY_ENABLE_WITHDRAW=true`** (veja [Segurança](#segurança))                  |

### Sua conta (somente leitura)

Tudo escopado à conta autenticada — uma chave de seller nunca enxerga dado de outro seller, e dados de comprador (nome, e-mail, CPF, telefone) chegam **sempre mascarados** (`jo***@gmail.com`, `123.***.***-**`).

| Tool                  | O que faz                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| `getSalesToday`       | Resumo das vendas de hoje: total pago, quantidade, ticket médio, breakdown por método e pendentes |
| `listProducts`        | Lista seus produtos (nome, preço, status, moeda, métodos de pagamento habilitados)                |
| `getProduct`          | Detalha um produto pelo `id`                                                                      |
| `listCourses`         | Lista seus cursos (área de membros): módulos, aulas e nº de alunos matriculados                   |
| `listSubscriptions`   | Assinaturas da conta: produto, status (ativa/cancelada/inativa/pendente), valor, periodicidade    |
| `listInfractions`     | Chargebacks e pedidos de reembolso (Infrações e MED), com status e prazos                         |
| `getReferralStats`    | Seu Indique & Ganhe: total de indicados, comissões pendentes/liberadas e histórico                |
| `getStore`            | Sua loja (vitrine): nome, slug, template, status de publicação e domínio                          |
| `listAcquirerRoutes`  | Rotas de adquirente disponíveis pra sua conta, com taxa de conversão — as mesmas do painel        |
| `listPaymentLinks`    | Seus links de pagamento (valor, método, views, status)                                            |
| `listIntegrationKeys` | Metadados das suas chaves de API (nome, domínio, criação) — **nunca** o client_secret             |
| `listWebhooks`        | Webhooks configurados na conta (URL, eventos, produtos, status)                                   |

Criar/editar/apagar qualquer coisa por aqui **não existe ainda** — escrita é a próxima fase, sempre atrás de confirmação explícita. Ações sensíveis (revelar/rotacionar chave, excluir produto, publicar loja) ficam **só no painel**, por design.

Extras: resource `zuckpay://docs/api` (referência da API + validação do webhook assinado) e prompt `criar-cobranca-pix`.

## Instalação

Gere suas credenciais no painel ZuckPay em **Desenvolvedores → Credenciais API**.

### Claude Code

```bash
claude mcp add zuckpay \
  -e ZUCKPAY_CLIENT_ID=seu_client_id \
  -e ZUCKPAY_CLIENT_SECRET=seu_client_secret \
  -- npx -y zuckpay-mcp
```

### Claude Desktop / Cursor

`claude_desktop_config.json` (ou `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "zuckpay": {
      "command": "npx",
      "args": ["-y", "zuckpay-mcp"],
      "env": {
        "ZUCKPAY_CLIENT_ID": "seu_client_id",
        "ZUCKPAY_CLIENT_SECRET": "seu_client_secret"
      }
    }
  }
}
```

### Variáveis de ambiente

| Variável                  | Obrigatória | Descrição                                                                               |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `ZUCKPAY_CLIENT_ID`       | ✅          | Client ID da integração                                                                 |
| `ZUCKPAY_CLIENT_SECRET`   | ✅          | Client Secret da integração                                                             |
| `ZUCKPAY_ENABLE_WITHDRAW` | —           | `true` habilita a tool de saque (padrão: desabilitada)                                  |
| `ZUCKPAY_BASE_URL`        | —           | Override da base da API (somente `https://`; padrão `https://www.zuckpay.com.br/conta`) |

## Exemplos de uso

> "Cria uma cobrança PIX de R$ 97,00 pro cliente João Silva, CPF 123.456.789-01, joao@email.com, (11) 99999-8888, com ID externo PEDIDO-4512"

> "Qual o status da transação do pedido PEDIDO-4512?"

> "Cria uma ordem PayPal de US$ 50 pro comprador Mike Ross, mike@email.com"

> "Lista minhas vendas de cartão pagas neste mês e diz quanto ainda está em liberação"

> "Quanto eu vendi hoje? Divide por método de pagamento"

> "Tenho algum chargeback ou pedido de reembolso aberto?"

> "Como tá meu Indique & Ganhe? Quanto tenho de comissão pra liberar?"

> "Lista minhas assinaturas ativas e me diz qual produto tem mais assinantes"

## Cartão: como o MCP se encaixa

O MCP **acompanha** as vendas de cartão, mas **não cria** cobrança de cartão — e isso é proposital (veja [Segurança](#segurança)):

| O que você quer fazer                        | Como fazer                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Cobrar no cartão                             | Checkout hospedado ou link de pagamento da ZuckPay — o dado do cartão nunca passa pela IA                          |
| Ver os gateways de cartão da conta           | `getCardGateways` — Stripe (internacional) e cartão nacional (BRL), com as chaves públicas de tokenização          |
| Conferir se uma venda de cartão foi paga     | `getTransactionStatus` com o `transactionId` ou o seu `external_id_client`                                         |
| Listar as vendas de cartão de um período     | `listTransactions` com `payment_method: credit_card`                                                               |
| Ver quanto de cartão ainda está em liberação | `getBalance` — o saldo bloqueado inclui vendas de cartão aguardando o prazo da conta (ex.: D+8); PIX libera em D+0 |

**Por que o MCP não cobra cartão?** PCI DSS: número e CVV jamais devem trafegar pelo contexto de um LLM. A tokenização acontece no navegador do pagador, dentro do checkout hospedado — e o MCP entra depois, para consultar status, listar vendas e conferir o saldo.

## Segurança

- **Credenciais**: aceitas SOMENTE via variáveis de ambiente — nunca por argumento de linha de comando (vazaria na lista de processos) nem por parâmetro de tool. A autenticação vai apenas no header `Authorization: Basic`, jamais no corpo JSON.
- **Máscara de segredos**: toda string que sai do processo (resultado de tool, erro, log em stderr) passa por um redactor que mascara o client_id, o client_secret e a forma base64 de ambos.
- **Saque é opt-in duplo**: a tool `createPixWithdraw` nem sequer é registrada sem `ZUCKPAY_ENABLE_WITHDRAW=true`; com ela, o schema ainda exige `confirm: true` e instrui o modelo a confirmar valor, chave e tipo com o usuário humano antes de chamar. Limites: R$ 50,00 a R$ 20.000,00 por saque, e o gateway valida o saldo disponível do vendedor antes de executar.
- **Cartão**: a cobrança direta de cartão **não existe** neste MCP por design — PAN/CVV nunca devem passar pelo contexto de um LLM (PCI DSS). Só as chaves públicas são expostas; a cobrança acontece no checkout hospedado.
- **Sem retry em dinheiro**: requisições POST nunca são repetidas automaticamente; somente `GET /pix/status` retenta uma única vez, e apenas em falha de rede.
- **PII do comprador em barreira dupla**: o servidor já devolve nome/e-mail/CPF/telefone mascarados; ainda assim, as tools de conta varrem cada resposta atrás de PII crua (`assertNoRawPii`) e **falham em vez de vazar** se o backend algum dia regredir. Campos como `refund_token` são bloqueados por nome.
- **Validação estrita**: toda entrada passa por schemas zod `.strict()` (campos desconhecidos são rejeitados) antes de qualquer chamada; o corpo enviado à API é montado campo a campo (allowlist).
- Encontrou uma vulnerabilidade? Veja [SECURITY.md](SECURITY.md).

## Webhook assinado (recomendado)

Ao informar `urlnoty`, seu endpoint recebe o postback de confirmação. Contas com webhook secret recebem os headers:

```
X-ZuckPay-Timestamp: <unix_ts>
X-ZuckPay-Signature: t=<unix_ts>,v1=<hex>
```

onde `v1 = HMAC-SHA256("<unix_ts>.<body_cru>", secret)`. Valide sempre sobre o body **cru** e rejeite timestamps velhos (ex.: > 5 min). Exemplo completo em Node.js e PHP no resource `zuckpay://docs/api`.

## Modo HTTP hospedado (multi-tenant)

Além do stdio, o servidor tem um modo **Streamable HTTP stateless** pensado para
hospedagem (ex.: `mcp.zuckpay.com.br`): cada seller conecta o próprio cliente MCP
na URL e autentica **com a própria credencial**, sem instalar nada.

```bash
npm run build && npm run start:http   # POST /mcp + GET /healthz na porta $PORT (padrão 8080)
```

- Autenticação por request: `Authorization: Basic base64(client_id:client_secret)`.
  Nada de credencial em URL/query, e nenhuma credencial é logada.
- Stateless de verdade: nenhum estado entre requests → escala horizontal sem sticky session.
- Endurecimento embutido: rate limit por IP (429 + `Retry-After`), body máx. 256 KB,
  timeouts anti-slowloris, `X-Content-Type-Options: nosniff`, sem CORS.
- A tool de saque **não** é exposta no modo hospedado, a menos que o operador do
  serviço suba com `ZUCKPAY_ENABLE_WITHDRAW=true` (não recomendado em multi-tenant).

Cliente (ex.: Claude Code):

```bash
claude mcp add --transport http zuckpay https://mcp.zuckpay.com.br/mcp \
  --header "Authorization: Basic $(printf 'seu_client_id:seu_client_secret' | base64)"
```

Variáveis do serviço HTTP: `PORT` (padrão 8080), `MCP_TRUST_PROXY=true` (atrás de
proxy/Railway), `MCP_RATE_LIMIT_PER_MINUTE` (padrão 60).

Deploy com Docker: `docker build -t zuckpay-mcp . && docker run -p 8080:8080 zuckpay-mcp`
— imagem alpine com usuário non-root e `HEALTHCHECK`. Para Railway, o `railway.toml`
já aponta o Dockerfile e o healthcheck.

## Desenvolvimento

```bash
npm ci
npm run lint && npm run typecheck && npm test
npm run build          # gera dist/index.js (stdio) e dist/http.js (HTTP)
npm run inspector      # debug com o MCP Inspector
```

## Licença

[MIT](LICENSE)
