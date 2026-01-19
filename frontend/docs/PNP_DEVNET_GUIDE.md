# PNP SDK - Devnet Developer Guide

**For Solana Privacy Hack Hackathon Participants**

This guide walks you through creating and trading on prediction markets using the PNP SDK on Solana **devnet**.

---

## TL;DR - The Core Flow

```
1. Create Market → 2. Set Resolvable (TRUE) → 3. Trade → 4. Redeem
```

**Key Insight**: On devnet, YOU must call `setMarketResolvable(true)` to enable trading. On mainnet, the AI oracle does this automatically.

---

## Why Do I Need to "Set Resolvable"?

### The Problem
When you create a market, it starts in a **non-resolvable** state. This means:
- ❌ No one can trade on it yet
- ❌ YES/NO tokens aren't minted yet
- ❌ The market is essentially "pending activation"

### The Solution
- On **mainnet**, the AI oracle automatically reviews new markets and sets them as resolvable when they meet quality criteria.
- On **devnet**, there's no oracle watching. So **YOU** need to call `setMarketResolvable(true)` yourself!

### What Happens When You Set Resolvable = TRUE?
1. ✅ YES/NO token mints are created
2. ✅ Initial liquidity tokens are minted to the creator
3. ✅ Trading is now enabled
4. ✅ Anyone can buy/sell YES and NO tokens

---

## Complete Code Flow

### Step 1: Create a Market

```typescript
const createRes = await client.market.createMarket({
  question: "Will ETH hit $5000 by end of 2026?",
  initialLiquidity: BigInt(1_000_000), // 1 USDC (6 decimals)
  endTime: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60), // 7 days
  baseMint: COLLATERAL_MINT,
});

console.log("Market created:", createRes.market.toBase58());
// BUT resolvable = false, trading NOT enabled yet!
```

### Step 2: Set Market Resolvable (REQUIRED on Devnet!)

```typescript
const result = await client.setMarketResolvable(
  marketPk,    // The market address from Step 1
  true         // Set resolvable to TRUE
);

console.log("Market activated! TX:", result.signature);
// NOW resolvable = true, trading IS enabled!
```

### Step 3: Trade!

```typescript
const tradeResult = await client.trading.buyTokensUsdc({
  market: marketPk,
  buyYesToken: true,  // or false for NO tokens
  amountUsdc: 10,     // Amount of collateral to spend
});
```

### Step 4: Redeem After Resolution

```typescript
const redeemResult = await client.redemption.redeemPosition({
  market: marketPk,
});
```

---

## Environment Setup

Create a `.env` file:

```env
# Your devnet wallet (base58 encoded private key)
DEVNET_PRIVATE_KEY=your_base58_private_key_here

# RPC endpoint
RPC_URL=https://api.devnet.solana.com

# Devnet collateral token (PNP's devnet USDC)
DEVNET_COLLATERAL_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
```

---

## Market Types

### V2 AMM Markets
- Uses an Automated Market Maker (like Uniswap)
- Price adjusts based on supply/demand
- **Requires `setMarketResolvable(true)` before trading**

### V3 P2P Markets
- Peer-to-peer order matching
- Fixed prices set by makers
- Trading enabled immediately after creation

---

## Common Issues

### "Market not found" when trading
→ Check the market address is correct

### "Trading not enabled" or empty token mints (System Program placeholder)
→ **You forgot to call `setMarketResolvable(true)`!**

### "Only admin can call"
→ On devnet, anyone can call setMarketResolvable. Make sure you're on devnet RPC.

### "Insufficient balance"
→ Get devnet tokens from a faucet or create your own SPL token

---

## Network Comparison

| Feature | Devnet | Mainnet |
|---------|--------|---------|
| Program ID | `pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz` | `6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb` |
| Set Resolvable | **Manual (you call it)** | Automatic (AI oracle) |
| Settlement | Manual testing | AI oracle resolution |
| Tokens | No real value | Real value |
| Collateral | Devnet USDC: `Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr` | Real USDC |

---

## Useful Links

- [Solana Devnet Explorer](https://explorer.solana.com/?cluster=devnet)
- [Devnet USDC Faucet](https://faucet.circle.com/)
- [PNP SDK Documentation](https://docs.pnp.exchange/pnp-sdk)
