# Confidex Streaming Data Pipeline Migration Plan

## Executive Summary

This document outlines the migration from Confidex's current polling-based RPC architecture to a streaming-based data pipeline using Triton's Yellowstone Fumarole and Richat. This migration will reduce costs by ~99%, decrease latency from seconds to milliseconds, and improve reliability through persistent cursors.

**Current State:** Polling via `getProgramAccounts` every 5-15 seconds
**Target State:** Real-time streaming via gRPC subscriptions

---

## Triton/Fumarole Clarifications (January 2026)

Based on conversation with **Steve CleanBrook** (Triton BD Lead):

| Question | Answer | Implications |
|----------|--------|--------------|
| **Beta Timeline** | Exiting beta in a few weeks, deploying to all regions | Safe to plan production migration now |
| **Enterprise SLA** | No SLA for Solana infrastructure, only for Triton's own software | Must implement robust fallback mechanisms |
| **Bandwidth Estimation** | No tools currently available (good suggestion to build) | Start conservative, monitor actual usage |
| **Cascade Integration** | Fumarole is read-only, not a webhook - cannot action data | Crank must handle transaction submission separately |
| **Multi-Program Filtering** | Technically possible, but recommend separate subscriptions | Use dual subscriptions: one for DEX, one for MXE |

### Architectural Decisions Based on Feedback

1. **Dual Subscription Architecture**: Steve recommends subscribing to each program individually for cleaner separation and easier debugging. We will maintain two Fumarole streams:
   - DEX stream: `63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB` (orders, pairs, balances)
   - MXE stream: `4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi` (computation requests/callbacks)

2. **No Webhook Assumption**: Fumarole provides data streaming only. Transaction submission must go through separate RPC connection (Helius or Triton RPC). Current crank architecture is correct.

3. **Fallback Strategy Required**: Since there's no SLA guarantee, we must:
   - Keep Helius as backup data source for critical operations
   - Implement automatic failover when stream disconnects
   - Use polling as last-resort fallback

4. **Conservative Bandwidth Start**: Without estimation tools, start with tight filters:
   - V5 orders only (`dataSize: 366`)
   - Specific account types
   - Monitor actual bandwidth before relaxing filters

---

## Current Architecture Analysis

### Backend Crank Service

| Component | File | Current Approach | Issues |
|-----------|------|------------------|--------|
| **Order Monitor** | `order-monitor.ts` | `getProgramAccounts` polling every 5s | High query count, missed events between polls |
| **MPC Poller** | `mpc-poller.ts` | Account polling every 3s + log subscription | Redundant polling alongside events |
| **Settlement Executor** | `settlement-executor.ts` | Polls settled orders periodically | Delay between fill and settlement |

### Frontend Hooks

| Hook | File | Current Approach | Issues |
|------|------|------------------|--------|
| **useOrderBook** | `use-order-book.ts` | `getProgramAccounts` every 15s with backoff | Rate limiting (429 errors), stale data |
| **useRecentTrades** | `use-recent-trades.ts` | Log subscription | Already event-driven (good) |
| **useMpcEvents** | `use-mpc-events.ts` | Log subscription | Already event-driven (good) |

### Cost Analysis (Current)

```
Backend:
  - Order polling:     ~17,280 queries/day (every 5s)
  - MPC polling:       ~28,800 queries/day (every 3s)
  - Settlement checks: ~8,640 queries/day (every 10s)
  - Total:             ~54,720 queries/day

Frontend (per user):
  - Order book:        ~5,760 queries/day (every 15s)
  - Trade/MPC events:  Subscription-based (efficient)

Monthly estimate (at scale):
  - Backend: ~1.65M queries = $16.50 + bandwidth
  - Frontend: ~173K queries/user/month
  - With 100 active users: ~17.3M queries = $173 + bandwidth
```

---

## Target Architecture

### Streaming Infrastructure (Dual Subscription Architecture)

Per Triton's recommendation, we use **separate subscriptions** for DEX and MXE programs.

```
                         ┌───────────────────────────────────────────┐
                         │           Triton Fumarole                 │
                         │         (Persistent gRPC)                 │
                         └───────────┬───────────────────┬───────────┘
                                     │                   │
                    ┌────────────────┴────┐    ┌────────┴────────────────┐
                    │                     │    │                         │
                    ▼                     │    ▼                         │
        ┌───────────────────────┐         │    ┌───────────────────────┐ │
        │   DEX Stream          │         │    │   MXE Stream          │ │
        │   (Subscription #1)   │         │    │   (Subscription #2)   │ │
        │                       │         │    │                       │ │
        │   Program:            │         │    │   Program:            │ │
        │   63bxU...ArB         │         │    │   DoT4u...YCM         │ │
        │                       │         │    │                       │ │
        │   - Order accounts    │         │    │   - Comp requests     │ │
        │   - Pair accounts     │         │    │   - Callbacks         │ │
        │   - Balance accounts  │         │    │   - MXE events        │ │
        │   - Filter: 366 bytes │         │    │                       │ │
        └───────────┬───────────┘         │    └───────────┬───────────┘ │
                    │                     │                │             │
                    └─────────────────────┼────────────────┘             │
                                          │                              │
                          ┌───────────────▼───────────────┐              │
                          │      Stream Aggregator        │              │
                          │   (Combines both streams)     │              │
                          └───────────────┬───────────────┘              │
                                          │                              │
           ┌──────────────────────────────┼──────────────────────────────┤
           │                              │                              │
           ▼                              ▼                              ▼
 ┌─────────────────┐            ┌─────────────────┐            ┌─────────────────┐
 │  Crank Service  │            │  WebSocket      │            │  Helius RPC     │
 │  (gRPC client)  │            │  Gateway        │            │  (Fallback)     │
 │                 │            │  (for frontend) │            │                 │
 │  - OrderStream  │            │                 │            │  - Backup data  │
 │  - MpcStream    │            │  - OrderBook WS │            │  - Failover     │
 │  - SettleStream │            │  - Trade WS     │            │  - Polling mode │
 └────────┬────────┘            └─────────────────┘            └─────────────────┘
          │                              │
          │                              │
          │  ┌───────────────────────────┘
          │  │
          ▼  ▼
 ┌─────────────────┐            ┌─────────────────┐
 │  Match Executor │            │  Frontend App   │
 │  Settlement Exec│◄──────────►│  (React)        │
 └────────┬────────┘            └─────────────────┘
          │
          │  Transaction Submission (NOT via Fumarole)
          │  Fumarole is READ-ONLY, not a webhook
          ▼
 ┌─────────────────┐
 │  Helius/Triton  │
 │  RPC Endpoint   │
 │  (sendTx only)  │
 └─────────────────┘
```

**Key Architecture Points:**
- Two separate Fumarole subscriptions (per Steve's recommendation)
- Stream aggregator merges data for unified processing
- Helius as fallback for both data reads and transaction submission
- Transaction submission goes through standard RPC, NOT Fumarole

### Filter Configuration (Dual Subscriptions)

Per Triton's recommendation, we use **separate subscriptions** rather than combining both programs in one filter:

```typescript
// Subscription #1: DEX Program
// Handles: orders, trading pairs, user balances
const dexSubscribeRequest = {
  accounts: {
    orders: {
      owner: ["63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB"],
      filters: [
        { dataSize: 366 }  // V5 orders only - CRITICAL for filtering
      ]
    },
    pairs: {
      owner: ["63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB"],
      filters: [
        { dataSize: 200 }  // TradingPair account size
      ]
    }
  },
  transactions: {
    dex_txs: {
      accountInclude: ["63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB"],
    }
  },
  commitment: "confirmed"
};

// Subscription #2: MXE Program
// Handles: computation requests, MPC callbacks
const mxeSubscribeRequest = {
  accounts: {
    computations: {
      owner: ["4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi"],
    }
  },
  transactions: {
    mxe_txs: {
      accountInclude: ["4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi"],
    }
  },
  commitment: "confirmed"
};
```

**Why Dual Subscriptions?**
- Cleaner separation of concerns (DEX vs MXE logic)
- Easier debugging - can isolate issues to specific stream
- Independent reconnection - one stream failing doesn't affect the other
- Steve's explicit recommendation from Triton

---

## Implementation Phases

### Phase 1: Backend Stream Client (Priority: HIGH)

**Goal:** Replace `order-monitor.ts` polling with Fumarole gRPC subscription

**Files to create:**
- `backend/src/stream/fumarole-client.ts` - gRPC client wrapper
- `backend/src/stream/account-stream.ts` - Account update processor
- `backend/src/stream/stream-config.ts` - Configuration

**Files to modify:**
- `backend/src/crank/order-monitor.ts` - Add streaming mode
- `backend/src/crank/config.ts` - Add streaming config
- `backend/src/crank/index.ts` - Initialize stream client

**New Dependencies:**
```json
{
  "@triton-one/yellowstone-grpc": "^1.0.0",
  "@grpc/grpc-js": "^1.9.0",
  "protobufjs": "^7.2.0"
}
```

**Implementation:**

```typescript
// backend/src/stream/fumarole-client.ts
import { SubscribeRequest, SubscribeUpdate } from '@triton-one/yellowstone-grpc';

export class FumaroleClient {
  private client: GrpcClient;
  private subscriptionId: string | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;

  constructor(
    private endpoint: string,
    private accessToken: string,
    private programFilters: ProgramFilter[]
  ) {}

  async connect(): Promise<void> {
    // Establish gRPC connection with auth
    this.client = new GrpcClient(this.endpoint, {
      'x-token': this.accessToken
    });
  }

  async subscribe(
    onAccountUpdate: (update: AccountUpdate) => void,
    onTransactionUpdate: (update: TransactionUpdate) => void
  ): Promise<void> {
    const request: SubscribeRequest = this.buildSubscribeRequest();

    const stream = this.client.subscribe(request);

    stream.on('data', (update: SubscribeUpdate) => {
      if (update.account) {
        onAccountUpdate(this.parseAccountUpdate(update.account));
      }
      if (update.transaction) {
        onTransactionUpdate(this.parseTransactionUpdate(update.transaction));
      }
    });

    stream.on('error', (err) => this.handleError(err));
    stream.on('end', () => this.handleDisconnect());
  }

  private async handleDisconnect(): Promise<void> {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
      await sleep(delay);
      await this.connect();
      await this.subscribe(/* ... */);
    }
  }
}
```

```typescript
// backend/src/crank/order-monitor.ts - Modified
export class OrderMonitor {
  private fumaroleClient: FumaroleClient | null = null;
  private orderCache: Map<string, OrderWithPda> = new Map();

  // Existing polling method (fallback)
  async fetchAllOpenOrders(): Promise<OrderWithPda[]> { /* ... */ }

  // New streaming method
  async startStreaming(): Promise<void> {
    if (!this.config.streaming?.enabled) {
      console.log('[OrderMonitor] Streaming disabled, using polling');
      return;
    }

    this.fumaroleClient = new FumaroleClient(
      this.config.streaming.fumaroleEndpoint,
      this.config.streaming.accessToken,
      [{ owner: this.programId.toBase58(), dataSize: ORDER_ACCOUNT_SIZE_V5 }]
    );

    await this.fumaroleClient.connect();
    await this.fumaroleClient.subscribe(
      (update) => this.handleAccountUpdate(update),
      (tx) => this.handleTransactionUpdate(tx)
    );
  }

  private handleAccountUpdate(update: AccountUpdate): void {
    const order = this.parseOrder(Buffer.from(update.data));

    if (order.status === OrderStatus.Active && !order.isMatching) {
      // New or updated active order
      this.orderCache.set(update.pubkey, { pda: new PublicKey(update.pubkey), order });
      this.emit('orderUpdate', { type: 'upsert', order });
    } else {
      // Order no longer active
      this.orderCache.delete(update.pubkey);
      this.emit('orderUpdate', { type: 'remove', pubkey: update.pubkey });
    }
  }
}
```

**Acceptance Criteria:**
- [ ] Fumarole client connects and authenticates
- [ ] Order updates received within <100ms of on-chain confirmation
- [ ] Automatic reconnection on disconnect
- [ ] Graceful fallback to polling if streaming unavailable
- [ ] No missed orders during reconnection (cursor persistence)

---

### Phase 2: MPC Event Streaming (Priority: HIGH)

**Goal:** Remove MPC polling entirely, rely on transaction stream for events

**Current:** `mpc-poller.ts` has dual modes (polling + log subscription)
**Target:** Transaction stream only, remove polling code path

**Files to modify:**
- `backend/src/crank/mpc-poller.ts` - Remove polling, enhance event handling
- `backend/src/stream/account-stream.ts` - Add MXE transaction parsing

**Implementation:**

```typescript
// Enhanced MPC event handling via transaction stream
export class MpcEventProcessor {
  async processTransaction(tx: TransactionUpdate): Promise<void> {
    // Check if transaction involves MXE program
    if (!tx.accountKeys.includes(this.mxeProgramId.toBase58())) {
      return;
    }

    // Parse logs for events
    for (const log of tx.meta.logMessages) {
      if (log.startsWith('Program data: ')) {
        const eventData = this.parseEventData(log);
        await this.handleMxeEvent(eventData, tx.signature);
      }
    }
  }
}
```

**Acceptance Criteria:**
- [ ] MPC events processed within <50ms of transaction confirmation
- [ ] Polling code removed from hot path
- [ ] Event deduplication maintained
- [ ] No missed callbacks during high throughput

---

### Phase 3: WebSocket Gateway for Frontend (Priority: MEDIUM)

**Goal:** Replace frontend `getProgramAccounts` polling with WebSocket subscription

**Files to create:**
- `backend/src/stream/websocket-gateway.ts` - WebSocket server
- `frontend/src/hooks/use-streaming-order-book.ts` - New hook

**Files to modify:**
- `backend/src/index.ts` - Add WebSocket server
- `frontend/src/hooks/use-order-book.ts` - Add streaming mode

**Architecture:**

```
Frontend Browser                 Backend Gateway              Fumarole
      │                               │                           │
      │  WebSocket connect            │                           │
      ├──────────────────────────────►│                           │
      │                               │  gRPC subscribe           │
      │                               ├──────────────────────────►│
      │                               │                           │
      │                               │◄─────Account update───────│
      │◄─────JSON message─────────────│                           │
      │                               │◄─────Account update───────│
      │◄─────JSON message─────────────│                           │
      │                               │                           │
```

**Implementation:**

```typescript
// backend/src/stream/websocket-gateway.ts
import { WebSocketServer, WebSocket } from 'ws';

export class OrderBookGateway {
  private wss: WebSocketServer;
  private clients: Map<string, Set<WebSocket>> = new Map(); // pairPda -> clients

  constructor(private fumaroleClient: FumaroleClient) {
    this.wss = new WebSocketServer({ noServer: true });
  }

  handleConnection(ws: WebSocket, pairPda: string): void {
    // Add client to subscription group
    if (!this.clients.has(pairPda)) {
      this.clients.set(pairPda, new Set());
    }
    this.clients.get(pairPda)!.add(ws);

    // Send current order book snapshot
    const snapshot = this.buildOrderBookSnapshot(pairPda);
    ws.send(JSON.stringify({ type: 'snapshot', data: snapshot }));

    ws.on('close', () => {
      this.clients.get(pairPda)?.delete(ws);
    });
  }

  broadcastUpdate(pairPda: string, update: OrderBookUpdate): void {
    const clients = this.clients.get(pairPda);
    if (!clients) return;

    const message = JSON.stringify({ type: 'update', data: update });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}
```

```typescript
// frontend/src/hooks/use-streaming-order-book.ts
export function useStreamingOrderBook(pairPda?: string) {
  const [orderBook, setOrderBook] = useState<OrderBook>({ asks: [], bids: [] });
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket(`${WS_ENDPOINT}/orderbook/${pairPda}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'snapshot') {
        setOrderBook(message.data);
      } else if (message.type === 'update') {
        setOrderBook(prev => applyUpdate(prev, message.data));
      }
    };

    ws.onclose = () => {
      // Reconnect with backoff
      setTimeout(() => connectWs(), 1000);
    };

    return () => ws.close();
  }, [pairPda]);

  return orderBook;
}
```

**Acceptance Criteria:**
- [ ] Frontend receives order book updates within <200ms
- [ ] No polling after initial WebSocket connection
- [ ] Graceful reconnection with state recovery
- [ ] Supports multiple trading pairs per connection

---

### Phase 4: Optional Richat Self-Hosting (Priority: LOW)

**Goal:** Reduce bandwidth costs by running local Richat multiplexer

**When to implement:** When streaming bandwidth exceeds $50/month

**Benefits:**
- Single Fumarole connection fans out to multiple services
- Local caching reduces redundant data transfer
- QUIC protocol for even lower latency

**Files to create:**
- `infra/richat/config.yml` - Richat configuration
- `infra/richat/docker-compose.yml` - Container deployment
- `docs/RICHAT_SETUP.md` - Setup documentation

**Configuration:**

```yaml
# infra/richat/config.yml
sources:
  fumarole:
    type: yellowstone_grpc
    endpoint: "https://fumarole.triton.one"
    token: "${FUMAROLE_TOKEN}"

filters:
  confidex:
    accounts:
      owner: ["63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB"]

outputs:
  grpc:
    bind: "0.0.0.0:10000"
  websocket:
    bind: "0.0.0.0:10001"
  quic:
    bind: "0.0.0.0:10002"
```

---

## Migration Strategy

### Feature Flags

```typescript
// backend/src/crank/config.ts
export interface StreamingConfig {
  enabled: boolean;

  // Dual subscription endpoints (per Triton recommendation)
  dexStream: {
    endpoint: string;
    accessToken: string;
  };
  mxeStream: {
    endpoint: string;
    accessToken: string;
  };

  // Fallback configuration (CRITICAL - no Triton SLA)
  fallback: {
    enabled: boolean;           // Always true for production
    provider: 'helius' | 'triton-rpc';
    heliusApiKey?: string;
    pollingIntervalMs: number;  // Fallback polling rate
  };

  // Health monitoring thresholds
  healthCheck: {
    maxLatencyMs: 5000;         // Trigger failover if exceeded
    maxSilenceMs: 30000;        // No messages threshold
    maxReconnectAttempts: 3;    // Before switching to fallback
    errorRateThreshold: 0.1;    // 10% error rate triggers failover
  };

  // Per-feature flags for gradual rollout
  features: {
    orderMonitoring: boolean;   // Phase 1
    mpcEvents: boolean;         // Phase 2
    frontendGateway: boolean;   // Phase 3
  };
}

// Example production config
const productionConfig: StreamingConfig = {
  enabled: true,
  dexStream: {
    endpoint: 'https://fumarole.triton.one',
    accessToken: process.env.FUMAROLE_TOKEN!,
  },
  mxeStream: {
    endpoint: 'https://fumarole.triton.one',
    accessToken: process.env.FUMAROLE_TOKEN!,
  },
  fallback: {
    enabled: true,  // ALWAYS true - no SLA guarantee
    provider: 'helius',
    heliusApiKey: process.env.HELIUS_API_KEY,
    pollingIntervalMs: 3000,
  },
  healthCheck: {
    maxLatencyMs: 5000,
    maxSilenceMs: 30000,
    maxReconnectAttempts: 3,
    errorRateThreshold: 0.1,
  },
  features: {
    orderMonitoring: true,
    mpcEvents: true,
    frontendGateway: true,
  },
};
```

### Rollout Plan

| Week | Phase | Change | Rollback Plan |
|------|-------|--------|---------------|
| 1 | 1a | Deploy streaming client (disabled) | N/A |
| 2 | 1b | Enable for 10% of order monitoring | Disable flag |
| 3 | 1c | Enable for 100% of order monitoring | Disable flag |
| 4 | 2a | Remove MPC polling, use event stream only | Re-enable polling |
| 5 | 3a | Deploy WebSocket gateway | N/A |
| 6 | 3b | Migrate frontend to WebSocket | Revert to polling hook |
| 8 | 4 | Evaluate Richat self-hosting | Continue with Fumarole direct |

### Monitoring & Alerts

```typescript
// Metrics to track during migration
const streamingMetrics = {
  // Latency
  orderUpdateLatencyMs: histogram,      // Time from on-chain to processed
  mpcEventLatencyMs: histogram,
  websocketMessageLatencyMs: histogram,

  // Reliability
  streamDisconnectCount: counter,
  reconnectSuccessCount: counter,
  fallbackTriggerCount: counter,

  // Throughput
  ordersProcessedPerSecond: gauge,
  eventsProcessedPerSecond: gauge,

  // Cost
  bandwidthBytesReceived: counter,
  queriesSavedVsPolling: counter,
};
```

---

## Cost Comparison

### Current (Polling)

| Service | Queries/Month | Cost |
|---------|---------------|------|
| Backend order polling | 1.65M | $16.50 |
| Backend MPC polling | 0.86M | $8.60 |
| Frontend (100 users) | 17.3M | $173.00 |
| **Total** | **19.8M** | **$198.10** |

### Target (Streaming)

| Service | Bandwidth/Month | Cost |
|---------|-----------------|------|
| Fumarole stream (filtered) | ~5 GB | $0.25 |
| WebSocket gateway bandwidth | ~10 GB | $0.50 |
| **Total** | **~15 GB** | **$0.75** |

**Monthly Savings: ~$197 (99.6% reduction)**

---

## Testing Plan

### Unit Tests

```typescript
// backend/src/stream/__tests__/fumarole-client.test.ts
describe('FumaroleClient', () => {
  it('connects and authenticates', async () => { /* ... */ });
  it('handles reconnection on disconnect', async () => { /* ... */ });
  it('parses account updates correctly', async () => { /* ... */ });
  it('falls back to polling when streaming unavailable', async () => { /* ... */ });
});
```

### Integration Tests

```typescript
// backend/src/stream/__tests__/integration.test.ts
describe('Streaming Integration', () => {
  it('receives order updates within 100ms of confirmation', async () => {
    // Place order on-chain
    const placedAt = Date.now();
    await placeTestOrder();

    // Wait for stream update
    const update = await waitForStreamUpdate();
    const latency = update.receivedAt - placedAt;

    expect(latency).toBeLessThan(100);
  });
});
```

### Load Tests

```typescript
// Simulate high order volume
describe('Streaming Load Test', () => {
  it('handles 100 orders/second without message loss', async () => {
    const orderCount = 1000;
    const receivedUpdates = new Set();

    // Subscribe to stream
    client.on('orderUpdate', (update) => {
      receivedUpdates.add(update.orderPda);
    });

    // Place orders rapidly
    for (let i = 0; i < orderCount; i++) {
      await placeOrder();
      await sleep(10); // 100 orders/second
    }

    // Wait for propagation
    await sleep(5000);

    expect(receivedUpdates.size).toBe(orderCount);
  });
});
```

---

## Risks & Mitigations

### Critical: No SLA Guarantee

Triton confirmed they **do not provide SLA for Solana infrastructure** - only for their own software. This means:
- No guaranteed uptime percentage
- No response time commitments
- No compensation for outages

**Mitigation Strategy:**
1. **Multi-provider failover**: Helius as primary backup
2. **Automatic fallback**: Detect stream health, switch to polling if needed
3. **Health monitoring**: Track latency, missed events, reconnection frequency
4. **Data reconciliation**: Periodic full-state sync to catch any missed updates

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Fumarole outage (no SLA)** | Medium | **Critical** | Helius fallback, automatic failover, polling mode |
| Fumarole beta instability | Medium | High | Feature flag to disable, dual-provider setup |
| gRPC connection drops | Medium | Medium | Auto-reconnect with cursor persistence, health checks |
| WebSocket scalability | Low | Medium | Horizontal scaling, connection limits |
| Bandwidth cost underestimate | Low | Low | Start conservative (no estimation tools), monitor closely |
| Missing events during migration | Medium | High | Dual-write period with deduplication |
| Single subscription overload | Low | Medium | Dual subscriptions per Steve's recommendation |

### Fallback Architecture

```
Primary Path:                    Fallback Path:

Fumarole Stream ──┐              ┌── Helius RPC
       │          │              │        │
       ▼          │              │        ▼
Stream Aggregator │   FAILOVER   │  Polling Mode
       │          │ ◄──────────► │        │
       ▼          │              │        ▼
  Crank Service ──┘              └── Crank Service

Health Check Triggers:
- Stream latency > 5s
- No messages for > 30s
- Reconnection failures > 3
- gRPC error rate > 10%
```

---

## Success Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Order detection latency | 5-15s | <100ms | P99 latency histogram |
| MPC callback latency | 3-6s | <500ms | P99 latency histogram |
| Frontend refresh rate | 15s | Real-time | WebSocket message rate |
| Monthly RPC cost | ~$200 | <$5 | Triton billing |
| Missed orders | Unknown | 0 | Reconciliation checks |

---

## Appendix: Triton Contact & Confirmed Information

**Steve CleanBrook** - BD Lead
- X: @SteveCleanBrook
- For Fumarole beta access

### Confirmed Information (January 2026)

| Topic | Confirmed Status |
|-------|------------------|
| **Fumarole Beta** | Exiting beta in a few weeks, deploying to all regions |
| **SLA** | **No SLA for Solana** - only for Triton's own software |
| **Bandwidth Estimation** | No tools available (suggestion noted for future) |
| **Cascade Integration** | Fumarole is read-only, cannot trigger transactions |
| **Multi-Program Filtering** | Possible but recommended to use separate subscriptions |

### Pricing Reference (from call)
- Streaming: $0.05/GB (no query fee)
- Standard RPC: $0.05/GB + $10/1M queries
- Ledger >10 epochs: $0.05/GB + $25/1M queries
- Third-party APIs: $0.05/GB + $50/1M queries

### Key Takeaways for Confidex

1. **No SLA means we need fallbacks** - Helius remains critical infrastructure
2. **Separate subscriptions are better** - One for DEX, one for MXE
3. **Fumarole is data-only** - Transaction submission needs separate RPC
4. **Beta exit imminent** - Can plan production migration with confidence
5. **Monitor bandwidth manually** - No pre-commit estimation available

---

## References

- [Triton Fumarole Docs](https://docs.triton.one/project-yellowstone/fumarole)
- [Yellowstone gRPC GitHub](https://github.com/rpcpool/yellowstone-grpc)
- [Richat GitHub](https://github.com/lamports-dev/richat)
- [Fumarole Blog Post](https://blog.triton.one/introducing-yellowstone-fumarole/)
