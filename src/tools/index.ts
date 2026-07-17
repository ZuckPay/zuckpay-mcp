/**
 * Registro central das tools. A tool de saque só existe quando o operador
 * habilita explicitamente via ZUCKPAY_ENABLE_WITHDRAW=true.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZuckPayClient } from "../client.js";
import type { Config } from "../config.js";
import { registerBalanceTool } from "./balance.js";
import { registerCardTools } from "./card.js";
import { registerPayPalTools } from "./paypal.js";
import { registerPixTools } from "./pix.js";
import { registerSpeiTools } from "./spei.js";
import { registerTransactionTools } from "./transactions.js";
import { registerWithdrawTool } from "./withdraw.js";

export function registerAllTools(server: McpServer, client: ZuckPayClient, config: Config): void {
  registerPixTools(server, client);
  registerSpeiTools(server, client);
  registerPayPalTools(server, client);
  registerCardTools(server, client);
  registerTransactionTools(server, client);
  registerBalanceTool(server, client);
  if (config.enableWithdraw) {
    registerWithdrawTool(server, client);
    console.error(
      "[zuckpay-mcp] AVISO: tool de saque PIX habilitada via ZUCKPAY_ENABLE_WITHDRAW=true.",
    );
  }
}
