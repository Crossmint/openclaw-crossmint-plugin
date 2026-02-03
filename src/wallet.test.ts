import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  configureWallet,
  deleteWallet,
  getKeypair,
  getOrCreateWallet,
  getWallet,
  isWalletConfigured,
  listWallets,
  signMessage,
} from "./wallet.js";

const isWindows = process.platform === "win32";

function expectPerms(actual: number, expected: number) {
  if (isWindows) {
    // Windows doesn't support Unix permissions
    expect([expected, 0o666, 0o777]).toContain(actual);
    return;
  }
  expect(actual).toBe(expected);
}

describe("crossmint wallet", () => {
  let tmpDir: string;
  let originalEnv: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "crossmint-wallet-test-"));
    originalEnv = process.env.CROSSMINT_WALLETS_DIR;
    process.env.CROSSMINT_WALLETS_DIR = tmpDir;
  });

  afterEach(async () => {
    if (originalEnv === undefined) {
      delete process.env.CROSSMINT_WALLETS_DIR;
    } else {
      process.env.CROSSMINT_WALLETS_DIR = originalEnv;
    }
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });

  describe("keypair creation", () => {
    it("creates a new Solana ed25519 keypair", () => {
      const wallet = getOrCreateWallet("test-agent");

      expect(wallet).toBeDefined();
      expect(wallet.address).toBeDefined();
      expect(wallet.secretKey).toBeDefined();
      expect(wallet.createdAt).toBeDefined();

      // Verify it's a valid Solana address (base58, 32-44 chars)
      expect(wallet.address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

      // Verify the secret key can reconstruct the keypair
      const secretKeyBytes = bs58.decode(wallet.secretKey);
      expect(secretKeyBytes.length).toBe(64); // ed25519 secret key is 64 bytes

      const keypair = Keypair.fromSecretKey(secretKeyBytes);
      expect(keypair.publicKey.toBase58()).toBe(wallet.address);
    });

    it("returns existing wallet on subsequent calls", () => {
      const wallet1 = getOrCreateWallet("test-agent");
      const wallet2 = getOrCreateWallet("test-agent");

      expect(wallet1.address).toBe(wallet2.address);
      expect(wallet1.secretKey).toBe(wallet2.secretKey);
      expect(wallet1.createdAt).toBe(wallet2.createdAt);
    });

    it("creates different wallets for different agents", () => {
      const wallet1 = getOrCreateWallet("agent-1");
      const wallet2 = getOrCreateWallet("agent-2");

      expect(wallet1.address).not.toBe(wallet2.address);
      expect(wallet1.secretKey).not.toBe(wallet2.secretKey);
    });

    it("getKeypair returns a valid Solana Keypair", () => {
      getOrCreateWallet("test-agent");
      const keypair = getKeypair("test-agent");

      expect(keypair).toBeInstanceOf(Keypair);
      expect(keypair).not.toBeNull();
    });

    it("getKeypair returns null for non-existent agent", () => {
      const keypair = getKeypair("non-existent");
      expect(keypair).toBeNull();
    });
  });

  describe("secure storage", () => {
    it("stores wallet file with secure permissions (0o600)", async () => {
      getOrCreateWallet("test-agent");

      const storePath = path.join(tmpDir, "wallets.json");
      const stats = await fs.promises.stat(storePath);
      const mode = stats.mode & 0o777;

      expectPerms(mode, 0o600);
    });

    it("creates wallets directory with secure permissions (0o700)", async () => {
      // Remove the directory first to test creation
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
      await fs.promises.mkdir(tmpDir, { recursive: true });

      const walletsSubDir = path.join(tmpDir, "subdir");
      process.env.CROSSMINT_WALLETS_DIR = walletsSubDir;

      getOrCreateWallet("test-agent");

      const stats = await fs.promises.stat(walletsSubDir);
      const mode = stats.mode & 0o777;

      expectPerms(mode, 0o700);
    });

    it("stores secret key as base58 encoded string", () => {
      const wallet = getOrCreateWallet("test-agent");

      // Should be valid base58
      expect(() => bs58.decode(wallet.secretKey)).not.toThrow();

      const decoded = bs58.decode(wallet.secretKey);
      expect(decoded.length).toBe(64); // ed25519 secret key
    });

    it("persists wallet data to disk", async () => {
      const wallet = getOrCreateWallet("test-agent");

      const storePath = path.join(tmpDir, "wallets.json");
      const raw = await fs.promises.readFile(storePath, "utf-8");
      const data = JSON.parse(raw) as { wallets: Record<string, unknown> };

      expect(data.wallets["test-agent"]).toBeDefined();
      expect((data.wallets["test-agent"] as { address: string }).address).toBe(wallet.address);
    });
  });

  describe("credential storage", () => {
    it("stores smart wallet address from web app", () => {
      getOrCreateWallet("test-agent");

      const smartWalletAddress = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
      const apiKey = "sk_test_123456";

      const configured = configureWallet("test-agent", smartWalletAddress, apiKey);

      expect(configured.smartWalletAddress).toBe(smartWalletAddress);
      expect(configured.configuredAt).toBeDefined();
    });

    it("stores client-side API key from web app", () => {
      getOrCreateWallet("test-agent");

      const smartWalletAddress = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
      const apiKey = "sk_test_abcdef123456";

      const configured = configureWallet("test-agent", smartWalletAddress, apiKey);

      expect(configured.apiKey).toBe(apiKey);
    });

    it("persists credentials to disk with secure permissions", async () => {
      getOrCreateWallet("test-agent");

      const smartWalletAddress = "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm";
      const apiKey = "sk_test_xyz789";

      configureWallet("test-agent", smartWalletAddress, apiKey);

      const storePath = path.join(tmpDir, "wallets.json");
      const raw = await fs.promises.readFile(storePath, "utf-8");
      const data = JSON.parse(raw) as {
        wallets: Record<string, { smartWalletAddress?: string; apiKey?: string }>;
      };

      expect(data.wallets["test-agent"].smartWalletAddress).toBe(smartWalletAddress);
      expect(data.wallets["test-agent"].apiKey).toBe(apiKey);

      // Verify file permissions remain secure after update
      const stats = await fs.promises.stat(storePath);
      const mode = stats.mode & 0o777;
      expectPerms(mode, 0o600);
    });

    it("throws error when configuring non-existent wallet", () => {
      expect(() => {
        configureWallet("non-existent", "address", "key");
      }).toThrow('No wallet found for agent "non-existent"');
    });

    it("isWalletConfigured returns false before configuration", () => {
      getOrCreateWallet("test-agent");
      expect(isWalletConfigured("test-agent")).toBe(false);
    });

    it("isWalletConfigured returns true after configuration", () => {
      getOrCreateWallet("test-agent");
      configureWallet("test-agent", "wallet-address", "api-key");
      expect(isWalletConfigured("test-agent")).toBe(true);
    });

    it("isWalletConfigured returns false for non-existent agent", () => {
      expect(isWalletConfigured("non-existent")).toBe(false);
    });
  });

  describe("wallet management", () => {
    it("getWallet returns null for non-existent agent", () => {
      const wallet = getWallet("non-existent");
      expect(wallet).toBeNull();
    });

    it("getWallet returns wallet data for existing agent", () => {
      const created = getOrCreateWallet("test-agent");
      const retrieved = getWallet("test-agent");

      expect(retrieved).not.toBeNull();
      expect(retrieved?.address).toBe(created.address);
    });

    it("listWallets returns all wallets", () => {
      getOrCreateWallet("agent-1");
      getOrCreateWallet("agent-2");
      getOrCreateWallet("agent-3");

      const wallets = listWallets();

      expect(Object.keys(wallets)).toHaveLength(3);
      expect(wallets["agent-1"]).toBeDefined();
      expect(wallets["agent-2"]).toBeDefined();
      expect(wallets["agent-3"]).toBeDefined();
    });

    it("deleteWallet removes wallet", () => {
      getOrCreateWallet("test-agent");
      expect(getWallet("test-agent")).not.toBeNull();

      const deleted = deleteWallet("test-agent");

      expect(deleted).toBe(true);
      expect(getWallet("test-agent")).toBeNull();
    });

    it("deleteWallet returns false for non-existent agent", () => {
      const deleted = deleteWallet("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("message signing", () => {
    it("signs messages with ed25519", async () => {
      getOrCreateWallet("test-agent");

      const message = new TextEncoder().encode("test message");
      const signature = await signMessage("test-agent", message);

      expect(signature).toBeInstanceOf(Uint8Array);
      expect(signature.length).toBe(64); // ed25519 signature is 64 bytes
    });

    it("produces valid ed25519 signature", async () => {
      const wallet = getOrCreateWallet("test-agent");

      const message = new TextEncoder().encode("test message for verification");
      const signature = await signMessage("test-agent", message);

      // Verify signature using tweetnacl
      const { sign } = await import("tweetnacl");
      const publicKey = bs58.decode(wallet.address);

      const isValid = sign.detached.verify(message, signature, publicKey);
      expect(isValid).toBe(true);
    });

    it("throws error for non-existent agent", async () => {
      await expect(signMessage("non-existent", new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "No wallet found for agent: non-existent",
      );
    });
  });
});
