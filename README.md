# zuckpay-mcp

Servidor [MCP](https://modelcontextprotocol.io) oficial da **ZuckPay** — crie cobranças PIX, SPEI (México) e PayPal, e consulte transações direto do seu assistente de IA (Claude Code, Claude Desktop, Cursor e qualquer cliente MCP).

- **Node puro** — funciona com `npx`/`node`, sem Bun nem build extra.
- **Seguro por padrão** — credenciais só via variáveis de ambiente, máscara de segredos em toda saída, saque desabilitado por padrão, dados de cartão jamais trafegam pela IA.
- **2 dependências de runtime** — `@modelcontextprotocol/sdk` e `zod`.

## Tools

| Tool                   | O que faz                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `createPixCharge`      | Cria cobrança PIX (copia-e-cola + QR Code + checkout hospedado). Suporta idempotência, split, webhook e UTMs |
| `getTransactionStatus` | Consulta status por `transactionId` ou pelo seu `external_id_client` (PIX, SPEI e cartão)                    |
| `createSpeiCashin`     | Cria cobrança SPEI em MXN e retorna a CLABE de 18 dígitos (México)                                           |
| `createPayPalOrder`    | Cria ordem PayPal em 25 moedas e retorna o link de aprovação                                                 |
| `capturePayPalOrder`   | Captura a ordem depois que o pagador aprova                                                                  |
| `getCardGateways`      | Lista as chaves públicas dos gateways de cartão (somente leitura)                                            |
| `listTransactions`     | Lista as transações da conta com filtros (status, tipo, método, período) e paginação por cursor              |
| `getBalance`           | Saldos da conta (disponível, bloqueado D+2, total) e limites de saque                                        |
| `createPixWithdraw`    | ⚠️ Saque PIX — **só existe com `ZUCKPAY_ENABLE_WITHDRAW=true`** (veja [Segurança](#segurança))               |

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

## Segurança

- **Credenciais**: aceitas SOMENTE via variáveis de ambiente — nunca por argumento de linha de comando (vazaria na lista de processos) nem por parâmetro de tool. A autenticação vai apenas no header `Authorization: Basic`, jamais no corpo JSON.
- **Máscara de segredos**: toda string que sai do processo (resultado de tool, erro, log em stderr) passa por um redactor que mascara o client_id, o client_secret e a forma base64 de ambos.
- **Saque é opt-in duplo**: a tool `createPixWithdraw` nem sequer é registrada sem `ZUCKPAY_ENABLE_WITHDRAW=true`; com ela, o schema ainda exige `confirm: true` e instrui o modelo a confirmar valor, chave e tipo com o usuário humano antes de chamar. Limites: R$ 50,00 a R$ 20.000,00 por saque, e o gateway valida o saldo disponível do vendedor antes de executar.
- **Cartão**: a cobrança direta de cartão **não existe** neste MCP por design — PAN/CVV nunca devem passar pelo contexto de um LLM (PCI DSS). Só as chaves públicas são expostas; a cobrança acontece no checkout hospedado.
- **Sem retry em dinheiro**: requisições POST nunca são repetidas automaticamente; somente `GET /pix/status` retenta uma única vez, e apenas em falha de rede.
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
