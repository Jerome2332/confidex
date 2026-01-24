import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection } from '@solana/web3.js';
import {
  FailoverConnection,
  createFailoverConnectionFromEnv,
  RpcEndpoint,
} from '../../crank/failover-connection.js';

// Use vi.hoisted for all mocks that need to be available before module loading
const mockErrorFns = vi.hoisted(() => ({
  classifyError: vi.fn().mockImplementation((error: unknown) => ({
    code: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
  })),
}));

const mockTimeoutFns = vi.hoisted(() => ({
  withTimeout: vi.fn().mockImplementation((promise: Promise<unknown>) => promise),
}));

// Mock dependencies
vi.mock('@solana/web3.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@solana/web3.js')>();
  return {
    ...actual,
    Connection: vi.fn().mockImplementation((url: string) => ({
      rpcEndpoint: url,
      getSlot: vi.fn().mockResolvedValue(12345),
      getAccountInfo: vi.fn().mockResolvedValue(null),
    })),
  };
});

vi.mock('../../lib/timeout.js', () => ({
  withTimeout: mockTimeoutFns.withTimeout,
  TimeoutError: class TimeoutError extends Error {
    code = 'TIMEOUT';
    constructor(ms: number, op?: string) {
      super(`Operation "${op}" timed out after ${ms}ms`);
    }
  },
  DEFAULT_TIMEOUTS: {
    RPC: 30000,
    TRANSACTION: 60000,
  },
}));

vi.mock('../../lib/errors.js', () => ({
  classifyError: mockErrorFns.classifyError,
  NetworkError: class NetworkError extends Error {
    code = 'NETWORK_ERROR';
  },
  ErrorCode: {
    CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
    CONNECTION_RESET: 'CONNECTION_RESET',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
    UNKNOWN: 'UNKNOWN',
  },
}));

// Define ErrorCode for use in tests
const ErrorCode = {
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  CONNECTION_RESET: 'CONNECTION_RESET',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN',
};

describe('FailoverConnection', () => {
  const testEndpoints: RpcEndpoint[] = [
    { url: 'https://primary.example.com', weight: 10 },
    { url: 'https://backup1.example.com', weight: 5 },
    { url: 'https://backup2.example.com', weight: 1 },
  ];

  let failoverConn: FailoverConnection;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock implementations after clearAllMocks
    mockErrorFns.classifyError.mockImplementation((error: unknown) => ({
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : String(error),
    }));
    mockTimeoutFns.withTimeout.mockImplementation((promise: Promise<unknown>) => promise);

    failoverConn = new FailoverConnection({
      endpoints: testEndpoints,
      commitment: 'confirmed',
      healthCheckIntervalMs: 10000,
      maxConsecutiveFailures: 3,
    });
  });

  afterEach(() => {
    failoverConn.stopHealthChecks();
  });

  describe('constructor', () => {
    it('creates connection with endpoints', () => {
      const conn = new FailoverConnection({ endpoints: testEndpoints });
      expect(conn.getConnection()).toBeDefined();
    });

    it('throws error when no endpoints provided', () => {
      expect(() => new FailoverConnection({ endpoints: [] })).toThrow(
        'At least one endpoint is required'
      );
    });

    it('sorts endpoints by weight (highest first)', () => {
      const endpoints: RpcEndpoint[] = [
        { url: 'https://low.example.com', weight: 1 },
        { url: 'https://high.example.com', weight: 10 },
        { url: 'https://medium.example.com', weight: 5 },
      ];

      const conn = new FailoverConnection({ endpoints });
      const status = conn.getEndpointStatus();

      expect(status[0].url).toBe('https://high.example.com');
      expect(status[1].url).toBe('https://medium.example.com');
      expect(status[2].url).toBe('https://low.example.com');
    });

    it('uses default values for optional config', () => {
      const conn = new FailoverConnection({
        endpoints: [{ url: 'https://test.example.com' }],
      });

      expect(conn.getConnection()).toBeDefined();
      expect(conn.getCurrentEndpoint()).toBe('https://test.example.com');
    });

    it('connects to highest weight endpoint initially', () => {
      expect(failoverConn.getCurrentEndpoint()).toBe('https://primary.example.com');
    });
  });

  describe('getConnection', () => {
    it('returns the current connection instance', () => {
      const conn = failoverConn.getConnection();
      expect(conn).toBeDefined();
    });

    it('returns same instance on repeated calls', () => {
      const conn1 = failoverConn.getConnection();
      const conn2 = failoverConn.getConnection();
      expect(conn1).toBe(conn2);
    });
  });

  describe('getCurrentEndpoint', () => {
    it('returns current endpoint URL', () => {
      expect(failoverConn.getCurrentEndpoint()).toBe('https://primary.example.com');
    });
  });

  describe('startHealthChecks', () => {
    it('starts periodic health checks', () => {
      vi.useFakeTimers();

      failoverConn.startHealthChecks();

      // Should not throw
      vi.advanceTimersByTime(10000);

      failoverConn.stopHealthChecks();
      vi.useRealTimers();
    });

    it('does not start duplicate timers', () => {
      vi.useFakeTimers();

      failoverConn.startHealthChecks();
      failoverConn.startHealthChecks();

      // Should only have one timer
      failoverConn.stopHealthChecks();
      vi.useRealTimers();
    });
  });

  describe('stopHealthChecks', () => {
    it('stops health check timer', () => {
      vi.useFakeTimers();

      failoverConn.startHealthChecks();
      failoverConn.stopHealthChecks();

      // Should not throw even after advancing time
      vi.advanceTimersByTime(100000);
      vi.useRealTimers();
    });

    it('can be called when not running', () => {
      expect(() => failoverConn.stopHealthChecks()).not.toThrow();
    });
  });

  describe('recordSuccess', () => {
    it('resets consecutive failures', () => {
      // First record some failures
      failoverConn.recordSuccess();

      const status = failoverConn.getEndpointStatus();
      const current = status.find((s) => s.isCurrent);
      expect(current?.consecutiveFailures).toBe(0);
      expect(current?.isHealthy).toBe(true);
    });
  });

  describe('recordFailure', () => {
    it('increments failure count', async () => {
      const error = new Error('RPC error');

      await failoverConn.recordFailure(error);

      const status = failoverConn.getEndpointStatus();
      const current = status.find((s) => s.isCurrent);
      expect(current?.consecutiveFailures).toBe(1);
    });

    it('does not failover on regular errors', async () => {
      const error = new Error('Regular error');

      const didFailover = await failoverConn.recordFailure(error);

      expect(didFailover).toBe(false);
      expect(failoverConn.getCurrentEndpoint()).toBe('https://primary.example.com');
    });

    it('fails over after max consecutive network failures', async () => {
      mockErrorFns.classifyError.mockReturnValue({
        code: ErrorCode.CONNECTION_TIMEOUT,
      });

      // Trigger max failures
      for (let i = 0; i < 3; i++) {
        await failoverConn.recordFailure(new Error('Network error'));
      }

      // Should have failed over
      expect(failoverConn.getCurrentEndpoint()).toBe('https://backup1.example.com');
    });
  });

  describe('executeWithFailover', () => {
    it('executes operation successfully', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      const result = await failoverConn.executeWithFailover(operation);

      expect(result).toBe('result');
      expect(operation).toHaveBeenCalledWith(failoverConn.getConnection());
    });

    it('records success on successful operation', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      await failoverConn.executeWithFailover(operation);

      const status = failoverConn.getEndpointStatus();
      const current = status.find((s) => s.isCurrent);
      expect(current?.consecutiveFailures).toBe(0);
    });

    it('retries on failure', async () => {
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockResolvedValue('success');

      const result = await failoverConn.executeWithFailover(operation, { maxRetries: 3 });

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('throws after max retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Always fails'));

      await expect(
        failoverConn.executeWithFailover(operation, { maxRetries: 3 })
      ).rejects.toThrow('Always fails');

      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('accepts custom timeout', async () => {
      const operation = vi.fn().mockResolvedValue('result');

      await failoverConn.executeWithFailover(operation, {
        maxRetries: 1,
        timeoutMs: 5000,
      });

      expect(operation).toHaveBeenCalled();
    });
  });

  describe('getEndpointStatus', () => {
    it('returns status for all endpoints', () => {
      const status = failoverConn.getEndpointStatus();

      expect(status).toHaveLength(3);
      expect(status[0]).toHaveProperty('url');
      expect(status[0]).toHaveProperty('isHealthy');
      expect(status[0]).toHaveProperty('isCurrent');
      expect(status[0]).toHaveProperty('consecutiveFailures');
      expect(status[0]).toHaveProperty('latencyMs');
    });

    it('marks current endpoint correctly', () => {
      const status = failoverConn.getEndpointStatus();

      const currentEndpoints = status.filter((s) => s.isCurrent);
      expect(currentEndpoints).toHaveLength(1);
      expect(currentEndpoints[0].url).toBe('https://primary.example.com');
    });

    it('all endpoints initially healthy', () => {
      const status = failoverConn.getEndpointStatus();

      expect(status.every((s) => s.isHealthy)).toBe(true);
      expect(status.every((s) => s.consecutiveFailures === 0)).toBe(true);
    });
  });

  describe('switchToEndpoint', () => {
    it('switches to specified endpoint', () => {
      const result = failoverConn.switchToEndpoint('https://backup1.example.com');

      expect(result).toBe(true);
      expect(failoverConn.getCurrentEndpoint()).toBe('https://backup1.example.com');
    });

    it('returns false for unknown endpoint', () => {
      const result = failoverConn.switchToEndpoint('https://unknown.example.com');

      expect(result).toBe(false);
      expect(failoverConn.getCurrentEndpoint()).toBe('https://primary.example.com');
    });

    it('updates connection when switching', () => {
      const connBefore = failoverConn.getConnection();

      failoverConn.switchToEndpoint('https://backup1.example.com');

      const connAfter = failoverConn.getConnection();
      expect(connBefore).not.toBe(connAfter);
    });
  });

  describe('addEndpoint', () => {
    it('adds new endpoint', () => {
      failoverConn.addEndpoint({ url: 'https://new.example.com', weight: 3 });

      const status = failoverConn.getEndpointStatus();
      expect(status).toHaveLength(4);
      expect(status.some((s) => s.url === 'https://new.example.com')).toBe(true);
    });

    it('re-sorts by weight after adding', () => {
      failoverConn.addEndpoint({ url: 'https://highest.example.com', weight: 100 });

      const status = failoverConn.getEndpointStatus();
      expect(status[0].url).toBe('https://highest.example.com');
    });

    it('new endpoint is initially healthy', () => {
      failoverConn.addEndpoint({ url: 'https://new.example.com' });

      const status = failoverConn.getEndpointStatus();
      const newEndpoint = status.find((s) => s.url === 'https://new.example.com');
      expect(newEndpoint?.isHealthy).toBe(true);
      expect(newEndpoint?.consecutiveFailures).toBe(0);
    });

    it('uses default weight if not specified', () => {
      failoverConn.addEndpoint({ url: 'https://new.example.com' });

      const status = failoverConn.getEndpointStatus();
      const newEndpoint = status.find((s) => s.url === 'https://new.example.com');
      expect(newEndpoint).toBeDefined();
    });
  });

  describe('removeEndpoint', () => {
    it('removes specified endpoint', () => {
      const result = failoverConn.removeEndpoint('https://backup2.example.com');

      expect(result).toBe(true);
      const status = failoverConn.getEndpointStatus();
      expect(status).toHaveLength(2);
      expect(status.some((s) => s.url === 'https://backup2.example.com')).toBe(false);
    });

    it('returns false for unknown endpoint', () => {
      const result = failoverConn.removeEndpoint('https://unknown.example.com');

      expect(result).toBe(false);
      expect(failoverConn.getEndpointStatus()).toHaveLength(3);
    });

    it('prevents removing last endpoint', () => {
      const singleEndpointConn = new FailoverConnection({
        endpoints: [{ url: 'https://only.example.com' }],
      });

      const result = singleEndpointConn.removeEndpoint('https://only.example.com');

      expect(result).toBe(false);
      expect(singleEndpointConn.getEndpointStatus()).toHaveLength(1);
    });

    it('switches connection if removing current endpoint', () => {
      // Current is primary
      expect(failoverConn.getCurrentEndpoint()).toBe('https://primary.example.com');

      failoverConn.removeEndpoint('https://primary.example.com');

      // Should have switched to another endpoint
      expect(failoverConn.getCurrentEndpoint()).not.toBe('https://primary.example.com');
    });
  });

  describe('failover behavior', () => {
    it('cycles through all endpoints', async () => {
      mockErrorFns.classifyError.mockReturnValue({
        code: ErrorCode.CONNECTION_TIMEOUT,
      });

      // Start at primary
      expect(failoverConn.getCurrentEndpoint()).toBe('https://primary.example.com');

      // Fail primary
      for (let i = 0; i < 3; i++) {
        await failoverConn.recordFailure(new Error('timeout'));
      }
      expect(failoverConn.getCurrentEndpoint()).toBe('https://backup1.example.com');

      // Fail backup1
      for (let i = 0; i < 3; i++) {
        await failoverConn.recordFailure(new Error('timeout'));
      }
      expect(failoverConn.getCurrentEndpoint()).toBe('https://backup2.example.com');
    });

    it('resets to primary when all endpoints fail', async () => {
      mockErrorFns.classifyError.mockReturnValue({
        code: ErrorCode.CONNECTION_TIMEOUT,
      });

      // Fail all 3 endpoints exactly - this should trigger the reset
      // Cycle 1: primary fails -> backup1
      for (let i = 0; i < 3; i++) {
        await failoverConn.recordFailure(new Error('timeout'));
      }
      expect(failoverConn.getCurrentEndpoint()).toBe('https://backup1.example.com');

      // Cycle 2: backup1 fails -> backup2
      for (let i = 0; i < 3; i++) {
        await failoverConn.recordFailure(new Error('timeout'));
      }
      expect(failoverConn.getCurrentEndpoint()).toBe('https://backup2.example.com');

      // Cycle 3: backup2 fails -> all unhealthy, should reset to primary
      for (let i = 0; i < 3; i++) {
        await failoverConn.recordFailure(new Error('timeout'));
      }

      // After all endpoints fail, it resets to primary with clean state
      const status = failoverConn.getEndpointStatus();
      expect(status.every((s) => s.consecutiveFailures === 0)).toBe(true);
      expect(status.every((s) => s.isHealthy)).toBe(true);
    });

    it('calls onEndpointChange callback on failover', async () => {
      const onEndpointChange = vi.fn();

      const conn = new FailoverConnection({
        endpoints: testEndpoints,
        maxConsecutiveFailures: 3,
        onEndpointChange,
      });

      mockErrorFns.classifyError.mockReturnValue({
        code: ErrorCode.CONNECTION_TIMEOUT,
      });

      for (let i = 0; i < 3; i++) {
        await conn.recordFailure(new Error('timeout'));
      }

      expect(onEndpointChange).toHaveBeenCalledWith(
        'https://primary.example.com',
        'https://backup1.example.com',
        'consecutive failures'
      );
    });
  });

  describe('endpoint weights', () => {
    it('prefers higher weight endpoints', () => {
      const status = failoverConn.getEndpointStatus();

      // First should be highest weight
      expect(status[0].url).toBe('https://primary.example.com');
    });

    it('handles endpoints with same weight', () => {
      const endpoints: RpcEndpoint[] = [
        { url: 'https://a.example.com', weight: 5 },
        { url: 'https://b.example.com', weight: 5 },
        { url: 'https://c.example.com', weight: 5 },
      ];

      const conn = new FailoverConnection({ endpoints });
      const status = conn.getEndpointStatus();

      // All should be present
      expect(status).toHaveLength(3);
    });

    it('handles endpoints without weight (defaults to 1)', () => {
      const endpoints: RpcEndpoint[] = [
        { url: 'https://no-weight.example.com' },
        { url: 'https://weighted.example.com', weight: 5 },
      ];

      const conn = new FailoverConnection({ endpoints });
      const status = conn.getEndpointStatus();

      // Weighted should be first
      expect(status[0].url).toBe('https://weighted.example.com');
    });
  });
});

describe('createFailoverConnectionFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates connection with primary RPC URL from env', () => {
    process.env.HELIUS_RPC_URL = 'https://helius.example.com';

    const conn = createFailoverConnectionFromEnv();
    const status = conn.getEndpointStatus();

    expect(status.some((s) => s.url === 'https://helius.example.com')).toBe(true);
  });

  it('falls back to RPC_URL if HELIUS_RPC_URL not set', () => {
    delete process.env.HELIUS_RPC_URL;
    process.env.RPC_URL = 'https://rpc.example.com';

    const conn = createFailoverConnectionFromEnv();
    const status = conn.getEndpointStatus();

    expect(status.some((s) => s.url === 'https://rpc.example.com')).toBe(true);
  });

  it('falls back to devnet if no env vars set', () => {
    delete process.env.HELIUS_RPC_URL;
    delete process.env.RPC_URL;
    delete process.env.BACKUP_RPC_URLS;

    const conn = createFailoverConnectionFromEnv();
    const status = conn.getEndpointStatus();

    expect(status.some((s) => s.url.includes('devnet.solana.com'))).toBe(true);
  });

  it('adds backup URLs from env', () => {
    process.env.HELIUS_RPC_URL = 'https://primary.example.com';
    process.env.BACKUP_RPC_URLS = 'https://backup1.example.com,https://backup2.example.com';

    const conn = createFailoverConnectionFromEnv();
    const status = conn.getEndpointStatus();

    expect(status.length).toBeGreaterThanOrEqual(2);
    expect(status.some((s) => s.url === 'https://backup1.example.com')).toBe(true);
    expect(status.some((s) => s.url === 'https://backup2.example.com')).toBe(true);
  });

  it('primary endpoint has highest weight', () => {
    process.env.HELIUS_RPC_URL = 'https://primary.example.com';
    process.env.BACKUP_RPC_URLS = 'https://backup.example.com';

    const conn = createFailoverConnectionFromEnv();
    const status = conn.getEndpointStatus();

    // Primary should be first (highest weight)
    expect(status[0].url).toBe('https://primary.example.com');
  });

  it('uses custom health check interval from env', () => {
    process.env.RPC_HEALTH_CHECK_INTERVAL_MS = '60000';

    const conn = createFailoverConnectionFromEnv();
    expect(conn).toBeDefined();
    conn.stopHealthChecks();
  });

  it('uses custom max failures from env', () => {
    process.env.RPC_MAX_FAILURES = '5';

    const conn = createFailoverConnectionFromEnv();
    expect(conn).toBeDefined();
    conn.stopHealthChecks();
  });

  it('trims whitespace from backup URLs', () => {
    process.env.HELIUS_RPC_URL = 'https://primary.example.com';
    process.env.BACKUP_RPC_URLS = '  https://backup.example.com  ';

    const conn = createFailoverConnectionFromEnv();
    const status = conn.getEndpointStatus();

    expect(status.some((s) => s.url === 'https://backup.example.com')).toBe(true);
  });

  it('handles empty backup URLs', () => {
    process.env.HELIUS_RPC_URL = 'https://primary.example.com';
    process.env.BACKUP_RPC_URLS = '';

    const conn = createFailoverConnectionFromEnv();
    expect(conn).toBeDefined();
    conn.stopHealthChecks();
  });
});
