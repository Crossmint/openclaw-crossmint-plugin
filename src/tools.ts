import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import type { OpenClawPluginToolContext } from "../../../src/plugins/types.js";
import {
  getOrCreateWallet,
  getWallet,
  getKeypair,
  configureWallet,
  isWalletConfigured,
} from "./wallet.js";
import {
  getWalletBalance,
  createTransfer,
  getTransactionStatus,
  waitForTransaction,
  buildDelegationUrl,
  purchaseProduct,
  getOrder,
  buildAmazonProductLocator,
  type CrossmintApiConfig,
  type CreateOrderRequest,
} from "./api.js";
import { DELEGATION_URL, ENVIRONMENT, type CrossmintPluginConfig } from "./config.js";

function getAgentId(ctx: OpenClawPluginToolContext): string {
  return ctx.agentId || "main";
}

function getApiConfig(walletData: { apiKey?: string }, environment: "staging"): CrossmintApiConfig {
  if (!walletData.apiKey) {
    throw new Error("Wallet not configured. Run crossmint_setup first and provide the API key.");
  }
  return {
    apiKey: walletData.apiKey,
    environment,
  };
}

export function createCrossmintSetupTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_setup",
    description:
      "Set up the Crossmint Solana wallet for this agent. Generates a local keypair and provides a URL for the user to complete wallet setup. After the user completes setup on the web, use crossmint_configure to save the wallet address and API key.",
    parameters: Type.Object({
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);

      // Get or create the local Solana wallet (generates keypair)
      const walletData = getOrCreateWallet(agentId);

      // Check if already configured
      if (isWalletConfigured(agentId)) {
        return {
          content: [
            {
              type: "text",
              text: `Wallet already configured for agent "${agentId}":\n\nLocal signer: ${walletData.address}\nSmart wallet: ${walletData.smartWalletAddress}\n\nTo reconfigure, delete the wallet first.`,
            },
          ],
          details: {
            status: "already_configured",
            agentId,
            localSignerAddress: walletData.address,
            smartWalletAddress: walletData.smartWalletAddress,
          },
        };
      }

      // Build the delegation URL with the public key
      const delegationUrl = buildDelegationUrl(
        DELEGATION_URL,
        walletData.address,
      );

      return {
        content: [
          {
            type: "text",
            text: `Solana wallet setup for agent "${agentId}":\n\n**Step 1:** Open this URL to set up the wallet:\n${delegationUrl}\n\n**Step 2:** The web app will:\n- Create a Crossmint smart wallet\n- Add this agent as a delegated signer\n- Show you the wallet address and API key\n\n**Step 3:** After completing setup, use crossmint_configure with:\n- The wallet address shown on the web\n- The API key shown on the web\n\nLocal signer address: ${walletData.address}`,
          },
        ],
        details: {
          status: "pending_configuration",
          agentId,
          localSignerAddress: walletData.address,
          delegationUrl,
          nextStep: "crossmint_configure",
        },
      };
    },
  };
}

export function createCrossmintConfigureTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_configure",
    description:
      "Complete wallet setup by providing the wallet address and API key from the Crossmint web app. Run this after completing the setup flow from crossmint_setup.",
    parameters: Type.Object({
      walletAddress: Type.String({
        description: "The smart wallet address shown on the Crossmint web app",
      }),
      apiKey: Type.String({
        description: "The client-side API key shown on the Crossmint web app",
      }),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);
      const walletAddress = params.walletAddress as string;
      const apiKey = params.apiKey as string;

      if (!walletAddress) {
        return {
          content: [{ type: "text", text: "Wallet address is required." }],
        };
      }

      if (!apiKey) {
        return {
          content: [{ type: "text", text: "API key is required." }],
        };
      }

      // Check if keypair exists
      const existing = getWallet(agentId);
      if (!existing) {
        return {
          content: [
            {
              type: "text",
              text: `No keypair found for agent "${agentId}". Run crossmint_setup first to generate a keypair.`,
            },
          ],
        };
      }

      try {
        // Save the wallet configuration
        const walletData = configureWallet(agentId, walletAddress, apiKey);

        return {
          content: [
            {
              type: "text",
              text: `Wallet configured successfully for agent "${agentId}"!\n\nLocal signer: ${walletData.address}\nSmart wallet: ${walletData.smartWalletAddress}\nEnvironment: ${ENVIRONMENT}\n\nYou can now use crossmint_balance and crossmint_send.`,
            },
          ],
          details: {
            status: "configured",
            agentId,
            localSignerAddress: walletData.address,
            smartWalletAddress: walletData.smartWalletAddress,
            environment: ENVIRONMENT,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to configure wallet: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  };
}

export function createCrossmintBalanceTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_balance",
    description: "Check the balance of the Crossmint Solana wallet for this agent.",
    parameters: Type.Object({
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [
            {
              type: "text",
              text: `No wallet found for agent "${agentId}". Run crossmint_setup first.`,
            },
          ],
        };
      }

      if (!isWalletConfigured(agentId)) {
        return {
          content: [
            {
              type: "text",
              text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.`,
            },
          ],
        };
      }

      try {
        const apiConfig = getApiConfig(walletData, ENVIRONMENT);
        const balances = await getWalletBalance(apiConfig, walletData.smartWalletAddress!);

        const balanceText = balances
          .map((b) => `${b.token}: ${b.amount}`)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: `Wallet balance for agent "${agentId}":\n\nSmart Wallet: ${walletData.smartWalletAddress}\nChain: Solana\n\n${balanceText || "No balances found"}`,
            },
          ],
          details: {
            agentId,
            smartWalletAddress: walletData.smartWalletAddress,
            localSignerAddress: walletData.address,
            chain: "solana",
            balances,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get balance: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  };
}

export function createCrossmintSendTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_send",
    description:
      "Send tokens from the agent's Crossmint Solana wallet to another address. Supports SOL, USDC, and other SPL tokens.",
    parameters: Type.Object({
      to: Type.String({ description: "Recipient Solana address or email locator" }),
      amount: Type.String({ description: "Amount to send (e.g., '10', '0.5')" }),
      token: Type.Optional(
        Type.String({
          description: "Token to send: 'sol', 'usdc', or SPL token address. Defaults to 'usdc'.",
        }),
      ),
      wait: Type.Optional(
        Type.Boolean({
          description: "If true, wait for transaction confirmation before returning. Default: false",
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Number({
          description: "Maximum time to wait for confirmation in milliseconds. Default: 60000 (60 seconds)",
        }),
      ),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);
      const to = params.to as string;
      const amount = params.amount as string;
      const token = (params.token as string) || "usdc";
      const wait = params.wait === true;
      const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 60000;

      if (!to) {
        return {
          content: [{ type: "text", text: "Recipient address is required." }],
        };
      }

      if (!amount) {
        return {
          content: [{ type: "text", text: "Amount is required." }],
        };
      }

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [
            {
              type: "text",
              text: `No wallet found for agent "${agentId}". Run crossmint_setup first.`,
            },
          ],
        };
      }

      if (!isWalletConfigured(agentId)) {
        return {
          content: [
            {
              type: "text",
              text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.`,
            },
          ],
        };
      }

      try {
        const apiConfig = getApiConfig(walletData, ENVIRONMENT);

        // Get Solana keypair for signing
        const keypair = getKeypair(agentId);
        if (!keypair) {
          return {
            content: [{ type: "text", text: "Failed to load wallet for signing." }],
          };
        }

        // Create and sign transfer
        let tx = await createTransfer(
          apiConfig,
          walletData.smartWalletAddress!,
          to,
          token,
          amount,
          keypair,
        );

        // If wait is requested, poll until terminal state
        if (wait && tx.id) {
          tx = await waitForTransaction(apiConfig, walletData.smartWalletAddress!, tx.id, timeoutMs);
        }

        const statusEmoji = tx.status === "success" || tx.status === "completed" ? "✅" :
                          tx.status === "failed" || tx.status === "rejected" ? "❌" :
                          tx.status === "pending" ? "⏳" : "🔄";

        const actionWord = (tx.status === "success" || tx.status === "completed") ? "completed" :
                          (tx.status === "failed" || tx.status === "rejected") ? "failed" : "initiated";

        return {
          content: [
            {
              type: "text",
              text: `${statusEmoji} Transfer ${actionWord}!\n\nFrom: ${walletData.smartWalletAddress}\nTo: ${to}\nAmount: ${amount} ${token.toUpperCase()}\n\nTransaction ID: ${tx.id}\nStatus: ${tx.status}${tx.hash ? `\nHash: ${tx.hash}` : ""}${tx.explorerLink ? `\nExplorer: ${tx.explorerLink}` : ""}`,
            },
          ],
          details: {
            agentId,
            from: walletData.smartWalletAddress,
            to,
            amount,
            token,
            transaction: tx,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to send: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  };
}

export function createCrossmintWalletInfoTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_wallet_info",
    description: "Get detailed information about the agent's Crossmint Solana wallet.",
    parameters: Type.Object({
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [
            {
              type: "text",
              text: `No wallet found for agent "${agentId}". Run crossmint_setup first.`,
            },
          ],
        };
      }

      const configured = isWalletConfigured(agentId);

      if (!configured) {
        const delegationUrl = buildDelegationUrl(
          DELEGATION_URL,
          walletData.address,
        );

        return {
          content: [
            {
              type: "text",
              text: `Wallet info for agent "${agentId}" (not fully configured):\n\nLocal signer: ${walletData.address}\nCreated: ${walletData.createdAt}\n\nComplete setup at: ${delegationUrl}\nThen run crossmint_configure with the wallet address and API key.`,
            },
          ],
          details: {
            agentId,
            localSignerAddress: walletData.address,
            createdAt: walletData.createdAt,
            configured: false,
            delegationUrl,
          },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `Wallet info for agent "${agentId}":\n\nLocal signer: ${walletData.address}\nSmart wallet: ${walletData.smartWalletAddress}\nChain: Solana\nEnvironment: ${ENVIRONMENT}\nCreated: ${walletData.createdAt}\nConfigured: ${walletData.configuredAt}`,
          },
        ],
        details: {
          agentId,
          localSignerAddress: walletData.address,
          smartWalletAddress: walletData.smartWalletAddress,
          chain: "solana",
          environment: ENVIRONMENT,
          createdAt: walletData.createdAt,
          configuredAt: walletData.configuredAt,
          configured: true,
        },
      };
    },
  };
}

export function createCrossmintTxStatusTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_tx_status",
    description:
      "Check the status of a Crossmint transaction. Can optionally wait for the transaction to complete.",
    parameters: Type.Object({
      transactionId: Type.String({
        description: "The transaction ID returned from crossmint_send",
      }),
      wait: Type.Optional(
        Type.Boolean({
          description: "If true, wait for the transaction to reach a terminal state (success/failed). Default: false",
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Number({
          description: "Maximum time to wait in milliseconds. Default: 60000 (60 seconds)",
        }),
      ),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);
      const transactionId = params.transactionId as string;
      const wait = params.wait === true;
      const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 60000;

      if (!transactionId) {
        return {
          content: [{ type: "text", text: "Transaction ID is required." }],
        };
      }

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [
            {
              type: "text",
              text: `No wallet found for agent "${agentId}". Run crossmint_setup first.`,
            },
          ],
        };
      }

      if (!isWalletConfigured(agentId)) {
        return {
          content: [
            {
              type: "text",
              text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.`,
            },
          ],
        };
      }

      try {
        const apiConfig = getApiConfig(walletData, ENVIRONMENT);

        const tx = wait
          ? await waitForTransaction(apiConfig, walletData.smartWalletAddress!, transactionId, timeoutMs)
          : await getTransactionStatus(apiConfig, walletData.smartWalletAddress!, transactionId);

        const statusEmoji = tx.status === "success" || tx.status === "completed" ? "✅" :
                          tx.status === "failed" || tx.status === "rejected" ? "❌" :
                          tx.status === "pending" ? "⏳" : "🔄";

        return {
          content: [
            {
              type: "text",
              text: `${statusEmoji} Transaction ${transactionId}\n\nStatus: ${tx.status}${tx.hash ? `\nHash: ${tx.hash}` : ""}${tx.explorerLink ? `\nExplorer: ${tx.explorerLink}` : ""}${tx.onChain ? `\nOn-chain: ${JSON.stringify(tx.onChain)}` : ""}`,
            },
          ],
          details: {
            agentId,
            transaction: tx,
          },
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Failed to get transaction status: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  };
}

export function createCrossmintBuyTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_buy",
    description:
      "Buy a product from Amazon using the agent's Crossmint wallet. Pays with SOL or USDC. Requires shipping address.",
    parameters: Type.Object({
      productId: Type.String({
        description: "Amazon product ASIN (e.g., 'B00O79SKV6') or full Amazon URL",
      }),
      recipientEmail: Type.String({
        description: "Email address for order confirmation and receipt",
      }),
      recipientName: Type.String({
        description: "Full name for shipping",
      }),
      addressLine1: Type.String({
        description: "Street address line 1",
      }),
      addressLine2: Type.Optional(
        Type.String({ description: "Street address line 2 (apt, suite, etc.)" }),
      ),
      city: Type.String({
        description: "City name",
      }),
      state: Type.Optional(
        Type.String({ description: "State/province code (e.g., 'CA', 'NY')" }),
      ),
      postalCode: Type.String({
        description: "Postal/ZIP code",
      }),
      country: Type.String({
        description: "Country code (e.g., 'US')",
      }),
      currency: Type.Optional(
        Type.String({ description: "Payment currency: 'sol' or 'usdc'. Defaults to 'usdc'." }),
      ),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);

      // Validate required params
      const productId = params.productId as string;
      const recipientEmail = params.recipientEmail as string;
      const recipientName = params.recipientName as string;
      const addressLine1 = params.addressLine1 as string;
      const addressLine2 = params.addressLine2 as string | undefined;
      const city = params.city as string;
      const state = params.state as string | undefined;
      const postalCode = params.postalCode as string;
      const country = params.country as string;
      const currency = (params.currency as string)?.toLowerCase() || "usdc";

      if (!productId || !recipientEmail || !recipientName || !addressLine1 || !city || !postalCode || !country) {
        return {
          content: [{ type: "text", text: "Missing required fields. Need: productId, recipientEmail, recipientName, addressLine1, city, postalCode, country" }],
        };
      }

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [
            { type: "text", text: `No wallet found for agent "${agentId}". Run crossmint_setup first.` },
          ],
        };
      }

      if (!isWalletConfigured(agentId)) {
        return {
          content: [
            { type: "text", text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.` },
          ],
        };
      }

      const keypair = getKeypair(agentId);
      if (!keypair) {
        return {
          content: [{ type: "text", text: "Failed to load wallet for signing." }],
        };
      }

      try {
        const apiConfig = getApiConfig(walletData, ENVIRONMENT);
        const productLocator = buildAmazonProductLocator(productId);

        const orderRequest: CreateOrderRequest = {
          recipient: {
            email: recipientEmail,
            physicalAddress: {
              name: recipientName,
              line1: addressLine1,
              line2: addressLine2,
              city,
              state,
              postalCode,
              country,
            },
          },
          payment: {
            receiptEmail: recipientEmail,
            method: "solana",
            currency,
            payerAddress: walletData.smartWalletAddress!,
          },
          lineItems: [{ productLocator }],
        };

        const result = await purchaseProduct(apiConfig, orderRequest, keypair);

        const productTitle = result.order.lineItems?.[0]?.metadata?.title || "Product";
        const totalPrice = result.order.quote?.totalPrice;
        const priceText = totalPrice ? `${totalPrice.amount} ${totalPrice.currency}` : "See order details";
        const paymentStatus = result.order.payment?.status || result.order.phase;

        return {
          content: [
            {
              type: "text",
              text: `✅ Purchase complete!\n\nProduct: ${productTitle}\nPrice: ${priceText}\nOrder ID: ${result.order.orderId}\nPayment: ${paymentStatus}\n\nTransaction: ${result.explorerLink}\n\nShipping to:\n${recipientName}\n${addressLine1}${addressLine2 ? `\n${addressLine2}` : ""}\n${city}${state ? `, ${state}` : ""} ${postalCode}\n${country}\n\nUse crossmint_order_status to check delivery status.`,
            },
          ],
          details: {
            orderId: result.order.orderId,
            transactionId: result.transactionId,
            onChainTxId: result.onChainTxId,
            explorerLink: result.explorerLink,
            phase: result.order.phase,
            paymentStatus,
            productLocator,
            totalPrice,
            recipient: orderRequest.recipient,
          },
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to purchase: ${(error as Error).message}` },
          ],
        };
      }
    },
  };
}

export function createCrossmintOrderStatusTool(_api: OpenClawPluginApi, _config: CrossmintPluginConfig) {
  return {
    name: "crossmint_order_status",
    description: "Check the status of a Crossmint order (Amazon purchase).",
    parameters: Type.Object({
      orderId: Type.String({
        description: "The order ID returned from crossmint_buy",
      }),
      agentId: Type.Optional(
        Type.String({ description: "Agent ID for the wallet. Defaults to current agent." }),
      ),
    }),

    async execute(_id: string, params: Record<string, unknown>, ctx: OpenClawPluginToolContext) {
      const agentId =
        typeof params.agentId === "string" ? params.agentId : getAgentId(ctx);
      const orderId = params.orderId as string;

      if (!orderId) {
        return {
          content: [{ type: "text", text: "Order ID is required." }],
        };
      }

      const walletData = getWallet(agentId);
      if (!walletData) {
        return {
          content: [
            { type: "text", text: `No wallet found for agent "${agentId}". Run crossmint_setup first.` },
          ],
        };
      }

      if (!isWalletConfigured(agentId)) {
        return {
          content: [
            { type: "text", text: `Wallet not fully configured for agent "${agentId}". Complete setup with crossmint_configure.` },
          ],
        };
      }

      try {
        const apiConfig = getApiConfig(walletData, ENVIRONMENT);
        const order = await getOrder(apiConfig, orderId);

        const productTitle = order.lineItems?.[0]?.metadata?.title || "Product";
        const deliveryStatus = order.delivery?.status || "pending";
        const deliveryItems = order.delivery?.items || [];

        let trackingInfo = "";
        for (const item of deliveryItems) {
          if (item.packageTracking) {
            trackingInfo += `\nCarrier: ${item.packageTracking.carrierName}\nTracking: ${item.packageTracking.carrierTrackingNumber}`;
          }
        }

        return {
          content: [
            {
              type: "text",
              text: `Order Status: ${order.phase}\n\nOrder ID: ${orderId}\nProduct: ${productTitle}\nPayment: ${order.payment?.status || "unknown"}\nDelivery: ${deliveryStatus}${trackingInfo}`,
            },
          ],
          details: {
            orderId,
            phase: order.phase,
            quote: order.quote,
            payment: order.payment,
            delivery: order.delivery,
            lineItems: order.lineItems,
          },
        };
      } catch (error) {
        return {
          content: [
            { type: "text", text: `Failed to get order status: ${(error as Error).message}` },
          ],
        };
      }
    },
  };
}
