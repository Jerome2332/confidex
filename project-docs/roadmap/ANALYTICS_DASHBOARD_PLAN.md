# Analytics Dashboard - Implementation Plan

**Status:** Backend Infrastructure Complete (January 2026)
**Priority:** P1
**Estimated Effort:** 2-3 weeks
**Last Updated:** January 24, 2026

This document provides the comprehensive implementation plan for the Confidex Analytics Dashboard, a privacy-respecting metrics system that displays aggregate exchange statistics without exposing encrypted trade data.

---

## Implementation Status

| Component | Status | Files |
|-----------|--------|-------|
| **TimescaleDB Client** | ✅ Complete | `backend/src/analytics/timescale-client.ts` |
| **Analytics Config** | ✅ Complete | `backend/src/analytics/config.ts` |
| **REST API Routes** | ✅ Complete | `backend/src/analytics/routes.ts` |
| **Analytics Types** | ✅ Complete | `backend/src/analytics/types.ts` |
| **WebSocket Server** | ✅ Complete | `backend/src/streaming/websocket-server.ts` |
| **Event Broadcaster** | ✅ Complete | `backend/src/streaming/event-broadcaster.ts` |
| **Redis Adapter** | ✅ Complete | `backend/src/streaming/redis-adapter.ts` |
| **Frontend Hooks** | ✅ Complete | `frontend/src/hooks/streaming/*.ts` |
| **Database Schema** | 🔲 Pending | SQL migration for hypertables |
| **Dashboard UI** | 🔲 Pending | Frontend pages/components |
| **Continuous Aggregates** | 🔲 Pending | TimescaleDB views |
| **User Analytics** | 🔲 Pending | Wallet-authenticated endpoints |

### Implemented API Endpoints

| Endpoint | Status | Description |
|----------|--------|-------------|
| `GET /api/analytics/global` | ✅ | Exchange-wide statistics |
| `GET /api/analytics/orders` | ✅ | Order activity metrics |
| `GET /api/analytics/trades` | ✅ | Trade history (public fields) |
| `GET /api/analytics/liquidations` | ✅ | Liquidation events |
| `GET /api/analytics/markets` | ✅ | Per-market statistics |

### Implemented Frontend Hooks

| Hook | Status | Purpose |
|------|--------|---------|
| `useWebSocket` | ✅ | Core Socket.IO connection |
| `useSharedWebSocket` | ✅ | Context-based shared connection |
| `useOrderStream` | ✅ | Real-time order events |
| `useTradeStream` | ✅ | Trade event aggregation |
| `usePriceStream` | ✅ | Pyth oracle prices |
| `useGlobalStats` | ✅ | Exchange-wide metrics |
| `useMarketStats` | ✅ | Per-market OI/funding |
| `useLiquidationStats` | ✅ | Liquidation event feed |

---

---

## Table of Contents

1. [Privacy Model](#1-privacy-model)
2. [Architecture Overview](#2-architecture-overview)
3. [Data Sources](#3-data-sources)
4. [Database Schema](#4-database-schema)
5. [API Specification](#5-api-specification)
6. [Frontend Components](#6-frontend-components)
7. [Implementation Phases](#7-implementation-phases)
8. [Technology Choices](#8-technology-choices)
9. [Verification & Testing](#9-verification--testing)

---

## 1. Privacy Model

### Core Principle

The analytics dashboard displays **aggregate public data only**. Individual trade amounts, prices, and position sizes remain encrypted and are never indexed or stored by the analytics system.

### Data Classification

| Category | Examples | Indexed? | Displayed? |
|----------|----------|----------|------------|
| **PUBLIC Counts** | order_count, position_count, pair_count | Yes | Yes |
| **PUBLIC Aggregates** | total_long_oi, total_short_oi, funding_rates | Yes | Yes |
| **PUBLIC Thresholds** | liquidatable_below_price, liquidatable_above_price | Yes | Yes |
| **PUBLIC Metadata** | timestamps, sides, leverage, status | Yes | Yes |
| **ENCRYPTED Values** | encrypted_amount, encrypted_price, encrypted_size | **Never** | User-only (client decrypt) |

### Event Privacy

All on-chain events are designed to exclude sensitive data:

```rust
// OrderPlaced - NO amounts or prices
#[event]
pub struct OrderPlaced {
    pub order_id: u64,
    pub maker: Pubkey,
    pub pair: Pubkey,
    pub side: Side,
    pub order_type: OrderType,
    pub timestamp: i64,
    // Note: encrypted_amount and encrypted_price are NOT emitted
}

// TradeExecuted - NO amounts or prices
#[event]
pub struct TradeExecuted {
    pub buy_order_id: u64,
    pub sell_order_id: u64,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub pair: Pubkey,
    pub timestamp: i64,
    // Note: fill amounts are NOT emitted
}
```

### User Private Data

Users can view their own encrypted data through **client-side decryption**:

```typescript
// Only the user can decrypt their position values
async function decryptPosition(position: ConfidentialPosition) {
  const { decryptValue } = useEncryption();

  // Requires wallet signature to prove ownership
  const size = await decryptValue(position.encrypted_size);
  const entryPrice = await decryptValue(position.encrypted_entry_price);
  const collateral = await decryptValue(position.encrypted_collateral);
  const pnl = await decryptValue(position.encrypted_realized_pnl);

  return { size, entryPrice, collateral, pnl };
}
```

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                  DATA SOURCES                                           │
├──────────────────┬─────────────────────┬────────────────────┬──────────────────────────┤
│  Solana RPC      │  Helius Enhanced    │  Pyth Oracle       │  On-Chain Accounts       │
│  (gPA accounts)  │  Transactions API   │  (Prices)          │  (ExchangeState, etc.)   │
└────────┬─────────┴──────────┬──────────┴──────────┬─────────┴────────────┬─────────────┘
         │                    │                     │                      │
         └────────────────────┼─────────────────────┼──────────────────────┘
                              ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              INDEXER SERVICE                                            │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │ Account Watcher │  │ Event Listener  │  │ Helius Webhook  │  │ Price Fetcher   │    │
│  │ (5-min polling) │  │ (onLogs sub)    │  │ (POST receiver) │  │ (Pyth stream)   │    │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘    │
│           │                    │                    │                    │              │
│           └────────────────────┼────────────────────┼────────────────────┘              │
│                                ▼                    ▼                                   │
│                    ┌───────────────────────────────────────────┐                        │
│                    │          Event Processor                  │                        │
│                    │  - Parse program logs                     │                        │
│                    │  - Extract PUBLIC fields only             │                        │
│                    │  - Calculate aggregates                   │                        │
│                    └─────────────────┬─────────────────────────┘                        │
└──────────────────────────────────────┼──────────────────────────────────────────────────┘
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              DATA LAYER                                                 │
│  ┌─────────────────────────────────────┐  ┌───────────────────────────────────────┐    │
│  │         TimescaleDB                 │  │              Redis                    │    │
│  │  - Time-series metrics              │  │  - Real-time WebSocket pub/sub        │    │
│  │  - Historical aggregations          │  │  - Hot metrics cache (5s TTL)         │    │
│  │  - Auto-compression (7+ days)       │  │  - Rate limiting state                │    │
│  │  - Continuous aggregates            │  │  - Session tracking                   │    │
│  └─────────────────────────────────────┘  └───────────────────────────────────────┘    │
└──────────────────────────────────────┬──────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              API LAYER                                                  │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐                    │
│  │     REST API (Express)      │  │     WebSocket Server         │                    │
│  │  /api/analytics/...         │  │  Real-time metric streams    │                    │
│  │  - Global stats             │  │  - Global updates            │                    │
│  │  - Pair metrics             │  │  - Pair updates              │                    │
│  │  - Perp market data         │  │  - Liquidation events        │                    │
│  │  - User portfolio (auth)    │  │  - User position changes     │                    │
│  └──────────────────────────────┘  └──────────────────────────────┘                    │
└──────────────────────────────────────┬──────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND                                                   │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │                          Analytics Dashboard                                      │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │  │
│  │  │ Global KPIs │  │ Pair Stats  │  │ Perp Health │  │ User Portfolio (Private)│  │  │
│  │  │ (public)    │  │ (public)    │  │ (public)    │  │ (client-decrypted)      │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Sources

### 3.1 On-Chain Accounts (Polling)

| Account | Public Fields | Poll Interval |
|---------|---------------|---------------|
| **ExchangeState** | pair_count, order_count, paused, fees | 5 min |
| **TradingPair** | open_order_count, active, min_order_size | 5 min |
| **PerpetualMarket** | total_long_oi, total_short_oi, position_count, funding | 1 min |
| **FundingRateState** | current_rate_bps, hourly_rates[24], totals | 1 min |
| **LiquidationConfig** | total_liquidations, total_adl_events | 5 min |

### 3.2 Events (Real-time via Helius Webhook)

| Event | Fields Indexed |
|-------|----------------|
| OrderPlaced | order_id, maker, pair, side, order_type, timestamp |
| OrderCancelled | order_id, maker, pair, timestamp |
| TradeExecuted | buy_order_id, sell_order_id, buyer, seller, pair, timestamp |
| PositionLiquidated | position_id, trader, market, liquidator, side, timestamp |
| FundingSettled | position_id, trader, market, funding_delta, is_paying |

### 3.3 Pyth Oracle (Price Context)

- SOL/USD price for display context
- Used for liquidation threshold visualization
- Streaming via Hermes endpoint

---

## 4. Database Schema

### 4.1 TimescaleDB Tables

```sql
-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================
-- SNAPSHOT TABLES (Periodic polling)
-- ============================================

-- Global exchange snapshots
CREATE TABLE exchange_snapshots (
    time            TIMESTAMPTZ NOT NULL,
    pair_count      BIGINT NOT NULL,
    order_count     BIGINT NOT NULL,
    paused          BOOLEAN NOT NULL,
    maker_fee_bps   SMALLINT NOT NULL,
    taker_fee_bps   SMALLINT NOT NULL
);
SELECT create_hypertable('exchange_snapshots', 'time');

-- Trading pair metrics
CREATE TABLE pair_metrics (
    time              TIMESTAMPTZ NOT NULL,
    pair_address      TEXT NOT NULL,
    base_symbol       TEXT NOT NULL,
    quote_symbol      TEXT NOT NULL,
    open_order_count  BIGINT NOT NULL,
    active            BOOLEAN NOT NULL,
    PRIMARY KEY (time, pair_address)
);
SELECT create_hypertable('pair_metrics', 'time');
CREATE INDEX idx_pair_metrics_pair ON pair_metrics (pair_address, time DESC);

-- Perpetual market metrics
CREATE TABLE perp_market_metrics (
    time                      TIMESTAMPTZ NOT NULL,
    market_address            TEXT NOT NULL,
    symbol                    TEXT NOT NULL,
    total_long_oi             BIGINT NOT NULL,
    total_short_oi            BIGINT NOT NULL,
    position_count            BIGINT NOT NULL,
    current_funding_rate_bps  SMALLINT,
    oracle_price              BIGINT,
    PRIMARY KEY (time, market_address)
);
SELECT create_hypertable('perp_market_metrics', 'time');
CREATE INDEX idx_perp_metrics_market ON perp_market_metrics (market_address, time DESC);

-- ============================================
-- EVENT TABLES (Real-time from webhooks)
-- ============================================

-- Order events (NO amounts/prices)
CREATE TABLE order_events (
    time              TIMESTAMPTZ NOT NULL,
    event_type        TEXT NOT NULL,
    signature         TEXT NOT NULL,
    order_id          BIGINT NOT NULL,
    maker             TEXT NOT NULL,
    pair              TEXT NOT NULL,
    side              TEXT NOT NULL,
    order_type        TEXT,
    PRIMARY KEY (time, signature)
);
SELECT create_hypertable('order_events', 'time');
CREATE INDEX idx_order_events_pair ON order_events (pair, time DESC);
CREATE INDEX idx_order_events_maker ON order_events (maker, time DESC);

-- Trade events (NO amounts/prices)
CREATE TABLE trade_events (
    time              TIMESTAMPTZ NOT NULL,
    signature         TEXT NOT NULL,
    buy_order_id      BIGINT NOT NULL,
    sell_order_id     BIGINT NOT NULL,
    buyer             TEXT NOT NULL,
    seller            TEXT NOT NULL,
    pair              TEXT NOT NULL,
    PRIMARY KEY (time, signature)
);
SELECT create_hypertable('trade_events', 'time');
CREATE INDEX idx_trade_events_pair ON trade_events (pair, time DESC);

-- Position events
CREATE TABLE position_events (
    time              TIMESTAMPTZ NOT NULL,
    event_type        TEXT NOT NULL,
    signature         TEXT NOT NULL,
    position_id       BIGINT NOT NULL,
    trader            TEXT NOT NULL,
    market            TEXT NOT NULL,
    side              TEXT NOT NULL,
    leverage          SMALLINT,
    liquidator        TEXT,
    PRIMARY KEY (time, signature)
);
SELECT create_hypertable('position_events', 'time');
CREATE INDEX idx_position_events_market ON position_events (market, time DESC);
CREATE INDEX idx_position_events_trader ON position_events (trader, time DESC);

-- ============================================
-- CONTINUOUS AGGREGATES (Auto-computed)
-- ============================================

-- Hourly pair activity
CREATE MATERIALIZED VIEW pair_activity_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    pair,
    COUNT(*) FILTER (WHERE event_type = 'placed') AS orders_placed,
    COUNT(*) FILTER (WHERE event_type = 'matched') AS trades,
    COUNT(*) FILTER (WHERE event_type = 'cancelled') AS cancellations,
    COUNT(DISTINCT maker) AS unique_traders
FROM order_events
GROUP BY bucket, pair;

-- Hourly perp activity
CREATE MATERIALIZED VIEW perp_activity_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    market,
    COUNT(*) FILTER (WHERE event_type = 'liquidated') AS liquidations,
    COUNT(*) FILTER (WHERE event_type = 'adl') AS adl_events,
    COUNT(DISTINCT trader) AS unique_traders
FROM position_events
GROUP BY bucket, market;

-- ============================================
-- DATA RETENTION
-- ============================================

SELECT add_retention_policy('order_events', INTERVAL '30 days');
SELECT add_retention_policy('trade_events', INTERVAL '30 days');
SELECT add_retention_policy('position_events', INTERVAL '30 days');
SELECT add_retention_policy('pair_metrics', INTERVAL '365 days');
SELECT add_retention_policy('perp_market_metrics', INTERVAL '365 days');

-- Compression for old data
SELECT add_compression_policy('exchange_snapshots', INTERVAL '7 days');
SELECT add_compression_policy('pair_metrics', INTERVAL '7 days');
SELECT add_compression_policy('perp_market_metrics', INTERVAL '7 days');
```

---

## 5. API Specification

### 5.1 Global Statistics

```typescript
// GET /api/analytics/global
interface GlobalStatsResponse {
  exchange: {
    pairCount: number;
    orderCount: number;
    paused: boolean;
    makerFeeBps: number;
    takerFeeBps: number;
  };
  activity24h: {
    ordersPlaced: number;
    tradesExecuted: number;
    uniqueTraders: number;
  };
  perpetuals: {
    totalLongOI: string;      // BigInt as string
    totalShortOI: string;
    totalPositions: number;
    liquidations24h: number;
  };
  lastUpdated: string;
}

// GET /api/analytics/global/history?interval=1h&range=24h
interface GlobalHistoryResponse {
  interval: '5m' | '15m' | '1h' | '4h' | '1d';
  range: '1h' | '6h' | '24h' | '7d' | '30d';
  data: Array<{
    timestamp: string;
    orderCount: number;
    tradeCount: number;
    uniqueTraders: number;
  }>;
}
```

### 5.2 Trading Pairs

```typescript
// GET /api/analytics/pairs
interface PairsResponse {
  pairs: Array<{
    address: string;
    baseSymbol: string;
    quoteSymbol: string;
    openOrders: number;
    active: boolean;
    activity24h: {
      ordersPlaced: number;
      trades: number;
    };
  }>;
}

// GET /api/analytics/pairs/:address
interface PairDetailResponse {
  pair: {
    address: string;
    baseSymbol: string;
    quoteSymbol: string;
    baseMint: string;
    quoteMint: string;
    openOrders: number;
  };
  activity: {
    ordersPlaced1h: number;
    ordersPlaced24h: number;
    trades1h: number;
    trades24h: number;
    uniqueTraders24h: number;
  };
}
```

### 5.3 Perpetual Markets

```typescript
// GET /api/analytics/perps
interface PerpsResponse {
  markets: Array<{
    address: string;
    symbol: string;
    totalLongOI: string;
    totalShortOI: string;
    oiRatio: number;           // long / short
    positionCount: number;
    currentFundingRateBps: number;
    liquidations24h: number;
  }>;
}

// GET /api/analytics/perps/:address
interface PerpDetailResponse {
  market: { /* metadata */ };
  health: {
    totalLongOI: string;
    totalShortOI: string;
    oiRatio: number;
    positionCount: number;
  };
  funding: {
    currentRateBps: number;
    hourlyRates: Array<{ timestamp: string; rateBps: number }>;
  };
  activity: {
    liquidations24h: number;
    adlEvents24h: number;
  };
}

// GET /api/analytics/perps/:address/funding-history?range=7d
interface FundingHistoryResponse {
  history: Array<{
    timestamp: string;
    fundingRateBps: number;
    longOI: string;
    shortOI: string;
  }>;
}
```

### 5.4 Liquidations

```typescript
// GET /api/analytics/liquidations
interface LiquidationsResponse {
  global: {
    totalLiquidations: number;
    totalAdlEvents: number;
    lastLiquidationTime: string;
  };
  recent: Array<{
    timestamp: string;
    market: string;
    side: 'long' | 'short';
    leverage: number;
    // NOTE: No amounts - privacy preserved
  }>;
}
```

### 5.5 User Analytics (Authenticated)

```typescript
// GET /api/analytics/user/:wallet
// Requires wallet signature header
interface UserAnalyticsResponse {
  wallet: string;
  spot: {
    ordersPlaced: number;
    tradesExecuted: number;
    openOrders: number;
  };
  perpetuals: {
    positionsOpened: number;
    currentPositions: number;
    // PUBLIC position data only
    positions: Array<{
      positionId: number;
      market: string;
      side: 'long' | 'short';
      leverage: number;
      liquidatableBelowPrice?: string;
      liquidatableAbovePrice?: string;
      // encrypted_* fields NOT included
    }>;
  };
}
```

### 5.6 WebSocket

```typescript
// WS /ws/analytics
// Subscribe: { type: 'subscribe', channels: ['global', 'pairs', 'perps', 'liquidations'] }

interface WebSocketMessage {
  type: 'global_update' | 'pair_update' | 'perp_update' | 'liquidation';
  data: unknown;
  timestamp: string;
}
```

---

## 6. Frontend Components

### 6.1 Component Tree

```
src/
├── app/
│   └── analytics/
│       ├── page.tsx                    # Main dashboard
│       └── [market]/page.tsx           # Market detail
│
├── components/analytics/
│   ├── dashboard/
│   │   ├── AnalyticsDashboard.tsx      # Main container
│   │   ├── GlobalKPICards.tsx          # Top metrics
│   │   ├── ActivityChart.tsx           # Time series
│   │   └── RefreshIndicator.tsx        # Auto-refresh
│   │
│   ├── spot/
│   │   ├── PairOverview.tsx            # All pairs
│   │   ├── PairCard.tsx                # Single pair
│   │   └── OrderActivityChart.tsx      # Pair orders
│   │
│   ├── perpetuals/
│   │   ├── PerpMarketHealth.tsx        # Market health
│   │   ├── OpenInterestGauge.tsx       # OI visualization
│   │   ├── FundingRateChart.tsx        # Funding history
│   │   └── LiquidationFeed.tsx         # Recent liquidations
│   │
│   ├── user/
│   │   ├── PortfolioOverview.tsx       # User stats
│   │   ├── PositionCard.tsx            # Position display
│   │   └── DecryptButton.tsx           # Decrypt values
│   │
│   └── shared/
│       ├── StatCard.tsx                # Metric card
│       ├── TimeRangeSelector.tsx       # 1h/24h/7d/30d
│       ├── MetricChart.tsx             # Chart wrapper
│       └── EncryptedValue.tsx          # Shows "***"
│
├── hooks/analytics/
│   ├── use-global-stats.ts
│   ├── use-pair-metrics.ts
│   ├── use-perp-metrics.ts
│   ├── use-liquidations.ts
│   ├── use-user-analytics.ts
│   └── use-analytics-websocket.ts
│
└── stores/
    └── analytics-store.ts              # Zustand store
```

### 6.2 Key Component Designs

**GlobalKPICards** - Top-level metrics display:
```
┌────────────────┬────────────────┬────────────────┬────────────────┐
│  Total Orders  │  Trading Pairs │  Open Interest │  Liquidations  │
│    12,547      │       8        │   $4.2M        │    23 (24h)    │
│   +234 (24h)   │   5 active     │  L/S: 1.21x    │   ▼ 15%        │
└────────────────┴────────────────┴────────────────┴────────────────┘
```

**OpenInterestGauge** - Visual OI balance:
```
Long ████████████░░░░░░░░ Short
     $2.3M (55%)  $1.9M (45%)
```

**FundingRateChart** - Funding history:
```
Rate
 +0.1% │    ╭─╮
  0.0% │──╮─╯ ╰──╮──
 -0.1% │  ╰──────╯
       └──────────────────
        -24h    -12h    Now
```

---

## 7. Implementation Phases

### Phase 1: Foundation (Week 1) - ✅ COMPLETE

**Backend Tasks:**
- [x] Set up TimescaleDB client (`backend/src/analytics/timescale-client.ts`)
- [x] Create analytics configuration (`backend/src/analytics/config.ts`)
- [x] Implement `/api/analytics/global` endpoint
- [x] Implement `/api/analytics/orders` endpoint
- [x] Implement `/api/analytics/markets` endpoint
- [x] Add Redis caching layer (`backend/src/streaming/redis-adapter.ts`)

**Frontend Tasks:**
- [x] Implement `useGlobalStats` hook (`frontend/src/hooks/streaming/use-global-stats.ts`)
- [x] Implement `useOrderStream` hook (`frontend/src/hooks/streaming/use-order-stream.ts`)
- [x] Implement `useMarketStats` hook (included in `use-global-stats.ts`)
- [ ] Create `/analytics` page route
- [ ] Build `GlobalKPICards` component
- [ ] Build `PairOverview` component
- [ ] Build `PerpMarketHealth` component

**Completed Infrastructure:**
- TimescaleDB client with connection pooling
- REST API endpoints for analytics
- WebSocket server with Redis adapter

### Phase 2: Real-time Events (Week 2) - ✅ COMPLETE

**Backend Tasks:**
- [x] Implement event parsing (public fields only) (`backend/src/streaming/types.ts`)
- [x] Add WebSocket server (`backend/src/streaming/websocket-server.ts`)
- [x] Create event broadcaster (`backend/src/streaming/event-broadcaster.ts`)
- [x] Add subscription manager (`backend/src/streaming/subscription-manager.ts`)
- [ ] Create continuous aggregates (SQL migration pending)

**Frontend Tasks:**
- [x] Implement WebSocket hooks (`frontend/src/hooks/streaming/use-websocket.tsx`)
- [x] Build `useLiquidationStats` hook (`frontend/src/hooks/streaming/use-global-stats.ts`)
- [x] Implement `useTradeStream` hook (`frontend/src/hooks/streaming/use-trade-stream.ts`)
- [ ] Build `ActivityChart` with time series
- [ ] Add `TimeRangeSelector` component
- [ ] Build `LiquidationFeed` component

**Completed Infrastructure:**
- Socket.IO server with Redis adapter for scaling
- Privacy-enforced event types
- Real-time streaming hooks

### Phase 3: Perpetuals Deep Dive (Week 2-3) - PARTIAL

**Backend Tasks:**
- [x] Implement position event tracking (types defined)
- [ ] Add funding rate history endpoint
- [ ] Build perp detail endpoint

**Frontend Tasks:**
- [x] Implement `useMarketStats` for OI data
- [ ] Build `OpenInterestGauge` component
- [ ] Create `FundingRateChart` component
- [ ] Add market detail page

**Deliverables:**
- Per-market OI breakdown
- Funding rate history charts
- Market health indicators

### Phase 4: User Analytics (Week 3) - PENDING

**Backend Tasks:**
- [ ] Implement wallet signature auth
- [ ] Build user analytics endpoints
- [ ] Add user activity aggregation

**Frontend Tasks:**
- [ ] Build `PortfolioOverview` component
- [ ] Implement client-side decryption
- [ ] Create user activity feed

**Deliverables:**
- User order/position counts
- Client-side position decryption
- Personal activity history

---

## 8. Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| **Database** | TimescaleDB | Time-series optimized, continuous aggregates, PostgreSQL compatible |
| **Cache** | Redis | Pub/sub for WebSocket, fast hot metrics, rate limiting |
| **API** | Express.js | Already used in backend |
| **WebSocket** | ws | Standard Node.js library |
| **Charts** | Recharts | Already in frontend stack |
| **State** | Zustand | Already used for stores |

### Why TimescaleDB?

1. **Hypertables** - Automatic partitioning by time
2. **Continuous aggregates** - Pre-computed rollups, auto-updated
3. **Compression** - 10-20x storage reduction for old data
4. **Retention policies** - Auto-delete old raw data
5. **PostgreSQL compatible** - Same SQL, familiar tooling

---

## 9. Verification & Testing

### 9.1 Privacy Audit Checklist

- [ ] No `encrypted_*` fields in database schema
- [ ] No `encrypted_*` fields in API responses
- [ ] Event parsing extracts only public fields
- [ ] Client decryption requires wallet signature
- [ ] Audit logging for user data access

### 9.2 Unit Tests

```typescript
describe('Event Parsing', () => {
  it('should extract only public fields from OrderPlaced', () => {
    const event = parseOrderPlacedEvent(logs);
    expect(event).toHaveProperty('order_id');
    expect(event).toHaveProperty('maker');
    expect(event).not.toHaveProperty('encrypted_amount');
    expect(event).not.toHaveProperty('encrypted_price');
  });
});
```

### 9.3 Integration Tests

1. Place orders → verify events indexed correctly
2. Open positions → verify OI updates in metrics
3. Execute liquidations → verify feed updates

### 9.4 Manual Testing

1. Load dashboard without wallet (public data only)
2. Connect wallet and view user analytics
3. Test client-side decryption flow
4. Verify WebSocket real-time updates

---

## References

- [FUTURE_IMPLEMENTATIONS.md](./FUTURE_IMPLEMENTATIONS.md) - Overall roadmap
- [perp_market.rs](../programs/confidex_dex/src/state/perp_market.rs) - Public OI fields
- [helius webhook](../frontend/src/app/api/webhooks/helius/route.ts) - Existing event handler
- [use-mpc-events.ts](../frontend/src/hooks/use-mpc-events.ts) - Event subscription pattern
- [BRAND_GUIDELINES.md](../frontend/BRAND_GUIDELINES.md) - Design system
