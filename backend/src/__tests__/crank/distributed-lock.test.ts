import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseClient, createMemoryDatabase } from '../../db/client.js';
import { DistributedLocksRepository } from '../../db/repositories/distributed-locks.js';
import { DistributedLockService, LOCK_NAMES } from '../../crank/distributed-lock.js';

describe('DistributedLockService', () => {
  let db: DatabaseClient;
  let locksRepo: DistributedLocksRepository;
  let lockService: DistributedLockService;

  beforeEach(() => {
    db = createMemoryDatabase();
    locksRepo = new DistributedLocksRepository(db);
    lockService = new DistributedLockService(locksRepo, {
      instanceId: 'test-instance',
      heartbeatIntervalMs: 60_000, // Disable heartbeat during tests
    });
  });

  afterEach(async () => {
    await lockService.shutdown();
    DatabaseClient.resetInstance();
  });

  describe('acquire', () => {
    it('acquires a lock successfully', async () => {
      const lock = await lockService.acquire('test-lock');

      expect(lock).not.toBeNull();
      expect(lock?.lockName).toBe('test-lock');
      expect(lock?.ownerId).toBe('test-instance');
    });

    it('returns null when lock is held by another', async () => {
      // Pre-acquire with another owner
      locksRepo.acquire('busy-lock', 'other-instance', 60);

      const lock = await lockService.acquire('busy-lock');
      expect(lock).toBeNull();
    });

    it('retries when configured', async () => {
      // Release the lock after a delay
      setTimeout(() => {
        locksRepo.release('retry-lock', 'other-instance');
      }, 500);

      locksRepo.acquire('retry-lock', 'other-instance', 60);

      const lock = await lockService.acquire('retry-lock', {
        retry: true,
        maxRetries: 3,
        retryDelayMs: 300,
      });

      expect(lock).not.toBeNull();
    });

    it('respects TTL option', async () => {
      const lock = await lockService.acquire('ttl-lock', { ttlSeconds: 5 });
      expect(lock).not.toBeNull();

      const info = locksRepo.get('ttl-lock');
      const expectedExpiry = Math.floor(Date.now() / 1000) + 5;
      expect(info?.expires_at).toBeCloseTo(expectedExpiry, 0);
    });
  });

  describe('tryAcquire', () => {
    it('acquires immediately without waiting', () => {
      const lock = lockService.tryAcquire('immediate-lock');
      expect(lock).not.toBeNull();
    });

    it('returns null immediately if lock is held', () => {
      locksRepo.acquire('held-lock', 'other-instance', 60);
      const lock = lockService.tryAcquire('held-lock');
      expect(lock).toBeNull();
    });
  });

  describe('withLock', () => {
    it('executes callback with lock held', async () => {
      let executed = false;

      const result = await lockService.withLock('callback-lock', async () => {
        executed = true;
        expect(lockService.holdsLock('callback-lock')).toBe(true);
        return 'success';
      });

      expect(executed).toBe(true);
      expect(result).toBe('success');
      expect(lockService.holdsLock('callback-lock')).toBe(false);
    });

    it('releases lock on error', async () => {
      await expect(
        lockService.withLock('error-lock', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      expect(lockService.holdsLock('error-lock')).toBe(false);
    });

    it('returns null if lock cannot be acquired', async () => {
      locksRepo.acquire('busy-callback-lock', 'other-instance', 60);

      const result = await lockService.withLock('busy-callback-lock', async () => {
        return 'should not execute';
      });

      expect(result).toBeNull();
    });
  });

  describe('lock handle', () => {
    it('release() releases the lock', async () => {
      const lock = await lockService.acquire('release-test');
      expect(lockService.holdsLock('release-test')).toBe(true);

      await lock!.release();
      expect(lockService.holdsLock('release-test')).toBe(false);
    });

    it('extend() extends the lock TTL', async () => {
      const lock = await lockService.acquire('extend-test', { ttlSeconds: 10 });
      const initialInfo = locksRepo.get('extend-test');

      const extended = await lock!.extend(60);
      expect(extended).toBe(true);

      const extendedInfo = locksRepo.get('extend-test');
      expect(extendedInfo!.expires_at).toBeGreaterThan(initialInfo!.expires_at);
    });

    it('isValid() checks lock validity', async () => {
      const lock = await lockService.acquire('valid-test');
      expect(lock!.isValid()).toBe(true);

      // Force release from database
      locksRepo.release('valid-test', 'test-instance');
      expect(lock!.isValid()).toBe(false);
    });
  });

  describe('holdsLock / isLocked', () => {
    it('holdsLock returns true only for owned locks', async () => {
      await lockService.acquire('owned-lock');
      locksRepo.acquire('other-lock', 'other-instance', 60);

      expect(lockService.holdsLock('owned-lock')).toBe(true);
      expect(lockService.holdsLock('other-lock')).toBe(false);
    });

    it('isLocked returns true for any held lock', async () => {
      await lockService.acquire('any-lock');
      locksRepo.acquire('other-any-lock', 'other-instance', 60);

      expect(lockService.isLocked('any-lock')).toBe(true);
      expect(lockService.isLocked('other-any-lock')).toBe(true);
      expect(lockService.isLocked('nonexistent-lock')).toBe(false);
    });
  });

  describe('releaseAll', () => {
    it('releases all locks held by this instance', async () => {
      await lockService.acquire('release-all-1');
      await lockService.acquire('release-all-2');
      locksRepo.acquire('other-instance-lock', 'other-instance', 60);

      const released = lockService.releaseAll();
      expect(released).toBe(2);

      expect(lockService.holdsLock('release-all-1')).toBe(false);
      expect(lockService.holdsLock('release-all-2')).toBe(false);
      expect(locksRepo.isHeld('other-instance-lock')).toBe(true);
    });
  });

  describe('listHeldLocks', () => {
    it('lists all locks held by this instance', async () => {
      await lockService.acquire('list-1');
      await lockService.acquire('list-2');

      const held = lockService.listHeldLocks();
      expect(held).toHaveLength(2);
      expect(held.map((l) => l.lock_name)).toContain('list-1');
      expect(held.map((l) => l.lock_name)).toContain('list-2');
    });
  });

  describe('shutdown', () => {
    it('releases all locks and stops accepting new locks', async () => {
      await lockService.acquire('shutdown-lock');
      expect(lockService.holdsLock('shutdown-lock')).toBe(true);

      await lockService.shutdown();

      expect(lockService.holdsLock('shutdown-lock')).toBe(false);

      // Should not acquire new locks after shutdown
      const newLock = await lockService.acquire('post-shutdown-lock');
      expect(newLock).toBeNull();
    });
  });

  describe('LOCK_NAMES constants', () => {
    it('has expected lock names', () => {
      expect(LOCK_NAMES.ORDER_MATCHING).toBe('crank:order-matching');
      expect(LOCK_NAMES.MPC_CALLBACKS).toBe('crank:mpc-callbacks');
      expect(LOCK_NAMES.SETTLEMENT).toBe('crank:settlement');
      expect(LOCK_NAMES.CRANK_STARTUP).toBe('crank:startup');
      expect(LOCK_NAMES.DB_MAINTENANCE).toBe('crank:db-maintenance');
    });
  });
});
