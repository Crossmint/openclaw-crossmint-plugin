# Crossmint Wallet Plugin

Solana wallet integration for OpenClaw agents using Crossmint smart wallets with delegated signing.

## Overview

This plugin enables OpenClaw agents to:
- Generate and manage local Solana signing keys (ed25519)
- Use Crossmint smart wallets on Solana
- Check wallet balances (SOL, USDC, SPL tokens)
- Send tokens to other addresses
- **Buy products from Amazon** with SOL or USDC

The key innovation is **delegated signing**: the agent holds its own private key locally, and users authorize the agent to operate their Crossmint wallet through a web-based delegation flow.

## Installation

```bash
openclaw plugins install @crossmint/openclaw-wallet
```

## Configuration

Enable the plugin in `~/.openclaw/.openclaw.json5`:

```json5
{
  plugins: {
    entries: {
      "openclaw-wallet": {
        enabled: true
      }
    }
  }
}
```

> **Note:** Currently only Solana devnet (staging) is supported. Mainnet support coming soon.

## Usage

### Setting Up a Wallet (3-Step Process)

**Step 1: Generate keypair and get delegation URL**

Ask the agent: "Set up my Crossmint wallet"

The agent will:
1. Generate a local Solana keypair (ed25519)
2. Provide a delegation URL: `https://www.lobster.cash/configure?pubkey=<your-public-key>`

**Step 2: Complete setup on the web app**

1. Open the delegation URL in your browser
2. The web app will:
   - Create a Crossmint smart wallet on Solana devnet
   - Add the agent's public key as a delegated signer
   - Show you the **wallet address** and **API key**

**Step 3: Configure the agent**

Tell the agent: "Configure my wallet with address X and API key Y"

The agent will use `crossmint_configure` to save these credentials securely.

### Checking Balance

Ask the agent: "What's my wallet balance?"

### Sending Tokens

Ask the agent: "Send 10 USDC to <solana-address>"

The agent will:
1. Confirm the recipient and amount
2. Sign the transaction locally using ed25519
3. Submit to Crossmint for execution on Solana

### Buying from Amazon

Ask the agent: "Buy me this Amazon product: B00O79SKV6"

The agent will:
1. Ask for shipping address if not provided
2. Create an order with Crossmint
3. Sign the payment transaction locally
4. Submit the payment and confirm on-chain
5. Return the order ID and Solana explorer link

**Example purchase flow:**
```
User: "Buy B00O79SKV6 and ship to John Doe, 123 Main St, New York NY 10001"

Agent: ✅ Purchase complete!

Product: AmazonBasics USB Cable
Price: 0.05 SOL
Order ID: order_abc123
Payment: completed

Transaction: https://explorer.solana.com/tx/5x...?cluster=devnet

Use crossmint_order_status to check delivery status.
```

## Tools

| Tool | Description |
|------|-------------|
| `crossmint_setup` | Generate Solana keypair and get delegation URL |
| `crossmint_configure` | Save wallet address and API key from web app |
| `crossmint_balance` | Check wallet balances (SOL, USDC, SPL tokens) |
| `crossmint_send` | Send tokens to another Solana address |
| `crossmint_wallet_info` | Get detailed wallet information |
| `crossmint_tx_status` | Check transaction status |
| `crossmint_buy` | Buy products from Amazon with SOL or USDC |
| `crossmint_order_status` | Check Amazon order/delivery status |

## Amazon Purchase Flow

When you use `crossmint_buy`, the plugin executes a complete delegated signer flow:

```
┌─────────────────────────────────────────────────────────────┐
│  1. Create Order                                            │
│     POST /orders → Returns serialized payment transaction   │
├─────────────────────────────────────────────────────────────┤
│  2. Create Transaction                                      │
│     POST /wallets/{address}/transactions                    │
│     → Returns approval message to sign                      │
├─────────────────────────────────────────────────────────────┤
│  3. Sign Approval (Local)                                   │
│     Agent signs message with ed25519 keypair                │
├─────────────────────────────────────────────────────────────┤
│  4. Submit Approval                                         │
│     POST /wallets/{address}/transactions/{id}/approvals     │
├─────────────────────────────────────────────────────────────┤
│  5. Wait for Broadcast                                      │
│     Poll until on-chain txId is available                   │
├─────────────────────────────────────────────────────────────┤
│  6. Confirm Payment (CRITICAL)                              │
│     POST /orders/{orderId}/payment                          │
│     → Notifies Crossmint that payment is on-chain           │
└─────────────────────────────────────────────────────────────┘
```

All steps are handled automatically by the plugin.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        OpenClaw Agent                        │
├─────────────────────────────────────────────────────────────┤
│  Local Solana Keypair (ed25519)                             │
│  - Private key stored at ~/.openclaw/crossmint-wallets/     │
│  - Signs transaction approvals locally                      │
│  - Wallet address + API key stored after web setup          │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              Delegation Web App (lobster.cash)               │
├─────────────────────────────────────────────────────────────┤
│  - Receives agent's public key via URL                      │
│  - Creates Crossmint smart wallet                           │
│  - Adds agent as delegated signer                           │
│  - Returns wallet address + API key to user                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Crossmint Smart Wallet                    │
├─────────────────────────────────────────────────────────────┤
│  - Deployed on Solana (devnet)                              │
│  - Agent's address registered as delegated signer           │
│  - User retains admin control                               │
│  - Holds SOL/USDC for purchases and transfers               │
└─────────────────────────────────────────────────────────────┘
```

## Security

- Private keys are stored locally on the agent's machine with secure file permissions (0600)
- Keys are never transmitted to Crossmint - only signatures
- Uses ed25519 cryptography (Solana native)
- API key is stored locally after user retrieves it from web app
- Users maintain admin control and can revoke delegation at any time
- The agent can only perform actions explicitly authorized through delegation

## Troubleshooting

**"No wallet found for agent"**
- Run `crossmint_setup` first to generate a keypair

**"Wallet not fully configured"**
- Complete the web setup flow at the delegation URL
- Run `crossmint_configure` with wallet address and API key from the web app

**"Failed to get balance" or "Failed to send"**
- Verify the API key is correct (should start with `ck_staging_`)
- Check that the wallet address matches the one shown in the web app
- Ensure the wallet has sufficient balance

**"Insufficient funds" (Amazon purchase)**
- Check balance with `crossmint_balance`
- Fund the wallet with more SOL or USDC
- For devnet testing, use Solana faucets for test SOL

**"Timeout waiting for transaction to be broadcast"**
- Check transaction status with `crossmint_tx_status`
- Solana network may be congested - wait and retry

## Plugin Management

```bash
# Install the plugin
openclaw plugins install @crossmint/openclaw-wallet

# Upgrade to latest version
openclaw plugins update @crossmint/openclaw-wallet

# List all plugins
openclaw plugins list

# Check plugin info (shows current version)
openclaw plugins info openclaw-wallet

# Enable/disable
openclaw plugins enable openclaw-wallet
openclaw plugins disable openclaw-wallet

# Uninstall
openclaw plugins uninstall openclaw-wallet
```

## Supported Currencies

| Currency | Token | Use Cases |
|----------|-------|-----------|
| SOL | Native Solana | Transfers, Amazon purchases |
| USDC | USD Coin | Transfers, Amazon purchases |
| SPL tokens | Any mint address | Transfers only |
