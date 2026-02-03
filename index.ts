import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import {
  createCrossmintSetupTool,
  createCrossmintConfigureTool,
  createCrossmintBalanceTool,
  createCrossmintSendTool,
  createCrossmintWalletInfoTool,
  createCrossmintTxStatusTool,
  createCrossmintBuyTool,
  createCrossmintOrderStatusTool,
} from "./src/tools.js";
import { crossmintConfigSchema } from "./src/config.js";

const plugin = {
  id: "crossmint",
  name: "Crossmint Wallet",
  description:
    "Solana wallet integration with Crossmint. Manage wallets, check balances, and send tokens using delegated signing.",

  configSchema: crossmintConfigSchema,

  register(api: OpenClawPluginApi) {
    // Parse and validate config at registration time
    const config = crossmintConfigSchema.parse(api.pluginConfig);

    // Register wallet setup tool (generates keypair, shows delegation URL)
    api.registerTool(createCrossmintSetupTool(api, config), {
      name: "crossmint_setup",
    });

    // Register configure tool (saves wallet address and API key from web)
    api.registerTool(createCrossmintConfigureTool(api, config), {
      name: "crossmint_configure",
    });

    // Register balance tool
    api.registerTool(createCrossmintBalanceTool(api, config), {
      name: "crossmint_balance",
    });

    // Register send tool
    api.registerTool(createCrossmintSendTool(api, config), {
      name: "crossmint_send",
    });

    // Register wallet info tool
    api.registerTool(createCrossmintWalletInfoTool(api, config), {
      name: "crossmint_wallet_info",
    });

    // Register transaction status tool
    api.registerTool(createCrossmintTxStatusTool(api, config), {
      name: "crossmint_tx_status",
    });

    // Register Amazon buy tool
    api.registerTool(createCrossmintBuyTool(api, config), {
      name: "crossmint_buy",
    });

    // Register order status tool
    api.registerTool(createCrossmintOrderStatusTool(api, config), {
      name: "crossmint_order_status",
    });

    api.logger.info("Crossmint wallet plugin loaded", {
      environment: config.environment,
    });
  },
};

export default plugin;
