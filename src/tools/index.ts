/**
 * Registro central das tools. A tool de saque só existe quando o operador
 * habilita explicitamente via ZUCKPAY_ENABLE_WITHDRAW=true.
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
import { registerWithdrawTool } from "./withdraw.js";

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
    registerWithdrawTool(server, client);
    console.error(
      "[zuckpay-mcp] AVISO: tool de saque PIX habilitada via ZUCKPAY_ENABLE_WITHDRAW=true.",
    );
  }
}
