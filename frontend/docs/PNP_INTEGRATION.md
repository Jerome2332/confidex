# PNP Exchange SDK Integration

This document describes how Confidex integrates with [PNP Exchange](https://pnp.exchange) for prediction market functionality.

## Overview

PNP Exchange is a prediction market protocol on Solana. Confidex integrates PNP to offer prediction markets alongside its confidential DEX functionality.

**Key Features:**
- Browse and trade on 150+ active prediction markets
- Buy/sell YES and NO outcome tokens
- Real-time price calculations using Pythagorean bonding curve
- Mainnet USDC as collateral

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend UI   │────▶│  API Routes      │────▶│  PNP SDK        │
│   /predict      │     │  /api/pnp/*      │     │  (server-side)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                                                │
        │                                                ▼
        │                                        ┌─────────────────┐
        │                                        │  Solana Mainnet │
        │                                        │  PNP Program    │
        └───────────────────────────────────────▶│  6fnYZUSy...    │
                    (signed transactions)        └─────────────────┘
```

### Why Server-Side SDK?

The `pnp-sdk` package imports `Wallet` from `@coral-xyz/anchor`, which requires Node.js and doesn't work in browsers. Our solution:

1. **Server-side API routes** load the SDK via `require()` (bypassing webpack)
2. **Transaction building** happens server-side, returning unsigned transactions
3. **Client signs** with wallet adapter and sends to network

## File Structure

```
frontend/
├── src/
│   ├── app/api/pnp/
│   │   ├── markets/route.ts    # GET /api/pnp/markets - Fetch markets
│   │   ├── build-tx/route.ts   # POST /api/pnp/build-tx - Build transactions
│   │   └── create-market/      # POST /api/pnp/create-market - Create markets
│   ├── lib/
│   │   ├── pnp.ts              # Main PNP integration module
│   │   ├── pnp-client.ts       # Client-side helpers and price calculations
│   │   ├── pnp-types.ts        # TypeScript interfaces
│   │   └── constants.ts        # PNP network configuration
│   └── hooks/
│       └── use-predictions.ts  # React hook for prediction markets
└── docs/
    └── PNP_INTEGRATION.md      # This file
```

## Configuration

### Environment Variables

```bash
# .env.local

# Network: 'mainnet' (default) or 'devnet'
NEXT_PUBLIC_PNP_NETWORK=mainnet

# Optional: Custom mainnet RPC for better performance
NEXT_PUBLIC_PNP_MAINNET_RPC=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY
```

### Network Details

| Network | RPC | Collateral | Markets |
|---------|-----|------------|---------|
| **Mainnet** (default) | `api.mainnet-beta.solana.com` | USDC (`EPjFWdd5...`) | 150+ active |
| Devnet | `api.devnet.solana.com` | Custom token (`2KHoiT...`) | Limited |

**Note:** Mainnet is recommended as devnet uses a custom collateral token without a public faucet.

## API Endpoints

### GET /api/pnp/markets

Fetch active prediction markets.

**Query Parameters:**
- `limit` (optional): Max markets to return (default: 20)
- `id` (optional): Fetch specific market by pubkey

**Response:**
```json
{
  "success": true,
  "count": 20,
  "totalCount": 151,
  "markets": [
    {
      "id": "G6123Vr...",
      "question": "Will BTC reach $100k by March 2026?",
      "yesTokenMint": "...",
      "noTokenMint": "...",
      "collateralMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "yesTokenSupply": "1000000000",
      "noTokenSupply": "500000000",
      "endTime": 1740873600,
      "resolved": false
    }
  ]
}
```

### POST /api/pnp/build-tx

Build an unsigned transaction for buying or selling outcome tokens.

**Request Body:**
```json
{
  "action": "buy",
  "marketId": "G6123Vr...",
  "isYes": true,
  "amount": 10.0,
  "userPubkey": "YourWalletPubkey...",
  "minimumOut": 0
}
```

**Response:**
```json
{
  "success": true,
  "transaction": "base64-encoded-versioned-transaction",
  "blockhash": "...",
  "lastValidBlockHeight": 123456789,
  "message": "Buy YES tokens",
  "details": {
    "market": "G6123Vr...",
    "amount": 10.0,
    "amountBaseUnits": "10000000",
    "isYes": true
  }
}
```

### GET /api/pnp/build-tx (Health Check)

Check SDK availability and capabilities.

**Response:**
```json
{
  "service": "pnp-transaction-builder",
  "status": "ready",
  "sdkAvailable": true,
  "rpcUrl": "https://api.mainnet-beta.solana.com",
  "capabilities": ["build_buy_tx", "build_sell_tx", "balance_check"]
}
```

## Usage

### React Hook

```typescript
import { usePredictions } from '@/hooks/use-predictions';

function PredictPage() {
  const {
    markets,
    selectedMarket,
    selectMarket,
    buyTokens,
    sellTokens,
    isTransacting,
    lastError,
  } = usePredictions();

  const handleBuy = async () => {
    try {
      const result = await buyTokens('YES', 10.0); // Buy $10 of YES tokens
      console.log('Transaction:', result.signature);
    } catch (error) {
      console.error('Buy failed:', error);
    }
  };

  return (
    <div>
      {markets.map(market => (
        <MarketCard
          key={market.id.toBase58()}
          market={market}
          onSelect={() => selectMarket(market.id)}
        />
      ))}

      {selectedMarket && (
        <TradingPanel
          market={selectedMarket}
          onBuy={handleBuy}
          loading={isTransacting}
        />
      )}
    </div>
  );
}
```

### Direct API Usage

```typescript
import { buyOutcomeTokens, fetchActiveMarkets } from '@/lib/pnp';

// Fetch markets
const markets = await fetchActiveMarkets(connection, 20);

// Buy tokens (requires wallet adapter)
const result = await buyOutcomeTokens(
  connection,
  marketId,
  'YES',        // outcome
  10.0,         // USDC amount
  0.65,         // max price (slippage)
  walletAdapter
);
```

## Price Calculations

PNP uses a **Pythagorean bonding curve** for pricing. Prices are calculated from token supplies:

```typescript
// Price formula (prices sum to 1.0)
yesPrice = noSupply / (yesSupply + noSupply)
noPrice = yesSupply / (yesSupply + noSupply)

// Example: 1M YES tokens, 500K NO tokens
// yesPrice = 500000 / 1500000 = 0.33 (33%)
// noPrice = 1000000 / 1500000 = 0.67 (67%)
```

This is implemented in `pnp-client.ts`:

```typescript
export function calculatePythagoreanPrices(
  yesSupply: bigint,
  noSupply: bigint
): { yesPrice: number; noPrice: number } {
  const yes = Number(yesSupply);
  const no = Number(noSupply);

  if (yes === 0 && no === 0) {
    return { yesPrice: 0.5, noPrice: 0.5 };
  }

  const total = yes + no;
  return {
    yesPrice: no / total,
    noPrice: yes / total,
  };
}
```

## Transaction Flow

```
1. User clicks "Buy YES"
   │
2. Frontend calls buyOutcomeTokens()
   │
3. POST /api/pnp/build-tx
   │  - Server loads SDK
   │  - Fetches market data
   │  - Derives all PDAs and ATAs
   │  - Builds unsigned VersionedTransaction
   │  - Returns base64-encoded transaction
   │
4. Frontend deserializes transaction
   │
5. Wallet signs transaction
   │
6. Frontend sends to mainnet RPC
   │
7. Await confirmation
   │
8. Update UI with result
```

## Error Handling

Common errors and their meanings:

| Error | Cause | Solution |
|-------|-------|----------|
| `Insufficient USDC` | User doesn't have enough USDC | Need mainnet USDC in wallet |
| `SDK not available` | Server couldn't load pnp-sdk | Check server logs |
| `Market not found` | Invalid market ID | Verify market pubkey |
| `ConstraintMut` | Account mutability mismatch | Bug in account setup |

## PNP Program Details

- **Program ID:** `6fnYZUSyp3vJxTNnayq5S62d363EFaGARnqYux5bqrxb`
- **Instructions:**
  - `mint_decision_tokens` - Buy outcome tokens (discriminator: `[226, 180, 53, 125, 168, 69, 114, 25]`)
  - `burn_decision_tokens` - Sell outcome tokens (discriminator: `[18, 198, 214, 1, 236, 94, 63, 29]`)

## Dependencies

```json
{
  "pnp-sdk": "^0.2.3",
  "@coral-xyz/anchor": "^0.32.1",
  "@solana/web3.js": "^1.98.0",
  "@solana/spl-token": "^0.4.13"
}
```

## Troubleshooting

### Markets not loading

1. Check server logs for SDK loading errors
2. Verify `NEXT_PUBLIC_PNP_NETWORK` is set correctly
3. Test RPC connectivity: `curl https://api.mainnet-beta.solana.com -X POST -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`

### Transaction fails with "insufficient funds"

1. Verify you have mainnet USDC (not devnet)
2. Check the market's collateral mint matches USDC
3. Some markets use custom collateral tokens

### Wallet won't sign

1. Ensure wallet is connected
2. Check wallet supports VersionedTransaction
3. Verify wallet is on mainnet (for mainnet markets)

## Resources

- [PNP SDK Documentation](https://docs.pnp.exchange/pnp-sdk)
- [PNP Exchange](https://pnp.exchange)
- [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)
