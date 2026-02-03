# Crossmint Wallet Plugin

Solana wallet integration for OpenClaw agents using Crossmint smart wallets with delegated signing.

## Overview

This plugin enables OpenClaw agents to:
- Generate and manage local Solana signing keys (ed25519)
- Use Crossmint smart wallets on Solana
- Check wallet balances (SOL, USDC, SPL tokens)
- Send tokens to other addresses

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

### Setting Up a Wallet (2-Step Process)

**Step 1: Generate keypair and get delegation URL**

Ask the agent: "Set up my Crossmint wallet"

The agent will:
1. Generate a local Solana keypair (ed25519)
2. Provide a URL with the public key for delegation setup

**Step 2: Complete setup on the web app**

1. Open the delegation URL in your browser
2. The web app will:
   - Create a Crossmint smart wallet
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
│                  Delegation Web App (external)               │
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
│  - Deployed on Solana                                       │
│  - Agent's address registered as delegated signer           │
│  - User retains admin control                               │
└─────────────────────────────────────────────────────────────┘
```

## Security

- Private keys are stored locally on the agent's machine with secure file permissions
- Keys are never transmitted to Crossmint
- Uses ed25519 cryptography (Solana native)
- API key is stored locally after user retrieves it from web app
- Users maintain admin control and can revoke delegation at any time
- The agent can only perform actions explicitly authorized through delegation

## Troubleshooting

**"No wallet found for agent"**
- Run `crossmint_setup` first to generate a keypair

**"Wallet not fully configured"**
- Complete the web setup flow and run `crossmint_configure` with wallet address and API key

**"Failed to get balance" or "Failed to send"**
- Verify the API key is correct
- Check that the wallet address matches the one shown in the web app
- Ensure the wallet has sufficient balance

## Plugin Management

```bash
# List all plugins
openclaw plugins list

# Check plugin info
openclaw plugins info openclaw-wallet

# Enable/disable
openclaw plugins enable openclaw-wallet
openclaw plugins disable openclaw-wallet
```
