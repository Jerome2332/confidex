# Liquidation Bot Infrastructure Plan

**Priority:** P1 (Required for perps launch)
**Status:** Core Infrastructure Complete (January 2026)
**Estimated Effort:** 2 weeks
**Last Updated:** January 24, 2026

---

## Implementation Status

| Component | Status | Files |
|-----------|--------|-------|
| **Pyth Hermes Client** | ✅ Complete | `backend/src/prices/pyth-hermes-client.ts` |
| **Price Cache** | ✅ Complete | `backend/src/prices/price-cache.ts` |
| **Price Config** | ✅ Complete | `backend/src/prices/config.ts` |
| **BullMQ Queue** | ✅ Complete | `backend/src/queues/liquidation-queue.ts` |
| **Queue Manager** | ✅ Complete | `backend/src/queues/queue-manager.ts` |
| **Jito Client** | ✅ Complete | `backend/src/jito/jito-client.ts` |
| **Bundle Builder** | ✅ Complete | `backend/src/jito/bundle-builder.ts` |
| **Jito Config** | ✅ Complete | `backend/src/jito/config.ts` |
| **WebSocket Streaming** | ✅ Complete | `backend/src/streaming/` |
| **Liquidation Checker** | ✅ Enhanced | `backend/src/crank/liquidation-checker.ts` |
| **PostgreSQL Schema** | 🔲 Pending | Position caching tables |
| **Prometheus Metrics** | 🔲 Pending | Metrics export |
| **Admin Dashboard** | 🔲 Pending | Frontend monitoring pages |
| **On-chain Pyth Integration** | 🔲 Pending | `perp_liquidate.rs` TODO |

### Implemented Features

| Feature | Description |
|---------|-------------|
| **SSE Price Streaming** | Real-time Pyth Hermes connection with auto-reconnect |
| **Price Staleness Detection** | Configurable threshold (default 30s) |
| **Job Deduplication** | Prevent duplicate liquidation attempts |
| **Exponential Backoff** | Retry with increasing delays |
| **Jito Bundle Submission** | MEV-protected transaction submission |
| **Tip Instructions** | Automatic tip calculation and inclusion |
| **WebSocket Broadcasting** | Real-time liquidation event streaming |

### Environment Variables Added

```bash
# Pyth Oracle
PYTH_HERMES_URL=https://hermes.pyth.network
PYTH_STALENESS_THRESHOLD_MS=30000
SOL_USD_FEED_ID=ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
BTC_USD_FEED_ID=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
ETH_USD_FEED_ID=ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

# Job Queue (Redis)
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379

# Jito MEV Protection
JITO_ENABLED=false  # Set true for mainnet
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_LAMPORTS=10000
JITO_SUBMISSION_TIMEOUT_MS=30000
JITO_POLL_TIMEOUT_MS=60000
```

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

### Phase 1: Foundation (Days 1-3) - ✅ COMPLETE

**Core Infrastructure:**
1. [x] Create `backend/src/prices/` directory structure
2. [x] Implement Pyth Hermes price streaming (`pyth-hermes-client.ts`)
3. [x] Build price cache with staleness detection (`price-cache.ts`)
4. [x] Configure price feeds (`config.ts`)
5. [ ] Set up PostgreSQL schema for position caching

**Completed Files:**
- `backend/src/prices/pyth-hermes-client.ts` - SSE streaming client
- `backend/src/prices/price-cache.ts` - In-memory cache with TTL
- `backend/src/prices/config.ts` - Feed configuration
- `backend/src/prices/types.ts` - Type definitions
- `backend/src/prices/index.ts` - Module exports

**Deliverables:**
- [x] Real-time price streaming from Pyth
- [ ] Position cache populated from on-chain data
- [ ] Basic liquidation detection (no execution yet)

### Phase 2: Liquidation Engine (Days 4-7) - ✅ COMPLETE

**Core Logic:**
1. [x] Implement BullMQ queue for liquidation jobs (`liquidation-queue.ts`)
2. [x] Build queue manager (`queue-manager.ts`)
3. [x] Add retry logic with exponential backoff
4. [x] Implement deduplication (jobId-based)
5. [ ] Build transaction builder for liquidate instruction

**Completed Files:**
- `backend/src/queues/queue-manager.ts` - BullMQ connection management
- `backend/src/queues/liquidation-queue.ts` - Job processor with retry
- `backend/src/queues/config.ts` - Queue configuration
- `backend/src/queues/types.ts` - Job type definitions
- `backend/src/queues/index.ts` - Module exports

**Deliverables:**
- [x] Working liquidation queue
- [x] Retry and error handling
- [ ] Transaction building and submission

### Phase 3: MEV Protection & Optimization (Days 8-10) - ✅ COMPLETE

**Jito Integration:**
1. [x] Add Jito bundle submission for MEV protection (`jito-client.ts`)
2. [x] Build bundle construction utilities (`bundle-builder.ts`)
3. [x] Implement tip instruction generation
4. [ ] Implement dynamic priority fee calculation
5. [ ] Add compute unit estimation
6. [ ] Batch multiple liquidations per block (if possible)

**Completed Files:**
- `backend/src/jito/jito-client.ts` - Block Engine client
- `backend/src/jito/bundle-builder.ts` - Transaction bundling
- `backend/src/jito/config.ts` - Jito configuration
- `backend/src/jito/index.ts` - Module exports

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
- [x] Jito bundle submission
- [ ] Dynamic fee calculation
- [ ] Profitability checks before submission

### Phase 4: Monitoring & Dashboard (Days 11-14) - PENDING

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

## Files Created

| File | Status | Purpose |
|------|--------|---------|
| `backend/src/prices/index.ts` | ✅ | Module exports |
| `backend/src/prices/pyth-hermes-client.ts` | ✅ | Pyth Hermes SSE streaming |
| `backend/src/prices/price-cache.ts` | ✅ | In-memory price cache |
| `backend/src/prices/config.ts` | ✅ | Price feed configuration |
| `backend/src/prices/types.ts` | ✅ | Type definitions |
| `backend/src/queues/index.ts` | ✅ | Module exports |
| `backend/src/queues/queue-manager.ts` | ✅ | BullMQ setup |
| `backend/src/queues/liquidation-queue.ts` | ✅ | Liquidation job processor |
| `backend/src/queues/config.ts` | ✅ | Queue configuration |
| `backend/src/queues/types.ts` | ✅ | Job type definitions |
| `backend/src/jito/index.ts` | ✅ | Module exports |
| `backend/src/jito/jito-client.ts` | ✅ | Jito bundle submission |
| `backend/src/jito/bundle-builder.ts` | ✅ | Transaction bundling |
| `backend/src/jito/config.ts` | ✅ | Jito configuration |

## Remaining Files to Create

| File | Purpose |
|------|---------|
| `backend/src/liquidation-bot/position-scanner.ts` | RPC polling, position caching |
| `backend/src/liquidation-bot/tx-builder.ts` | Transaction construction |
| `backend/src/liquidation-bot/metrics.ts` | Prometheus metrics |
| `prisma/migrations/xxx_liquidation_bot.sql` | Database schema |

---

## Files Modified

| File | Status | Change |
|------|--------|--------|
| `backend/package.json` | ✅ | Added socket.io, bullmq, ioredis, pg, eventsource |
| `backend/src/index.ts` | ✅ | Added streaming and analytics integration |
| `backend/.env` | ✅ | Added streaming/Pyth/Jito environment variables |
| `backend/.env.production.example` | ✅ | Added production config template |

## Remaining Files to Modify

| File | Change |
|------|--------|
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
