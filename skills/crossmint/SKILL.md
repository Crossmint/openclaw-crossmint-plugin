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

This generates a local ed25519 keypair and returns a delegation URL pointing to `https://www.lobster.cash/configure?pubkey=<agent-public-key>`.

### Step 2: User completes web setup

The user opens the delegation URL in their browser. The web app (lobster.cash) will:
1. Create a Crossmint smart wallet on Solana devnet
2. Add the agent's public key as a delegated signer
3. Display the **wallet address** and **API key** for the user to copy

### Step 3: Configure the agent

```
User: "My wallet address is X and API key is Y"
Agent: Use crossmint_configure with walletAddress and apiKey
```

Now the wallet is ready to use for balance checks, transfers, and Amazon purchases.

## Common Operations

### Check balance

```
User: "What's my wallet balance?"
Agent: Use crossmint_balance
```

Returns SOL, USDC, and other token balances on the smart wallet.

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

### How It Works (Under the Hood)

When you use `crossmint_buy`, the plugin executes a 6-step delegated signer flow:

1. **Create Order** - Crossmint creates an Amazon order and returns a payment transaction
2. **Create Transaction** - The serialized transaction is submitted to Crossmint's wallet API
3. **Sign Approval** - The agent signs an approval message locally using ed25519
4. **Submit Approval** - The signed approval is sent to Crossmint
5. **Wait for Broadcast** - Poll until the transaction is confirmed on-chain
6. **Confirm Payment** - Submit the on-chain transaction ID to complete the order

The entire flow happens automatically - the agent handles all signing and API calls.

### Buy a product

```
User: "Buy me this Amazon product: B00O79SKV6"
Agent: Use crossmint_buy with product ASIN and shipping address
```

Required information:
- Amazon product ASIN or URL
- Recipient email (for order confirmation)
- Full shipping address (name, street, city, postal code, country)

### Successful Purchase Response

When a purchase completes successfully, you'll receive:
- **Order ID** - Use with `crossmint_order_status` to track delivery
- **Transaction Explorer Link** - Solana explorer URL to verify the payment on-chain
- **Payment Status** - Confirms payment was processed
- **Product Details** - Title and price of the purchased item

Example response:
```
✅ Purchase complete!

Product: AmazonBasics USB Cable
Price: 0.05 SOL
Order ID: order_abc123
Payment: completed

Transaction: https://explorer.solana.com/tx/5x...?cluster=devnet

Shipping to:
John Doe
123 Main St
New York, NY 10001
US

Use crossmint_order_status to check delivery status.
```

### Check order status

```
User: "What's the status of my order?"
Agent: Use crossmint_order_status with the order ID
```

Returns:
- Order phase (quote, payment, delivery, completed)
- Payment status
- Delivery status
- Tracking information (when available)

### Amazon Product Locator Formats

All of these formats work:
- ASIN only: `B00O79SKV6`
- Full URL: `https://www.amazon.com/dp/B00O79SKV6`
- With amazon: prefix: `amazon:B00O79SKV6`

### Amazon Order Restrictions

Orders may fail if:
- Item not sold by Amazon or verified seller
- Item requires special shipping (hazmat, oversized)
- Item is digital (ebooks, software, music, etc.)
- Item is from Amazon Fresh, Pantry, Pharmacy, or Subscribe & Save
- Item is out of stock or unavailable for shipping to the address

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
  "state": "optional - state/province code (e.g., 'CA', 'NY')",
  "postalCode": "required",
  "country": "required - ISO country code (e.g., 'US')",
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
2. Ask user to complete web setup at the URL
3. Use crossmint_configure with the wallet address and API key from the web app
```

### "Failed to get balance" or "Failed to send"

- Verify the API key is correct (should start with `ck_staging_` for devnet)
- Check wallet address matches the one shown in the web app
- Ensure sufficient balance for transfers

### "Insufficient funds" (Amazon purchase)

The wallet doesn't have enough SOL or USDC for the purchase.

```
Agent:
1. Use crossmint_balance to check current balance
2. Ask user to fund the wallet with more SOL/USDC
3. For devnet testing, use Solana faucets to get test SOL
```

### "Order created but no serialized transaction returned"

The order was created but payment couldn't be prepared. This usually means:
- Product is unavailable or restricted
- Shipping address is invalid
- Price changed during checkout

### "Timeout waiting for transaction to be broadcast"

The transaction was signed but didn't confirm on-chain within 30 seconds.

```
Agent:
1. Use crossmint_tx_status to check the transaction status
2. If still pending, wait longer or retry
3. Check Solana network status for congestion
```

## Security Notes

- Private keys are stored locally at `~/.openclaw/crossmint-wallets/`
- Keys never leave the agent's machine - only signatures are sent to Crossmint
- Uses ed25519 cryptography (Solana native)
- Users retain admin control and can revoke delegation anytime via the Crossmint dashboard
- Always verify recipient addresses before sending
- The API key grants limited permissions - only what the user authorized during delegation

## Best Practices

1. **Always check balance before purchasing** - Avoid failed transactions due to insufficient funds
2. **Confirm shipping address with user** - Double-check addresses for Amazon purchases
3. **Get devnet tokens for testing** - Use Solana devnet faucets to get test SOL before trying purchases
4. **One wallet per agent** - Each agent ID gets its own keypair and wallet
5. **Save the order ID** - Users should note the order ID to track delivery status later
6. **Verify on-chain** - The explorer link lets users verify the payment transaction on Solana

## Supported Currencies

For Amazon purchases:
- **SOL** - Native Solana token
- **USDC** - USD Coin stablecoin on Solana

For transfers:
- **SOL** - Native Solana token
- **USDC** - USD Coin stablecoin
- **Any SPL token** - Specify the token mint address
