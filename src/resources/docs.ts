/**
 * Resource estático zuckpay://docs/api — contrato resumido da API v3
 * embutido no binário (nenhuma chamada de rede para servir docs).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const API_DOCS_MARKDOWN = `# API ZuckPay v3 — referência rápida

Base URL: \`https://www.zuckpay.com.br/conta\` (o \`www\` é obrigatório — sem ele
o CDN responde 301 e converte POST em GET).

Autenticação: HTTP Basic com \`client_id:client_secret\` (painel ZuckPay >
Desenvolvedores > Credenciais API). Erros vêm como JSON \`{statusCode, message}\`:
401 credenciais, 400 parâmetros, 405 método, 500 interno.

## Endpoints

| Endpoint | Método | Função |
|---|---|---|
| \`/v3/pix/qrcode\` | POST | Cria cobrança PIX (copia-e-cola + QR + checkout hospedado) |
| \`/v3/pix/status\` | GET | Status por \`transactionId\` ou \`external_id_client\` (PIX, SPEI e cartão) |
| \`/v3/pix/withdraw\` | POST | Saque PIX (mín. R$ 50,00, máx. R$ 20.000,00 por saque; exige saldo disponível) |
| \`/v3/spei/cashin\` | POST | Cobrança SPEI México em MXN (retorna CLABE 18 dígitos) |
| \`/v3/paypal/order\` | POST | Cria ordem PayPal (retorna \`orderId\` + \`approvalUrl\`) |
| \`/v3/paypal/capture\` | POST | Captura ordem PayPal aprovada |
| \`/v3/card/keys\` | GET | Chaves públicas dos gateways de cartão |
| \`/v3/transactions\` | GET | Lista transações da conta (filtros + paginação por cursor) |
| \`/v3/balance\` | GET | Saldos da conta (disponível, bloqueado D+2, total) e limites de saque |

## Listagem de transações — filtros

Todos opcionais: \`status\` (PAID, PENDING, WAITING_PAYMENT, REFUSED, EXPIRED,
REFUNDED, CHARGEBACK, FAILED), \`type\` (DEPOSIT | WITHDRAW), \`payment_method\`
(pix, spei, credit_card, paypal, crypto, mercadopago), \`external_id_client\`,
\`date_from\`/\`date_to\` (YYYY-MM-DD, horário de Brasília), \`limit\` (1–50,
padrão 20) e \`cursor\` (opaco, vem em \`pagination.next_cursor\`). Ordenação
fixa: mais recente primeiro.

## Cobrança PIX — campos

Obrigatórios: \`nome\`, \`cpf\` (11 dígitos), \`valor\` (reais, float), \`email\`,
\`telefone\`. Opcionais: \`urlnoty\` (webhook), \`descricao\`,
\`external_id_client\` (idempotência — repetir o mesmo ID devolve a mesma
cobrança pendente), \`product_id\`, \`splits\` (2–10 recebedores, soma = 100),
e parâmetros de rastreio (\`utm_*\`, \`fbclid\`, \`fbc\`, \`fbp\`, \`gclid\`,
\`ttclid\`, \`click_id\`...).

Resposta: \`transactionId\`, \`qrcode\` (copia-e-cola), \`qrcode_image\`,
\`checkout_url\`, \`amount_liquid\`.

## Webhook (postback) assinado

Gere o webhook secret em https://www.zuckpay.com.br/conta/keys.php (card
"Webhook Secret" — é diferente do \`client_secret\`). Quando a conta tem
webhook secret gerado, cada postback inclui:

\`\`\`
X-ZuckPay-Timestamp: <unix_ts>
X-ZuckPay-Signature: t=<unix_ts>,v1=<hex>
\`\`\`

onde \`v1 = HMAC-SHA256("<unix_ts>.<body_json_cru>", secret)\`.
Valide SEMPRE sobre o body cru (antes de qualquer parse) e rejeite
timestamps fora de uma janela de tolerância (ex.: 5 minutos).

Exemplo em Node.js:

\`\`\`js
import crypto from "node:crypto";

function verifyZuckPaySignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const parts = {};
  for (const piece of String(signatureHeader).split(",")) {
    const idx = piece.indexOf("=");
    if (idx > 0) parts[piece.slice(0, idx).trim()] = piece.slice(idx + 1).trim();
  }
  const ts = Number(parts.t);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest("hex");
  const provided = String(parts.v1 ?? "");
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
}
\`\`\`

Exemplo em PHP:

\`\`\`php
function verifyZuckPaySignature(string $rawBody, string $header, string $secret, int $tolerance = 300): bool {
    $parts = [];
    foreach (explode(',', $header) as $piece) {
        [$k, $v] = array_pad(explode('=', $piece, 2), 2, '');
        $parts[trim($k)] = trim($v);
    }
    $ts = (int) ($parts['t'] ?? 0);
    if ($ts <= 0 || abs(time() - $ts) > $tolerance) return false;
    $expected = hash_hmac('sha256', $ts . '.' . $rawBody, $secret);
    return hash_equals($expected, $parts['v1'] ?? '');
}
\`\`\`

## Boas práticas

- Use \`external_id_client\` em toda cobrança criada por automação — é a sua
  garantia de idempotência contra duplicidade.
- Nunca confie só no retorno do checkout: o estado autoritativo vem do
  webhook assinado ou de \`GET /v3/pix/status\`.
- Dados de cartão (PAN/CVV) nunca devem trafegar por contexto de IA — use o
  checkout hospedado.
`;

export function registerDocsResource(server: McpServer): void {
  server.registerResource(
    "api-docs",
    "zuckpay://docs/api",
    {
      title: "Documentação da API ZuckPay v3",
      description:
        "Referência rápida da API v3: endpoints, campos, idempotência e validação do webhook assinado (HMAC).",
      mimeType: "text/markdown",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "text/markdown",
          text: API_DOCS_MARKDOWN,
        },
      ],
    }),
  );
}
