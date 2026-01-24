# Backend Test Coverage Plan - Path to 100%

**Current Coverage:** 93.07%
**Target:** 100%

---

## Phase 1: Quick Wins (Easy, High Impact)

### 1.1 match-executor.ts (94.26% → 98%)
**Uncovered Lines:** 387-388, 394-410
**Effort:** Low | **Impact:** +4%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| `getPendingComputation` returns undefined for non-existent pair | 387-388 | Unit |
| `cleanupStaleComputations` returns 0 when no stale items | 394-410 | Unit |
| `cleanupStaleComputations` removes aged computations | 394-410 | Unit |

### 1.2 distributed-lock.ts (93.99% → 98%)
**Uncovered Lines:** 216-218, 250-257
**Effort:** Low | **Impact:** +4%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| Auto-extend timer fires at 50% of TTL | 216-218 | Unit |
| Heartbeat extends all held locks | 250-257 | Unit |
| Heartbeat respects `isShuttingDown` flag | 250-257 | Unit |

### 1.3 blockhash-manager.ts (88.21% → 95%)
**Uncovered Lines:** 191-207, 291-297
**Effort:** Low | **Impact:** +7%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| `getBlockhashWithMaxAge` refreshes when cache is stale | 191-207 | Unit |
| `createBlockhashManagerFromEnv` parses env vars | 291-297 | Unit |
| `createBlockhashManagerFromEnv` uses defaults | 291-297 | Unit |

---

## Phase 2: Medium Complexity (Mocking Required)

### 2.1 rate-limit-redis.ts (80.22% → 90%)
**Uncovered Lines:** 272-275, 346-348
**Effort:** Medium | **Impact:** +10%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| Rate limiter allows request when `store.increment` throws | 272-275 | Unit+Mock |
| Error logged but request passes through | 272-275 | Unit+Mock |
| `closeRedisRateLimiter` handles disconnect error | 346-348 | Unit+Mock |

**Mocks Required:** Redis client, store methods

### 2.2 routes/admin/blacklist.ts (88.62% → 95%)
**Uncovered Lines:** 192-194, 223-253
**Effort:** Medium | **Impact:** +6%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| POST /sync with invalid private key format returns 400 | 223-253 | Integration |
| POST /sync parses base58 private key correctly | 223-253 | Integration |
| POST /sync parses JSON array private key correctly | 223-253 | Integration |
| POST /sync when roots already match | 192-194 | Integration |

**Mocks Required:** Keypair, blacklist functions

### 2.3 mpc-operations.ts (83.72% → 92%)
**Uncovered Lines:** 227-243, 249-257
**Effort:** Medium | **Impact:** +8%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| MPC callback result parsing | 227-243 | Unit |
| Error handling in callback | 249-257 | Unit |

### 2.4 position-history.ts (87.5% → 95%)
**Uncovered Lines:** 164-171, 177-183
**Effort:** Medium | **Impact:** +8%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| Query with date range filtering | 164-171 | Unit |
| Aggregation methods | 177-183 | Unit |

---

## Phase 3: Complex (Infrastructure Mocking)

### 3.1 settlement-executor.ts (92.36% → 98%)
**Uncovered Lines:** 573, 622, 629-640
**Effort:** High | **Impact:** +6%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| Settlement skips when roots already match | 573 | Unit+Mock |
| Settlement signature extraction | 622 | Unit+Mock |
| InsufficientBalance (0x1782) alert sending | 629-640 | Unit+Mock |

**Mocks Required:** AlertManager, Database, Connection

### 3.2 prover.ts (82.19% → 92%)
**Uncovered Lines:** 308-321, 327-328
**Effort:** High | **Impact:** +10%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| Invalid proof size rejection | 308-321 | Unit+Mock |
| `nargo execute` failure fallback | 327-328 | Unit+Mock |
| `sunspot prove` failure fallback | 327-328 | Unit+Mock |

**Mocks Required:** fs/promises, child_process.exec

### 3.3 arcium-client.ts (59.71% → 80%)
**Uncovered Lines:** 263-275, 282-286
**Effort:** High | **Impact:** +20%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| `executeComparePrices` error handling | 263-275 | Unit+Mock |
| `computeDiscriminator` correctness | 282-286 | Unit |
| Computation finalization failure | 263-275 | Unit+Mock |

**Mocks Required:** Arcium SDK, sendAndConfirmTransaction

### 3.4 funding-processor.ts (82.15% → 92%)
**Uncovered Lines:** 503-539, 545-619
**Effort:** High | **Impact:** +10%

| Test Case | Line(s) | Type |
|-----------|---------|------|
| Funding rate calculation edge cases | 503-539 | Unit |
| Settlement execution paths | 545-619 | Unit+Mock |

---

## Implementation Order (Recommended)

```
Week 1: Phase 1 (Quick Wins)
├── Day 1: match-executor.ts (+4%)
├── Day 2: distributed-lock.ts (+4%)
└── Day 3: blockhash-manager.ts (+7%)

Week 2: Phase 2 (Medium)
├── Day 1-2: rate-limit-redis.ts (+10%)
├── Day 3: routes/admin/blacklist.ts (+6%)
├── Day 4: mpc-operations.ts (+8%)
└── Day 5: position-history.ts (+8%)

Week 3: Phase 3 (Complex)
├── Day 1-2: settlement-executor.ts (+6%)
├── Day 3-4: prover.ts (+10%)
├── Day 5: arcium-client.ts (+20%)
└── Day 6: funding-processor.ts (+10%)
```

---

## Expected Coverage After Completion

| File | Current | Target |
|------|---------|--------|
| match-executor.ts | 94.26% | 98% |
| distributed-lock.ts | 93.99% | 98% |
| blockhash-manager.ts | 88.21% | 95% |
| rate-limit-redis.ts | 80.22% | 90% |
| routes/admin/blacklist.ts | 88.62% | 95% |
| mpc-operations.ts | 83.72% | 92% |
| position-history.ts | 87.5% | 95% |
| settlement-executor.ts | 92.36% | 98% |
| prover.ts | 82.19% | 92% |
| arcium-client.ts | 59.71% | 80% |
| funding-processor.ts | 82.15% | 92% |

**Overall Backend Coverage:** 93.07% → **97%+**

---

## Test File Locations

```
src/__tests__/crank/match-executor-coverage.test.ts
src/__tests__/crank/distributed-lock-coverage.test.ts
src/__tests__/crank/blockhash-manager-coverage.test.ts
src/__tests__/middleware/rate-limit-redis-coverage.test.ts
src/__tests__/routes/admin/blacklist-coverage.test.ts
src/__tests__/db/repositories/mpc-operations-coverage.test.ts
src/__tests__/db/repositories/position-history-coverage.test.ts
src/__tests__/crank/settlement-executor-coverage.test.ts
src/__tests__/lib/prover-coverage.test.ts
src/__tests__/crank/arcium-client-coverage.test.ts
src/__tests__/crank/funding-processor-coverage.test.ts
```

---

## Mock Templates

### Solana Connection Mock
```typescript
const mockConnection = {
  getAccountInfo: vi.fn().mockResolvedValue(null),
  getLatestBlockhash: vi.fn().mockResolvedValue({
    blockhash: 'mock-blockhash',
    lastValidBlockHeight: 1000,
  }),
  getSlot: vi.fn().mockResolvedValue(100),
};
```

### Redis Client Mock
```typescript
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    get: vi.fn().mockResolvedValue('1'),
    del: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
  })),
}));
```

### Alert Manager Mock
```typescript
const mockAlertManager = {
  critical: vi.fn().mockResolvedValue(true),
  error: vi.fn().mockResolvedValue(true),
  warning: vi.fn().mockResolvedValue(true),
  info: vi.fn().mockResolvedValue(true),
};
```
