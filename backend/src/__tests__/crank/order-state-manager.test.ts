import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { OrderStateManager } from '../../crank/order-state-manager.js';

describe('OrderStateManager', () => {
  let manager: OrderStateManager;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  // Sample PDAs for testing
  const buyOrderPda = 'BuyOrder111111111111111111111111111111111111';
  const sellOrderPda = 'SellOrder11111111111111111111111111111111111';
  const anotherBuyPda = 'AnotherBuy1111111111111111111111111111111111';
  const anotherSellPda = 'AnotherSell111111111111111111111111111111111';

  beforeEach(() => {
    manager = new OrderStateManager();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleSpy.mockRestore();
  });

  describe('acquireLocks', () => {
    it('acquires locks for buy/sell pair successfully', () => {
      const result = manager.acquireLocks(buyOrderPda, sellOrderPda);

      expect(result).toBe(true);
      expect(manager.isLocked(buyOrderPda)).toBe(true);
      expect(manager.isLocked(sellOrderPda)).toBe(true);
    });

    it('fails if buy order is already locked', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      const result = manager.acquireLocks(buyOrderPda, anotherSellPda);

      expect(result).toBe(false);
    });

    it('fails if sell order is already locked', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      const result = manager.acquireLocks(anotherBuyPda, sellOrderPda);

      expect(result).toBe(false);
    });

    it('stores match partner reference', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      const buyLock = manager.getLockInfo(buyOrderPda);
      const sellLock = manager.getLockInfo(sellOrderPda);

      expect(buyLock?.matchPartner).toBe(sellOrderPda);
      expect(sellLock?.matchPartner).toBe(buyOrderPda);
    });

    it('stores request ID if provided', () => {
      const requestId = 'mpc-request-123';
      manager.acquireLocks(buyOrderPda, sellOrderPda, requestId);

      const buyLock = manager.getLockInfo(buyOrderPda);
      const sellLock = manager.getLockInfo(sellOrderPda);

      expect(buyLock?.requestId).toBe(requestId);
      expect(sellLock?.requestId).toBe(requestId);
    });

    it('acquires locks without request ID', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      const buyLock = manager.getLockInfo(buyOrderPda);

      expect(buyLock?.requestId).toBeUndefined();
    });

    it('logs lock acquisition', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Acquired locks')
      );
    });

    it('cleans up expired locks before acquiring', () => {
      // Acquire initial locks
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      // Advance time past expiration (60 seconds for regular locks)
      vi.advanceTimersByTime(61_000);

      // Should succeed because old locks are expired
      const result = manager.acquireLocks(buyOrderPda, anotherSellPda);

      expect(result).toBe(true);
    });
  });

  describe('releaseLocks', () => {
    it('releases both buy and sell locks', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      manager.releaseLocks(buyOrderPda, sellOrderPda);

      expect(manager.isLocked(buyOrderPda)).toBe(false);
      expect(manager.isLocked(sellOrderPda)).toBe(false);
    });

    it('logs lock release', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      consoleSpy.mockClear();

      manager.releaseLocks(buyOrderPda, sellOrderPda);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Released locks')
      );
    });

    it('handles releasing non-existent locks gracefully', () => {
      // Should not throw
      expect(() => manager.releaseLocks('nonexistent1', 'nonexistent2')).not.toThrow();
    });
  });

  describe('releaseLock', () => {
    it('releases single order lock and its partner', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      manager.releaseLock(buyOrderPda);

      expect(manager.isLocked(buyOrderPda)).toBe(false);
      expect(manager.isLocked(sellOrderPda)).toBe(false);
    });

    it('releases partner lock when releasing sell order', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      manager.releaseLock(sellOrderPda);

      expect(manager.isLocked(buyOrderPda)).toBe(false);
      expect(manager.isLocked(sellOrderPda)).toBe(false);
    });

    it('handles releasing non-existent lock gracefully', () => {
      expect(() => manager.releaseLock('nonexistent')).not.toThrow();
    });

    it('handles lock without match partner', () => {
      // This tests the edge case where matchPartner might be undefined
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      // Manually remove partner reference to simulate edge case
      const lock = manager.getLockInfo(buyOrderPda);
      if (lock) {
        delete lock.matchPartner;
      }

      expect(() => manager.releaseLock(buyOrderPda)).not.toThrow();
    });
  });

  describe('isLocked', () => {
    it('returns false for unlocked order', () => {
      expect(manager.isLocked(buyOrderPda)).toBe(false);
    });

    it('returns true for locked order', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      expect(manager.isLocked(buyOrderPda)).toBe(true);
    });

    it('returns false after lock is released', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      manager.releaseLocks(buyOrderPda, sellOrderPda);

      expect(manager.isLocked(buyOrderPda)).toBe(false);
    });

    it('cleans up expired locks before checking', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      // Advance time past expiration
      vi.advanceTimersByTime(61_000);

      expect(manager.isLocked(buyOrderPda)).toBe(false);
    });

    it('does not clean up MPC locks before MPC expiration', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda, 'mpc-request-123');

      // Advance time past regular expiration but before MPC expiration
      vi.advanceTimersByTime(90_000); // 90 seconds

      expect(manager.isLocked(buyOrderPda)).toBe(true);
    });

    it('cleans up MPC locks after MPC expiration', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda, 'mpc-request-123');

      // Advance time past MPC expiration (120 seconds)
      vi.advanceTimersByTime(121_000);

      expect(manager.isLocked(buyOrderPda)).toBe(false);
    });
  });

  describe('getLockedOrders', () => {
    it('returns empty set when no locks', () => {
      const locked = manager.getLockedOrders();

      expect(locked.size).toBe(0);
    });

    it('returns set of locked order PDAs', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      const locked = manager.getLockedOrders();

      expect(locked.size).toBe(2);
      expect(locked.has(buyOrderPda)).toBe(true);
      expect(locked.has(sellOrderPda)).toBe(true);
    });

    it('excludes expired locks', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      vi.advanceTimersByTime(61_000);

      const locked = manager.getLockedOrders();

      expect(locked.size).toBe(0);
    });
  });

  describe('getLockInfo', () => {
    it('returns undefined for non-existent lock', () => {
      expect(manager.getLockInfo(buyOrderPda)).toBeUndefined();
    });

    it('returns lock info for existing lock', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda, 'request-123');

      const lock = manager.getLockInfo(buyOrderPda);

      expect(lock).toBeDefined();
      expect(lock?.orderPda).toBe(buyOrderPda);
      expect(lock?.matchPartner).toBe(sellOrderPda);
      expect(lock?.requestId).toBe('request-123');
      expect(lock?.lockedAt).toBeDefined();
    });
  });

  describe('setMpcRequestId', () => {
    it('updates lock with MPC request ID', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      manager.setMpcRequestId(buyOrderPda, 'new-mpc-request');

      const lock = manager.getLockInfo(buyOrderPda);
      expect(lock?.requestId).toBe('new-mpc-request');
    });

    it('does nothing for non-existent lock', () => {
      expect(() => manager.setMpcRequestId('nonexistent', 'request')).not.toThrow();
    });

    it('allows changing request ID', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda, 'initial-request');

      manager.setMpcRequestId(buyOrderPda, 'updated-request');

      const lock = manager.getLockInfo(buyOrderPda);
      expect(lock?.requestId).toBe('updated-request');
    });

    it('updates lock expiration behavior after setting MPC request ID', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      // Advance past regular expiration
      vi.advanceTimersByTime(50_000);

      // Set MPC request ID
      manager.setMpcRequestId(buyOrderPda, 'mpc-request');

      // Advance more time (total ~100 seconds, past regular but not MPC expiration)
      vi.advanceTimersByTime(50_000);

      // Lock should still exist because it now has MPC expiration
      expect(manager.isLocked(buyOrderPda)).toBe(true);
    });
  });

  describe('getPendingMatchCount', () => {
    it('returns 0 when no locks', () => {
      expect(manager.getPendingMatchCount()).toBe(0);
    });

    it('returns 1 for single buy/sell pair', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      expect(manager.getPendingMatchCount()).toBe(1);
    });

    it('returns 2 for two buy/sell pairs', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      manager.acquireLocks(anotherBuyPda, anotherSellPda);

      expect(manager.getPendingMatchCount()).toBe(2);
    });

    it('excludes expired locks', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      vi.advanceTimersByTime(61_000);

      expect(manager.getPendingMatchCount()).toBe(0);
    });
  });

  describe('clearAllLocks', () => {
    it('clears all locks', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      manager.acquireLocks(anotherBuyPda, anotherSellPda);

      manager.clearAllLocks();

      expect(manager.isLocked(buyOrderPda)).toBe(false);
      expect(manager.isLocked(sellOrderPda)).toBe(false);
      expect(manager.isLocked(anotherBuyPda)).toBe(false);
      expect(manager.isLocked(anotherSellPda)).toBe(false);
    });

    it('logs cleared count', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      consoleSpy.mockClear();

      manager.clearAllLocks();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleared 2 locks')
      );
    });

    it('handles clearing empty locks', () => {
      manager.clearAllLocks();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleared 0 locks')
      );
    });
  });

  describe('getStats', () => {
    it('returns zero stats when no locks', () => {
      const stats = manager.getStats();

      expect(stats.totalLocks).toBe(0);
      expect(stats.pendingMatches).toBe(0);
      expect(stats.oldestLockAge).toBe(0);
    });

    it('returns correct total locks', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      const stats = manager.getStats();

      expect(stats.totalLocks).toBe(2);
    });

    it('returns correct pending matches', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      manager.acquireLocks(anotherBuyPda, anotherSellPda);

      const stats = manager.getStats();

      expect(stats.pendingMatches).toBe(2);
    });

    it('returns correct oldest lock age', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      vi.advanceTimersByTime(5000);

      manager.acquireLocks(anotherBuyPda, anotherSellPda);

      vi.advanceTimersByTime(1000);

      const stats = manager.getStats();

      // Oldest lock should be ~6 seconds old
      expect(stats.oldestLockAge).toBeGreaterThanOrEqual(5000);
      expect(stats.oldestLockAge).toBeLessThanOrEqual(7000);
    });

    it('excludes expired locks from stats', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      vi.advanceTimersByTime(61_000);

      const stats = manager.getStats();

      expect(stats.totalLocks).toBe(0);
      expect(stats.pendingMatches).toBe(0);
    });
  });

  describe('lock expiration', () => {
    it('regular locks expire after 60 seconds', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);

      // Just before expiration
      vi.advanceTimersByTime(59_999);
      expect(manager.isLocked(buyOrderPda)).toBe(true);

      // Just after expiration
      vi.advanceTimersByTime(2);
      expect(manager.isLocked(buyOrderPda)).toBe(false);
    });

    it('MPC locks expire after 120 seconds', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda, 'mpc-request');

      // At 90 seconds (past regular, before MPC)
      vi.advanceTimersByTime(90_000);
      expect(manager.isLocked(buyOrderPda)).toBe(true);

      // At 120+ seconds
      vi.advanceTimersByTime(31_000);
      expect(manager.isLocked(buyOrderPda)).toBe(false);
    });

    it('logs expired locks', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      consoleSpy.mockClear();

      vi.advanceTimersByTime(61_000);

      // Trigger cleanup by checking lock
      manager.isLocked(buyOrderPda);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Expired lock')
      );
    });
  });

  describe('concurrent matching scenarios', () => {
    it('prevents same order from being matched twice', () => {
      // First match attempt succeeds
      expect(manager.acquireLocks(buyOrderPda, sellOrderPda)).toBe(true);

      // Second attempt with same buy order fails
      expect(manager.acquireLocks(buyOrderPda, anotherSellPda)).toBe(false);
    });

    it('allows different orders to be matched concurrently', () => {
      expect(manager.acquireLocks(buyOrderPda, sellOrderPda)).toBe(true);
      expect(manager.acquireLocks(anotherBuyPda, anotherSellPda)).toBe(true);

      expect(manager.getPendingMatchCount()).toBe(2);
    });

    it('allows reusing order after match completes', () => {
      manager.acquireLocks(buyOrderPda, sellOrderPda);
      manager.releaseLocks(buyOrderPda, sellOrderPda);

      expect(manager.acquireLocks(buyOrderPda, anotherSellPda)).toBe(true);
    });
  });
});
