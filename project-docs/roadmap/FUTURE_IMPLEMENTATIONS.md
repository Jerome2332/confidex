# Confidex - Future Implementations Roadmap

**Last Updated:** January 24, 2026
**Status:** Post-Hackathon Planning

This document tracks future implementations, SDK integrations, and improvements planned for Confidex after the Solana Privacy Hack 2026 hackathon.

---

## Recently Completed (Hackathon)

The following features were implemented during the hackathon and are now live:

| Feature | Status | Notes |
|---------|--------|-------|
| **V5 Order Format** | ✅ Complete | 366-byte production format, no plaintext fields |
| **Arcium MPC Integration** | ✅ Complete | Cluster 456, MXE keygen complete, 10 circuits |
| **Automated Crank Service** | ✅ Complete | PM2 production, distributed locking, error classification |
| **Settlement Executor** | ✅ Complete | Race condition prevention, failure cooldown |
| **ZK Eligibility Proofs** | ✅ Complete | Sunspot Groth16 via deployed verifier |
| **Encrypted Perpetuals** | ✅ Complete | Hidden positions with public liquidation thresholds |
| **MPC Test Suite** | ✅ Complete | 18 tests covering encryption, cluster, circuits |
| **Error Handling Infrastructure** | ✅ Complete | 500+ lines, retry with classification |
| **Timeout Handling** | ✅ Complete | Promise.race() wrapper for all network ops |

## Recently Completed (Post-Hackathon - January 2026)

| Feature | Status | Notes |
|---------|--------|-------|
| **WebSocket Streaming** | ✅ Complete | Socket.IO + Redis adapter for horizontal scaling |
| **Pyth Oracle Integration** | ✅ Complete | Hermes SSE streaming with staleness detection |
| **BullMQ Job Queues** | ✅ Complete | Liquidation queue with retry/deduplication |
| **Jito MEV Protection** | ✅ Complete | Bundle builder, block engine client |
| **TimescaleDB Analytics** | ✅ Complete | Client, config, REST API routes |
| **Frontend Streaming Hooks** | ✅ Complete | useWebSocket, useOrderStream, usePriceStream, etc. |
| **Event Broadcasting** | ✅ Complete | Privacy-enforced event types (no encrypted fields) |

---

## Priority Legend

| Priority | Description |
|----------|-------------|
| **P0** | Critical for production launch |
| **P1** | Important for user experience |
| **P2** | Nice to have / stretch goals |
| **P3** | Research / exploration |

---

## 1. C-SPL SDK Integration

**Priority:** P0
**Status:** Waiting for SDK release
**Estimated Effort:** 2-3 weeks

### Background

C-SPL (Confidential SPL) is Solana's native confidential token standard. Currently "going live on devnet soon" as of January 2026, but SDK not yet available.

### Current State

- ShadowWire implemented as primary settlement layer (production fallback)
- C-SPL interface stubs built awaiting SDK
- Dual settlement architecture ready

### Implementation Tasks

- [ ] Monitor C-SPL SDK release announcements
- [ ] Replace stub implementations in `frontend/src/lib/settlement/providers/cspl-provider.ts`
- [ ] Update `frontend/src/hooks/use-cspl-settlement.ts` with real SDK calls
- [ ] Test confidential token wrapping/unwrapping flow
- [ ] Update `programs/confidex_dex/src/settlement/` with C-SPL CPI calls
- [ ] Benchmark C-SPL vs ShadowWire settlement performance
- [ ] Migrate users from ShadowWire to C-SPL (optional, maintain dual support)

### Files to Update

| File | Change Required |
|------|-----------------|
| `frontend/src/lib/settlement/providers/cspl-provider.ts` | Replace stubs with SDK |
| `frontend/src/hooks/use-cspl-settlement.ts` | Real encryption/decryption |
| `frontend/src/hooks/use-encrypted-balance.ts` | C-SPL balance queries |
| `programs/confidex_dex/src/settlement/mod.rs` | C-SPL CPI integration |
| `programs/confidex_dex/src/instructions/wrap_tokens.rs` | C-SPL wrapping |
| `programs/confidex_dex/src/instructions/unwrap_tokens.rs` | C-SPL unwrapping |

### Resources

- Arcium C-SPL announcement: https://docs.arcium.com (check for updates)
- SPL Token-2022 Confidential Extension: Background reference

---

## 2. Helius getTransactionsForAddress API

**Priority:** P1
**Status:** Requires Developer Plan ($49/month)
**Estimated Effort:** 1 week

### Background

New Helius-exclusive RPC method that solves the ATA (Associated Token Account) transaction visibility problem. Our current `getSignaturesForAddress` misses transactions that only touch token accounts.

### Benefits for Confidex

| Feature | Impact |
|---------|--------|
| Complete MPC settlement tracking | ATAs now visible |
| `balanceChanged` filter | Clean trade history, no spam |
| Single API call | Replace multi-step fetch/parse |
| Time-based filtering | Analytics, session activity |
| Better pagination | `slot:position` format |

### Implementation Tasks

- [ ] Upgrade Helius plan to Developer ($49/month)
- [ ] Add `getTransactionsForAddress` function to `frontend/src/lib/helius-client.ts`
- [ ] Update `frontend/src/hooks/use-trade-history.ts` to use new API
- [ ] Add `tokenAccounts: 'balanceChanged'` filter for complete visibility
- [ ] Implement proper pagination with `paginationToken`
- [ ] Add time-based filtering for analytics dashboard
- [ ] Test on devnet (note: 2-week retention limit)

### API Details

```typescript
// New implementation pattern
const response = await fetch(heliusRpcUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'getTransactionsForAddress',
    params: [
      walletAddress,
      {
        transactionDetails: 'full',
        sortOrder: 'asc',
        limit: 100,
        filters: {
          tokenAccounts: 'balanceChanged',
          status: 'succeeded'
        }
      }
    ]
  })
});
```

### Documentation

Full API reference: [HELIUS_GET_TRANSACTIONS_FOR_ADDRESS.md](./HELIUS_GET_TRANSACTIONS_FOR_ADDRESS.md)

---

## 3. Inco Lightning Integration

**Priority:** P2
**Status:** Stretch goal (potential $6K prize)
**Estimated Effort:** 2-3 weeks

### Background

Inco Lightning is a TEE-based confidential computing platform. Could serve as alternative or complement to Arcium MPC for encrypted balance storage.

### Prize Tracks

- DeFi: $2,000
- Consumer/Gaming/Prediction Markets: $2,000
- Payments: $2,000

### Potential Integration Paths

**Option A: Encrypted Balance Storage**
```
Layer 1: Noir ZK (compliance) - unchanged
Layer 2: Arcium MPC (order matching) - unchanged
Layer 3: Inco (encrypted balance storage) - NEW
```

**Option B: Hybrid Operations**
- Use Arcium for order matching (stronger security)
- Use Inco for simpler encrypted operations (CPI-based)

### Implementation Tasks

- [ ] Add Inco SDK dependency (`@inco/solana-sdk`)
- [ ] Create `frontend/src/lib/inco.ts` client
- [ ] Implement `Euint128` storage for user positions
- [ ] Test TEE-based encrypted comparisons
- [ ] Document as "alternative settlement layer"
- [ ] Create demo showing Inco integration

### Technical Notes

| Aspect | Inco | Arcium |
|--------|------|--------|
| Security | TEE trust | Cryptographic MPC |
| Complexity | Simpler (CPI) | Complex (circuits) |
| Operations | `e_add`, `e_sub`, `e_ge` | Custom Arcis circuits |
| Handle size | 128-bit | 64-byte ciphertext |

### Resources

- Inco Docs: https://docs.inco.org/svm/introduction
- Program ID (Devnet): `5sjEbPiqgZrYwR31ahR6Uk9wf5awoX61YGg7jExQSwaj`

---

## 4. Advanced Order Types

**Priority:** P1
**Status:** Planning complete, ready for implementation
**Estimated Effort:** 6-8 weeks
**Detailed Plan:** [ADVANCED_ORDER_TYPES_PLAN.md](./ADVANCED_ORDER_TYPES_PLAN.md)

### Planned Order Types

| Order Type | Priority | Description | Complexity |
|------------|----------|-------------|------------|
| **Stop-Loss** | P0 | Execute at trigger price to limit losses | Medium |
| **Take-Profit** | P0 | Close at profit target | Medium |
| **Time-in-Force** | P0 | GTC/IOC/FOK/GTD order expiration | Low |
| **Stop-Limit** | P1 | Controlled stop execution with limit | Medium |
| **OCO** | P1 | One-cancels-other (combined SL/TP) | High |
| **Trailing Stop** | P1 | Dynamic stop based on price movement | High |
| **Reduce-Only** | P1 | Perpetuals position reduction only | Low |
| **Post-Only** | P2 | Maker-only orders | Medium |
| **Iceberg** | P2 | Hidden large orders | Medium |
| **TWAP** | P3 | Time-weighted execution slicing | High |

### Key Architecture Decisions

1. **Privacy Model:** Hybrid approach (same as perps liquidation)
   - Trigger price: **Public** (enables keeper discovery)
   - Order amount: **Encrypted** (maintains privacy)
   - MPC verifies trigger matches encrypted parameters

2. **Keeper System:** Off-chain bots monitor prices and submit trigger transactions
   - Incentivized via execution fees
   - MEV protection through encrypted amounts

3. **Infrastructure Required:**
   - Trigger evaluation engine (Pyth oracle integration)
   - Order expiry/cleanup crank
   - Order linking for OCO pairs
   - Extended order state machine

### Implementation Phases

| Phase | Weeks | Deliverables |
|-------|-------|--------------|
| 1. Foundation | 1-2 | Extended order structs, time-in-force, oracle integration |
| 2. Stop-Loss/TP | 3-4 | Core conditional orders, keeper bot v1 |
| 3. OCO/Trailing | 5-6 | Linked orders, dynamic stops, enhanced keeper |
| 4. Frontend | 7-8 | UI components, testing, documentation |

### Tasks

- [ ] Review and finalize [ADVANCED_ORDER_TYPES_PLAN.md](./ADVANCED_ORDER_TYPES_PLAN.md)
- [ ] Extend `OrderType` enum with new variants
- [ ] Implement `ConditionalOrder` account structure
- [ ] Add Pyth oracle parsing on-chain
- [ ] Build keeper bot infrastructure
- [ ] Implement stop-loss/take-profit instructions
- [ ] Add OCO order pair linking
- [ ] Implement trailing stop with peak tracking
- [ ] Build frontend conditional order components
- [ ] Write comprehensive test suite

---

## 5. Cross-Chain Privacy Bridge

**Priority:** P3
**Status:** Research phase
**Estimated Effort:** 2-3 months

### Concept

Enable private token transfers between Solana and other chains while maintaining confidentiality.

### Potential Approaches

1. **Wormhole + MPC**: Bridge messages with encrypted payloads
2. **ZK Light Clients**: Verify cross-chain state privately
3. **MPC Custody**: Multi-party bridge custody

### Research Tasks

- [ ] Survey existing bridge architectures
- [ ] Assess privacy guarantees of each approach
- [ ] Prototype basic cross-chain proof verification
- [ ] Evaluate latency/cost tradeoffs

---

## 6. Mobile Native App

**Priority:** P2
**Status:** Post-web optimization
**Estimated Effort:** 6-8 weeks

### Background

Current web app is mobile-responsive, but native app would provide better UX for active traders.

### Planned Features

- Push notifications for order fills
- Biometric authentication
- Offline proof generation (cached circuit)
- Deep wallet integration

### Technology Options

| Framework | Pros | Cons |
|-----------|------|------|
| React Native | Code sharing with web | Performance overhead |
| Expo | Faster development | Limited native access |
| Flutter | High performance | Different codebase |
| Native (Swift/Kotlin) | Best performance | Double development |

### Tasks

- [ ] Decide on framework
- [ ] Port core client library
- [ ] Implement secure key storage
- [ ] Add push notification infrastructure
- [ ] App store submissions

---

## 7. Analytics Dashboard

**Priority:** P1
**Status:** ✅ Core Infrastructure Complete (January 2026)
**Estimated Effort:** 2-3 weeks
**Detailed Plan:** [ANALYTICS_DASHBOARD_PLAN.md](./ANALYTICS_DASHBOARD_PLAN.md)

### Implementation Status

| Component | Status | Files |
|-----------|--------|-------|
| TimescaleDB Client | ✅ Complete | `backend/src/analytics/timescale-client.ts` |
| Analytics Config | ✅ Complete | `backend/src/analytics/config.ts` |
| REST API Endpoints | ✅ Complete | `backend/src/analytics/routes.ts` |
| WebSocket Server | ✅ Complete | `backend/src/streaming/websocket-server.ts` |
| Event Broadcaster | ✅ Complete | `backend/src/streaming/event-broadcaster.ts` |
| Frontend Hooks | ✅ Complete | `frontend/src/hooks/streaming/*.ts` |
| Schema Migration | 🔲 Pending | SQL migration for hypertables |
| Dashboard UI | 🔲 Pending | Frontend analytics page |

### Key Privacy Principle

| Data Type | Visibility | Example |
|-----------|------------|---------|
| **PUBLIC** | Can be indexed/displayed | Order counts, OI totals, funding rates |
| **PRIVATE** | Never indexed, client-decrypt only | encrypted_amount, encrypted_price |

### Architecture Components

| Component | Technology | Purpose |
|-----------|------------|---------|
| Database | TimescaleDB | Time-series metrics, continuous aggregates |
| Cache | Redis | Hot metrics, WebSocket pub/sub |
| API | Express.js | REST endpoints for analytics |
| Real-time | Socket.IO | Live metric streaming |

### REST API Endpoints (Implemented)

| Endpoint | Response |
|----------|----------|
| `GET /api/analytics/global` | Total orders, pairs, positions |
| `GET /api/analytics/orders` | Order activity metrics |
| `GET /api/analytics/trades` | Trade history (public fields only) |
| `GET /api/analytics/liquidations` | Liquidation events |
| `GET /api/analytics/markets` | Market-level statistics |

### Frontend Hooks (Implemented)

| Hook | File | Purpose |
|------|------|---------|
| `useWebSocket` | `use-websocket.tsx` | Core connection management |
| `useOrderStream` | `use-order-stream.ts` | Real-time order events |
| `useTradeStream` | `use-trade-stream.ts` | Trade event aggregation |
| `usePriceStream` | `use-price-stream.ts` | Pyth oracle prices |
| `useGlobalStats` | `use-global-stats.ts` | Exchange-wide metrics |

### Remaining Tasks

- [ ] Create TimescaleDB schema migration (`migrations/001_analytics_timescale.sql`)
- [ ] Create frontend dashboard page (`/analytics`)
- [ ] Build `GlobalKPICards`, `PairOverview`, `PerpMarketHealth` components
- [ ] Implement `OpenInterestGauge`, `FundingRateChart`, `LiquidationFeed`
- [ ] Add user portfolio with client-side decryption
- [ ] Write privacy audit tests (no encrypted fields in API/DB)

---

## 8. Governance & DAO

**Priority:** P3
**Status:** Long-term vision
**Estimated Effort:** 2-3 months

### Concept

Decentralized governance for Confidex protocol parameters.

### Governed Parameters

- Trading fees
- Supported trading pairs
- Blacklist merkle root updates
- Settlement provider selection
- MPC cluster configuration

### Privacy-Preserving Voting

Potential integration with Arcium for:
- Encrypted vote weights
- Hidden voting choices until tally
- Proof of token ownership without balance reveal

### Tasks

- [ ] Research privacy-preserving voting schemes
- [ ] Design token economics
- [ ] Implement governance program
- [ ] Build voting UI
- [ ] Token distribution plan

---

## 9. Institutional API

**Priority:** P1
**Status:** Post-launch
**Estimated Effort:** 3-4 weeks

### Planned Features

| Feature | Description |
|---------|-------------|
| REST API | Programmatic order submission |
| WebSocket | Real-time order updates |
| FIX Protocol | Industry-standard trading protocol |
| Sub-accounts | Managed trading for funds |
| Reporting | Compliance exports (encrypted) |

### Authentication

- API keys with granular permissions
- IP whitelisting
- Rate limiting
- Audit logging

### Tasks

- [ ] Design API specification (OpenAPI)
- [ ] Implement authentication layer
- [ ] Build REST endpoints
- [ ] Add WebSocket streaming
- [ ] Create SDK libraries (Python, TypeScript)
- [ ] Documentation and examples

---

## 10. Performance Optimizations

**Priority:** P1
**Status:** Ongoing
**Estimated Effort:** Continuous

### Current Metrics

| Operation | Current | Target |
|-----------|---------|--------|
| ZK proof generation | ~2.5s | < 1s |
| MPC price comparison | ~450ms | < 200ms |
| Order submission | ~1.8s | < 1s |
| Settlement | ~350ms | ~350ms (1 slot limit) |

### Optimization Areas

**Client-Side:**
- [ ] Circuit optimization (fewer constraints)
- [ ] WASM compilation improvements
- [ ] Proof caching strategies
- [ ] Parallel proof generation

**Server-Side:**
- [ ] MPC batching for multiple orders
- [ ] Connection pooling
- [ ] Transaction bundling

**On-Chain:**
- [ ] Account compression
- [ ] Compute unit optimization
- [ ] Lookup tables for common accounts

---

## 11. Liquidation Bot Infrastructure

**Priority:** P1
**Status:** ✅ Core Infrastructure Complete (January 2026)
**Estimated Effort:** 2 weeks
**Detailed Plan:** [LIQUIDATION_BOT_PLAN.md](./LIQUIDATION_BOT_PLAN.md)

### Implementation Status

| Component | Status | Files |
|-----------|--------|-------|
| Pyth Hermes Client | ✅ Complete | `backend/src/prices/pyth-hermes-client.ts` |
| Price Cache | ✅ Complete | `backend/src/prices/price-cache.ts` |
| BullMQ Queue | ✅ Complete | `backend/src/queues/liquidation-queue.ts` |
| Queue Manager | ✅ Complete | `backend/src/queues/queue-manager.ts` |
| Jito Client | ✅ Complete | `backend/src/jito/jito-client.ts` |
| Bundle Builder | ✅ Complete | `backend/src/jito/bundle-builder.ts` |
| WebSocket Streaming | ✅ Complete | `backend/src/streaming/` |
| Liquidation Checker | ✅ Enhanced | `backend/src/crank/liquidation-checker.ts` |
| Prometheus Metrics | 🔲 Pending | Integration with existing metrics |
| Admin Dashboard | 🔲 Pending | Frontend admin pages |

### Background

Perpetual positions have public liquidation thresholds (`liquidatable_below_price`, `liquidatable_above_price`) but need external actors (keepers) to trigger liquidations. The liquidation bot earns bonuses for maintaining protocol health.

### Privacy Model

| Data Type | Visibility | Used For |
|-----------|------------|----------|
| **PUBLIC** | `liquidatable_below_price`, `liquidatable_above_price`, `threshold_verified` | Keeper discovery |
| **PRIVATE** | `encrypted_size`, `encrypted_collateral`, `encrypted_pnl` | MPC verification |

### Implemented Components

| Component | Description | File |
|-----------|-------------|------|
| Price Monitor | Pyth Hermes SSE streaming with staleness checks | `pyth-hermes-client.ts` |
| Price Cache | In-memory cache with TTL and staleness detection | `price-cache.ts` |
| Liquidation Queue | BullMQ with retry, deduplication, job persistence | `liquidation-queue.ts` |
| TX Executor | Jito bundle submission for MEV protection | `jito-client.ts` |
| Bundle Builder | Transaction construction with tip instructions | `bundle-builder.ts` |

### Environment Variables Added

```bash
# Pyth Oracle
PYTH_HERMES_URL=https://hermes.pyth.network
PYTH_STALENESS_THRESHOLD_MS=30000
SOL_USD_FEED_ID=ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d

# Jito MEV Protection
JITO_ENABLED=false  # Disable for devnet
JITO_BLOCK_ENGINE_URL=https://mainnet.block-engine.jito.wtf
JITO_TIP_LAMPORTS=10000

# Job Queue
REDIS_ENABLED=true
REDIS_URL=redis://localhost:6379
```

### Remaining Tasks

- [ ] Complete Pyth oracle integration in `perp_liquidate.rs` (mark_price TODO)
- [ ] Integrate Prometheus metrics with liquidation events
- [ ] Build admin dashboard endpoints for liquidation monitoring
- [ ] Test with devnet positions in production-like environment
- [ ] Enable Jito on mainnet deployment

---

## 12. Enhanced ZK Circuits

**Priority:** P2
**Status:** Planning complete, ready for implementation
**Estimated Effort:** 4-6 weeks
**Detailed Plan:** [ENHANCED_ZK_CIRCUITS_PLAN.md](./ENHANCED_ZK_CIRCUITS_PLAN.md)

### Architecture

Unified verifier program with circuit type discriminator (1 byte):
- `0x00` - Eligibility (existing)
- `0x01` - Range Proof
- `0x02` - Solvency Proof
- `0x03` - KYC Attestation
- `0x04` - Credit Score

### Planned Circuits

| Circuit | Purpose | Constraints | Use Case |
|---------|---------|-------------|----------|
| **Range Proof** | Prove `min ≤ value ≤ max` | ~3,500 | Order amount bounds |
| **Solvency** | Prove `reserves ≥ liabilities` | ~9,000 | Proof of reserves |
| **KYC Attestation** | Prove valid KYC from provider | ~6,500 | Identity verification |
| **Credit Score** | Prove `score ≥ threshold` | ~4,500 | Credit requirements |

### Privacy Model

| Circuit | Public Inputs | Private Inputs | Guarantee |
|---------|---------------|----------------|-----------|
| Range Proof | commitment, bounds | value, blinding | Value hidden |
| Solvency | root, ratio | reserves, balances | Balances hidden |
| KYC | user_hash, level_req | actual_level, PII | PII never revealed |
| Credit Score | user_hash, threshold | score | Exact score hidden |

### Implementation Phases

| Phase | Weeks | Focus |
|-------|-------|-------|
| 1. Foundation | 1-2 | Shared library, unified verifier, build scripts |
| 2. Range Proofs | 3 | Circuit, frontend hook, order integration |
| 3. KYC/Credit | 4 | Circuits, provider registry, verification |
| 4. Solvency | 5 | Merkle-sum-tree, proof of reserves |
| 5. Deployment | 6 | Testing, benchmarking, audit prep |

### Tasks

- [ ] Review and finalize [ENHANCED_ZK_CIRCUITS_PLAN.md](./ENHANCED_ZK_CIRCUITS_PLAN.md)
- [ ] Create `circuits/shared/` library with Poseidon2/Merkle utilities
- [ ] Implement unified verifier program structure
- [ ] Write `circuits/range_proof/src/main.nr`
- [ ] Write `circuits/solvency/src/main.nr` and `inclusion.nr`
- [ ] Write `circuits/kyc_attest/src/main.nr`
- [ ] Write `circuits/credit_score/src/main.nr`
- [ ] Implement `KycProviderRegistry` on-chain account
- [ ] Create frontend `useCircuitProofs` hook
- [ ] Build merkle-sum-tree service for solvency
- [ ] Deploy unified verifier to devnet
- [ ] Performance benchmarking
- [ ] Security audit preparation

---

## Dependencies & Timeline

```
Q1 2026 (Post-Hackathon)
├── C-SPL SDK release (waiting)
├── Helius Developer plan upgrade
├── ✅ Streaming data infrastructure (COMPLETE - Jan 2026)
│   ├── WebSocket server (Socket.IO + Redis)
│   ├── Pyth Hermes price streaming
│   ├── BullMQ job queues
│   ├── Jito MEV protection client
│   ├── TimescaleDB analytics client
│   └── Frontend streaming hooks
├── ✅ Analytics backend infrastructure (COMPLETE - Jan 2026)
├── ✅ Liquidation bot core infrastructure (COMPLETE - Jan 2026)
├── 🔲 Analytics dashboard UI (frontend)
└── 🔲 Admin monitoring dashboard

Q2 2026
├── Advanced order types
├── Institutional API v1
├── Mobile app prototype
└── Inco integration (optional)

Q3 2026
├── Performance optimizations
├── Enhanced ZK circuits
├── Cross-chain research
└── Governance design

Q4 2026+
├── DAO launch
├── Cross-chain bridge
├── Mobile app release
└── Institutional API v2
```

---

## Contributing

For each implementation:

1. Create feature branch from `main`
2. Update this document with progress
3. Add tests before merging
4. Update CLAUDE.md if new patterns emerge
5. Document in relevant PRD file

---

## References

- [CLAUDE.md](../CLAUDE.md) - Project overview and constraints
- [HELIUS_GET_TRANSACTIONS_FOR_ADDRESS.md](./HELIUS_GET_TRANSACTIONS_FOR_ADDRESS.md) - Helius API details
- [ARCIUM_MPC_INTEGRATION.md](./ARCIUM_MPC_INTEGRATION.md) - Current MPC architecture
- [PRIZE-STRATEGY.md](./PRIZE-STRATEGY.md) - Hackathon prize context
- [TODO.md](../TODO.md) - Current task tracking
