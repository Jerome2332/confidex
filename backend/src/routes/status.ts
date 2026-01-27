/**
 * Public Status API Routes
 *
 * Public endpoints for querying system status including
 * crank service status and settlement metrics.
 *
 * Note: This provides read-only public access to non-sensitive status data.
 * Admin operations still require authentication via /api/admin/crank.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { CrankService } from '../crank/index.js';
import { rateLimiters, createCustomRateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../lib/logger.js';

const router: RouterType = Router();
const log = logger.http;

// Apply higher rate limit for status queries (for load testing)
const statusRateLimiter = process.env.LOAD_TEST_MODE === 'true'
  ? createCustomRateLimiter(5000)
  : rateLimiters.standard;

router.use(statusRateLimiter);

// Reference to crank service (set by main server)
let crankService: CrankService | null = null;

/**
 * Initialize the status routes with crank service reference
 */
export function initializeStatusService(service: CrankService): void {
  crankService = service;
}

/**
 * GET /api/status/crank
 *
 * Get current crank service status and metrics (public, read-only).
 * Returns non-sensitive operational metrics.
 */
router.get('/crank', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Crank service not initialized',
      status: 'unavailable',
      crank: null,
      settlement: null,
    });
  }

  try {
    const status = await crankService.getStatus();

    // Return public-safe subset of status
    return res.json({
      status: status.status,
      crank: {
        status: status.status,
        isRunning: status.status === 'running',
        metrics: {
          totalPolls: status.metrics.totalPolls,
          totalMatchAttempts: status.metrics.totalMatchAttempts,
          successfulMatches: status.metrics.successfulMatches,
          failedMatches: status.metrics.failedMatches,
          openOrderCount: status.metrics.openOrderCount,
          pendingMatches: status.metrics.pendingMatches,
        },
        uptime: status.metrics.startedAt
          ? Date.now() - status.metrics.startedAt
          : null,
        lastPoll: status.metrics.lastPollAt,
      },
      settlement: {
        // Settlement metrics (if available)
        enabled: true,
        method: process.env.SHADOWWIRE_ENABLED === 'true' ? 'shadowwire' : 'legacy',
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error({ error }, 'Error getting crank status');
    return res.status(500).json({
      error: 'Failed to get crank status',
      status: 'error',
    });
  }
});

/**
 * GET /api/status/settlement
 *
 * Get settlement system status and statistics.
 */
router.get('/settlement', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Service not initialized',
      settlement: null,
    });
  }

  try {
    const status = await crankService.getStatus();

    return res.json({
      settlement: {
        enabled: true,
        method: process.env.SHADOWWIRE_ENABLED === 'true' ? 'shadowwire' : 'legacy',
        metrics: {
          matchAttempts: status.metrics.totalMatchAttempts,
          successfulMatches: status.metrics.successfulMatches,
          failedMatches: status.metrics.failedMatches,
          successRate: status.metrics.totalMatchAttempts > 0
            ? (status.metrics.successfulMatches / status.metrics.totalMatchAttempts * 100).toFixed(2)
            : 'N/A',
        },
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error({ error }, 'Error getting settlement status');
    return res.status(500).json({
      error: 'Failed to get settlement status',
    });
  }
});

/**
 * GET /api/status/rpc
 *
 * Get RPC connection health status.
 */
router.get('/rpc', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Service not initialized',
      rpc: null,
    });
  }

  try {
    const rpcHealth = crankService.getRpcHealth();

    if (!rpcHealth) {
      return res.json({
        rpc: {
          status: 'unknown',
          message: 'RPC health monitoring not available',
        },
        timestamp: Date.now(),
      });
    }

    // Return RPC health info
    return res.json({
      rpc: {
        status: 'healthy',
        endpoints: rpcHealth.endpoints.map((e) => ({
          url: e.url.replace(/\/\/[^@]+@/, '//***@'), // Mask credentials
          isHealthy: e.isHealthy,
          isCurrent: e.isCurrent,
          latencyMs: e.latencyMs,
        })),
        blockhash: {
          cacheSize: rpcHealth.blockhash.cacheSize,
          currentSlot: rpcHealth.blockhash.currentSlot,
        },
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    log.error({ error }, 'Error getting RPC status');
    return res.status(500).json({
      error: 'Failed to get RPC status',
    });
  }
});

/**
 * GET /api/status
 *
 * Get overall system status summary.
 */
router.get('/', async (_req: Request, res: Response) => {
  const isInitialized = crankService !== null;

  let crankStatus = 'unavailable';
  let metrics: {
    openOrders: number;
    pendingMatches: number;
    successRate: string;
  } | null = null;

  if (crankService) {
    try {
      const status = await crankService.getStatus();
      crankStatus = status.status;
      metrics = {
        openOrders: status.metrics.openOrderCount,
        pendingMatches: status.metrics.pendingMatches,
        successRate: status.metrics.totalMatchAttempts > 0
          ? ((status.metrics.successfulMatches / status.metrics.totalMatchAttempts) * 100).toFixed(1) + '%'
          : 'N/A',
      };
    } catch {
      crankStatus = 'error';
    }
  }

  return res.json({
    status: isInitialized ? 'operational' : 'initializing',
    services: {
      crank: crankStatus,
      settlement: process.env.SHADOWWIRE_ENABLED === 'true' ? 'shadowwire' : 'legacy',
      mpc: process.env.CRANK_USE_REAL_MPC === 'true' ? 'enabled' : 'simulated',
    },
    metrics,
    timestamp: Date.now(),
  });
});

export const statusRouter: RouterType = router;
