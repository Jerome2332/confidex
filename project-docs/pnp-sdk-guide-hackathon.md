# 🚀 PNP SDK - Devnet Developer Guide

**For Solana Privacy Hack Hackathon Participants**

Welcome! This guide walks you through creating and trading on prediction markets using the PNP SDK on Solana **devnet**. Perfect for building and testing your hackathon project!

---

## 📌 TL;DR - The Core Flow

```
1. Create Market → 2. Set Resolvable (TRUE) → 3. Trade → 4. Redeem
```

**Key Insight**: On devnet, YOU must call `setMarketResolvable(true)` to enable trading. On mainnet, our AI oracle does this automatically.

---

## 🔑 Why Do I Need to "Set Resolvable"?

### The Problem
When you create a market, it starts in a **non-resolvable** state. This means:
- ❌ No one can trade on it yet
- ❌ YES/NO tokens aren't minted yet
- ❌ The market is essentially "pending activation"

### The Solution
On **mainnet**, our AI oracle automatically reviews new markets and sets them as resolvable when they meet quality criteria.

On **devnet**, there's no oracle watching. So **YOU** need to call `setMarketResolvable(true)` yourself!

### What Happens When You Set Resolvable = TRUE?
1. ✅ YES/NO token mints are created
2. ✅ Initial liquidity tokens are minted to the creator
3. ✅ Trading is now enabled
4. ✅ Anyone can buy/sell YES and NO tokens

---

## 🏗️ Complete Code Flow

### Step 1: Create a Market

```typescript
// createMarket.ts creates a V2 AMM market
// The market starts with resolvable = FALSE

const createRes = await client.market.createMarket({
  question: "Will ETH hit $5000 by end of 2026?",
  initialLiquidity: BigInt(1_000_000), // 1 USDC (6 decimals)
  endTime: BigInt(Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60), // 7 days
  baseMint: COLLATERAL_MINT,
});

console.log("Market created:", createRes.market.toBase58());
// Market Address: 9ABC...xyz
// BUT resolvable = false, trading NOT enabled yet!
```

### Step 2: Set Market Resolvable (REQUIRED!)

```typescript
// setMarketResolvableTrue.ts enables trading

const result = await client.setMarketResolvable(
  marketPk,    // The market address from Step 1
  true         // Set resolvable to TRUE
);

console.log("Market activated! TX:", result.signature);
// NOW resolvable = true, trading IS enabled!
```

### Step 3: Trade!

```typescript
// Now anyone can buy YES or NO tokens

const tradeResult = await client.trading.buyTokensUsdc({
  market: marketPk,
  buyYesToken: true,  // or false for NO tokens
  amountUsdc: 10,     // Amount of collateral to spend
});
```

### Step 4: Redeem After Resolution

```typescript
// After market end time + resolution, redeem winning tokens

const redeemResult = await client.redemption.redeemPosition({
  market: marketPk,
});
```

---

---

## 🎯 Quick Start Guide

### 1. Setup Environment

Create a `.env` file in the project root:

```env
# Your devnet wallet (base58 encoded private key)
DEVNET_PRIVATE_KEY=your_base58_private_key_here

# Alternative name (also works)
TEST_PRIVATE_KEY=your_base58_private_key_here


# Optional: Custom RPC
RPC_URL=https://api.devnet.solana.com

# Optional: Custom collateral token
DEVNET_COLLATERAL_MINT=Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr
```

### 2. Get Devnet SOL & Tokens

```bash
# Airdrop devnet SOL
solana airdrop 2 <YOUR_WALLET_ADDRESS> --url devnet

# For collateral tokens, use devnet USDC faucet or create your own SPL token
```

### 3. Build the SDK

```bash
npm install
npm run build
```

### 4. Run the Full Flow

---

## 🔧 Programmatic Usage

If you're building your own scripts:

```typescript
import { PNPClient } from 'pnp-sdk';
import { PublicKey } from '@solana/web3.js';

// Initialize client (auto-detects devnet from RPC URL)
const client = new PNPClient(
  'https://api.devnet.solana.com',
  'your_private_key_base58'
);

// Verify we're on devnet
console.log('Is Devnet:', client.client.isDevnet); // true
console.log('Program:', client.client.programId.toBase58());
// Output: pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz

async function createAndTradeMarket() {
  // 1. Create market
  const { market, signature } = await client.market.createMarket({
    question: "Will my hackathon project win?",
    initialLiquidity: BigInt(1_000_000),
    endTime: BigInt(Math.floor(Date.now() / 1000) + 3600), // 1 hour
    baseMint: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'),
  });
  console.log('Market created:', market.toBase58());

  // 2. Enable trading (REQUIRED on devnet!)
  await client.setMarketResolvable(market, true);
  console.log('Trading enabled!');

  // 3. Now trade
  const trade = await client.trading.buyTokensUsdc({
    market,
    buyYesToken: true,
    amountUsdc: 5,
  });
  console.log('Trade executed:', trade.signature);
}
```

---

## 📊 Market Types

### V2 AMM Markets
- Uses an Automated Market Maker (like Uniswap)
- Price adjusts based on supply/demand
- Create with `createMarket.ts`
- **Requires `setMarketResolvable(true)` before trading**

### V3 P2P Markets
- Peer-to-peer order matching
- Fixed prices set by makers
- Create with `createP2PMarket.ts`
- Trading enabled immediately after creation

---

## ⚠️ Common Issues

### "Market not found" when trading
→ Check the market address is correct

### "Trading not enabled" or empty token mints
→ **You forgot to call `setMarketResolvable(true)`!**

### "Only admin can call"
→ On devnet, anyone can call setMarketResolvable. Make sure you're on devnet RPC.

### "Insufficient balance"
→ Get devnet tokens from a faucet or create your own SPL token

### Module not found errors
→ Run `npm run build` first

---

## 🌐 Network Comparison

| Feature | Devnet | Mainnet |
|---------|--------|---------|
| Program ID | `pnpkv2qnh4bfpGvTugGDSEhvZC7DP4pVxTuDykV3BGz` | `6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb` |
| Set Resolvable | **Manual (you call it)** | Automatic (AI oracle) |
| Settlement | Manual testing | AI oracle resolution |
| Tokens | No value | Real value |

---

## 🔗 Useful Links

- [Solana Devnet Explorer](https://explorer.solana.com/?cluster=devnet)
- [Devnet USDC Faucet](https://faucet.circle.com/)
- [SDK Documentation](../../DOCUMENTATION.md)
- [API Reference](../../API_REFERENCE.md)

---

## 💡 Pro Tips for Hackathon

1. **Short End Times**: Set `DEVNET_DAYS_UNTIL_END=0.01` (about 15 minutes) for quick testing

2. **Check Market Status**: Use `getMarketInfo.ts` to verify resolvable=true before trading ( ask if u need this )

3. **Use Environment Variables**: Keep your keys in `.env`, not in code

4. **Test P2P Markets Too**: V3 markets don't need setResolvable - faster iteration

5. **Watch the Logs**: Transaction logs often tell you exactly what's wrong

---

Good luck with your privacy hackathon project! 🏆

If you have issues, check the program logs in the Solana Explorer for detailed error messages.
