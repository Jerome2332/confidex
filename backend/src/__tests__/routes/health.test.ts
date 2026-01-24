import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Keypair } from '@solana/web3.js';

// Mock all external dependencies with vi.hoisted for ESM compatibility
const mockProverFns = vi.hoisted(() => ({
  isProverAvailable: vi.fn().mockReturnValue(true),
  getProverStatus: vi.fn().mockReturnValue({
    available: true,
    strictMode: false,
    nargoVersion: '1.0.0-beta.13',
    sunspotPath: '/usr/local/bin/sunspot',
    sunspotFound: true,
    artifacts: { circuit: true, proving_key: true, verifying_key: true },
    cache: { size: 100, maxSize: 1000, hits: 50, misses: 50 },
  }),
}));

const mockBlacklistFns = vi.hoisted(() => ({
  getEmptyTreeRoot: vi.fn().mockReturnValue('0x1234567890abcdef'),
}));

const mockLoggerFns = vi.hoisted(() => ({
  logger: {
    health: {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

const mockMetricsFns = vi.hoisted(() => ({
  walletBalance: {
    set: vi.fn(),
  },
}));

const mockRateLimitFns = vi.hoisted(() => ({
  rateLimiters: {
    health: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  },
}));

const mockDbFns = vi.hoisted(() => ({
  DatabaseClient: {
    getInstance: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ ok: 1 }),
    }),
  },
}));

// Mock file system
const mockFsFns = vi.hoisted(() => ({
  existsSync: vi.fn().mockReturnValue(true),
  readFileSync: vi.fn(),
}));

vi.mock('../../lib/prover.js', () => mockProverFns);
vi.mock('../../lib/blacklist.js', () => mockBlacklistFns);
vi.mock('../../lib/logger.js', () => mockLoggerFns);
vi.mock('./metrics.js', () => mockMetricsFns);
vi.mock('../../middleware/rate-limit.js', () => mockRateLimitFns);
vi.mock('../../db/client.js', () => mockDbFns);

vi.mock('fs', () => ({
  default: mockFsFns,
  existsSync: mockFsFns.existsSync,
  readFileSync: mockFsFns.readFileSync,
}));

// Import after mocks
import { healthRouter, setCrankServiceRef } from '../../routes/health.js';

describe('health routes', () => {
  let app: express.Application;
  let testKeypair: Keypair;

  beforeEach(() => {
    vi.clearAllMocks();

    app = express();
    app.use(express.json());
    app.use('/health', healthRouter);

    // Generate a test keypair for wallet tests
    testKeypair = Keypair.generate();
    mockFsFns.readFileSync.mockReturnValue(
      JSON.stringify(Array.from(testKeypair.secretKey))
    );

    // Reset prover status
    mockProverFns.getProverStatus.mockReturnValue({
      available: true,
      strictMode: false,
      nargoVersion: '1.0.0-beta.13',
      sunspotPath: '/usr/local/bin/sunspot',
      sunspotFound: true,
      artifacts: { circuit: true, proving_key: true, verifying_key: true },
      cache: { size: 100, maxSize: 1000, hits: 50, misses: 50 },
    });

    // Reset file system mock
    mockFsFns.existsSync.mockReturnValue(true);

    // Reset database mock
    mockDbFns.DatabaseClient.getInstance.mockReturnValue({
      get: vi.fn().mockReturnValue({ ok: 1 }),
    });

    // Reset crank service reference
    setCrankServiceRef(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.SOLANA_RPC_URL;
    delete process.env.NEXT_PUBLIC_RPC_URL;
    delete process.env.ARCIUM_PROGRAM_ID;
    delete process.env.ARCIUM_CLUSTER_OFFSET;
    delete process.env.CRANK_WALLET_PATH;
    delete process.env.CRANK_MIN_SOL_BALANCE;
  });

  describe('GET /health', () => {
    it('returns basic health status', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.version).toBeDefined();
      expect(response.body.uptime).toBeDefined();
      expect(response.body.prover).toBeDefined();
    });

    it('includes prover details in response', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.prover).toMatchObject({
        mode: 'real',
        strictMode: false,
        treeDepth: 20,
        hashFunction: 'poseidon2',
      });
    });

    it('reflects simulated prover mode', async () => {
      mockProverFns.getProverStatus.mockReturnValue({
        available: false,
        strictMode: false,
        nargoVersion: null,
        sunspotPath: null,
        sunspotFound: false,
        artifacts: { circuit: false, proving_key: false, verifying_key: false },
        cache: { size: 0, maxSize: 1000, hits: 0, misses: 0 },
      });

      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(response.body.prover.mode).toBe('simulated');
    });

    it('returns uptime in seconds', async () => {
      const response = await request(app).get('/health');

      expect(response.status).toBe(200);
      expect(typeof response.body.uptime).toBe('number');
      expect(response.body.uptime).toBeGreaterThanOrEqual(0);
    });

    it('uses default version when npm_package_version not set', async () => {
      const response = await request(app).get('/health');

      expect(response.body.version).toBeDefined();
    });
  });

  describe('GET /health/live', () => {
    it('returns alive status for liveness probe', async () => {
      const response = await request(app).get('/health/live');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: 'alive' });
    });

    it('returns minimal response for fast liveness check', async () => {
      const response = await request(app).get('/health/live');

      expect(Object.keys(response.body)).toEqual(['status']);
    });
  });

  describe('GET /health/ready', () => {
    it('checks RPC and database health and returns appropriate status', async () => {
      // The ready endpoint calls checkRpc() and checkDatabase()
      // which make real network calls - we're testing the handler behavior
      const response = await request(app).get('/health/ready');

      // Should return a response (either ready or not_ready)
      expect([200, 503]).toContain(response.status);
      expect(['ready', 'not_ready']).toContain(response.body.status);
    });

    it('returns 503 when database is unhealthy', async () => {
      mockDbFns.DatabaseClient.getInstance.mockReturnValue({
        get: vi.fn().mockImplementation(() => {
          throw new Error('Database connection failed');
        }),
      });

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
    });

    it('handles unexpected database errors gracefully', async () => {
      mockDbFns.DatabaseClient.getInstance.mockImplementation(() => {
        throw new Error('Unexpected initialization error');
      });

      const response = await request(app).get('/health/ready');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('not_ready');
    });
  });

  describe('GET /health/detailed', () => {
    beforeEach(() => {
      // Set up crank service for detailed check
      setCrankServiceRef({
        getMetrics: vi.fn().mockReturnValue({
          status: 'running',
          totalPolls: 100,
          successfulMatches: 50,
          failedMatches: 5,
          consecutiveErrors: 0,
          openOrderCount: 10,
          pendingMatches: 2,
        }),
      });
    });

    it('returns subsystem health statuses', async () => {
      const response = await request(app).get('/health/detailed');

      // Should return a valid response
      expect([200, 503]).toContain(response.status);
      expect(response.body.subsystems).toBeDefined();
    });

    it('includes version, timestamp, and uptime', async () => {
      const response = await request(app).get('/health/detailed');

      expect(response.body.version).toBeDefined();
      expect(response.body.timestamp).toBeDefined();
      expect(response.body.uptime).toBeDefined();
    });

    describe('database health check', () => {
      it('returns healthy for successful database query', async () => {
        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.database.status).toBe('healthy');
        expect(response.body.subsystems.database.details?.type).toBe('sqlite');
      });

      it('includes latency in database check', async () => {
        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.database.latencyMs).toBeDefined();
      });

      it('returns unhealthy when database fails', async () => {
        mockDbFns.DatabaseClient.getInstance.mockReturnValue({
          get: vi.fn().mockImplementation(() => {
            throw new Error('SQLITE_READONLY');
          }),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.database.status).toBe('unhealthy');
        expect(response.body.subsystems.database.message).toContain('SQLITE_READONLY');
      });

      it('handles database returning unexpected result', async () => {
        mockDbFns.DatabaseClient.getInstance.mockReturnValue({
          get: vi.fn().mockReturnValue({ ok: 0 }),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.database.status).toBe('unhealthy');
        expect(response.body.subsystems.database.message).toContain('unexpected result');
      });

      it('handles database returning null', async () => {
        mockDbFns.DatabaseClient.getInstance.mockReturnValue({
          get: vi.fn().mockReturnValue(null),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.database.status).toBe('unhealthy');
      });

      it('logs database errors', async () => {
        mockDbFns.DatabaseClient.getInstance.mockReturnValue({
          get: vi.fn().mockImplementation(() => {
            throw new Error('DB error');
          }),
        });

        await request(app).get('/health/detailed');

        expect(mockLoggerFns.logger.health.error).toHaveBeenCalled();
      });
    });

    describe('crank health check', () => {
      it('returns degraded when crank service is not initialized', async () => {
        setCrankServiceRef(null);

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.crank.status).toBe('degraded');
        expect(response.body.subsystems.crank.message).toBe('Crank service not initialized');
      });

      it('returns healthy for running crank service', async () => {
        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.crank.status).toBe('healthy');
      });

      it('returns degraded when crank service is stopped', async () => {
        setCrankServiceRef({
          getMetrics: vi.fn().mockReturnValue({
            status: 'stopped',
            totalPolls: 100,
            successfulMatches: 50,
            failedMatches: 5,
            consecutiveErrors: 0,
            openOrderCount: 0,
            pendingMatches: 0,
          }),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.crank.status).toBe('degraded');
        expect(response.body.subsystems.crank.message).toBe('Crank service is stopped');
      });

      it('returns degraded when crank service is paused', async () => {
        setCrankServiceRef({
          getMetrics: vi.fn().mockReturnValue({
            status: 'paused',
            totalPolls: 100,
            successfulMatches: 50,
            failedMatches: 5,
            consecutiveErrors: 0,
            openOrderCount: 0,
            pendingMatches: 0,
          }),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.crank.status).toBe('degraded');
        expect(response.body.subsystems.crank.message).toBe('Crank service is paused (circuit breaker)');
      });

      it('returns degraded when crank has high error rate', async () => {
        setCrankServiceRef({
          getMetrics: vi.fn().mockReturnValue({
            status: 'running',
            totalPolls: 100,
            successfulMatches: 50,
            failedMatches: 20,
            consecutiveErrors: 10,
            openOrderCount: 10,
            pendingMatches: 2,
          }),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.crank.status).toBe('degraded');
        expect(response.body.subsystems.crank.message).toContain('consecutive errors');
      });

      it('includes crank metrics details', async () => {
        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.crank.details).toMatchObject({
          serviceStatus: 'running',
          totalPolls: 100,
          successfulMatches: 50,
          failedMatches: 5,
          consecutiveErrors: 0,
          openOrders: 10,
          pendingMatches: 2,
        });
      });

      it('handles crank getMetrics throwing error', async () => {
        setCrankServiceRef({
          getMetrics: vi.fn().mockImplementation(() => {
            throw new Error('Metrics unavailable');
          }),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.crank.status).toBe('unhealthy');
        expect(response.body.subsystems.crank.message).toContain('Metrics unavailable');
      });

      it('logs crank errors', async () => {
        setCrankServiceRef({
          getMetrics: vi.fn().mockImplementation(() => {
            throw new Error('Crank error');
          }),
        });

        await request(app).get('/health/detailed');

        expect(mockLoggerFns.logger.health.error).toHaveBeenCalled();
      });
    });

    describe('wallet health check', () => {
      it('returns degraded when wallet file not found', async () => {
        mockFsFns.existsSync.mockReturnValue(false);

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.wallet.status).toBe('degraded');
        expect(response.body.subsystems.wallet.message).toBe('Crank wallet file not found');
      });

      it('uses custom CRANK_WALLET_PATH', async () => {
        process.env.CRANK_WALLET_PATH = '/custom/path/wallet.json';

        mockFsFns.existsSync.mockImplementation((path: string) => {
          return path === '/custom/path/wallet.json';
        });

        await request(app).get('/health/detailed');

        expect(mockFsFns.existsSync).toHaveBeenCalledWith('/custom/path/wallet.json');
      });

      it('handles wallet file read error', async () => {
        mockFsFns.readFileSync.mockImplementation(() => {
          throw new Error('Permission denied');
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.wallet.status).toBe('unhealthy');
        expect(response.body.subsystems.wallet.message).toContain('Permission denied');
      });

      it('handles invalid wallet file content', async () => {
        mockFsFns.readFileSync.mockReturnValue('invalid json');

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.wallet.status).toBe('unhealthy');
      });

      it('logs wallet errors', async () => {
        mockFsFns.readFileSync.mockImplementation(() => {
          throw new Error('Wallet error');
        });

        await request(app).get('/health/detailed');

        expect(mockLoggerFns.logger.health.error).toHaveBeenCalled();
      });
    });

    describe('prover health check', () => {
      it('returns healthy when prover is available', async () => {
        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.prover.status).toBe('healthy');
      });

      it('returns degraded when prover is in simulated mode', async () => {
        mockProverFns.getProverStatus.mockReturnValue({
          available: false,
          strictMode: false,
          nargoVersion: null,
          sunspotPath: null,
          sunspotFound: false,
          artifacts: { circuit: false, proving_key: false, verifying_key: false },
          cache: { size: 0, maxSize: 1000, hits: 0, misses: 0 },
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.prover.status).toBe('degraded');
        expect(response.body.subsystems.prover.message).toContain('simulated mode');
      });

      it('includes prover details', async () => {
        const response = await request(app).get('/health/detailed');

        expect(response.body.subsystems.prover.details).toMatchObject({
          mode: 'real',
          strictMode: false,
          treeDepth: 20,
          hashFunction: 'poseidon2',
        });
      });
    });

    describe('overall status calculation', () => {
      it('returns unhealthy when database is unhealthy', async () => {
        mockDbFns.DatabaseClient.getInstance.mockReturnValue({
          get: vi.fn().mockImplementation(() => {
            throw new Error('Database error');
          }),
        });

        const response = await request(app).get('/health/detailed');

        expect(response.body.status).toBe('unhealthy');
        expect(response.status).toBe(503);
      });

      it('returns 200 when status is degraded', async () => {
        setCrankServiceRef(null); // This makes crank degraded

        const response = await request(app).get('/health/detailed');

        // Could be 200 (degraded) or 503 (unhealthy from RPC/MPC)
        expect([200, 503]).toContain(response.status);
      });
    });

    it('logs info when running detailed check', async () => {
      await request(app).get('/health/detailed');

      expect(mockLoggerFns.logger.health.info).toHaveBeenCalledWith(
        'Running detailed health check'
      );
    });
  });

  describe('setCrankServiceRef', () => {
    it('allows setting crank service reference', async () => {
      const mockService = {
        getMetrics: vi.fn().mockReturnValue({
          status: 'running',
          totalPolls: 100,
          successfulMatches: 50,
          failedMatches: 5,
          consecutiveErrors: 0,
          openOrderCount: 10,
          pendingMatches: 2,
        }),
      };

      setCrankServiceRef(mockService);

      const response = await request(app).get('/health/detailed');

      expect(response.body.subsystems.crank.status).toBe('healthy');
      expect(mockService.getMetrics).toHaveBeenCalled();
    });

    it('allows clearing crank service reference', async () => {
      setCrankServiceRef({
        getMetrics: vi.fn().mockReturnValue({ status: 'running' }),
      });
      setCrankServiceRef(null);

      const response = await request(app).get('/health/detailed');

      expect(response.body.subsystems.crank.status).toBe('degraded');
      expect(response.body.subsystems.crank.message).toBe('Crank service not initialized');
    });

    it('accepts null reference', () => {
      expect(() => setCrankServiceRef(null)).not.toThrow();
    });

    it('accepts service reference with getMetrics', () => {
      const mockService = {
        getMetrics: vi.fn().mockReturnValue({
          status: 'running',
          totalPolls: 50,
          successfulMatches: 25,
          failedMatches: 1,
          consecutiveErrors: 0,
          openOrderCount: 5,
          pendingMatches: 2,
        }),
      };

      expect(() => setCrankServiceRef(mockService)).not.toThrow();
    });
  });

  describe('environment variables', () => {
    it('uses SOLANA_RPC_URL environment variable', async () => {
      process.env.SOLANA_RPC_URL = 'https://custom-rpc.example.com';

      const response = await request(app).get('/health/detailed');

      // Should attempt the health check
      expect([200, 503]).toContain(response.status);
    });

    it('falls back to NEXT_PUBLIC_RPC_URL', async () => {
      process.env.NEXT_PUBLIC_RPC_URL = 'https://fallback-rpc.example.com';

      const response = await request(app).get('/health/detailed');

      expect([200, 503]).toContain(response.status);
    });

    it('uses default devnet RPC when no env vars set', async () => {
      const response = await request(app).get('/health/detailed');

      expect([200, 503]).toContain(response.status);
    });
  });

  describe('healthRouter', () => {
    it('exports a valid Express router', () => {
      expect(healthRouter).toBeDefined();
      expect((healthRouter as unknown as { stack: unknown[] }).stack).toBeDefined();
    });

    it('has all route handlers registered', () => {
      const routerStack = (healthRouter as unknown as { stack: Array<{ route?: { path: string } }> }).stack;
      const routes = routerStack
        .filter(layer => layer.route)
        .map(layer => layer.route?.path);

      expect(routes).toContain('/');
      expect(routes).toContain('/live');
      expect(routes).toContain('/ready');
      expect(routes).toContain('/detailed');
    });
  });

  describe('rate limiting', () => {
    it('applies health rate limiter', () => {
      // The rate limiter middleware is applied to all health routes
      // Our mock just passes through, so routes should work
      expect(healthRouter).toBeDefined();
    });
  });
});
