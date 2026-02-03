---
name: crossmint
description: Use when the user wants to manage Solana wallets, check crypto balances, send tokens (SOL, USDC), buy products from Amazon with crypto, or set up Crossmint smart wallet delegation. Activate on wallet setup, balance checks, token transfers, Amazon purchases, or Crossmint mentions.
metadata: { "openclaw": { "emoji": "💳" } }
---

# Crossmint Wallet

Manage Solana wallets using Crossmint smart wallets with delegated signing. The agent holds a local signing key, and users authorize it via a web-based delegation flow.

> **Note:** Currently only **Solana devnet** (staging environment) is supported. Mainnet/production support coming soon.

## When to Activate

Use this skill when the user:

- Wants to set up a crypto/Solana wallet
- Asks about wallet balance (SOL, USDC, tokens)
- Wants to send tokens to someone
- Wants to buy something from Amazon with crypto
- Mentions Crossmint or smart wallets
- Asks about wallet delegation or signing

## Tools Overview

| Tool | Purpose |
|------|---------|
| `crossmint_setup` | Generate local keypair, get delegation URL |
| `crossmint_configure` | Save wallet address + API key after web setup |
| `crossmint_balance` | Check SOL, USDC, and token balances |
| `crossmint_send` | Send tokens to another address (supports wait for confirmation) |
| `crossmint_tx_status` | Check transaction status or wait for completion |
| `crossmint_wallet_info` | Get detailed wallet information |
| `crossmint_buy` | Buy products from Amazon with SOL or USDC |
| `crossmint_order_status` | Check Amazon order/delivery status |

## Setup Workflow (First Time)

### Step 1: Generate keypair

```
User: "Set up my Crossmint wallet"
Agent: Use crossmint_setup
```

This generates a local ed25519 keypair and returns a delegation URL.

### Step 2: User completes web setup

The user opens the delegation URL in their browser. The web app will:
1. Create a Crossmint smart wallet
2. Add the agent's public key as a delegated signer
3. Display the **wallet address** and **API key**

### Step 3: Configure the agent

```
User: "My wallet address is X and API key is Y"
Agent: Use crossmint_configure with walletAddress and apiKey
```

Now the wallet is ready to use.

## Common Operations

### Check balance

```
User: "What's my wallet balance?"
Agent: Use crossmint_balance
```

Returns SOL, USDC, and other token balances.

### Send tokens

```
User: "Send 10 USDC to <address>"
Agent: Use crossmint_send with to, amount, token="usdc"
```

```
User: "Send 0.1 SOL to <address> and wait for confirmation"
Agent: Use crossmint_send with to, amount, token="sol", wait=true
```

Supported tokens:
- `sol` - Native SOL
- `usdc` - USDC stablecoin
- Any SPL token address

### Check transaction status

```
User: "What's the status of transaction abc-123?"
Agent: Use crossmint_tx_status with transactionId="abc-123"
```

```
User: "Wait for transaction abc-123 to complete"
Agent: Use crossmint_tx_status with transactionId="abc-123", wait=true
```

### Get wallet info

```
User: "Show my wallet details"
Agent: Use crossmint_wallet_info
```

## Amazon Purchases

Buy products from Amazon using SOL or USDC from the agent's wallet. Crossmint acts as Merchant of Record, handling payments, shipping, and taxes.

### Buy a product

```
User: "Buy me this Amazon product: B00O79SKV6"
Agent: Use crossmint_buy with product ASIN and shipping address
```

Required information:
- Amazon product ASIN or URL
- Recipient email
- Full shipping address (name, street, city, postal code, country)

### Check order status

```
User: "What's the status of my order?"
Agent: Use crossmint_order_status with the order ID
```

### Amazon Product Locator Formats

- ASIN: `B00O79SKV6`
- Full URL: `https://www.amazon.com/dp/B00O79SKV6`

### Amazon Order Restrictions

Orders may fail if:
- Item not sold by Amazon or verified seller
- Item requires special shipping
- Item is digital (ebooks, software, etc.)
- Item is from Amazon Fresh, Pantry, Pharmacy, or Subscribe & Save

## Tool Parameters

### crossmint_setup

```json
{
  "agentId": "optional - defaults to current agent"
}
```

### crossmint_configure

```json
{
  "walletAddress": "required - smart wallet address from web app",
  "apiKey": "required - API key from web app",
  "agentId": "optional"
}
```

### crossmint_balance

```json
{
  "agentId": "optional"
}
```

### crossmint_send

```json
{
  "to": "required - recipient Solana address or email locator",
  "amount": "required - e.g., '10', '0.5'",
  "token": "optional - 'sol', 'usdc', or SPL address (default: 'usdc')",
  "wait": "optional - if true, wait for confirmation (default: false)",
  "timeoutMs": "optional - max wait time in ms (default: 60000)",
  "agentId": "optional"
}
```

### crossmint_tx_status

```json
{
  "transactionId": "required - transaction ID from crossmint_send",
  "wait": "optional - if true, wait for terminal state (default: false)",
  "timeoutMs": "optional - max wait time in ms (default: 60000)",
  "agentId": "optional"
}
```

### crossmint_wallet_info

```json
{
  "agentId": "optional"
}
```

### crossmint_buy

```json
{
  "productId": "required - Amazon ASIN or URL",
  "recipientEmail": "required - for order confirmation",
  "recipientName": "required - full name for shipping",
  "addressLine1": "required - street address",
  "addressLine2": "optional - apt, suite, etc.",
  "city": "required",
  "state": "optional - state/province code",
  "postalCode": "required",
  "country": "required - e.g., 'US'",
  "currency": "optional - 'sol' or 'usdc' (default: 'usdc')",
  "agentId": "optional"
}
```

### crossmint_order_status

```json
{
  "orderId": "required - from crossmint_buy response",
  "agentId": "optional"
}
```

## Troubleshooting

### "No wallet found for agent"

The user hasn't run setup yet.

```
Agent: Use crossmint_setup first to generate a keypair
```

### "Wallet not fully configured"

Keypair exists but web setup wasn't completed.

```
Agent:
1. Use crossmint_wallet_info to get the delegation URL
2. Ask user to complete web setup
3. Use crossmint_configure with the wallet address and API key
```

### "Failed to get balance" or "Failed to send"

- Verify the API key is correct
- Check wallet address matches the web app
- Ensure sufficient balance for transfers

## Security Notes

- Private keys are stored locally at `~/.openclaw/crossmint-wallets/`
- Keys never leave the agent's machine
- Uses ed25519 cryptography (Solana native)
- Users retain admin control and can revoke delegation anytime
- Always verify recipient addresses before sending

## Best Practices

1. **Always check balance before sending** - Avoid failed transactions
2. **Confirm recipient with user** - Double-check addresses for large transfers
3. **Get devnet tokens for testing** - Use Solana devnet faucets to get test SOL
4. **One wallet per agent** - Each agent ID gets its own keypair
