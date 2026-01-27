import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import {
  OrderCacheSubscriber,
  createOrderCacheSubscriberFromEnv,
} from '../../crank/order-cache-subscriber.js';

// Mock logger
vi.mock('../../lib/logger.js', () => ({
  logger: {
    crank: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}));

// Mock metrics
vi.mock('../../routes/metrics.js', () => ({
  metricsRegistry: {
    registerMetric: vi.fn(),
  },
}));

describe('OrderCacheSubscriber', () => {
  let subscriber: OrderCacheSubscriber;
  let mockConnection: Connection;
  let programId: PublicKey;

  beforeEach(() => {
    programId = Keypair.generate().publicKey;

    mockConnection = {
      onProgramAccountChange: vi.fn().mockReturnValue(1),
      removeProgramAccountChangeListener: vi.fn().mockResolvedValue(undefined),
    } as unknown as Connection;

    subscriber = new OrderCacheSubscriber(mockConnection, programId, {
      enableWebSocket: false, // Disable for most tests
      maxTtlMs: 60000,
    });
  });

  afterEach(() => {
    subscriber.stop();
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates subscriber with default config', () => {
      const sub = new OrderCacheSubscriber(mockConnection, programId);
      expect(sub).toBeDefined();
      expect(sub.isActive()).toBe(false);
    });

    it('creates subscriber with custom config', () => {
      const sub = new OrderCacheSubscriber(mockConnection, programId, {
        maxTtlMs: 30000,
        enableWebSocket: true,
        commitment: 'finalized',
        maxReconnectAttempts: 5,
        reconnectDelayMs: 2000,
      });
      expect(sub).toBeDefined();
    });
  });

  describe('cache operations', () => {
    it('returns null for uncached entries', () => {
      const pda = Keypair.generate().publicKey.toString();
      const result = subscriber.get(pda);
      expect(result).toBeNull();
    });

    it('stores and retrieves cache entries', () => {
      const pda = Keypair.generate().publicKey.toString();
      const data = Buffer.from('test data');
      const slot = 12345;

      subscriber.set(pda, data, slot);
      const cached = subscriber.get(pda);

      expect(cached).not.toBeNull();
      expect(cached!.data).toEqual(data);
      expect(cached!.slot).toBe(slot);
    });

    it('does not overwrite with older slot data', () => {
      const pda = Keypair.generate().publicKey.toString();
      const oldData = Buffer.from('old data');
      const newData = Buffer.from('new data');

      subscriber.set(pda, newData, 200);
      subscriber.set(pda, oldData, 100); // Older slot

      const cached = subscriber.get(pda);
      expect(cached!.data).toEqual(newData);
      expect(cached!.slot).toBe(200);
    });

    it('expires entries after TTL', async () => {
      // Create subscriber with very short TTL
      const shortTtlSubscriber = new OrderCacheSubscriber(mockConnection, programId, {
        enableWebSocket: false,
        maxTtlMs: 10, // 10ms TTL
      });

      const pda = Keypair.generate().publicKey.toString();
      shortTtlSubscriber.set(pda, Buffer.from('test'), 100);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      const cached = shortTtlSubscriber.get(pda);
      expect(cached).toBeNull();
    });
  });

  describe('invalidation', () => {
    it('invalidates single entry', () => {
      const pda = Keypair.generate().publicKey.toString();
      subscriber.set(pda, Buffer.from('test'), 100);

      subscriber.invalidate(pda);

      expect(subscriber.get(pda)).toBeNull();
    });

    it('invalidates all entries', () => {
      const pda1 = Keypair.generate().publicKey.toString();
      const pda2 = Keypair.generate().publicKey.toString();

      subscriber.set(pda1, Buffer.from('test1'), 100);
      subscriber.set(pda2, Buffer.from('test2'), 100);

      subscriber.invalidateAll();

      expect(subscriber.get(pda1)).toBeNull();
      expect(subscriber.get(pda2)).toBeNull();
    });

    it('calls update callback on delete invalidation', () => {
      const callback = vi.fn();
      subscriber.onUpdate(callback);

      const pda = Keypair.generate().publicKey.toString();
      subscriber.set(pda, Buffer.from('test'), 100);

      subscriber.invalidate(pda, 'delete');

      expect(callback).toHaveBeenCalledWith(expect.any(PublicKey), null);
    });
  });

  describe('WebSocket subscription', () => {
    it('starts subscription when enabled', async () => {
      const wsSubscriber = new OrderCacheSubscriber(mockConnection, programId, {
        enableWebSocket: true,
      });

      await wsSubscriber.start();

      expect(mockConnection.onProgramAccountChange).toHaveBeenCalledWith(
        programId,
        expect.any(Function),
        expect.objectContaining({
          commitment: 'confirmed',
          filters: [{ dataSize: 366 }], // V5 order size
        })
      );

      expect(wsSubscriber.isActive()).toBe(true);

      wsSubscriber.stop();
    });

    it('does not start subscription when disabled', async () => {
      await subscriber.start();

      expect(mockConnection.onProgramAccountChange).not.toHaveBeenCalled();
      expect(subscriber.isActive()).toBe(false);
    });

    it('removes subscription on stop', async () => {
      const wsSubscriber = new OrderCacheSubscriber(mockConnection, programId, {
        enableWebSocket: true,
      });

      await wsSubscriber.start();
      wsSubscriber.stop();

      expect(mockConnection.removeProgramAccountChangeListener).toHaveBeenCalledWith(1);
      expect(wsSubscriber.isActive()).toBe(false);
    });
  });

  describe('getStats', () => {
    it('returns correct statistics', () => {
      const pda1 = Keypair.generate().publicKey.toString();
      const pda2 = Keypair.generate().publicKey.toString();

      subscriber.set(pda1, Buffer.from('test1'), 100);
      subscriber.set(pda2, Buffer.from('test2'), 200);

      const stats = subscriber.getStats();

      expect(stats.size).toBe(2);
      expect(stats.isSubscribed).toBe(false);
      expect(stats.reconnectAttempts).toBe(0);
      expect(stats.oldestCachedAt).not.toBeNull();
      expect(stats.newestCachedAt).not.toBeNull();
    });

    it('returns null timestamps for empty cache', () => {
      const stats = subscriber.getStats();

      expect(stats.size).toBe(0);
      expect(stats.oldestCachedAt).toBeNull();
      expect(stats.newestCachedAt).toBeNull();
    });
  });

  describe('createOrderCacheSubscriberFromEnv', () => {
    it('creates subscriber with default env values', () => {
      const sub = createOrderCacheSubscriberFromEnv(mockConnection, programId);
      expect(sub).toBeDefined();
    });

    it('respects environment variables', () => {
      const originalEnv = { ...process.env };

      process.env.ORDER_CACHE_TTL_MS = '30000';
      process.env.ORDER_CACHE_WEBSOCKET = 'false';
      process.env.ORDER_CACHE_COMMITMENT = 'finalized';
      process.env.ORDER_CACHE_MAX_RECONNECTS = '5';
      process.env.ORDER_CACHE_RECONNECT_DELAY_MS = '2000';

      const sub = createOrderCacheSubscriberFromEnv(mockConnection, programId);
      expect(sub).toBeDefined();

      // Restore env
      process.env = originalEnv;
    });
  });
});
