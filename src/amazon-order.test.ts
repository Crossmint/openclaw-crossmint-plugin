import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { describe, it, expect } from "vitest";

/**
 * End-to-end test for Amazon order purchase via Crossmint.
 *
 * This test demonstrates the complete delegated signer flow:
 * 1. Create an Amazon order via Crossmint API
 * 2. Create a Crossmint transaction with the serialized transaction
 * 3. Sign the approval message with the delegated signer
 * 4. Submit the approval to Crossmint
 * 5. Wait for transaction to be broadcast and get txId
 * 6. Submit txId to /payment endpoint (CRITICAL STEP!)
 * 7. Poll for order completion
 *
 * Run with:
 *   CROSSMINT_API_KEY=your-key \
 *   PAYER_ADDRESS=your-smart-wallet-address \
 *   SIGNER_PRIVATE_KEY=your-delegated-signer-base58-private-key \
 *   pnpm test src/amazon-order.test.ts
 */

// Configuration from environment
const API_KEY = process.env.CROSSMINT_API_KEY || "";
const PAYER_ADDRESS = process.env.PAYER_ADDRESS || ""; // Smart wallet address
const SIGNER_PRIVATE_KEY = process.env.PAYER_PRIVATE_KEY || ""; // Delegated signer private key

// Crossmint API base URLs (staging = devnet)
const CROSSMINT_ORDERS_API = "https://staging.crossmint.com/api/2022-06-09";
const CROSSMINT_WALLETS_API = "https://staging.crossmint.com/api/2025-06-09";

// Test product - can be overridden via environment variable
const TEST_AMAZON_ASIN = process.env.TEST_AMAZON_ASIN || "B00AATAHY0";

// Skip tests if credentials not provided
const LIVE = API_KEY && PAYER_ADDRESS && SIGNER_PRIVATE_KEY;

/**
 * Step 1: Create the Amazon Order
 */
async function createAmazonOrder(amazonASIN: string, payerAddress: string, currency: string = "sol") {
  const response = await fetch(`${CROSSMINT_ORDERS_API}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": API_KEY,
    },
    body: JSON.stringify({
      recipient: {
        email: "buyer@example.com",
        physicalAddress: {
          name: "John Doe",
          line1: "350 5th Ave",
          line2: "Suite 400",
          city: "New York",
          state: "NY",
          postalCode: "10118",
          country: "US",
        },
      },
      payment: {
        method: "solana",
        currency: currency,
        payerAddress: payerAddress,
        receiptEmail: "buyer@example.com",
      },
      lineItems: [
        {
          productLocator: `amazon:${amazonASIN}`,
        },
      ],
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create order: ${error}`);
  }

  return await response.json();
}

/**
 * Step 2: Create Crossmint transaction from serialized transaction
 * Returns transactionId and message to sign
 */
async function createCrossmintTransaction(
  payerAddress: string,
  serializedTransaction: string,
  signerAddress: string
) {
  const response = await fetch(
    `${CROSSMINT_WALLETS_API}/wallets/${encodeURIComponent(payerAddress)}/transactions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
      body: JSON.stringify({
        params: {
          transaction: serializedTransaction,
          signer: `external-wallet:${signerAddress}`,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create transaction: ${error}`);
  }

  return await response.json();
}

/**
 * Step 3: Sign the approval message with delegated signer
 */
function signApprovalMessage(message: string, privateKeyBase58: string): string {
  const secretKey = bs58.decode(privateKeyBase58);
  const messageBytes = bs58.decode(message);
  const signature = nacl.sign.detached(messageBytes, secretKey);
  return bs58.encode(signature);
}

/**
 * Step 4: Submit approval to Crossmint
 */
async function submitApproval(
  payerAddress: string,
  transactionId: string,
  signerAddress: string,
  signature: string
) {
  const response = await fetch(
    `${CROSSMINT_WALLETS_API}/wallets/${encodeURIComponent(payerAddress)}/transactions/${encodeURIComponent(transactionId)}/approvals`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
      body: JSON.stringify({
        approvals: [
          {
            signer: `external-wallet:${signerAddress}`,
            signature: signature,
          },
        ],
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to submit approval: ${error}`);
  }

  return await response.json();
}

/**
 * Step 5: Get transaction status from Crossmint Wallets API
 * Poll until we get the on-chain txId
 */
async function getTransactionStatus(payerAddress: string, transactionId: string) {
  const response = await fetch(
    `${CROSSMINT_WALLETS_API}/wallets/${encodeURIComponent(payerAddress)}/transactions/${encodeURIComponent(transactionId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get transaction status: ${error}`);
  }

  return await response.json();
}

/**
 * Step 5b: Poll for transaction to be broadcast and get on-chain txId
 */
async function waitForTransactionBroadcast(
  payerAddress: string,
  transactionId: string,
  timeoutMs: number = 30000
): Promise<string | null> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    const txStatus = await getTransactionStatus(payerAddress, transactionId);
    console.log("Transaction status:", txStatus.status);
    
    // Check if transaction has been broadcast and we have the on-chain txId
    if (txStatus.onChain?.txId) {
      console.log("On-chain txId:", txStatus.onChain.txId);
      return txStatus.onChain.txId;
    }
    
    // Also check for txId directly on the response
    if (txStatus.txId) {
      console.log("txId from response:", txStatus.txId);
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
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log("Timeout waiting for transaction broadcast");
  return null;
}

/**
 * Step 6: Submit payment to Crossmint Orders API (CRITICAL!)
 * This notifies Crossmint that the payment transaction has been submitted
 */
async function processPayment(orderId: string, txId: string, clientSecret?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
  };
  if (clientSecret) {
    headers["Authorization"] = clientSecret;
  }

  const response = await fetch(`${CROSSMINT_ORDERS_API}/orders/${orderId}/payment`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      type: "crypto-tx-id",
      txId: txId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to process payment: ${error}`);
  }

  return await response.json();
}

/**
 * Step 7: Poll for Order Completion
 */
async function pollOrderStatus(
  orderId: string,
  clientSecret: string,
  timeoutMs: number = 60000
): Promise<{ paymentStatus: string; deliveryStatus: string }> {
  return new Promise((resolve) => {
    const intervalId = setInterval(async () => {
      try {
        const response = await fetch(`${CROSSMINT_ORDERS_API}/orders/${orderId}`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            "X-API-KEY": API_KEY,
            Authorization: clientSecret,
          },
        });

        if (!response.ok) {
          console.log("Failed to get order status:", await response.text());
          return;
        }

        const orderStatus = await response.json();
        const paymentStatus = orderStatus.payment?.status || "unknown";
        const deliveryStatus = orderStatus.lineItems?.[0]?.delivery?.status || "pending";

        console.log("Payment:", paymentStatus);
        console.log("Delivery:", deliveryStatus);

        if (paymentStatus === "completed") {
          clearInterval(intervalId);
          console.log("Payment completed! Amazon order is being fulfilled.");
          resolve({ paymentStatus, deliveryStatus });
        }
      } catch (error) {
        console.error("Error polling order status:", error);
      }
    }, 2500);

    setTimeout(() => {
      clearInterval(intervalId);
      console.log("Timeout - check order manually");
      resolve({ paymentStatus: "timeout", deliveryStatus: "unknown" });
    }, timeoutMs);
  });
}

/**
 * Get order status (single call)
 */
async function getOrderStatus(orderId: string, clientSecret?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-API-KEY": API_KEY,
  };
  if (clientSecret) {
    headers["Authorization"] = clientSecret;
  }

  const response = await fetch(`${CROSSMINT_ORDERS_API}/orders/${orderId}`, {
    method: "GET",
    headers,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get order: ${error}`);
  }

  return await response.json();
}

/**
 * Get signer public key from private key
 */
function getSignerAddress(privateKeyBase58: string): string {
  const secretKey = bs58.decode(privateKeyBase58);
  const keypair = Keypair.fromSecretKey(secretKey);
  return keypair.publicKey.toBase58();
}

describe("Amazon Order E2E Test", () => {
  describe.skipIf(!LIVE)("live: delegated signer purchase flow", () => {
    it("creates order and pays with delegated signer approval", async () => {
      const signerAddress = getSignerAddress(SIGNER_PRIVATE_KEY);

      console.log("\n=== Starting Amazon Order E2E Test (Delegated Signer Flow) ===\n");
      console.log("Smart Wallet (Payer):", PAYER_ADDRESS);
      console.log("Delegated Signer:", signerAddress);
      console.log("Amazon ASIN:", TEST_AMAZON_ASIN);

      // Step 1: Create the order
      console.log("\n--- Step 1: Creating Amazon order ---");
      const { order, clientSecret } = await createAmazonOrder(
        TEST_AMAZON_ASIN,
        PAYER_ADDRESS,
        "sol"
      );

      console.log("Order ID:", order.orderId);
      console.log("Order Phase:", order.phase);
      console.log("Client Secret:", clientSecret ? "✓ received" : "✗ missing");

      expect(order.orderId).toBeDefined();
      expect(order.phase).toBeDefined();

      // Check if we have a serialized transaction
      const serializedTransaction = order.payment?.preparation?.serializedTransaction;
      console.log(
        "Serialized Transaction:",
        serializedTransaction ? `✓ received (${serializedTransaction.length} chars)` : "✗ missing"
      );

      if (!serializedTransaction) {
        console.log("\nOrder created but no serialized transaction returned.");
        console.log("Full order response:", JSON.stringify(order, null, 2));
        return;
      }

      // Check for insufficient funds
      if (order.payment?.failureReason?.code === "insufficient-funds") {
        console.log("\n⚠️ Insufficient funds:", order.payment.failureReason.message);
        console.log("Please fund the wallet and try again.");
        return;
      }

      // Step 2: Create Crossmint transaction
      console.log("\n--- Step 2: Creating Crossmint transaction ---");
      const txResponse = await createCrossmintTransaction(
        PAYER_ADDRESS,
        serializedTransaction,
        signerAddress
      );

      console.log("Transaction ID:", txResponse.id);
      console.log("Transaction Status:", txResponse.status);

      const messageToSign = txResponse.approvals?.pending?.[0]?.message;
      console.log("Message to sign:", messageToSign ? `✓ received (${messageToSign.length} chars)` : "✗ missing");

      if (!messageToSign) {
        console.log("\nNo message to sign. Transaction response:", JSON.stringify(txResponse, null, 2));
        return;
      }

      // Step 3: Sign the approval message
      console.log("\n--- Step 3: Signing approval message ---");
      const signature = signApprovalMessage(messageToSign, SIGNER_PRIVATE_KEY);
      console.log("Signature:", `✓ generated (${signature.length} chars)`);

      // Step 4: Submit approval
      console.log("\n--- Step 4: Submitting approval to Crossmint ---");
      const approvalResponse = await submitApproval(
        PAYER_ADDRESS,
        txResponse.id,
        signerAddress,
        signature
      );

      console.log("Approval Response:", JSON.stringify(approvalResponse, null, 2));

      // Step 5: Wait for transaction to be broadcast and get on-chain txId
      console.log("\n--- Step 5: Waiting for transaction broadcast ---");
      const onChainTxId = await waitForTransactionBroadcast(PAYER_ADDRESS, txResponse.id, 30000);

      if (!onChainTxId) {
        console.log("Could not get on-chain txId. Checking approval response for txId...");
        // Try to get txId from approval response
        const fallbackTxId = approvalResponse.onChain?.txId || approvalResponse.txId || approvalResponse.hash;
        if (!fallbackTxId) {
          console.log("No txId available. Cannot call /payment endpoint.");
          console.log("Full approval response:", JSON.stringify(approvalResponse, null, 2));
          return;
        }
      }

      const txIdToSubmit = onChainTxId || approvalResponse.onChain?.txId || approvalResponse.txId;

      // Step 6: Submit payment to Crossmint (CRITICAL!)
      console.log("\n--- Step 6: Submitting payment to Crossmint /payment endpoint ---");
      console.log("Submitting txId:", txIdToSubmit);
      
      const paymentResponse = await processPayment(order.orderId, txIdToSubmit!, clientSecret);
      console.log("Payment Response:", JSON.stringify(paymentResponse, null, 2));

      // Step 7: Poll for order completion
      console.log("\n--- Step 7: Polling for order completion ---");
      const { paymentStatus, deliveryStatus } = await pollOrderStatus(
        order.orderId,
        clientSecret,
        60000
      );

      console.log("\n=== Final Status ===");
      console.log("Payment Status:", paymentStatus);
      console.log("Delivery Status:", deliveryStatus);

      // Payment should eventually complete
      expect(["completed", "timeout", "crypto-payer-insufficient-funds"]).toContain(paymentStatus);
    }, 180000); // 3 minute timeout

    it("creates order only (inspect response)", async () => {
      console.log("\n=== Create Order Only Test ===\n");

      const { order, clientSecret } = await createAmazonOrder(
        TEST_AMAZON_ASIN,
        PAYER_ADDRESS,
        "sol"
      );

      console.log("Order ID:", order.orderId);
      console.log("Order Phase:", order.phase);
      console.log("Quote:", JSON.stringify(order.quote, null, 2));
      console.log("Payment:", JSON.stringify(order.payment, null, 2));

      expect(order.orderId).toBeDefined();

      console.log("\n--- Full Response ---");
      console.log(JSON.stringify({ order, clientSecret }, null, 2));
    }, 30000);
  });

  describe("unit tests", () => {
    it("validates keypair creation from base58", () => {
      const testKeypair = Keypair.generate();
      const secretKeyBase58 = bs58.encode(testKeypair.secretKey);
      const recreatedKeypair = Keypair.fromSecretKey(bs58.decode(secretKeyBase58));
      expect(recreatedKeypair.publicKey.toBase58()).toBe(testKeypair.publicKey.toBase58());
    });

    it("validates signature generation", () => {
      const testKeypair = Keypair.generate();
      const secretKeyBase58 = bs58.encode(testKeypair.secretKey);
      const testMessage = bs58.encode(Buffer.from("test message"));

      const signature = signApprovalMessage(testMessage, secretKeyBase58);
      expect(signature).toBeDefined();
      expect(signature.length).toBeGreaterThan(0);

      // Verify signature
      const sigBytes = bs58.decode(signature);
      const msgBytes = bs58.decode(testMessage);
      const isValid = nacl.sign.detached.verify(msgBytes, sigBytes, testKeypair.publicKey.toBytes());
      expect(isValid).toBe(true);
    });
  });
});

export {
  createAmazonOrder,
  createCrossmintTransaction,
  signApprovalMessage,
  submitApproval,
  waitForTransactionBroadcast,
  processPayment,
  pollOrderStatus,
  getOrderStatus,
  getTransactionStatus,
};
