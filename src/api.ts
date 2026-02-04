import type { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export type CrossmintApiConfig = {
  apiKey: string;
  environment: "staging"; // Only staging (Solana devnet) supported for now
};

export type CrossmintBalance = {
  token: string;
  amount: string;
  decimals: number;
  rawAmount?: string;
};

export type CrossmintTransaction = {
  id: string;
  status: string;
  hash?: string;
  txId?: string; // Top-level txId from API response
  explorerLink?: string;
  onChain?: {
    status?: string;
    chain?: string;
    txId?: string;
  };
};

// Only staging (Solana devnet) is supported for now
function getBaseUrl(_env: "staging"): string {
  // Production URL reserved for future use: https://www.crossmint.com/api
  return "https://staging.crossmint.com/api";
}

async function fetchCrossmint(
  config: CrossmintApiConfig,
  endpoint: string,
  options: RequestInit = {},
): Promise<Response> {
  const baseUrl = getBaseUrl(config.environment);
  const url = `${baseUrl}${endpoint}`;

  const headers: Record<string, string> = {
    "X-API-KEY": config.apiKey,
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  return response;
}

export async function getWalletBalance(
  config: CrossmintApiConfig,
  walletAddress: string,
): Promise<CrossmintBalance[]> {
  const response = await fetchCrossmint(
    config,
    `/2025-06-09/wallets/${encodeURIComponent(walletAddress)}/balances?tokens=sol,usdc&chains=solana`,
    { method: "GET" },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get balance: ${error}`);
  }

  const data = await response.json();

  const balances: CrossmintBalance[] = [];

  // Parse the response array
  if (Array.isArray(data)) {
    for (const token of data) {
      balances.push({
        token: token.symbol || "Unknown",
        amount: token.amount || "0",
        decimals: token.decimals || 9,
        rawAmount: token.rawAmount,
      });
    }
  }

  return balances;
}

export async function getTransactionStatus(
  config: CrossmintApiConfig,
  walletAddress: string,
  transactionId: string,
): Promise<CrossmintTransaction> {
  const response = await fetchCrossmint(
    config,
    `/2025-06-09/wallets/${encodeURIComponent(walletAddress)}/transactions/${encodeURIComponent(transactionId)}`,
    { method: "GET" },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get transaction status: ${error}`);
  }

  const data = await response.json();

  return {
    id: data.id,
    status: data.status,
    hash: data.onChain?.txId || data.hash,
    txId: data.txId, // Top-level txId from API response
    explorerLink: data.onChain?.txId
      ? `https://explorer.solana.com/tx/${data.onChain.txId}?cluster=devnet`
      : undefined,
    onChain: data.onChain,
  };
}

export async function waitForTransaction(
  config: CrossmintApiConfig,
  walletAddress: string,
  transactionId: string,
  timeoutMs: number = 60000,
  pollIntervalMs: number = 2000,
): Promise<CrossmintTransaction> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const tx = await getTransactionStatus(config, walletAddress, transactionId);
    
    // Terminal states
    if (tx.status === "success" || tx.status === "completed") {
      return tx;
    }
    if (tx.status === "failed" || tx.status === "rejected" || tx.status === "cancelled") {
      return tx;
    }
    
    // Still pending, wait and retry
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
  
  // Timeout - return last known status
  return getTransactionStatus(config, walletAddress, transactionId);
}

export async function createTransfer(
  config: CrossmintApiConfig,
  walletAddress: string,
  recipient: string,
  token: string,
  amount: string,
  keypair: Keypair,
): Promise<CrossmintTransaction> {
  // Token locator format for Solana: solana:tokenAddress or solana:sol for native
  const tokenLocator = token.toLowerCase() === "sol" ? "solana:sol" : `solana:${token}`;

  // Step 1: Create the transfer transaction
  const createResponse = await fetchCrossmint(
    config,
    `/2025-06-09/wallets/${encodeURIComponent(walletAddress)}/tokens/${encodeURIComponent(tokenLocator)}/transfers`,
    {
      method: "POST",
      body: JSON.stringify({
        recipient,
        amount,
        signer: `external-wallet:${keypair.publicKey.toBase58()}`,
      }),
    },
  );

  if (!createResponse.ok) {
    const error = await createResponse.text();
    throw new Error(`Failed to create transfer: ${error}`);
  }

  const txData = await createResponse.json();

  // Step 2: If approval is needed, sign and submit
  if (txData.status === "awaiting-approval" && txData.approvals?.pending?.length > 0) {
    const approval = txData.approvals.pending[0];
    if (approval?.message) {
      // Sign the approval message using ed25519
      // Message is base58 encoded (Solana standard), not hex
      const messageBytes = bs58.decode(approval.message);
      const nacl = (await import("tweetnacl")).default;
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
      const signatureBase58 = bs58.encode(signature);

      // Submit approval
      const approveResponse = await fetchCrossmint(
        config,
        `/2025-06-09/wallets/${encodeURIComponent(walletAddress)}/transactions/${txData.id}/approvals`,
        {
          method: "POST",
          body: JSON.stringify({
            approvals: [
              {
                signer: `external-wallet:${keypair.publicKey.toBase58()}`,
                signature: signatureBase58,
              },
            ],
          }),
        },
      );

      if (!approveResponse.ok) {
        const error = await approveResponse.text();
        throw new Error(`Failed to approve transfer: ${error}`);
      }

      const approvedData = await approveResponse.json();
      return {
        id: approvedData.id || txData.id,
        status: approvedData.status || "pending",
        hash: approvedData.hash,
        explorerLink: approvedData.explorerLink,
      };
    }
  }

  return {
    id: txData.id,
    status: txData.status,
    hash: txData.hash,
    explorerLink: txData.explorerLink,
  };
}

export function buildDelegationUrl(
  delegationBaseUrl: string,
  publicAddress: string,
): string {
  // URL format: {baseUrl}/configure?pubkey={publicKey}
  const baseUrl = delegationBaseUrl.replace(/\/+$/, ""); // Remove trailing slashes
  return `${baseUrl}/configure?pubkey=${publicAddress}`;
}

// ============================================================================
// Headless Checkout Types (Amazon purchases with delegated signer)
// ============================================================================

export type OrderRecipient = {
  email: string;
  physicalAddress: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode: string;
    country: string; // ISO 3166-1 alpha-2 (e.g., "US")
  };
};

export type OrderLineItem = {
  productLocator: string; // e.g., "amazon:B00O79SKV6"
};

export type OrderPayment = {
  receiptEmail: string;
  method: "solana";
  currency: string; // e.g., "usdc"
  payerAddress: string; // Smart wallet address that pays
};

export type CreateOrderRequest = {
  recipient: OrderRecipient;
  payment: OrderPayment;
  lineItems: OrderLineItem[];
};

export type OrderPhase = "quote" | "payment" | "delivery" | "completed" | "failed";

export type CrossmintOrder = {
  orderId: string;
  phase: OrderPhase;
  quote?: {
    status: string;
    totalPrice?: { amount: string; currency: string };
  };
  payment?: {
    status: string;
    preparation?: {
      serializedTransaction?: string; // Transaction to sign for payment
    };
  };
  delivery?: {
    status: string;
    items?: Array<{
      status: string;
      packageTracking?: {
        carrierName: string;
        carrierTrackingNumber: string;
      };
    }>;
  };
  lineItems?: Array<{
    metadata?: {
      title?: string;
      imageUrl?: string;
      price?: { amount: string; currency: string };
    };
  }>;
};

export type TransactionResponse = {
  id: string;
  status: string;
  approvals?: {
    pending?: Array<{
      signer: string;
      message: string; // Message to sign
    }>;
  };
};

// ============================================================================
// Headless Checkout API Functions (Delegated Signer Flow)
// ============================================================================

export type CreateOrderResponse = {
  order: CrossmintOrder;
  clientSecret: string;
};

/**
 * Step 1: Create an order for purchasing products (e.g., from Amazon)
 * Returns order with serializedTransaction and clientSecret for subsequent API calls
 */
export async function createOrder(
  config: CrossmintApiConfig,
  request: CreateOrderRequest,
): Promise<CreateOrderResponse> {
  const response = await fetchCrossmint(config, "/2022-06-09/orders", {
    method: "POST",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create order: ${error}`);
  }

  // API returns { clientSecret, order }
  const data = await response.json();
  return {
    order: data.order,
    clientSecret: data.clientSecret,
  };
}

/**
 * Step 2a: Create transaction from serialized transaction
 * Returns transactionId and message to sign
 */
export async function createTransaction(
  config: CrossmintApiConfig,
  payerAddress: string,
  serializedTransaction: string,
  signerAddress?: string,
): Promise<TransactionResponse> {
  const response = await fetchCrossmint(
    config,
    `/2025-06-09/wallets/${encodeURIComponent(payerAddress)}/transactions`,
    {
      method: "POST",
      body: JSON.stringify({
        params: {
          transaction: serializedTransaction,
          ...(signerAddress && { signer: `external-wallet:${signerAddress}` }),
        },
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create transaction: ${error}`);
  }

  return response.json();
}

/**
 * Step 2b: Submit approval with signed message
 */
export async function submitApproval(
  config: CrossmintApiConfig,
  payerAddress: string,
  transactionId: string,
  signerAddress: string,
  signature: string,
): Promise<TransactionResponse> {
  const response = await fetchCrossmint(
    config,
    `/2025-06-09/wallets/${encodeURIComponent(payerAddress)}/transactions/${encodeURIComponent(transactionId)}/approvals`,
    {
      method: "POST",
      body: JSON.stringify({
        approvals: [
          {
            signer: `external-wallet:${signerAddress}`,
            signature,
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit approval: ${error}`);
  }

  return response.json();
}

/**
 * Get order status
 */
export async function getOrder(
  config: CrossmintApiConfig,
  orderId: string,
  clientSecret?: string,
): Promise<CrossmintOrder> {
  const headers: Record<string, string> = {};
  if (clientSecret) {
    headers["Authorization"] = clientSecret;
  }

  const response = await fetchCrossmint(
    config,
    `/2022-06-09/orders/${encodeURIComponent(orderId)}`,
    { method: "GET", headers },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get order: ${error}`);
  }

  return response.json();
}

/**
 * Step 5: Wait for transaction to be broadcast and get on-chain txId
 * Polls the transaction status until we get the on-chain transaction ID
 */
export async function waitForTransactionBroadcast(
  config: CrossmintApiConfig,
  walletAddress: string,
  transactionId: string,
  timeoutMs: number = 30000,
  pollIntervalMs: number = 2000,
): Promise<string | null> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const txStatus = await getTransactionStatus(config, walletAddress, transactionId);

    // Check if transaction has been broadcast and we have the on-chain txId
    if (txStatus.onChain?.txId) {
      return txStatus.onChain.txId;
    }

    // Also check for txId directly on the response
    if (txStatus.txId) {
      return txStatus.txId;
    }

    // Check if status indicates completion
    if (txStatus.status === "success" || txStatus.status === "completed") {
      // Try to find txId in various places
      const txId = txStatus.onChain?.txId || txStatus.txId || txStatus.hash;
      if (txId) {
        return txId;
      }
    }

    // Check for failure
    if (txStatus.status === "failed") {
      throw new Error(`Transaction failed: ${JSON.stringify(txStatus)}`);
    }

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return null;
}

/**
 * Step 6: Submit payment confirmation to Crossmint Orders API (CRITICAL!)
 * This notifies Crossmint that the payment transaction has been submitted on-chain
 */
export async function submitPaymentConfirmation(
  config: CrossmintApiConfig,
  orderId: string,
  onChainTxId: string,
  clientSecret?: string,
): Promise<CrossmintOrder> {
  const headers: Record<string, string> = {};
  if (clientSecret) {
    headers["Authorization"] = clientSecret;
  }

  const response = await fetchCrossmint(
    config,
    `/2022-06-09/orders/${encodeURIComponent(orderId)}/payment`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        type: "crypto-tx-id",
        txId: onChainTxId,
      }),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit payment confirmation: ${error}`);
  }

  return response.json();
}

export type PurchaseResult = {
  order: CrossmintOrder;
  transactionId: string;
  onChainTxId: string;
  explorerLink: string;
};

/**
 * Complete Amazon purchase flow with delegated signer
 *
 * Steps:
 * 1. Create order → returns serializedTransaction and clientSecret
 * 2a. Create Crossmint transaction with serialized tx
 * 2b. Sign the approval message locally with ed25519
 * 2c. Submit approval to Crossmint
 * 5. Wait for transaction to be broadcast → get on-chain txId
 * 6. Submit txId to /payment endpoint (CRITICAL!)
 *
 * Returns the final order state after payment confirmation.
 */
export async function purchaseProduct(
  config: CrossmintApiConfig,
  request: CreateOrderRequest,
  keypair: Keypair,
): Promise<PurchaseResult> {
  // Step 1: Create order
  const { order, clientSecret } = await createOrder(config, request);

  const serializedTransaction = order.payment?.preparation?.serializedTransaction;
  if (!serializedTransaction) {
    // Check for insufficient funds
    const failureReason = (order.payment as { failureReason?: { code: string; message: string } })?.failureReason;
    if (failureReason?.code === "insufficient-funds") {
      throw new Error(`Insufficient funds: ${failureReason.message}`);
    }
    throw new Error(
      `Order created but no serialized transaction returned. Payment status: ${order.payment?.status || "unknown"}`,
    );
  }

  // Step 2a: Create transaction with delegated signer
  const txResponse = await createTransaction(
    config,
    request.payment.payerAddress,
    serializedTransaction,
    keypair.publicKey.toBase58(),
  );

  const messageToSign = txResponse.approvals?.pending?.[0]?.message;
  if (!messageToSign) {
    throw new Error("Transaction created but no message to sign");
  }

  // Step 2b (local): Sign the message with ed25519
  // Message is base58 encoded (Solana standard)
  const messageBytes = bs58.decode(messageToSign);
  const nacl = (await import("tweetnacl")).default;
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  const signatureBase58 = bs58.encode(signature);

  // Step 2c: Submit approval
  await submitApproval(
    config,
    request.payment.payerAddress,
    txResponse.id,
    keypair.publicKey.toBase58(),
    signatureBase58,
  );

  // Step 5: Wait for transaction to be broadcast and get on-chain txId
  const onChainTxId = await waitForTransactionBroadcast(
    config,
    request.payment.payerAddress,
    txResponse.id,
    30000, // 30 second timeout
  );

  if (!onChainTxId) {
    throw new Error("Timeout waiting for transaction to be broadcast on-chain");
  }

  // Step 6: Submit payment confirmation (CRITICAL!)
  const updatedOrder = await submitPaymentConfirmation(
    config,
    order.orderId,
    onChainTxId,
    clientSecret,
  );

  const explorerLink =
    config.environment === "staging"
      ? `https://explorer.solana.com/tx/${onChainTxId}?cluster=devnet`
      : `https://explorer.solana.com/tx/${onChainTxId}`;

  return {
    order: updatedOrder,
    transactionId: txResponse.id,
    onChainTxId,
    explorerLink,
  };
}

/**
 * Build Amazon product locator from ASIN or URL
 */
export function buildAmazonProductLocator(productIdOrUrl: string): string {
  if (productIdOrUrl.startsWith("amazon:")) {
    return productIdOrUrl;
  }
  if (productIdOrUrl.includes("amazon.com")) {
    return `amazon:${productIdOrUrl}`;
  }
  // Assume it's an ASIN
  return `amazon:${productIdOrUrl}`;
}
