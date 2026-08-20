/**
 * Registro central das tools.
 *
 * A tool de saque NÃO é mais registrada, nem com ZUCKPAY_ENABLE_WITHDRAW=true.
 * Motivo: /v3/pix/withdraw passou a exigir PIN obrigatório do vendedor
 * (withdraw.php: `if (empty($pin)) jsonResponse(400, "PIN obrigatório para
 * saques.")`), e o MCP nunca enviou esse campo — toda chamada morria em 400.
 *
 * A correção NÃO é adicionar um parâmetro `pin` ao schema: isso faria o PIN de
 * saque do vendedor trafegar como texto pela conversa do assistente, ficar no
 * histórico do cliente MCP e possivelmente no log do provedor do modelo. O PIN
 * existe justamente para ser o fator que uma automação não tem.
 *
 * Habilitar saque por aqui de novo exige um mecanismo próprio no gateway
 * (ex.: token de saque pré-autorizado no painel, com escopo e validade), não
 * o PIN do humano. Até lá, saque é feito no painel. Ver src/tools/withdraw.ts,
 * que segue versionado e testado para esse dia.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import type { Config } from "../config.js";
import { registerAcquirerTools } from "./acquirers.js";
import { registerBalanceTool } from "./balance.js";
import { registerCardTools } from "./card.js";
import { registerCourseTools } from "./courses.js";
import { registerInfractionTools } from "./infractions.js";
import { registerIntegrationTools } from "./integrations.js";
import { registerPaymentLinkTools } from "./payment-links.js";
import { registerPayPalTools } from "./paypal.js";
import { registerPixTools } from "./pix.js";
import { registerProductTools } from "./products.js";
import { registerReferralTools } from "./referrals.js";
import { registerSalesTools } from "./sales.js";
import { registerSpeiTools } from "./spei.js";
import { registerStoreTools } from "./store.js";
import { registerSubscriptionTools } from "./subscriptions.js";
import { registerTransactionTools } from "./transactions.js";

export function registerAllTools(server: McpServer, client: ZuckPayClient, config: Config): void {
  registerPixTools(server, client);
  registerSpeiTools(server, client);
  registerPayPalTools(server, client);
  registerCardTools(server, client);
  registerTransactionTools(server, client);
  registerBalanceTool(server, client);
  registerProductTools(server, client);
  registerCourseTools(server, client);
  registerSalesTools(server, client);
  registerInfractionTools(server, client);
  registerSubscriptionTools(server, client);
  registerReferralTools(server, client);
  registerStoreTools(server, client);
  registerAcquirerTools(server, client);
  registerIntegrationTools(server, client);
  registerPaymentLinkTools(server, client);
  if (config.enableWithdraw) {
    console.error(
      "[zuckpay-mcp] AVISO: ZUCKPAY_ENABLE_WITHDRAW=true não tem mais efeito. " +
        "A tool de saque foi desativada porque /v3/pix/withdraw exige PIN do vendedor, " +
        "e o PIN não deve passar pela conversa do assistente. Faça saques pelo painel ZuckPay.",
    );
  }
}
