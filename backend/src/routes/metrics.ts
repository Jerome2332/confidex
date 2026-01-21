/**
 * Prometheus Metrics Endpoint
 *
 * Exposes metrics in Prometheus format for monitoring and alerting.
 * Metrics include:
 * - HTTP request metrics (latency, status codes)
 * - Crank service metrics (matches, errors, queue depth)
 * - MPC operation metrics
 * - RPC connection health
 * - Database metrics
 */

import { Router, type Router as RouterType, Request, Response } from 'express';
import client, {
  Counter,
  Histogram,
  Gauge,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

// Create a custom registry
export const metricsRegistry = new Registry();

// Collect default Node.js metrics (CPU, memory, event loop, etc.)
collectDefaultMetrics({
  register: metricsRegistry,
  prefix: 'confidex_',
});

// ============================================
// HTTP Request Metrics
// ============================================

export const httpRequestsTotal = new Counter({
  name: 'confidex_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [metricsRegistry],
});

export const httpRequestDuration = new Histogram({
  name: 'confidex_http_request_duration_seconds',
  help: 'HTTP request latency in seconds',
  labelNames: ['method', 'path', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [metricsRegistry],
});

// ============================================
// Crank Service Metrics
// ============================================

export const crankMatchAttemptsTotal = new Counter({
  name: 'confidex_crank_match_attempts_total',
  help: 'Total number of order match attempts',
  labelNames: ['status'], // success, failed, skipped
  registers: [metricsRegistry],
});

export const crankMatchDuration = new Histogram({
  name: 'confidex_crank_match_duration_seconds',
  help: 'Duration of order matching operations',
  labelNames: ['type'], // spot, perp
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [metricsRegistry],
});

export const crankOpenOrders = new Gauge({
  name: 'confidex_crank_open_orders',
  help: 'Current number of open orders',
  labelNames: ['side'], // buy, sell
  registers: [metricsRegistry],
});

export const crankPendingMatches = new Gauge({
  name: 'confidex_crank_pending_matches',
  help: 'Current number of pending MPC matches',
  registers: [metricsRegistry],
});

export const crankConsecutiveErrors = new Gauge({
  name: 'confidex_crank_consecutive_errors',
  help: 'Number of consecutive errors (circuit breaker metric)',
  registers: [metricsRegistry],
});

export const crankStatus = new Gauge({
  name: 'confidex_crank_status',
  help: 'Crank service status (1=running, 0=stopped, -1=paused)',
  registers: [metricsRegistry],
});

// ============================================
// MPC Operation Metrics
// ============================================

export const mpcOperationsTotal = new Counter({
  name: 'confidex_mpc_operations_total',
  help: 'Total number of MPC operations',
  labelNames: ['operation', 'status'], // operation: compare, fill, verify; status: success, failed
  registers: [metricsRegistry],
});

export const mpcOperationDuration = new Histogram({
  name: 'confidex_mpc_operation_duration_seconds',
  help: 'Duration of MPC operations',
  labelNames: ['operation'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [metricsRegistry],
});

export const mpcCallbacksTotal = new Counter({
  name: 'confidex_mpc_callbacks_total',
  help: 'Total number of MPC callbacks received',
  labelNames: ['status'], // success, failed, timeout
  registers: [metricsRegistry],
});

// ============================================
// RPC Connection Metrics
// ============================================

export const rpcRequestsTotal = new Counter({
  name: 'confidex_rpc_requests_total',
  help: 'Total number of RPC requests',
  labelNames: ['endpoint', 'status'], // endpoint: primary, fallback; status: success, failed
  registers: [metricsRegistry],
});

export const rpcRequestDuration = new Histogram({
  name: 'confidex_rpc_request_duration_seconds',
  help: 'RPC request latency',
  labelNames: ['endpoint', 'method'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const rpcFailoversTotal = new Counter({
  name: 'confidex_rpc_failovers_total',
  help: 'Total number of RPC failover events',
  registers: [metricsRegistry],
});

export const rpcActiveEndpoint = new Gauge({
  name: 'confidex_rpc_active_endpoint',
  help: 'Currently active RPC endpoint (0=primary, 1+=fallback index)',
  registers: [metricsRegistry],
});

// ============================================
// Database Metrics
// ============================================

export const dbOperationsTotal = new Counter({
  name: 'confidex_db_operations_total',
  help: 'Total number of database operations',
  labelNames: ['operation', 'table', 'status'],
  registers: [metricsRegistry],
});

export const dbOperationDuration = new Histogram({
  name: 'confidex_db_operation_duration_seconds',
  help: 'Database operation latency',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25],
  registers: [metricsRegistry],
});

export const dbConnectionPool = new Gauge({
  name: 'confidex_db_connection_pool',
  help: 'Database connection pool status',
  labelNames: ['status'], // active, idle, waiting
  registers: [metricsRegistry],
});

// ============================================
// Wallet Metrics
// ============================================

export const walletBalance = new Gauge({
  name: 'confidex_wallet_balance_sol',
  help: 'Wallet SOL balance',
  labelNames: ['wallet'], // crank, fee_recipient
  registers: [metricsRegistry],
});

// ============================================
// ZK Proof Metrics
// ============================================

export const zkProofsTotal = new Counter({
  name: 'confidex_zk_proofs_total',
  help: 'Total number of ZK proofs generated',
  labelNames: ['status'], // success, failed
  registers: [metricsRegistry],
});

export const zkProofDuration = new Histogram({
  name: 'confidex_zk_proof_duration_seconds',
  help: 'ZK proof generation time',
  buckets: [0.5, 1, 2, 3, 5, 10, 20],
  registers: [metricsRegistry],
});

// ============================================
// Business Metrics
// ============================================

export const ordersPlacedTotal = new Counter({
  name: 'confidex_orders_placed_total',
  help: 'Total orders placed',
  labelNames: ['type', 'side'], // type: spot, perp; side: buy, sell
  registers: [metricsRegistry],
});

export const tradesExecutedTotal = new Counter({
  name: 'confidex_trades_executed_total',
  help: 'Total trades executed',
  labelNames: ['type'], // spot, perp
  registers: [metricsRegistry],
});

// ============================================
// Metrics Router
// ============================================

export const metricsRouter: RouterType = Router();

/**
 * GET /metrics
 *
 * Returns Prometheus-formatted metrics
 */
metricsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    res.set('Content-Type', metricsRegistry.contentType);
    const metrics = await metricsRegistry.metrics();
    res.end(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

/**
 * Express middleware to track HTTP request metrics
 */
export function metricsMiddleware() {
  return (req: Request, res: Response, next: () => void) => {
    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
      const endTime = process.hrtime.bigint();
      const durationSeconds = Number(endTime - startTime) / 1e9;

      // Normalize path to avoid high cardinality
      const path = normalizePath(req.path);
      const labels = {
        method: req.method,
        path,
        status: String(res.statusCode),
      };

      httpRequestsTotal.inc(labels);
      httpRequestDuration.observe(labels, durationSeconds);
    });

    next();
  };
}

/**
 * Normalize paths to avoid high cardinality in metrics
 */
function normalizePath(path: string): string {
  return path
    // Replace UUIDs
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ':id')
    // Replace Solana public keys (base58, ~44 chars)
    .replace(/[1-9A-HJ-NP-Za-km-z]{32,44}/g, ':pubkey')
    // Replace numeric IDs
    .replace(/\/\d+/g, '/:id');
}

/**
 * Helper to record metric for a timed operation
 */
export function recordOperationMetric(
  histogram: Histogram<string>,
  labels: Record<string, string>,
  operation: () => Promise<void> | void
): Promise<void> {
  const end = histogram.startTimer(labels);
  return Promise.resolve(operation()).finally(() => end());
}
