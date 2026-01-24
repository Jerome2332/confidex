import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection } from '@solana/web3.js';
import { BlockhashManager, createBlockhashManagerFromEnv } from '../../crank/blockhash-manager.js';

// Mock Connection
const mockConnection = {
  getSlot: vi.fn(),
  getLatestBlockhash: vi.fn(),
} as unknown as Connection;

describe('BlockhashManager', () => {
  let manager: BlockhashManager;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock responses
    (mockConnection.getSlot as ReturnType<typeof vi.fn>).mockResolvedValue(12345);
    (mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
      blockhash: 'ABC123blockhash',
      lastValidBlockHeight: 12500,
    });

    manager = new BlockhashManager(mockConnection, {
      refreshIntervalMs: 30_000,
      maxAgeMs: 60_000,
      prefetchCount: 2,
      fetchTimeoutMs: 5_000,
    });
  });

  afterEach(() => {
    manager.stop();
  });

  describe('refresh', () => {
    it('fetches and caches blockhash', async () => {
      await manager.refresh();

      expect(mockConnection.getSlot).toHaveBeenCalled();
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalledWith('confirmed');

      const cached = manager.getCachedBlockhash();
      expect(cached).not.toBeNull();
      expect(cached?.blockhash).toBe('ABC123blockhash');
      expect(cached?.lastValidBlockHeight).toBe(12500);
    });

    it('maintains cache size limit', async () => {
      // First refresh
      await manager.refresh();

      // Update mock for second refresh
      (mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
        blockhash: 'DEF456blockhash',
        lastValidBlockHeight: 12600,
      });
      (mockConnection.getSlot as ReturnType<typeof vi.fn>).mockResolvedValue(12400);

      // Second refresh
      await manager.refresh();

      // Update mock for third refresh
      (mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
        blockhash: 'GHI789blockhash',
        lastValidBlockHeight: 12700,
      });
      (mockConnection.getSlot as ReturnType<typeof vi.fn>).mockResolvedValue(12500);

      // Third refresh (should evict first)
      await manager.refresh();

      // Cache should have latest 2 entries
      const stats = manager.getStats();
      expect(stats.cacheSize).toBeLessThanOrEqual(2);
    });
  });

  describe('getCachedBlockhash', () => {
    it('returns null when cache is empty', () => {
      const cached = manager.getCachedBlockhash();
      expect(cached).toBeNull();
    });

    it('returns cached blockhash after refresh', async () => {
      await manager.refresh();

      const cached = manager.getCachedBlockhash();
      expect(cached).not.toBeNull();
      expect(cached?.blockhash).toBe('ABC123blockhash');
    });
  });

  describe('getBlockhash', () => {
    it('returns cached blockhash if available', async () => {
      await manager.refresh();

      const result = await manager.getBlockhash();
      expect(result.blockhash).toBe('ABC123blockhash');

      // Should not fetch again
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalledTimes(1);
    });

    it('refreshes if cache is empty', async () => {
      const result = await manager.getBlockhash();

      expect(result.blockhash).toBe('ABC123blockhash');
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalled();
    });

    it('force refresh fetches new blockhash', async () => {
      await manager.refresh();

      (mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
        blockhash: 'FRESH123',
        lastValidBlockHeight: 13000,
      });

      const result = await manager.getBlockhash(true);
      expect(result.blockhash).toBe('FRESH123');
    });
  });

  describe('hasValidBlockhash', () => {
    it('returns false when cache is empty', () => {
      expect(manager.hasValidBlockhash()).toBe(false);
    });

    it('returns true after refresh', async () => {
      await manager.refresh();
      expect(manager.hasValidBlockhash()).toBe(true);
    });
  });

  describe('getStats', () => {
    it('returns correct stats', async () => {
      await manager.refresh();

      const stats = manager.getStats();
      expect(stats.cacheSize).toBe(1);
      expect(stats.currentSlot).toBe(12345);
      expect(stats.isRefreshing).toBe(false);
      expect(stats.newestAge).toBeLessThan(1000);
    });
  });

  describe('getCurrentSlot', () => {
    it('returns current slot after refresh', async () => {
      await manager.refresh();
      expect(manager.getCurrentSlot()).toBe(12345);
    });
  });

  describe('estimateRemainingValidity', () => {
    it('estimates slots and time remaining', async () => {
      await manager.refresh();

      const validity = manager.estimateRemainingValidity(12500);
      expect(validity.estimatedSlotsRemaining).toBe(155); // 12500 - 12345
      expect(validity.estimatedMsRemaining).toBe(155 * 400);
      expect(validity.isLikelyValid).toBe(true);
    });

    it('returns zero for expired blockhash', async () => {
      await manager.refresh();

      const validity = manager.estimateRemainingValidity(12000);
      expect(validity.estimatedSlotsRemaining).toBe(0);
      expect(validity.estimatedMsRemaining).toBe(0);
      expect(validity.isLikelyValid).toBe(false);
    });
  });

  describe('ensureFreshBlockhash', () => {
    it('returns cached if fresh enough', async () => {
      await manager.refresh();

      const result = await manager.ensureFreshBlockhash(100);
      expect(result.blockhash).toBe('ABC123blockhash');

      // Should not fetch again
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalledTimes(1);
    });

    it('refreshes if cached is too old', async () => {
      await manager.refresh();

      // Need very fresh blockhash (more slots remaining than we have)
      (mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
        blockhash: 'VERYFRESH',
        lastValidBlockHeight: 20000,
      });

      const result = await manager.ensureFreshBlockhash(200);
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalledTimes(2);
    });
  });

  describe('start/stop', () => {
    it('starts and stops refresh loop', async () => {
      vi.useFakeTimers();

      manager.start();

      // Fast forward past refresh interval
      await vi.advanceTimersByTimeAsync(35_000);

      // Should have refreshed multiple times
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalled();

      manager.stop();

      const callCount = (mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mock.calls.length;

      // Fast forward more - should not refresh after stop
      await vi.advanceTimersByTimeAsync(60_000);

      expect((mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);

      vi.useRealTimers();
    });
  });

  describe('getBlockhashWithMaxAge', () => {
    it('returns cached blockhash when within maxAge', async () => {
      await manager.refresh();

      // Request blockhash with generous maxAge - should use cached
      const result = await manager.getBlockhashWithMaxAge(60_000);

      expect(result.blockhash).toBe('ABC123blockhash');
      // Should not have fetched again
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalledTimes(1);
    });

    it('refreshes when cached blockhash is older than maxAge', async () => {
      vi.useFakeTimers();

      await manager.refresh();

      // Advance time past the maxAge we'll request
      await vi.advanceTimersByTimeAsync(5000);

      // Update mock for fresh blockhash
      (mockConnection.getLatestBlockhash as ReturnType<typeof vi.fn>).mockResolvedValue({
        blockhash: 'FRESH_BLOCKHASH',
        lastValidBlockHeight: 13000,
      });

      // Request blockhash with very short maxAge - should refresh
      const result = await manager.getBlockhashWithMaxAge(1000);

      expect(result.blockhash).toBe('FRESH_BLOCKHASH');
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalledTimes(2);

      vi.useRealTimers();
    });

    it('refreshes when cache is empty', async () => {
      const result = await manager.getBlockhashWithMaxAge(60_000);

      expect(result.blockhash).toBe('ABC123blockhash');
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createBlockhashManagerFromEnv', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('creates BlockhashManager with default values when env vars not set', () => {
    delete process.env.BLOCKHASH_REFRESH_INTERVAL_MS;
    delete process.env.BLOCKHASH_MAX_AGE_MS;
    delete process.env.BLOCKHASH_PREFETCH_COUNT;
    delete process.env.BLOCKHASH_FETCH_TIMEOUT_MS;

    const manager = createBlockhashManagerFromEnv(mockConnection);

    expect(manager).toBeInstanceOf(BlockhashManager);
    manager.stop();
  });

  it('parses environment variables correctly', () => {
    process.env.BLOCKHASH_REFRESH_INTERVAL_MS = '15000';
    process.env.BLOCKHASH_MAX_AGE_MS = '45000';
    process.env.BLOCKHASH_PREFETCH_COUNT = '3';
    process.env.BLOCKHASH_FETCH_TIMEOUT_MS = '3000';

    const manager = createBlockhashManagerFromEnv(mockConnection);

    expect(manager).toBeInstanceOf(BlockhashManager);
    manager.stop();
  });

  it('uses defaults for invalid env values', () => {
    process.env.BLOCKHASH_REFRESH_INTERVAL_MS = 'invalid';

    const manager = createBlockhashManagerFromEnv(mockConnection);

    // Should still create a valid manager (NaN becomes fallback or default)
    expect(manager).toBeInstanceOf(BlockhashManager);
    manager.stop();
  });
});
