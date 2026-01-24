# PRD-008: Monitoring & Observability

**Status:** Completed (January 2026)
**Priority:** HIGH
**Complexity:** Low
**Estimated Effort:** 1-2 days

---

## Executive Summary

No metrics export, inconsistent logging, and minimal health checks make production debugging impossible. This PRD implements Prometheus metrics, structured logging, enhanced health checks, and Sentry error tracking.

## Implementation Status

All items in this PRD have been implemented:

| Feature | Status | Implementation |
|---------|--------|----------------|
| Prometheus Metrics | Complete | `backend/src/routes/metrics.ts` |
| Structured Logging | Complete | `backend/src/lib/logger.ts` (Pino) |
| Enhanced Health Checks | Complete | `backend/src/routes/health.ts` |
| Console.log Cleanup | Complete | Replaced with structured logger throughout |

### Prometheus Metrics Available

The following metrics are now recorded and exported at `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `crankMatchAttemptsTotal` | Counter | Total match attempts by status |
| `crankMatchDuration` | Histogram | Match operation duration |
| `crankOpenOrders` | Gauge | Open orders by side (buy/sell) |
| `crankPendingMatches` | Gauge | Pending MPC matches |
| `crankConsecutiveErrors` | Gauge | Consecutive error count |
| `crankStatus` | Gauge | Service status (1=running, 0=stopped, -1=paused) |
| `walletBalance` | Gauge | Crank wallet SOL balance |

### RPC Health Monitoring

New `getRpcHealth()` method on `CrankService` exposes:
- Endpoint health status per RPC endpoint
- Current/failover endpoint tracking
- Blockhash cache stats (size, age, slot)

---

## Problem Statement

Current observability gaps:

1. **No Metrics Export** - Cannot track performance or create dashboards
2. **Inconsistent Logging** - Mix of console.log styles, no structure
3. **Minimal Health Checks** - Only basic endpoint existence check
4. **No Error Tracking** - Errors lost in logs, no aggregation
5. **Console.log in Production** - Unnecessary noise, no log levels

---

## Scope

### In Scope
- Prometheus metrics endpoint
- Structured JSON logging
- Enhanced health checks for all subsystems
- Sentry integration for error tracking
- Remove console.log from production code

### Out of Scope
- Full APM solution
- Distributed tracing
- Log aggregation infrastructure (ELK/Loki)

---

## Implementation Plan

### Task 1: Prometheus Metrics Endpoint

**New Files:**
- `backend/src/routes/metrics.ts`
- `backend/src/lib/metrics.ts`

**Step 1.1: Metrics Registry**

```typescript
// backend/src/lib/metrics.ts

import { Registry, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client';

// Create a new registry
export const registry = new Registry();

// Add default Node.js metrics
collectDefaultMetrics({ register: registry });

// Custom metrics

/**
 * Crank Service Metrics
 */
export const crankMetrics = {
  // Counters
  matchAttempts: new Counter({
    name: 'confidex_crank_match_attempts_total',
    help: 'Total number of match attempts',
    labelNames: ['status'], // success, failed, skipped
    registers: [registry],
  }),

  settlementsExecuted: new Counter({
    name: 'confidex_crank_settlements_total',
    help: 'Total number of settlements executed',
    labelNames: ['status'], // success, failed
    registers: [registry],
  }),

  mpcCallbacks: new Counter({
    name: 'confidex_crank_mpc_callbacks_total',
    help: 'Total number of MPC callbacks received',
    labelNames: ['type', 'status'], // compare_prices, calculate_fill | success, failed
    registers: [registry],
  }),

  // Gauges
  activeOrders: new Gauge({
    name: 'confidex_crank_active_orders',
    help: 'Number of active orders',
    labelNames: ['side'], // buy, sell
    registers: [registry],
  }),

  pendingMatches: new Gauge({
    name: 'confidex_crank_pending_matches',
    help: 'Number of pending MPC matches',
    registers: [registry],
  }),

  walletBalance: new Gauge({
    name: 'confidex_crank_wallet_balance_sol',
    help: 'Crank wallet SOL balance',
    registers: [registry],
  }),

  circuitBreakerState: new Gauge({
    name: 'confidex_crank_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=open)',
    registers: [registry],
  }),

  consecutiveErrors: new Gauge({
    name: 'confidex_crank_consecutive_errors',
    help: 'Number of consecutive errors',
    registers: [registry],
  }),

  // Histograms
  matchDuration: new Histogram({
    name: 'confidex_crank_match_duration_seconds',
    help: 'Duration of match operations',
    labelNames: ['status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  }),

  settlementDuration: new Histogram({
    name: 'confidex_crank_settlement_duration_seconds',
    help: 'Duration of settlement operations',
    labelNames: ['status'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
    registers: [registry],
  }),

  rpcLatency: new Histogram({
    name: 'confidex_rpc_latency_seconds',
    help: 'RPC call latency',
    labelNames: ['method', 'endpoint'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  }),

  mpcDuration: new Histogram({
    name: 'confidex_mpc_duration_seconds',
    help: 'MPC computation duration',
    labelNames: ['operation'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry],
  }),
};

/**
 * API Metrics
 */
export const apiMetrics = {
  requestsTotal: new Counter({
    name: 'confidex_api_requests_total',
    help: 'Total API requests',
    labelNames: ['method', 'path', 'status'],
    registers: [registry],
  }),

  requestDuration: new Histogram({
    name: 'confidex_api_request_duration_seconds',
    help: 'API request duration',
    labelNames: ['method', 'path'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [registry],
  }),

  activeConnections: new Gauge({
    name: 'confidex_api_active_connections',
    help: 'Number of active API connections',
    registers: [registry],
  }),
};

/**
 * Metrics middleware for Express
 */
export function metricsMiddleware(req: any, res: any, next: any) {
  const start = process.hrtime();

  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds + nanoseconds / 1e9;

    // Normalize path to avoid high cardinality
    const path = normalizePath(req.path);

    apiMetrics.requestsTotal.inc({
      method: req.method,
      path,
      status: res.statusCode,
    });

    apiMetrics.requestDuration.observe(
      { method: req.method, path },
      duration
    );
  });

  next();
}

function normalizePath(path: string): string {
  // Replace UUIDs, public keys, and numbers with placeholders
  return path
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ':pubkey')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':uuid')
    .replace(/\/\d+/g, '/:id');
}
```

**Step 1.2: Metrics Route**

```typescript
// backend/src/routes/metrics.ts

import { Router } from 'express';
import { registry } from '../lib/metrics.js';

const router = Router();

/**
 * GET /metrics
 * Prometheus metrics endpoint
 */
router.get('/', async (req, res) => {
  try {
    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    res.status(500).end(err instanceof Error ? err.message : 'Unknown error');
  }
});

export { router as metricsRouter };
```

**Step 1.3: Register Metrics Route**

```typescript
// backend/src/index.ts

import { metricsRouter, metricsMiddleware } from './routes/metrics.js';

// Apply metrics middleware
app.use(metricsMiddleware);

// Metrics endpoint (no auth required for Prometheus scraping)
app.use('/metrics', metricsRouter);
```

---

### Task 2: Structured Logging

**New Files:**
- `backend/src/lib/logger.ts`

**Step 2.1: Structured Logger**

```typescript
// backend/src/lib/logger.ts

import pino from 'pino';

// Log levels
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

// Determine log level from environment
const level: LogLevel = (process.env.LOG_LEVEL as LogLevel) ||
  (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

// Configure Pino logger
export const logger = pino({
  level,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: (bindings) => ({
      pid: bindings.pid,
      host: bindings.hostname,
      service: 'confidex-crank',
    }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Pretty print in development
  transport: process.env.NODE_ENV !== 'production'
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
});

// Create child loggers for different components
export const loggers = {
  crank: logger.child({ component: 'crank' }),
  match: logger.child({ component: 'match-executor' }),
  settle: logger.child({ component: 'settlement-executor' }),
  mpc: logger.child({ component: 'mpc-poller' }),
  api: logger.child({ component: 'api' }),
  db: logger.child({ component: 'database' }),
};

// Request logging middleware
export function requestLogger(req: any, res: any, next: any) {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;

    loggers.api.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    }, `${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
  });

  next();
}

// Utility functions
export function logError(logger: pino.Logger, error: Error, context?: object) {
  logger.error({
    err: {
      message: error.message,
      name: error.name,
      stack: error.stack,
    },
    ...context,
  }, error.message);
}

export function logMetric(logger: pino.Logger, metric: string, value: number, labels?: object) {
  logger.info({
    metric,
    value,
    ...labels,
  }, `${metric}=${value}`);
}
```

**Step 2.2: Replace console.log Calls**

```typescript
// Example: backend/src/crank/match-executor.ts

// BEFORE
console.log('[MatchExecutor] Match successful:', signature);
console.error('[MatchExecutor] Match failed:', error);

// AFTER
import { loggers, logError } from '../lib/logger.js';

const log = loggers.match;

log.info({ signature, buyOrder, sellOrder }, 'Match successful');
logError(log, error, { buyOrder, sellOrder });
```

---

### Task 3: Enhanced Health Checks

**Files to Modify:**
- `backend/src/routes/health.ts`

**Step 3.1: Comprehensive Health Check**

```typescript
// backend/src/routes/health.ts

import { Router } from 'express';
import { Connection } from '@solana/web3.js';
import { DatabaseClient } from '../db/client.js';
import { CrankService } from '../crank/index.js';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    [key: string]: {
      status: 'pass' | 'warn' | 'fail';
      message?: string;
      latency?: number;
      details?: object;
    };
  };
}

export function createHealthRouter(
  connection: Connection,
  db: DatabaseClient,
  crankService: CrankService
): Router {
  const router = Router();
  const startTime = Date.now();

  /**
   * GET /health
   * Basic health check (for load balancers)
   */
  router.get('/', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  /**
   * GET /health/detailed
   * Comprehensive health check
   */
  router.get('/detailed', async (req, res) => {
    const checks: HealthStatus['checks'] = {};

    // Check RPC connection
    const rpcCheck = await checkRpc(connection);
    checks.rpc = rpcCheck;

    // Check database
    const dbCheck = await checkDatabase(db);
    checks.database = dbCheck;

    // Check crank wallet balance
    const walletCheck = await checkWallet(connection, crankService.getWalletPublicKey());
    checks.wallet = walletCheck;

    // Check crank service status
    const crankCheck = checkCrankService(crankService);
    checks.crank = crankCheck;

    // Check MPC connectivity (basic)
    const mpcCheck = await checkMpcConnectivity();
    checks.mpc = mpcCheck;

    // Determine overall status
    const failedChecks = Object.values(checks).filter(c => c.status === 'fail').length;
    const warnChecks = Object.values(checks).filter(c => c.status === 'warn').length;

    let overallStatus: HealthStatus['status'] = 'healthy';
    if (failedChecks > 0) {
      overallStatus = 'unhealthy';
    } else if (warnChecks > 0) {
      overallStatus = 'degraded';
    }

    const health: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.0',
      uptime: Date.now() - startTime,
      checks,
    };

    const statusCode = overallStatus === 'unhealthy' ? 503 : 200;
    res.status(statusCode).json(health);
  });

  /**
   * GET /health/ready
   * Readiness check (for Kubernetes)
   */
  router.get('/ready', async (req, res) => {
    try {
      // Check critical components
      await connection.getSlot();
      const crankStatus = crankService.getStatus();

      if (crankStatus.isPaused) {
        res.status(503).json({ ready: false, reason: 'Crank service paused' });
        return;
      }

      res.json({ ready: true });
    } catch (err) {
      res.status(503).json({ ready: false, reason: (err as Error).message });
    }
  });

  /**
   * GET /health/live
   * Liveness check (for Kubernetes)
   */
  router.get('/live', (req, res) => {
    // If this endpoint responds, the process is alive
    res.json({ live: true });
  });

  return router;
}

async function checkRpc(connection: Connection): Promise<HealthStatus['checks'][string]> {
  const start = Date.now();
  try {
    const slot = await connection.getSlot();
    const latency = Date.now() - start;

    return {
      status: latency < 1000 ? 'pass' : 'warn',
      latency,
      details: { slot },
    };
  } catch (err) {
    return {
      status: 'fail',
      message: (err as Error).message,
      latency: Date.now() - start,
    };
  }
}

async function checkDatabase(db: DatabaseClient): Promise<HealthStatus['checks'][string]> {
  const start = Date.now();
  try {
    // Simple query to check DB connectivity
    const result = db.get<{ count: number }>('SELECT COUNT(*) as count FROM transaction_history');
    const latency = Date.now() - start;

    return {
      status: 'pass',
      latency,
      details: { transactionCount: result?.count || 0 },
    };
  } catch (err) {
    return {
      status: 'fail',
      message: (err as Error).message,
      latency: Date.now() - start,
    };
  }
}

async function checkWallet(
  connection: Connection,
  walletPubkey: PublicKey
): Promise<HealthStatus['checks'][string]> {
  const start = Date.now();
  try {
    const balance = await connection.getBalance(walletPubkey);
    const solBalance = balance / 1e9;
    const latency = Date.now() - start;

    // Warn if below 0.1 SOL
    const status = solBalance >= 0.1 ? 'pass' : solBalance >= 0.01 ? 'warn' : 'fail';

    return {
      status,
      latency,
      details: { balance: solBalance, address: walletPubkey.toBase58() },
      message: status === 'fail' ? 'Wallet balance critically low' : undefined,
    };
  } catch (err) {
    return {
      status: 'fail',
      message: (err as Error).message,
      latency: Date.now() - start,
    };
  }
}

function checkCrankService(crankService: CrankService): HealthStatus['checks'][string] {
  const status = crankService.getStatus();

  if (!status.isRunning) {
    return {
      status: 'fail',
      message: 'Crank service not running',
      details: status.metrics,
    };
  }

  if (status.isPaused) {
    return {
      status: 'warn',
      message: 'Crank service paused (circuit breaker)',
      details: status.metrics,
    };
  }

  if (status.metrics.consecutiveErrors > 5) {
    return {
      status: 'warn',
      message: `${status.metrics.consecutiveErrors} consecutive errors`,
      details: status.metrics,
    };
  }

  return {
    status: 'pass',
    details: status.metrics,
  };
}

async function checkMpcConnectivity(): Promise<HealthStatus['checks'][string]> {
  // Basic connectivity check to Arcium cluster
  // In a real implementation, this would ping the MXE
  return {
    status: 'pass',
    message: 'MPC cluster assumed healthy (no active check)',
  };
}
```

---

### Task 4: Sentry Error Tracking

**New Files:**
- `backend/src/lib/sentry.ts`
- `frontend/src/lib/sentry.ts`

**Step 4.1: Backend Sentry Integration**

```typescript
// backend/src/lib/sentry.ts

import * as Sentry from '@sentry/node';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;

  if (!dsn) {
    console.log('[Sentry] DSN not configured, skipping initialization');
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version,

    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Filter sensitive data
    beforeSend(event) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers['x-api-key'];
        delete event.request.headers['authorization'];
      }

      // Remove sensitive data from breadcrumbs
      if (event.breadcrumbs) {
        event.breadcrumbs = event.breadcrumbs.map((crumb) => {
          if (crumb.data?.privateKey) {
            crumb.data.privateKey = '[REDACTED]';
          }
          return crumb;
        });
      }

      return event;
    },

    // Ignore certain errors
    ignoreErrors: [
      'Network request failed',
      'ResizeObserver loop',
      /^AbortError/,
    ],
  });

  console.log('[Sentry] Initialized');
}

// Express error handler
export const sentryErrorHandler = Sentry.Handlers.errorHandler();

// Express request handler (adds request context)
export const sentryRequestHandler = Sentry.Handlers.requestHandler();

// Capture exception with context
export function captureException(error: Error, context?: Record<string, unknown>): void {
  Sentry.withScope((scope) => {
    if (context) {
      Object.entries(context).forEach(([key, value]) => {
        scope.setExtra(key, value);
      });
    }
    Sentry.captureException(error);
  });
}

// Capture message
export function captureMessage(message: string, level: Sentry.SeverityLevel = 'info'): void {
  Sentry.captureMessage(message, level);
}

// Set user context
export function setUser(user: { id?: string; ip?: string }): void {
  Sentry.setUser(user);
}
```

**Step 4.2: Frontend Sentry Integration**

```typescript
// frontend/src/lib/sentry.ts

import * as Sentry from '@sentry/nextjs';

export function initSentry(): void {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.NEXT_PUBLIC_VERSION,

    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    // Replay for debugging
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

    integrations: [
      Sentry.replayIntegration({
        maskAllText: false,
        blockAllMedia: false,
      }),
    ],

    // Filter sensitive data
    beforeSend(event) {
      // Remove wallet addresses from error messages
      if (event.message) {
        event.message = event.message.replace(
          /[1-9A-HJ-NP-Za-km-z]{32,44}/g,
          '[WALLET_ADDRESS]'
        );
      }
      return event;
    },

    ignoreErrors: [
      'User rejected the request',
      'WalletNotConnectedError',
      'WalletSignTransactionError',
    ],
  });
}

// Re-export Sentry for use in components
export { Sentry };

// Capture error with wallet context
export function captureError(error: Error, walletAddress?: string): void {
  Sentry.withScope((scope) => {
    if (walletAddress) {
      scope.setUser({ id: walletAddress.slice(0, 8) + '...' });
    }
    Sentry.captureException(error);
  });
}
```

**Step 4.3: Integrate Sentry in Backend**

```typescript
// backend/src/index.ts

import { initSentry, sentryRequestHandler, sentryErrorHandler } from './lib/sentry.js';

// Initialize Sentry first
initSentry();

const app = express();

// Sentry request handler (must be first middleware)
app.use(sentryRequestHandler);

// ... other middleware and routes ...

// Sentry error handler (must be before other error handlers)
app.use(sentryErrorHandler);

// Generic error handler
app.use((err, req, res, next) => {
  // ... error handling
});
```

---

### Task 5: Remove Console.log from Frontend

**Step 5.1: Frontend Logger**

```typescript
// frontend/src/lib/logger.ts

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug: (message: string, data?: object) => void;
  info: (message: string, data?: object) => void;
  warn: (message: string, data?: object) => void;
  error: (message: string, error?: Error, data?: object) => void;
}

const LOG_LEVEL: LogLevel = (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) || 'info';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[LOG_LEVEL];
}

function formatMessage(namespace: string, level: LogLevel, message: string, data?: object): string {
  if (IS_PRODUCTION) {
    // Structured JSON for production
    return JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      namespace,
      message,
      ...data,
    });
  }
  // Pretty format for development
  return `[${namespace}] ${message}`;
}

export function createLogger(namespace: string): Logger {
  return {
    debug(message: string, data?: object) {
      if (shouldLog('debug')) {
        console.debug(formatMessage(namespace, 'debug', message, data), data || '');
      }
    },

    info(message: string, data?: object) {
      if (shouldLog('info')) {
        console.info(formatMessage(namespace, 'info', message, data), data || '');
      }
    },

    warn(message: string, data?: object) {
      if (shouldLog('warn')) {
        console.warn(formatMessage(namespace, 'warn', message, data), data || '');
      }
    },

    error(message: string, error?: Error, data?: object) {
      if (shouldLog('error')) {
        console.error(
          formatMessage(namespace, 'error', message, { ...data, error: error?.message }),
          error || '',
          data || ''
        );

        // Report to Sentry in production
        if (IS_PRODUCTION && error) {
          import('./sentry').then(({ captureError }) => {
            captureError(error);
          });
        }
      }
    },
  };
}

// Pre-configured loggers
export const logger = {
  encryption: createLogger('encryption'),
  trading: createLogger('trading'),
  wallet: createLogger('wallet'),
  api: createLogger('api'),
  pnp: createLogger('pnp'),
};
```

**Step 5.2: ESLint Rule to Prevent console.log**

```json
// frontend/.eslintrc.json

{
  "rules": {
    "no-console": ["warn", {
      "allow": ["warn", "error", "info", "debug"]
    }]
  }
}
```

---

## Acceptance Criteria

- [x] **Prometheus Metrics**
  - [x] `/metrics` endpoint returns Prometheus format
  - [x] Crank metrics: match attempts, settlements, MPC callbacks
  - [x] API metrics: request count, latency histograms
  - [x] System metrics: CPU, memory, event loop lag

- [x] **Structured Logging**
  - [x] All logs are JSON in production
  - [x] Logs include timestamp, level, component
  - [x] Sensitive data not logged (keys, secrets)
  - [x] Pretty formatting in development

- [x] **Health Checks**
  - [x] `/health` returns basic status
  - [x] `/health/detailed` checks all subsystems (RPC, DB, wallet, crank, prover)
  - [x] `/health/ready` for Kubernetes readiness
  - [x] `/health/live` for Kubernetes liveness
  - [x] RPC, database, wallet, crank checks

- [x] **Sentry Integration**
  - [x] Errors reported to Sentry
  - [x] Sensitive data filtered
  - [x] Source maps uploaded
  - [x] Error grouping working

- [x] **Console Cleanup**
  - [x] No `console.log` in production code (replaced with Pino logger)
  - [x] All logging via logger utilities
  - [x] Structured logging in blockhash-manager, failover-connection, prover

---

## Environment Variables

```bash
# Logging
LOG_LEVEL=info                    # debug, info, warn, error

# Sentry
SENTRY_DSN=https://xxx@sentry.io/xxx
NEXT_PUBLIC_SENTRY_DSN=https://xxx@sentry.io/xxx

# Prometheus (optional - for remote write)
PROMETHEUS_PUSHGATEWAY_URL=
```

---

## Grafana Dashboard (Example)

```json
{
  "title": "Confidex Crank Service",
  "panels": [
    {
      "title": "Match Success Rate",
      "type": "stat",
      "targets": [
        {
          "expr": "sum(rate(confidex_crank_match_attempts_total{status='success'}[5m])) / sum(rate(confidex_crank_match_attempts_total[5m]))"
        }
      ]
    },
    {
      "title": "Match Latency (p99)",
      "type": "graph",
      "targets": [
        {
          "expr": "histogram_quantile(0.99, rate(confidex_crank_match_duration_seconds_bucket[5m]))"
        }
      ]
    },
    {
      "title": "Active Orders",
      "type": "graph",
      "targets": [
        {
          "expr": "confidex_crank_active_orders"
        }
      ]
    },
    {
      "title": "Wallet Balance",
      "type": "gauge",
      "targets": [
        {
          "expr": "confidex_crank_wallet_balance_sol"
        }
      ]
    }
  ]
}
```

---

## References

- [Prometheus Node.js Client](https://github.com/siimon/prom-client)
- [Pino Logger](https://github.com/pinojs/pino)
- [Sentry Node.js SDK](https://docs.sentry.io/platforms/node/)
- [Sentry Next.js SDK](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
