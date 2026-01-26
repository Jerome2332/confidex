/**
 * Enhanced Health Check Endpoint
 *
 * Provides comprehensive health status for all subsystems:
 * - RPC connectivity
 * - Database connectivity
 * - Crank service status
 * - MPC cluster availability
 * - Wallet balance
 * - Prover availability
 */

import { Router, type Router as RouterType, Request, Response } from 'express';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { isProverAvailable, getProverStatus, validateProverConfiguration } from '../lib/prover.js';
import { getEmptyTreeRoot } from '../lib/blacklist.js';
import { logger } from '../lib/logger.js';
import { walletBalance } from './metrics.js';
import { rateLimiters } from '../middleware/rate-limit.js';
import { getWebSocketStats } from '../index.js';
import fs from 'fs';

const log = logger.health;

export const healthRouter: RouterType = Router();

// Apply rate limiting to health endpoints (1000 req/min - permissive for monitoring)
healthRouter.use(rateLimiters.health);

// Subsystem check results
interface SubsystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  message?: string;
  details?: Record<string, unknown>;
}

interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  subsystems: {
    rpc: SubsystemHealth;
    database: SubsystemHealth;
    crank: SubsystemHealth;
    mpc: SubsystemHealth;
    wallet: SubsystemHealth;
    prover: SubsystemHealth;
  };
}

// Store crank service reference for health checks
let crankServiceRef: any = null;

export function setCrankServiceRef(service: any) {
  crankServiceRef = service;
}

/**
 * Check RPC connectivity
 */
async function checkRpc(): Promise<SubsystemHealth> {
  const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
  const startTime = Date.now();

  try {
    const connection = new Connection(rpcUrl, 'confirmed');
    const slot = await connection.getSlot();
    const latencyMs = Date.now() - startTime;

    return {
      status: latencyMs < 2000 ? 'healthy' : 'degraded',
      latencyMs,
      details: {
        endpoint: rpcUrl.replace(/api-key=[\w-]+/i, 'api-key=***'),
        slot,
      },
    };
  } catch (error) {
    log.error({ error }, 'RPC health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : 'RPC connection failed',
    };
  }
}

/**
 * Check database connectivity
 */
async function checkDatabase(): Promise<SubsystemHealth> {
  const startTime = Date.now();

  try {
    // Dynamic import to avoid circular dependencies
    const { DatabaseClient } = await import('../db/client.js');
    const db = DatabaseClient.getInstance();

    // Simple query to verify connection
    const result = db.get<{ ok: number }>('SELECT 1 as ok');
    const latencyMs = Date.now() - startTime;

    if (result?.ok === 1) {
      return {
        status: 'healthy',
        latencyMs,
        details: {
          type: 'sqlite',
        },
      };
    }

    return {
      status: 'unhealthy',
      latencyMs,
      message: 'Database query returned unexpected result',
    };
  } catch (error) {
    log.error({ error }, 'Database health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : 'Database connection failed',
    };
  }
}

/**
 * Check crank service status
 */
async function checkCrank(): Promise<SubsystemHealth> {
  if (!crankServiceRef) {
    return {
      status: 'degraded',
      message: 'Crank service not initialized',
    };
  }

  try {
    const metrics = crankServiceRef.getMetrics();

    // Determine health based on metrics
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    let message: string | undefined;

    if (metrics.status === 'stopped') {
      status = 'degraded';
      message = 'Crank service is stopped';
    } else if (metrics.status === 'paused') {
      status = 'degraded';
      message = 'Crank service is paused (circuit breaker)';
    } else if (metrics.consecutiveErrors > 5) {
      status = 'degraded';
      message = `High error rate: ${metrics.consecutiveErrors} consecutive errors`;
    }

    return {
      status,
      message,
      details: {
        serviceStatus: metrics.status,
        totalPolls: metrics.totalPolls,
        successfulMatches: metrics.successfulMatches,
        failedMatches: metrics.failedMatches,
        consecutiveErrors: metrics.consecutiveErrors,
        openOrders: metrics.openOrderCount,
        pendingMatches: metrics.pendingMatches,
      },
    };
  } catch (error) {
    log.error({ error }, 'Crank health check failed');
    return {
      status: 'unhealthy',
      message: error instanceof Error ? error.message : 'Crank check failed',
    };
  }
}

/**
 * Check MPC cluster availability
 */
async function checkMpc(): Promise<SubsystemHealth> {
  const startTime = Date.now();

  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Check if Arcium program is accessible
    const arciumProgramId = process.env.ARCIUM_PROGRAM_ID || 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ';
    const programInfo = await connection.getAccountInfo(new PublicKey(arciumProgramId));
    const latencyMs = Date.now() - startTime;

    if (programInfo && programInfo.executable) {
      return {
        status: 'healthy',
        latencyMs,
        details: {
          programId: arciumProgramId,
          clusterOffset: process.env.ARCIUM_CLUSTER_OFFSET || '456',
        },
      };
    }

    return {
      status: 'degraded',
      latencyMs,
      message: 'Arcium program not found or not executable',
    };
  } catch (error) {
    log.error({ error }, 'MPC health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : 'MPC check failed',
    };
  }
}

/**
 * Check wallet balance
 */
async function checkWallet(): Promise<SubsystemHealth> {
  const startTime = Date.now();

  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
    const connection = new Connection(rpcUrl, 'confirmed');

    // Check crank wallet balance
    const crankWalletPath = process.env.CRANK_WALLET_PATH || './keys/crank-wallet.json';

    if (!fs.existsSync(crankWalletPath)) {
      return {
        status: 'degraded',
        message: 'Crank wallet file not found',
      };
    }

    const keypairData = JSON.parse(fs.readFileSync(crankWalletPath, 'utf-8'));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    const balance = await connection.getBalance(keypair.publicKey);
    const balanceSol = balance / 1e9;
    const latencyMs = Date.now() - startTime;

    // Update metrics
    walletBalance.set({ wallet: 'crank' }, balanceSol);

    const minBalance = parseFloat(process.env.CRANK_MIN_SOL_BALANCE || '0.1');

    if (balanceSol < minBalance) {
      return {
        status: 'degraded',
        latencyMs,
        message: `Low balance: ${balanceSol.toFixed(4)} SOL (min: ${minBalance})`,
        details: {
          address: keypair.publicKey.toBase58(),
          balanceSol,
          minRequired: minBalance,
        },
      };
    }

    return {
      status: 'healthy',
      latencyMs,
      details: {
        address: keypair.publicKey.toBase58(),
        balanceSol,
      },
    };
  } catch (error) {
    log.error({ error }, 'Wallet health check failed');
    return {
      status: 'unhealthy',
      latencyMs: Date.now() - startTime,
      message: error instanceof Error ? error.message : 'Wallet check failed',
    };
  }
}

/**
 * Check prover availability
 */
function checkProver(): SubsystemHealth {
  const status = getProverStatus();
  const validation = validateProverConfiguration();

  // In production with strict mode, validation errors are critical
  const isProduction = process.env.NODE_ENV === 'production';
  let healthStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
  let message: string | undefined;

  if (!validation.valid) {
    // In production with validation errors, mark as unhealthy
    healthStatus = isProduction ? 'unhealthy' : 'degraded';
    message = validation.errors.join('; ');
  } else if (!status.available) {
    // ZK infrastructure not available
    healthStatus = status.strictMode ? 'unhealthy' : 'degraded';
    message = 'Running in simulated mode (sunspot/nargo not available)';
  } else if (validation.warnings.length > 0) {
    // Warnings but still functional
    healthStatus = 'degraded';
    message = validation.warnings.join('; ');
  }

  return {
    status: healthStatus,
    message,
    details: {
      mode: status.available ? 'real' : 'simulated',
      strictMode: status.strictMode,
      treeDepth: 20,
      hashFunction: 'poseidon2',
      emptyRoot: getEmptyTreeRoot(),
      nargoVersion: status.nargoVersion,
      sunspotPath: status.sunspotPath,
      sunspotFound: status.sunspotFound,
      artifacts: status.artifacts,
      cache: status.cache,
      validationErrors: validation.errors.length > 0 ? validation.errors : undefined,
      validationWarnings: validation.warnings.length > 0 ? validation.warnings : undefined,
    },
  };
}

/**
 * Calculate overall health status
 */
function calculateOverallStatus(subsystems: HealthCheckResult['subsystems']): 'healthy' | 'degraded' | 'unhealthy' {
  const statuses = Object.values(subsystems).map(s => s.status);

  if (statuses.includes('unhealthy')) {
    return 'unhealthy';
  }
  if (statuses.includes('degraded')) {
    return 'degraded';
  }
  return 'healthy';
}

// Track start time for uptime
const startTime = Date.now();

/**
 * GET /health
 *
 * Basic health check (fast, no external calls)
 */
healthRouter.get('/', (_req: Request, res: Response) => {
  const prover = checkProver();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '0.1.0',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    prover: prover.details,
  });
});

/**
 * GET /health/live
 *
 * Kubernetes liveness probe (is the process running?)
 */
healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * GET /health/ready
 *
 * Kubernetes readiness probe (can the service accept traffic?)
 */
healthRouter.get('/ready', async (_req: Request, res: Response) => {
  try {
    const [rpc, database] = await Promise.all([
      checkRpc(),
      checkDatabase(),
    ]);

    const isReady = rpc.status !== 'unhealthy' && database.status !== 'unhealthy';

    res.status(isReady ? 200 : 503).json({
      status: isReady ? 'ready' : 'not_ready',
      rpc: rpc.status,
      database: database.status,
    });
  } catch (error) {
    res.status(503).json({ status: 'not_ready', error: 'Health check failed' });
  }
});

/**
 * GET /health/detailed
 *
 * Comprehensive health check (all subsystems)
 */
healthRouter.get('/detailed', async (_req: Request, res: Response) => {
  log.info('Running detailed health check');

  try {
    const [rpc, database, crank, mpc, wallet] = await Promise.all([
      checkRpc(),
      checkDatabase(),
      checkCrank(),
      checkMpc(),
      checkWallet(),
    ]);

    const prover = checkProver();

    const subsystems = { rpc, database, crank, mpc, wallet, prover };
    const overallStatus = calculateOverallStatus(subsystems);

    const result: HealthCheckResult = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.1.0',
      uptime: Math.floor((Date.now() - startTime) / 1000),
      subsystems,
    };

    const statusCode = overallStatus === 'healthy' ? 200 : overallStatus === 'degraded' ? 200 : 503;
    res.status(statusCode).json(result);
  } catch (error) {
    log.error({ error }, 'Detailed health check failed');
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Health check failed',
    });
  }
});

/**
 * GET /health/ws
 *
 * WebSocket server health check - useful for debugging connectivity
 */
healthRouter.get('/ws', (_req: Request, res: Response) => {
  const wsStats = getWebSocketStats();
  const wsPath = process.env.WS_PATH || '/ws';
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
  const frontendUrl = process.env.FRONTEND_URL;

  res.json({
    status: wsStats ? 'enabled' : 'disabled',
    timestamp: new Date().toISOString(),
    config: {
      path: wsPath,
      allowedOrigins,
      frontendUrl,
      streamingEnabled: process.env.STREAMING_ENABLED === 'true',
    },
    stats: wsStats,
    debug: {
      message: 'If connections are failing, check that the frontend NEXT_PUBLIC_API_URL matches this server URL',
      expectedOrigins: allowedOrigins,
    },
  });
});
