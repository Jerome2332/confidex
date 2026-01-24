# Streaming Data Infrastructure Implementation

**Status:** Complete (January 2026)
**Author:** Claude Code
**Last Updated:** January 24, 2026

This document describes the streaming data infrastructure implemented for Confidex, enabling real-time WebSocket updates, oracle price streaming, job queues for liquidations, and analytics.

---

## Overview

The streaming infrastructure provides:
1. **Real-time WebSocket updates** for frontend via Socket.IO
2. **Pyth oracle price streaming** for liquidation monitoring
3. **BullMQ job queue** for reliable liquidation processing
4. **Jito MEV protection** for transaction submission
5. **TimescaleDB analytics** for public metrics

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                 │
│   useOrderStream() ◄── Socket.IO Client ──► Real-time UI        │
└────────────────────────────────┬────────────────────────────────┘
                                 │ WebSocket
┌────────────────────────────────▼────────────────────────────────┐
│                    BACKEND (Express + Socket.IO)                 │
│                                                                  │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ EventBroadcaster │  │ Analytics API │  │ Liquidation Svc  │   │
│  └────────┬─────────┘  └──────┬───────┘  └────────┬─────────┘   │
│           │                   │                    │             │
│  ┌────────▼─────────┐  ┌──────▼───────┐  ┌────────▼─────────┐   │
│  │ Redis Pub/Sub    │  │ TimescaleDB  │  │ BullMQ Queue     │   │
│  └──────────────────┘  └──────────────┘  └────────┬─────────┘   │
│                                                    │             │
│  ┌─────────────────────────────────────────────────▼─────────┐   │
│  │ Pyth Hermes SSE ──► Price Cache ──► Liquidation Detector  │   │
│  └─────────────────────────────────────────────────┬─────────┘   │
│                                                    │             │
│  ┌─────────────────────────────────────────────────▼─────────┐   │
│  │ Jito Client ──► Bundle Builder ──► Block Engine Submit    │   │
│  └───────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Privacy Model

**CRITICAL:** All streaming data respects the privacy model. Encrypted fields are NEVER exposed.

| Data Type | Visibility | Example Fields |
|-----------|------------|----------------|
| **PUBLIC** | Can be streamed/indexed | `orderId`, `maker`, `side`, `timestamp`, `pairPda` |
| **PRIVATE** | Never exposed | `encrypted_amount`, `encrypted_price`, `encrypted_filled` |

All event types in `backend/src/streaming/types.ts` and `frontend/src/hooks/streaming/types.ts` explicitly exclude encrypted fields.

---

## Backend Components

### 1. WebSocket Server (`backend/src/streaming/`)

| File | Purpose |
|------|---------|
| `websocket-server.ts` | Socket.IO server with Redis adapter |
| `redis-adapter.ts` | Redis pub/sub for horizontal scaling |
| `event-broadcaster.ts` | Privacy-enforced event emission |
| `subscription-manager.ts` | Client subscription tracking |
| `config.ts` | Streaming configuration |
| `types.ts` | Event type definitions |
| `index.ts` | Module exports |

**Key Features:**
- Socket.IO with Redis adapter for multi-instance scaling
- Channel-based subscriptions (`orders:{pairPda}`, `trades`, `prices`, etc.)
- Graceful reconnection handling
- Connection authentication (optional)

**Usage:**
```typescript
import { createWebSocketServer, loadStreamingConfig } from './streaming/index.js';

const config = loadStreamingConfig();
const io = createWebSocketServer(httpServer, config);
```

### 2. Pyth Oracle Integration (`backend/src/prices/`)

| File | Purpose |
|------|---------|
| `pyth-hermes-client.ts` | SSE streaming client |
| `price-cache.ts` | In-memory price cache with TTL |
| `config.ts` | Price feed configuration |
| `types.ts` | Price data types |
| `index.ts` | Module exports |

**Key Features:**
- Server-Sent Events (SSE) from Pyth Hermes
- Staleness detection (configurable threshold)
- Price cache with automatic expiry
- Multiple feed support (SOL, BTC, ETH)

**Usage:**
```typescript
import { createPythClient, createPriceCache } from './prices/index.js';

const priceCache = createPriceCache();
const pythClient = createPythClient(config, priceCache);
await pythClient.start();

const solPrice = priceCache.get('SOL/USD');
if (solPrice && !solPrice.isStale) {
  // Use price for liquidation check
}
```

### 3. Job Queue (`backend/src/queues/`)

| File | Purpose |
|------|---------|
| `queue-manager.ts` | BullMQ setup and connection |
| `liquidation-queue.ts` | Liquidation job processor |
| `config.ts` | Queue configuration |
| `types.ts` | Job type definitions |
| `index.ts` | Module exports |

**Key Features:**
- BullMQ with Redis backend
- Job deduplication by position PDA
- Exponential backoff retry
- Completed job cleanup
- Concurrency control

**Usage:**
```typescript
import { createQueueManager, createLiquidationQueue } from './queues/index.js';

const queueManager = createQueueManager(redisConfig);
const liquidationQueue = createLiquidationQueue(queueManager);

// Queue a liquidation
await liquidationQueue.add({
  positionPda: 'abc123...',
  markPrice: 150.50,
  threshold: 145.00,
});
```

### 4. Jito MEV Protection (`backend/src/jito/`)

| File | Purpose |
|------|---------|
| `jito-client.ts` | Block Engine client |
| `bundle-builder.ts` | Transaction bundling |
| `config.ts` | Jito configuration |
| `index.ts` | Module exports |

**Key Features:**
- Bundle submission to Jito Block Engine
- Tip instruction construction
- Submission timeout handling
- Poll-based confirmation

**Usage:**
```typescript
import { createJitoClient, createBundleBuilder } from './jito/index.js';

const jitoClient = createJitoClient(config);
const bundleBuilder = createBundleBuilder(wallet);

const tx = bundleBuilder.buildLiquidationBundle(positionPda, markPrice);
const result = await jitoClient.submitBundle([tx]);
```

### 5. Analytics (`backend/src/analytics/`)

| File | Purpose |
|------|---------|
| `timescale-client.ts` | TimescaleDB client |
| `routes.ts` | REST API endpoints |
| `config.ts` | Analytics configuration |
| `types.ts` | Record type definitions |
| `index.ts` | Module exports |

**Key Features:**
- TimescaleDB hypertable support
- Connection pooling
- Privacy-enforced queries (no encrypted fields)
- REST endpoints for metrics

**Endpoints:**
| Route | Method | Description |
|-------|--------|-------------|
| `/api/analytics/global` | GET | Global exchange statistics |
| `/api/analytics/orders` | GET | Order activity metrics |
| `/api/analytics/trades` | GET | Trade history (public) |
| `/api/analytics/liquidations` | GET | Liquidation events |
| `/api/analytics/markets` | GET | Per-market statistics |

---

## Frontend Components

### Streaming Hooks (`frontend/src/hooks/streaming/`)

| Hook | Purpose |
|------|---------|
| `useWebSocket` | Core Socket.IO connection management |
| `useSharedWebSocket` | Context-based shared connection |
| `WebSocketProvider` | Provider component for connection sharing |
| `useOrderStream` | Real-time order events |
| `useTradeStream` | Trade event aggregation |
| `usePriceStream` | Pyth oracle price updates |
| `useGlobalStats` | Exchange-wide statistics |
| `useMarketStats` | Per-market open interest, funding |
| `useLiquidationStats` | Liquidation event feed |

**Usage Example:**
```tsx
import { WebSocketProvider, useOrderStream, useGlobalStats } from '@/hooks/streaming';

function App() {
  return (
    <WebSocketProvider url="wss://api.confidex.exchange/ws">
      <Dashboard />
    </WebSocketProvider>
  );
}

function Dashboard() {
  const { events, isConnected } = useOrderStream('SOL-USDC-PAIR-PDA');
  const { stats } = useGlobalStats();

  return (
    <div>
      <p>Connection: {isConnected ? 'Connected' : 'Disconnected'}</p>
      <p>Total Orders: {stats.orderCount}</p>
      <ul>
        {events.map(e => <li key={e.orderId}>{e.type}: {e.orderId}</li>)}
      </ul>
    </div>
  );
}
```

---

## Environment Variables

### Backend (`.env`)

```bash
# =============================================================================
# Streaming Infrastructure
# =============================================================================
STREAMING_ENABLED=true
WS_PATH=/ws

# Redis (Required for WebSocket + Job Queues)
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379

# =============================================================================
# Pyth Oracle (Price Streaming)
# =============================================================================
PYTH_HERMES_URL=https://hermes.pyth.network
PYTH_STALENESS_THRESHOLD_MS=30000
SOL_USD_FEED_ID=ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
BTC_USD_FEED_ID=e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43
ETH_USD_FEED_ID=ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace

# =============================================================================
# Jito MEV Protection (Mainnet Only)
# =============================================================================
JITO_ENABLED=false  # Set true for mainnet
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_LAMPORTS=10000
JITO_SUBMISSION_TIMEOUT_MS=30000
JITO_POLL_TIMEOUT_MS=60000

# =============================================================================
# TimescaleDB Analytics (Optional)
# =============================================================================
# TIMESCALE_URL=postgres://user:password@localhost:5432/confidex_analytics
# ANALYTICS_POOL_SIZE=10
# ANALYTICS_LOG_QUERIES=false
```

---

## Dependencies

### Backend (`package.json`)

```json
{
  "dependencies": {
    "socket.io": "^4.7.0",
    "@socket.io/redis-adapter": "^8.2.0",
    "bullmq": "^5.0.0",
    "ioredis": "^5.3.0",
    "pg": "^8.11.0",
    "eventsource": "^4.0.0"
  },
  "devDependencies": {
    "@types/pg": "^8.10.0"
  }
}
```

### Frontend (`package.json`)

```json
{
  "dependencies": {
    "socket.io-client": "^4.7.0"
  }
}
```

---

## Event Types

### Order Events
```typescript
interface OrderEvent {
  type: 'order_placed' | 'order_cancelled' | 'order_matched';
  orderId: string;
  pairPda: string;
  side: 'buy' | 'sell';
  maker: string;
  timestamp: number;
  // NO encrypted fields
}
```

### Trade Events
```typescript
interface TradeEvent {
  type: 'trade_executed';
  tradeId: string;
  pairPda: string;
  makerOrderId: string;
  takerOrderId: string;
  side: 'buy' | 'sell';
  timestamp: number;
  // NO amounts or prices
}
```

### Liquidation Events
```typescript
interface LiquidationEvent {
  type: 'liquidation_detected' | 'liquidation_executed' | 'liquidation_failed';
  positionPda: string;
  marketPda: string;
  owner: string;
  timestamp: number;
  // NO encrypted position details
}
```

### Price Events
```typescript
interface PriceEvent {
  feedId: string;
  price: string;
  confidence: string;
  publishTime: number;
  isStale: boolean;
}
```

---

## Testing

### Backend Tests

```bash
cd backend
pnpm test src/__tests__/streaming/
pnpm test src/__tests__/prices/
pnpm test src/__tests__/queues/
pnpm test src/__tests__/analytics/
```

### Frontend Tests

```bash
cd frontend
pnpm test src/hooks/streaming/
```

---

## Future Enhancements

1. **Triton Fumarole Migration** - Replace polling with gRPC streaming (see [STREAMING_MIGRATION_PLAN.md](../roadmap/STREAMING_MIGRATION_PLAN.md))
2. **TimescaleDB Schema** - Create hypertables and continuous aggregates
3. **Analytics Dashboard UI** - Frontend pages for metrics visualization
4. **Prometheus Metrics** - Integration with monitoring stack
5. **Admin Dashboard** - Liquidation monitoring and queue management

---

## References

- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [Pyth Network Hermes](https://docs.pyth.network/hermes)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Jito Block Engine](https://jito-labs.gitbook.io/mev/)
- [TimescaleDB Docs](https://docs.timescale.com/)
