# Liquidation Bot Infrastructure Plan

**Priority:** P1 (Required for perps launch)
**Status:** Planning complete, ready for implementation
**Estimated Effort:** 2 weeks

---

## Overview

Build a production-grade liquidation bot service for Confidex perpetual markets. The bot monitors positions with public liquidation thresholds, verifies liquidatability via Pyth oracle prices, and submits liquidation transactions to earn liquidation bonuses while maintaining protocol health.

---

## Key Design Principles

### Privacy Model (Hybrid Approach)

| Data Type | Visibility | Used For |
|-----------|------------|----------|
| **PUBLIC** | `liquidatable_below_price`, `liquidatable_above_price`, `threshold_verified` | Keeper discovery, bot scanning |
| **PRIVATE** | `encrypted_size`, `encrypted_collateral`, `encrypted_entry_price`, `encrypted_pnl` | MPC verification, settlement |

The bot only uses PUBLIC thresholds - actual position sizes and collateral remain encrypted.

### Double Verification

1. **Bot-side check:** Compare Pyth mark price against public thresholds
2. **On-chain check:** `position.is_liquidatable(mark_price)`
3. **MPC verification:** `check_liquidation_sync()` double-checks with encrypted data

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LIQUIDATION BOT SERVICE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐         │
│  │  Price Monitor  │    │ Position Scanner│    │  TX Executor    │         │
│  │  (Pyth Hermes)  │───▶│  (RPC Polling)  │───▶│  (Jito Bundles) │         │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘         │
│         │                       │                       │                   │
│         │   ┌───────────────────┴───────────────────┐   │                   │
│         │   │           Job Queue (Bull)            │   │                   │
│         │   │  - Liquidation jobs                   │   │                   │
│         │   │  - Retry with backoff                 │   │                   │
│         │   │  - Deduplication                      │   │                   │
│         │   └───────────────────────────────────────┘   │                   │
│         │                       │                       │                   │
│         ▼                       ▼                       ▼                   │
│  ┌─────────────────────────────────────────────────────────────────┐       │
│  │                     PostgreSQL + Prisma                          │       │
│  │  - Position cache (public fields only)                          │       │
│  │  - Liquidation attempts (success/fail/timing)                   │       │
│  │  - Performance metrics                                           │       │
│  └─────────────────────────────────────────────────────────────────┘       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Pyth Hermes    │    │   Solana RPC    │    │  Jito Block     │
│  (SSE Stream)   │    │   (Helius)      │    │  Engine         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

---

## Core Components

### 1. Price Monitor

Connects to Pyth Hermes SSE endpoint for real-time price updates.

```typescript
// Pattern from frontend/src/hooks/use-pyth-price.ts
const PYTH_HERMES_URL = 'https://hermes.pyth.network';
const PRICE_FEEDS = {
  'SOL/USD': '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  'ETH/USD': '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  'BTC/USD': '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
};
```

**Features:**
- SSE streaming with automatic reconnection
- Fallback to polling (10s interval) on stream failure
- Price staleness check (max 30s)
- Multi-feed subscription

### 2. Position Scanner

Polls on-chain position accounts and caches public fields.

```typescript
// Cached fields (PUBLIC only)
interface CachedPosition {
  positionAddress: string;
  trader: string;
  market: string;
  side: 'long' | 'short';
  liquidatableBelow: bigint;  // For longs
  liquidatableAbove: bigint;  // For shorts
  thresholdVerified: boolean;
  status: 'open' | 'liquidated' | 'closed';
}
```

**Scanning Strategy:**
- Poll every 5 seconds per market
- Use `getProgramAccounts` with filters:
  - `memcmp` on market pubkey
  - `memcmp` on status = Open
  - `memcmp` on threshold_verified = true

### 3. Liquidation Engine

Core logic for detecting and executing liquidations.

```typescript
async function checkAndQueueLiquidations(markPrice: bigint, market: string) {
  // 1. Query positions that might be liquidatable
  const positions = await prisma.cachedPositions.findMany({
    where: {
      market,
      status: 'open',
      threshold_verified: true,
      OR: [
        { side: 'long', liquidatable_below_price: { gte: markPrice } },
        { side: 'short', liquidatable_above_price: { lte: markPrice } },
      ],
    },
  });

  // 2. Queue each for liquidation
  for (const position of positions) {
    await liquidationQueue.add('liquidate', {
      positionAddress: position.position_address,
      markPrice: markPrice.toString(),
      thresholdPrice: position.side === 'long'
        ? position.liquidatable_below_price
        : position.liquidatable_above_price,
    }, {
      jobId: `liq-${position.position_address}`,  // Deduplication
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
    });
  }
}
```

### 4. Transaction Builder

Constructs liquidation transactions with proper accounts.

```typescript
async function buildLiquidateTx(
  position: CachedPosition,
  markPrice: bigint,
): Promise<Transaction> {
  const perpMarket = await fetchPerpMarket(position.market);

  return program.methods
    .liquidatePosition()
    .accounts({
      perpMarket: position.market,
      position: position.positionAddress,
      liquidationConfig: LIQUIDATION_CONFIG_PDA,
      oracle: perpMarket.oraclePriceFeed,
      collateralVault: perpMarket.collateralVault,
      insuranceFund: perpMarket.insuranceFund,
      liquidatorCollateralAccount: liquidatorAta,
      liquidator: liquidatorKeypair.publicKey,
      arciumProgram: ARCIUM_PROGRAM_ID,
    })
    .transaction();
}
```

### 5. Jito Client

MEV-protected transaction submission via Jito Block Engine.

```typescript
async function submitWithJito(tx: Transaction, tip: number): Promise<string> {
  const bundle = [
    tx,
    buildJitoTipIx(tip),
  ];

  const response = await fetch(`${JITO_BLOCK_ENGINE}/api/v1/bundles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'sendBundle',
      params: [bundle.map(tx => bs58.encode(tx.serialize()))],
    }),
  });

  return response.json().result;
}
```

---

## Implementation Phases

### Phase 1: Foundation (Days 1-3)

**Core Infrastructure:**
1. Create `backend/src/liquidation-bot/` directory structure
2. Set up PostgreSQL schema for position caching
3. Implement Pyth Hermes price streaming (reuse frontend pattern)
4. Build position scanner with RPC polling

**Deliverables:**
- Position cache populated from on-chain data
- Real-time price streaming from Pyth
- Basic liquidation detection (no execution yet)

### Phase 2: Liquidation Engine (Days 4-7)

**Core Logic:**
1. Implement Bull queue for liquidation jobs
2. Build transaction builder for liquidate instruction
3. Add retry logic with exponential backoff
4. Implement deduplication (don't liquidate twice)

**Deliverables:**
- Working liquidation queue
- Transaction building and submission
- Retry and error handling

### Phase 3: MEV Protection & Optimization (Days 8-10)

**Jito Integration:**
1. Add Jito bundle submission for MEV protection
2. Implement dynamic priority fee calculation
3. Add compute unit estimation
4. Batch multiple liquidations per block (if possible)

**Priority Fee Strategy:**
```typescript
interface FeeConfig {
  basePriorityFee: number;      // 10,000 microlamports
  maxPriorityFee: number;       // 1,000,000 microlamports
  profitMarginBps: number;      // 2000 (20% minimum profit)
  congestionMultiplier: number; // 1.5x during high activity
}

function calculatePriorityFee(
  estimatedBonus: bigint,
  config: FeeConfig
): number {
  // Ensure we're profitable after fees
  const maxFee = (estimatedBonus * BigInt(10000 - config.profitMarginBps)) / 10000n;
  const baseFee = BigInt(config.basePriorityFee);

  // Adjust for network congestion
  const adjustedFee = baseFee * BigInt(Math.floor(config.congestionMultiplier * 100)) / 100n;

  return Number(adjustedFee > maxFee ? maxFee : adjustedFee);
}
```

**Deliverables:**
- Jito bundle submission
- Dynamic fee calculation
- Profitability checks before submission

### Phase 4: Monitoring & Dashboard (Days 11-14)

**Monitoring:**
1. Prometheus metrics export
2. Alert rules for failures
3. Position health overview
4. Revenue tracking

**Metrics to Track:**
```typescript
const metrics = {
  // Activity
  liquidations_attempted: Counter,
  liquidations_successful: Counter,
  liquidations_failed: Counter,

  // Performance
  liquidation_latency_ms: Histogram,
  price_to_liquidation_delay_ms: Histogram,

  // Financial
  total_bonus_earned_lamports: Counter,
  total_gas_spent_lamports: Counter,
  net_profit_lamports: Gauge,

  // Health
  positions_at_risk: Gauge,
  positions_monitored: Gauge,
  price_feed_lag_ms: Gauge,
};
```

**Admin Dashboard Endpoints:**
- `GET /api/liquidation-bot/stats` - Overall statistics
- `GET /api/liquidation-bot/positions/at-risk` - Positions near liquidation
- `GET /api/liquidation-bot/attempts` - Recent liquidation attempts
- `POST /api/liquidation-bot/pause` - Emergency pause

**Deliverables:**
- Prometheus metrics
- Admin dashboard endpoints
- Alert configuration

---

## Database Schema

```sql
-- Cached positions (PUBLIC fields only)
CREATE TABLE cached_positions (
    position_address TEXT PRIMARY KEY,
    trader TEXT NOT NULL,
    market TEXT NOT NULL,
    side TEXT NOT NULL,  -- 'long' | 'short'
    liquidatable_below_price BIGINT,
    liquidatable_above_price BIGINT,
    threshold_verified BOOLEAN DEFAULT false,
    status TEXT NOT NULL,  -- 'open' | 'liquidated' | 'closed'
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Liquidation attempts
CREATE TABLE liquidation_attempts (
    id SERIAL PRIMARY KEY,
    position_address TEXT NOT NULL,
    mark_price BIGINT NOT NULL,
    threshold_price BIGINT NOT NULL,
    tx_signature TEXT,
    status TEXT NOT NULL,  -- 'pending' | 'success' | 'failed' | 'already_liquidated'
    error_message TEXT,
    gas_used BIGINT,
    priority_fee_lamports BIGINT,
    bonus_earned_lamports BIGINT,
    attempted_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_positions_market ON cached_positions(market);
CREATE INDEX idx_positions_status ON cached_positions(status);
CREATE INDEX idx_attempts_position ON liquidation_attempts(position_address);
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `backend/src/liquidation-bot/index.ts` | Main entry point, service orchestration |
| `backend/src/liquidation-bot/price-monitor.ts` | Pyth Hermes SSE streaming |
| `backend/src/liquidation-bot/position-scanner.ts` | RPC polling, position caching |
| `backend/src/liquidation-bot/liquidation-engine.ts` | Core liquidation logic |
| `backend/src/liquidation-bot/tx-builder.ts` | Transaction construction |
| `backend/src/liquidation-bot/jito-client.ts` | Jito bundle submission |
| `backend/src/liquidation-bot/queue.ts` | Bull queue setup |
| `backend/src/liquidation-bot/metrics.ts` | Prometheus metrics |
| `backend/src/liquidation-bot/config.ts` | Configuration management |
| `prisma/migrations/xxx_liquidation_bot.sql` | Database schema |

---

## Files to Modify

| File | Change |
|------|--------|
| `backend/package.json` | Add bull, ioredis, prom-client dependencies |
| `backend/src/index.ts` | Add liquidation bot routes |
| `backend/prisma/schema.prisma` | Add CachedPosition, LiquidationAttempt models |
| `programs/confidex_dex/src/instructions/perp_liquidate.rs` | Complete Pyth oracle integration |

---

## On-Chain Integration Required

The current `perp_liquidate.rs` has a TODO for oracle integration:

```rust
// programs/confidex_dex/src/instructions/perp_liquidate.rs:80-83
// TODO: Get current mark price from Pyth oracle
// For now, we'll use a placeholder - in production this would be:
// let mark_price = get_pyth_price(&ctx.accounts.oracle)?;
let mark_price: u64 = 0; // Placeholder - oracle integration needed
```

**Tasks:**
1. Add Pyth SDK dependency to Anchor program
2. Implement `get_pyth_price()` function
3. Parse Pyth price account data on-chain
4. Add staleness check (reject if price > 30s old)

---

## Configuration

```typescript
// backend/src/liquidation-bot/config.ts
export interface LiquidationBotConfig {
  // RPC
  rpcUrl: string;
  heliusApiKey: string;

  // Pyth
  pythHermesUrl: string;  // 'https://hermes.pyth.network'
  priceFeeds: string[];   // ['SOL/USD', 'ETH/USD', ...]
  maxPriceStalenessMs: number;  // 30000

  // Scanning
  positionPollIntervalMs: number;  // 5000
  marketsToMonitor: string[];

  // Execution
  liquidatorKeypair: string;  // Base58 or path
  priorityFeeLamports: number;
  maxRetries: number;

  // Jito
  jitoBlockEngineUrl: string;
  jitoTipLamports: number;

  // Safety
  minProfitLamports: number;  // Don't liquidate if unprofitable
  emergencyPauseEnabled: boolean;
}
```

---

## Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Runtime | Node.js 20+ | Already used in backend |
| Queue | Bull + Redis | Reliable job processing, retries |
| Database | PostgreSQL + Prisma | Already in backend stack |
| Price Feed | Pyth Hermes SSE | Already implemented in frontend |
| MEV Protection | Jito Block Engine | Best-in-class for Solana |
| Metrics | Prometheus | Industry standard |
| Alerts | Grafana/PagerDuty | Integrates with Prometheus |

---

## Verification Plan

### Unit Tests
- Position filtering logic (long vs short thresholds)
- Priority fee calculation
- Profitability checks

### Integration Tests
1. Create test position on devnet
2. Update position to be underwater
3. Verify bot detects and queues liquidation
4. Verify transaction succeeds
5. Verify bonus received

### Manual Testing Checklist
- [ ] Bot connects to Pyth Hermes stream
- [ ] Bot polls and caches positions
- [ ] Bot detects liquidatable position
- [ ] Bot submits transaction successfully
- [ ] Bot handles already-liquidated gracefully
- [ ] Bot recovers from RPC failures
- [ ] Metrics appear in Prometheus
- [ ] Admin endpoints work

---

## Risk Considerations

| Risk | Mitigation |
|------|------------|
| Race condition (other liquidators) | Check tx result, don't retry if already liquidated |
| Stale prices | Staleness check in bot + on-chain validation |
| RPC rate limits | Use Helius with high limits, exponential backoff |
| Bot wallet drained | Monitor balance, alert on low funds |
| Network congestion | Dynamic priority fees, Jito bundles |

---

## References

- [FUTURE_IMPLEMENTATIONS.md](./FUTURE_IMPLEMENTATIONS.md) - Roadmap context
- [ARCIUM_MPC_INTEGRATION.md](./ARCIUM_MPC_INTEGRATION.md) - MPC architecture
- [perp_liquidate.rs](../programs/confidex_dex/src/instructions/perp_liquidate.rs) - On-chain liquidation instruction
- [position.rs](../programs/confidex_dex/src/state/position.rs) - Position state with public thresholds
- [use-pyth-price.ts](../frontend/src/hooks/use-pyth-price.ts) - Frontend Pyth integration pattern
