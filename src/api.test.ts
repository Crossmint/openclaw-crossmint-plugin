import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildAmazonProductLocator,
  buildDelegationUrl,
  createOrder,
  getOrder,
  type CreateOrderRequest,
  type CrossmintApiConfig,
} from "./api.js";

/**
 * Live integration tests for Crossmint Amazon purchase API.
 *
 * Run with: CROSSMINT_API_KEY=your-key pnpm test extensions/crossmint/src/api.test.ts
 *
 * These tests make real API calls to Crossmint staging (devnet).
 * They require a valid client-side API key with orders.create scope.
 */

const LIVE = process.env.CROSSMINT_API_KEY || process.env.LIVE;

describe("crossmint api", () => {
  describe("buildDelegationUrl", () => {
    it("builds URL with public key parameter", () => {
      const url = buildDelegationUrl("https://example.com/delegate", "ABC123");
      expect(url).toBe("https://example.com/delegate/configure?pubkey=ABC123");
    });

    it("removes trailing slashes from base URL", () => {
      const url = buildDelegationUrl("https://example.com/delegate///", "ABC123");
      expect(url).toBe("https://example.com/delegate/configure?pubkey=ABC123");
    });
  });

  describe("buildAmazonProductLocator", () => {
    it("returns existing amazon: locator unchanged", () => {
      const result = buildAmazonProductLocator("amazon:B00O79SKV6");
      expect(result).toBe("amazon:B00O79SKV6");
    });

    it("wraps Amazon URL with amazon: prefix", () => {
      const result = buildAmazonProductLocator("https://www.amazon.com/dp/B00O79SKV6");
      expect(result).toBe("amazon:https://www.amazon.com/dp/B00O79SKV6");
    });

    it("wraps ASIN with amazon: prefix", () => {
      const result = buildAmazonProductLocator("B00O79SKV6");
      expect(result).toBe("amazon:B00O79SKV6");
    });
  });

  describe.skipIf(!LIVE)("live: createOrder", () => {
    const config: CrossmintApiConfig = {
      apiKey: process.env.CROSSMINT_API_KEY!,
      environment: "staging",
    };

    // Generate a test keypair for the payer address
    const testKeypair = Keypair.generate();

    it("creates an order for an Amazon product", async () => {
      const request: CreateOrderRequest = {
        recipient: {
          email: "test@example.com",
          physicalAddress: {
            name: "Test User",
            line1: "123 Test Street",
            city: "San Francisco",
            state: "CA",
            postalCode: "94102",
            country: "US",
          },
        },
        payment: {
          receiptEmail: "test@example.com",
          method: "solana",
          currency: "usdc",
          payerAddress: testKeypair.publicKey.toBase58(),
        },
        lineItems: [
          {
            // Amazon Basics product - commonly available
            productLocator: "amazon:B00O79SKV6",
          },
        ],
      };

      const order = await createOrder(config, request);

      console.log("Created order:", JSON.stringify(order, null, 2));

      // Verify order was created
      expect(order.orderId).toBeDefined();
      expect(order.phase).toBeDefined();

      // The order should have a quote or be in quote phase
      expect(["quote", "payment"]).toContain(order.phase);

      // For headless checkout with delegated signer, we expect serializedTransaction
      // Note: This may not always be present depending on quote status
      if (order.phase === "payment") {
        expect(order.payment?.preparation?.serializedTransaction).toBeDefined();
      }
    });

    it("creates an order with SOL currency", async () => {
      const request: CreateOrderRequest = {
        recipient: {
          email: "test@example.com",
          physicalAddress: {
            name: "Test User",
            line1: "456 Test Avenue",
            city: "Los Angeles",
            state: "CA",
            postalCode: "90001",
            country: "US",
          },
        },
        payment: {
          receiptEmail: "test@example.com",
          method: "solana",
          currency: "sol",
          payerAddress: testKeypair.publicKey.toBase58(),
        },
        lineItems: [
          {
            productLocator: "amazon:B00O79SKV6",
          },
        ],
      };

      const order = await createOrder(config, request);

      console.log("Created SOL order:", JSON.stringify(order, null, 2));

      expect(order.orderId).toBeDefined();
      expect(order.phase).toBeDefined();
    });

    it("retrieves order status after creation", async () => {
      // First create an order
      const request: CreateOrderRequest = {
        recipient: {
          email: "test@example.com",
          physicalAddress: {
            name: "Test User",
            line1: "789 Test Blvd",
            city: "New York",
            state: "NY",
            postalCode: "10001",
            country: "US",
          },
        },
        payment: {
          receiptEmail: "test@example.com",
          method: "solana",
          currency: "usdc",
          payerAddress: testKeypair.publicKey.toBase58(),
        },
        lineItems: [
          {
            productLocator: "amazon:B00O79SKV6",
          },
        ],
      };

      const createdOrder = await createOrder(config, request);
      expect(createdOrder.orderId).toBeDefined();

      // Now retrieve the order
      const retrievedOrder = await getOrder(config, createdOrder.orderId);

      console.log("Retrieved order:", JSON.stringify(retrievedOrder, null, 2));

      expect(retrievedOrder.orderId).toBe(createdOrder.orderId);
      expect(retrievedOrder.phase).toBeDefined();
    });

    it("handles invalid product gracefully", async () => {
      const request: CreateOrderRequest = {
        recipient: {
          email: "test@example.com",
          physicalAddress: {
            name: "Test User",
            line1: "123 Test Street",
            city: "San Francisco",
            state: "CA",
            postalCode: "94102",
            country: "US",
          },
        },
        payment: {
          receiptEmail: "test@example.com",
          method: "solana",
          currency: "usdc",
          payerAddress: testKeypair.publicKey.toBase58(),
        },
        lineItems: [
          {
            // Invalid ASIN
            productLocator: "amazon:INVALID123",
          },
        ],
      };

      // Should throw an error for invalid product
      await expect(createOrder(config, request)).rejects.toThrow();
    });
  });
});
