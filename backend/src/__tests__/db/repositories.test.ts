import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseClient, createMemoryDatabase } from '../../db/client.js';
import { TransactionHistoryRepository, TxStatus } from '../../db/repositories/transaction-history.js';
import { PendingOperationsRepository, OperationStatus } from '../../db/repositories/pending-operations.js';
import { DistributedLocksRepository } from '../../db/repositories/distributed-locks.js';
import { OrderStateCacheRepository } from '../../db/repositories/order-state-cache.js';

describe('Database Repositories', () => {
  let db: DatabaseClient;
  let txRepo: TransactionHistoryRepository;
  let opsRepo: PendingOperationsRepository;
  let locksRepo: DistributedLocksRepository;
  let cacheRepo: OrderStateCacheRepository;

  beforeEach(() => {
    db = createMemoryDatabase();
    txRepo = new TransactionHistoryRepository(db);
    opsRepo = new PendingOperationsRepository(db);
    locksRepo = new DistributedLocksRepository(db);
    cacheRepo = new OrderStateCacheRepository(db);
  });

  afterEach(() => {
    DatabaseClient.resetInstance();
  });

  describe('TransactionHistoryRepository', () => {
    it('creates and retrieves a transaction record', () => {
      const id = txRepo.create({
        tx_signature: 'abc123',
        tx_type: 'match',
        status: 'pending',
        buy_order_pda: 'buy123',
        sell_order_pda: 'sell456',
      });

      expect(id).toBeGreaterThan(0);

      const record = txRepo.findBySignature('abc123');
      expect(record).toBeDefined();
      expect(record?.tx_signature).toBe('abc123');
      expect(record?.tx_type).toBe('match');
      expect(record?.status).toBe('pending');
      expect(record?.buy_order_pda).toBe('buy123');
    });

    it('updates transaction status', () => {
      txRepo.create({
        tx_signature: 'xyz789',
        tx_type: 'settlement',
        status: 'pending',
      });

      const updated = txRepo.updateStatus('xyz789', 'confirmed', undefined, 12345);
      expect(updated).toBe(true);

      const record = txRepo.findBySignature('xyz789');
      expect(record?.status).toBe('confirmed');
      expect(record?.slot).toBe(12345);
    });

    it('finds pending transactions by type', () => {
      txRepo.create({ tx_signature: 'a', tx_type: 'match', status: 'pending' });
      txRepo.create({ tx_signature: 'b', tx_type: 'match', status: 'confirmed' });
      txRepo.create({ tx_signature: 'c', tx_type: 'settlement', status: 'pending' });

      const pending = txRepo.findPendingByType('match');
      expect(pending).toHaveLength(1);
      expect(pending[0].tx_signature).toBe('a');
    });

    it('checks if order pair was recently matched', () => {
      txRepo.create({
        tx_signature: 'recent1',
        tx_type: 'match',
        status: 'confirmed',
        buy_order_pda: 'buyA',
        sell_order_pda: 'sellB',
      });

      expect(txRepo.wasRecentlyMatched('buyA', 'sellB', 300)).toBe(true);
      expect(txRepo.wasRecentlyMatched('buyA', 'sellC', 300)).toBe(false);
    });

    it('gets count by status', () => {
      txRepo.create({ tx_signature: 'a', tx_type: 'match', status: 'pending' });
      txRepo.create({ tx_signature: 'b', tx_type: 'match', status: 'pending' });
      txRepo.create({ tx_signature: 'c', tx_type: 'match', status: 'confirmed' });
      txRepo.create({ tx_signature: 'd', tx_type: 'match', status: 'failed' });

      const counts = txRepo.getCountByStatus();
      expect(counts.pending).toBe(2);
      expect(counts.confirmed).toBe(1);
      expect(counts.failed).toBe(1);
      expect(counts.expired).toBe(0);
    });

    it('cleans up old records', () => {
      // Create some records
      txRepo.create({ tx_signature: 'old1', tx_type: 'match', status: 'confirmed' });
      txRepo.create({ tx_signature: 'old2', tx_type: 'match', status: 'failed' });
      txRepo.create({ tx_signature: 'pending1', tx_type: 'match', status: 'pending' });

      // With daysToKeep=0, any completed/failed transactions should be deleted
      // But since we just created them, they're not older than 0 days
      // So we need to test with a larger window
      const cleanedNone = txRepo.cleanup(30);
      expect(cleanedNone).toBe(0); // Nothing old enough

      // Test that the method works by checking that records still exist
      expect(txRepo.findBySignature('old1')).toBeDefined();
      expect(txRepo.findBySignature('old2')).toBeDefined();
      expect(txRepo.findBySignature('pending1')).toBeDefined();
    });

    it('gets recent transactions', () => {
      // Create some transactions
      txRepo.create({ tx_signature: 'recent1', tx_type: 'match', status: 'confirmed' });
      txRepo.create({ tx_signature: 'recent2', tx_type: 'settlement', status: 'pending' });
      txRepo.create({ tx_signature: 'recent3', tx_type: 'match', status: 'failed' });

      // Get recent with default limit
      const recent = txRepo.getRecent();
      expect(recent.length).toBe(3);
      // Verify all transactions are present (order may vary if created at same second)
      const signatures = recent.map(r => r.tx_signature);
      expect(signatures).toContain('recent1');
      expect(signatures).toContain('recent2');
      expect(signatures).toContain('recent3');
    });

    it('gets recent transactions with limit', () => {
      txRepo.create({ tx_signature: 'tx1', tx_type: 'match', status: 'confirmed' });
      txRepo.create({ tx_signature: 'tx2', tx_type: 'match', status: 'confirmed' });
      txRepo.create({ tx_signature: 'tx3', tx_type: 'match', status: 'confirmed' });

      const recent = txRepo.getRecent(2);
      expect(recent.length).toBe(2);
    });

    it('getRecent returns empty array when no transactions', () => {
      const recent = txRepo.getRecent();
      expect(recent).toEqual([]);
    });
  });

  describe('PendingOperationsRepository', () => {
    it('creates and retrieves an operation', () => {
      const id = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:buy1:sell1',
        payload: JSON.stringify({ buyPda: 'buy1', sellPda: 'sell1' }),
      });

      expect(id).toBeGreaterThan(0);

      const op = opsRepo.findByKey('match:buy1:sell1');
      expect(op).toBeDefined();
      expect(op?.status).toBe('pending');
    });

    it('finds operations ready to process', () => {
      opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:1',
        payload: '{}',
      });
      opsRepo.create({
        operation_type: 'settlement',
        operation_key: 'settlement:1',
        payload: '{}',
      });

      const all = opsRepo.findReadyToProcess();
      expect(all).toHaveLength(2);

      const matchOnly = opsRepo.findReadyToProcess('match');
      expect(matchOnly).toHaveLength(1);
      expect(matchOnly[0].operation_type).toBe('match');
    });

    it('marks operation as in progress with lock', () => {
      const id = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:lock-test',
        payload: '{}',
      });

      const locked = opsRepo.markInProgress(id, 'instance-1');
      expect(locked).toBe(true);

      const op = opsRepo.findById(id);
      expect(op?.status).toBe('in_progress');
      expect(op?.locked_by).toBe('instance-1');

      // Another instance should not be able to lock
      const lockedAgain = opsRepo.markInProgress(id, 'instance-2');
      expect(lockedAgain).toBe(false);
    });

    it('marks operation as completed', () => {
      const id = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:complete-test',
        payload: '{}',
      });

      opsRepo.markInProgress(id, 'instance-1');
      opsRepo.markCompleted(id);

      const op = opsRepo.findById(id);
      expect(op?.status).toBe('completed');
      expect(op?.locked_by).toBeNull();
    });

    it('marks operation as failed and increments retry count', () => {
      const id = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:fail-test',
        payload: '{}',
        max_retries: 3,
      });

      opsRepo.markFailed(id, 'Network error');
      let op = opsRepo.findById(id);
      expect(op?.status).toBe('failed');
      expect(op?.retry_count).toBe(1);
      expect(op?.last_error).toBe('Network error');

      // Reset and fail again
      opsRepo.resetForRetry(id);
      opsRepo.markFailed(id, 'Timeout');
      op = opsRepo.findById(id);
      expect(op?.retry_count).toBe(2);
    });

    it('checks for existence (deduplication)', () => {
      opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:dedupe',
        payload: '{}',
      });

      expect(opsRepo.exists('match:dedupe')).toBe(true);
      expect(opsRepo.exists('match:nonexistent')).toBe(false);
    });

    it('gets count by status', () => {
      // Create operations with various statuses
      opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:count1',
        payload: '{}',
      }); // pending
      opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:count2',
        payload: '{}',
      }); // pending

      const id3 = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:count3',
        payload: '{}',
      });
      opsRepo.markInProgress(id3, 'instance-1'); // in_progress

      const id4 = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:count4',
        payload: '{}',
      });
      opsRepo.markCompleted(id4); // completed

      const id5 = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:count5',
        payload: '{}',
      });
      opsRepo.markFailed(id5, 'Error'); // failed

      const counts = opsRepo.getCountByStatus();
      expect(counts.pending).toBe(2);
      expect(counts.in_progress).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(1);
    });

    it('gets count by status with empty database', () => {
      const counts = opsRepo.getCountByStatus();
      expect(counts.pending).toBe(0);
      expect(counts.in_progress).toBe(0);
      expect(counts.completed).toBe(0);
      expect(counts.failed).toBe(0);
    });

    it('releases stale locks', async () => {
      const id = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:stale',
        payload: '{}',
      });

      // Mark as in_progress
      opsRepo.markInProgress(id, 'instance-1');

      // Verify it's in progress
      let op = opsRepo.findById(id);
      expect(op?.status).toBe('in_progress');
      expect(op?.locked_by).toBe('instance-1');
      expect(op?.locked_at).toBeDefined();

      // The locked_at timestamp is in seconds. To ensure the lock is stale,
      // we need to wait longer than the timeout or use a very short timeout.
      // Wait 2 full seconds then use 1 second timeout
      await new Promise(resolve => setTimeout(resolve, 2100));

      // Release stale locks with timeout of 1 second
      // Any lock older than 1 second should be released
      const released = opsRepo.releaseStaleLocks(1);
      expect(released).toBe(1);

      // Verify it's back to pending
      op = opsRepo.findById(id);
      expect(op?.status).toBe('pending');
      expect(op?.locked_by).toBeNull();
    });

    it('does not release non-stale locks', () => {
      const id = opsRepo.create({
        operation_type: 'match',
        operation_key: 'match:not-stale',
        payload: '{}',
      });

      // Mark as in_progress (will have current timestamp)
      opsRepo.markInProgress(id, 'instance-1');

      // Release stale locks with high timeout (nothing should be stale)
      const released = opsRepo.releaseStaleLocks(3600); // 1 hour
      expect(released).toBe(0);

      // Verify still in progress
      const op = opsRepo.findById(id);
      expect(op?.status).toBe('in_progress');
      expect(op?.locked_by).toBe('instance-1');
    });
  });

  describe('DistributedLocksRepository', () => {
    it('acquires and releases a lock', () => {
      const acquired = locksRepo.acquire('test-lock', 'owner-1', 60);
      expect(acquired).toBe(true);
      expect(locksRepo.isHeld('test-lock')).toBe(true);
      expect(locksRepo.isHeldBy('test-lock', 'owner-1')).toBe(true);
      expect(locksRepo.isHeldBy('test-lock', 'owner-2')).toBe(false);

      const released = locksRepo.release('test-lock', 'owner-1');
      expect(released).toBe(true);
      expect(locksRepo.isHeld('test-lock')).toBe(false);
    });

    it('prevents acquiring lock held by another owner', () => {
      locksRepo.acquire('exclusive-lock', 'owner-1', 60);

      const acquired = locksRepo.acquire('exclusive-lock', 'owner-2', 60);
      expect(acquired).toBe(false);
      expect(locksRepo.isHeldBy('exclusive-lock', 'owner-1')).toBe(true);
    });

    it('allows same owner to re-acquire', () => {
      locksRepo.acquire('reacquire-lock', 'owner-1', 60);
      const reacquired = locksRepo.acquire('reacquire-lock', 'owner-1', 120);
      expect(reacquired).toBe(true);
    });

    it('extends lock TTL', () => {
      locksRepo.acquire('extend-lock', 'owner-1', 60);
      const extended = locksRepo.extend('extend-lock', 'owner-1', 120);
      expect(extended).toBe(true);
    });

    it('releases all locks by owner', () => {
      locksRepo.acquire('lock-1', 'owner-1', 60);
      locksRepo.acquire('lock-2', 'owner-1', 60);
      locksRepo.acquire('lock-3', 'owner-2', 60);

      const released = locksRepo.releaseAllByOwner('owner-1');
      expect(released).toBe(2);
      expect(locksRepo.isHeld('lock-1')).toBe(false);
      expect(locksRepo.isHeld('lock-2')).toBe(false);
      expect(locksRepo.isHeld('lock-3')).toBe(true);
    });

    it('lists active locks', () => {
      locksRepo.acquire('active-1', 'owner-1', 60);
      locksRepo.acquire('active-2', 'owner-2', 60);

      const active = locksRepo.listActive();
      expect(active).toHaveLength(2);
    });
  });

  describe('OrderStateCacheRepository', () => {
    it('upserts and retrieves cached order', () => {
      cacheRepo.upsert({
        order_pda: 'order123',
        trading_pair_pda: 'pair456',
        side: 'Buy',
        status: 'Open',
        owner: 'trader789',
        slot: 1000,
      });

      const order = cacheRepo.getByPda('order123');
      expect(order).toBeDefined();
      expect(order?.side).toBe('Buy');
      expect(order?.status).toBe('Open');
    });

    it('updates order status', () => {
      cacheRepo.upsert({
        order_pda: 'orderUpdate',
        trading_pair_pda: 'pair1',
        side: 'Sell',
        status: 'Open',
        owner: 'trader1',
        slot: 1000,
      });

      cacheRepo.updateStatus('orderUpdate', 'PartiallyFilled', 1001);

      const order = cacheRepo.getByPda('orderUpdate');
      expect(order?.status).toBe('PartiallyFilled');
      expect(order?.slot).toBe(1001);
    });

    it('finds open orders by trading pair', () => {
      cacheRepo.upsert({ order_pda: 'o1', trading_pair_pda: 'pair1', side: 'Buy', status: 'Open', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'o2', trading_pair_pda: 'pair1', side: 'Sell', status: 'Open', owner: 't2', slot: 100 });
      cacheRepo.upsert({ order_pda: 'o3', trading_pair_pda: 'pair1', side: 'Buy', status: 'Filled', owner: 't3', slot: 100 });
      cacheRepo.upsert({ order_pda: 'o4', trading_pair_pda: 'pair2', side: 'Buy', status: 'Open', owner: 't4', slot: 100 });

      const allOpen = cacheRepo.findOpenByTradingPair('pair1');
      expect(allOpen).toHaveLength(2);

      const buyOnly = cacheRepo.findOpenBuyOrders('pair1');
      expect(buyOnly).toHaveLength(1);
      expect(buyOnly[0].order_pda).toBe('o1');
    });

    it('gets open order count', () => {
      cacheRepo.upsert({ order_pda: 'c1', trading_pair_pda: 'pair1', side: 'Buy', status: 'Open', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'c2', trading_pair_pda: 'pair1', side: 'Sell', status: 'PartiallyFilled', owner: 't2', slot: 100 });
      cacheRepo.upsert({ order_pda: 'c3', trading_pair_pda: 'pair1', side: 'Buy', status: 'Filled', owner: 't3', slot: 100 });

      expect(cacheRepo.getOpenOrderCount('pair1')).toBe(2);
      expect(cacheRepo.getOpenOrderCount()).toBe(2);
    });

    it('gets cache stats', () => {
      cacheRepo.upsert({ order_pda: 's1', trading_pair_pda: 'p1', side: 'Buy', status: 'Open', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 's2', trading_pair_pda: 'p1', side: 'Sell', status: 'Filled', owner: 't2', slot: 100 });

      const stats = cacheRepo.getStats();
      expect(stats.total).toBe(2);
      expect(stats.byStatus.Open).toBe(1);
      expect(stats.byStatus.Filled).toBe(1);
    });

    it('finds open sell orders by trading pair', () => {
      cacheRepo.upsert({ order_pda: 'sell1', trading_pair_pda: 'pair1', side: 'Sell', status: 'Open', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'sell2', trading_pair_pda: 'pair1', side: 'Sell', status: 'PartiallyFilled', owner: 't2', slot: 100 });
      cacheRepo.upsert({ order_pda: 'buy1', trading_pair_pda: 'pair1', side: 'Buy', status: 'Open', owner: 't3', slot: 100 });
      cacheRepo.upsert({ order_pda: 'sell3', trading_pair_pda: 'pair1', side: 'Sell', status: 'Filled', owner: 't4', slot: 100 });

      const sellOrders = cacheRepo.findOpenSellOrders('pair1');
      expect(sellOrders).toHaveLength(2);
      expect(sellOrders.every(o => o.side === 'Sell')).toBe(true);
      expect(sellOrders.every(o => ['Open', 'PartiallyFilled'].includes(o.status))).toBe(true);
    });

    it('finds open orders by trading pair with side filter', () => {
      cacheRepo.upsert({ order_pda: 'o1', trading_pair_pda: 'pair1', side: 'Buy', status: 'Open', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'o2', trading_pair_pda: 'pair1', side: 'Sell', status: 'Open', owner: 't2', slot: 100 });
      cacheRepo.upsert({ order_pda: 'o3', trading_pair_pda: 'pair1', side: 'Buy', status: 'Open', owner: 't3', slot: 100 });

      const buyOrders = cacheRepo.findOpenByTradingPair('pair1', 'Buy');
      expect(buyOrders).toHaveLength(2);
      expect(buyOrders.every(o => o.side === 'Buy')).toBe(true);

      const sellOrders = cacheRepo.findOpenByTradingPair('pair1', 'Sell');
      expect(sellOrders).toHaveLength(1);
      expect(sellOrders[0].side).toBe('Sell');
    });

    it('finds orders by owner', () => {
      cacheRepo.upsert({ order_pda: 'o1', trading_pair_pda: 'p1', side: 'Buy', status: 'Open', owner: 'owner1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'o2', trading_pair_pda: 'p1', side: 'Sell', status: 'Filled', owner: 'owner1', slot: 101 });
      cacheRepo.upsert({ order_pda: 'o3', trading_pair_pda: 'p2', side: 'Buy', status: 'Open', owner: 'owner2', slot: 102 });

      const owner1Orders = cacheRepo.findByOwner('owner1');
      expect(owner1Orders).toHaveLength(2);
      expect(owner1Orders.every(o => o.owner === 'owner1')).toBe(true);

      const owner2Orders = cacheRepo.findByOwner('owner2');
      expect(owner2Orders).toHaveLength(1);

      const noOrders = cacheRepo.findByOwner('nonexistent');
      expect(noOrders).toHaveLength(0);
    });

    it('finds matching orders', () => {
      cacheRepo.upsert({ order_pda: 'm1', trading_pair_pda: 'p1', side: 'Buy', status: 'Matching', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'm2', trading_pair_pda: 'p1', side: 'Sell', status: 'Matching', owner: 't2', slot: 101 });
      cacheRepo.upsert({ order_pda: 'm3', trading_pair_pda: 'p1', side: 'Buy', status: 'Open', owner: 't3', slot: 102 });

      const matchingOrders = cacheRepo.findMatching();
      expect(matchingOrders).toHaveLength(2);
      expect(matchingOrders.every(o => o.status === 'Matching')).toBe(true);
    });

    it('deletes an order from cache', () => {
      cacheRepo.upsert({ order_pda: 'del1', trading_pair_pda: 'p1', side: 'Buy', status: 'Open', owner: 't1', slot: 100 });

      expect(cacheRepo.getByPda('del1')).toBeDefined();

      const deleted = cacheRepo.delete('del1');
      expect(deleted).toBe(true);
      expect(cacheRepo.getByPda('del1')).toBeUndefined();

      // Deleting non-existent order returns false
      const deletedAgain = cacheRepo.delete('del1');
      expect(deletedAgain).toBe(false);
    });

    it('deletes finalized orders older than specified days', () => {
      const now = Math.floor(Date.now() / 1000);
      const twoDaysAgo = now - 2 * 24 * 60 * 60;

      // Insert orders with old timestamps by manipulating updated_at directly
      cacheRepo.upsert({ order_pda: 'old1', trading_pair_pda: 'p1', side: 'Buy', status: 'Filled', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'old2', trading_pair_pda: 'p1', side: 'Sell', status: 'Cancelled', owner: 't2', slot: 101 });
      cacheRepo.upsert({ order_pda: 'new1', trading_pair_pda: 'p1', side: 'Buy', status: 'Filled', owner: 't3', slot: 102 });
      cacheRepo.upsert({ order_pda: 'open1', trading_pair_pda: 'p1', side: 'Buy', status: 'Open', owner: 't4', slot: 103 });

      // Manually set old timestamps for old orders
      db.run('UPDATE order_state_cache SET updated_at = ? WHERE order_pda IN (?, ?)', twoDaysAgo, 'old1', 'old2');

      // Delete finalized orders older than 1 day
      const deletedCount = cacheRepo.deleteFinalized(1);
      expect(deletedCount).toBe(2);

      // Old finalized orders should be deleted
      expect(cacheRepo.getByPda('old1')).toBeUndefined();
      expect(cacheRepo.getByPda('old2')).toBeUndefined();

      // New finalized and open orders should remain
      expect(cacheRepo.getByPda('new1')).toBeDefined();
      expect(cacheRepo.getByPda('open1')).toBeDefined();
    });

    it('invalidates stale cache entries', () => {
      const now = Math.floor(Date.now() / 1000);
      const tenMinutesAgo = now - 10 * 60;

      // Insert orders
      cacheRepo.upsert({ order_pda: 'stale1', trading_pair_pda: 'p1', side: 'Buy', status: 'Open', owner: 't1', slot: 100 });
      cacheRepo.upsert({ order_pda: 'stale2', trading_pair_pda: 'p1', side: 'Sell', status: 'PartiallyFilled', owner: 't2', slot: 101 });
      cacheRepo.upsert({ order_pda: 'fresh1', trading_pair_pda: 'p1', side: 'Buy', status: 'Open', owner: 't3', slot: 102 });

      // Manually set old timestamps for stale orders
      db.run('UPDATE order_state_cache SET updated_at = ? WHERE order_pda IN (?, ?)', tenMinutesAgo, 'stale1', 'stale2');

      // Invalidate entries older than 5 minutes (300 seconds)
      const invalidatedCount = cacheRepo.invalidateStale(300);
      expect(invalidatedCount).toBe(2);

      // Stale orders should be deleted
      expect(cacheRepo.getByPda('stale1')).toBeUndefined();
      expect(cacheRepo.getByPda('stale2')).toBeUndefined();

      // Fresh orders should remain
      expect(cacheRepo.getByPda('fresh1')).toBeDefined();
    });

    it('updateStatus returns false when slot is older than cached', () => {
      cacheRepo.upsert({
        order_pda: 'slotTest',
        trading_pair_pda: 'pair1',
        side: 'Buy',
        status: 'Open',
        owner: 'trader1',
        slot: 1000,
      });

      // Try to update with an older slot - should fail
      const updated = cacheRepo.updateStatus('slotTest', 'Filled', 999);
      expect(updated).toBe(false);

      // Order should still be Open
      const order = cacheRepo.getByPda('slotTest');
      expect(order?.status).toBe('Open');
      expect(order?.slot).toBe(1000);
    });

    it('upsert only updates when slot is >= cached slot', () => {
      cacheRepo.upsert({
        order_pda: 'upsertSlot',
        trading_pair_pda: 'pair1',
        side: 'Buy',
        status: 'Open',
        owner: 'trader1',
        slot: 1000,
      });

      // Upsert with older slot - should not update status
      cacheRepo.upsert({
        order_pda: 'upsertSlot',
        trading_pair_pda: 'pair1',
        side: 'Buy',
        status: 'Filled',
        owner: 'trader1',
        slot: 999,
      });

      const order = cacheRepo.getByPda('upsertSlot');
      expect(order?.status).toBe('Open');
      expect(order?.slot).toBe(1000);

      // Upsert with newer slot - should update
      cacheRepo.upsert({
        order_pda: 'upsertSlot',
        trading_pair_pda: 'pair1',
        side: 'Buy',
        status: 'Filled',
        owner: 'trader1',
        slot: 1001,
      });

      const updatedOrder = cacheRepo.getByPda('upsertSlot');
      expect(updatedOrder?.status).toBe('Filled');
      expect(updatedOrder?.slot).toBe(1001);
    });

    it('respects limit in findOpenBuyOrders and findOpenSellOrders', () => {
      // Create more orders than the limit
      for (let i = 0; i < 5; i++) {
        cacheRepo.upsert({ order_pda: `buy${i}`, trading_pair_pda: 'pair1', side: 'Buy', status: 'Open', owner: `t${i}`, slot: 100 + i });
        cacheRepo.upsert({ order_pda: `sell${i}`, trading_pair_pda: 'pair1', side: 'Sell', status: 'Open', owner: `t${i}`, slot: 100 + i });
      }

      const buyOrders = cacheRepo.findOpenBuyOrders('pair1', 3);
      expect(buyOrders).toHaveLength(3);

      const sellOrders = cacheRepo.findOpenSellOrders('pair1', 2);
      expect(sellOrders).toHaveLength(2);
    });
  });

  describe('DatabaseClient utilities', () => {
    it('vacuum() reclaims space without errors', () => {
      // Insert some data then delete it
      txRepo.create({
        tx_signature: 'vacuum-test-1',
        tx_type: 'match',
        status: 'confirmed',
      });
      txRepo.create({
        tx_signature: 'vacuum-test-2',
        tx_type: 'match',
        status: 'confirmed',
      });

      // Vacuum should run without throwing
      expect(() => db.vacuum()).not.toThrow();
    });

    it('checkpoint() truncates WAL without errors', () => {
      // Insert some data to ensure WAL has content
      txRepo.create({
        tx_signature: 'wal-test-1',
        tx_type: 'settlement',
        status: 'pending',
      });

      // Checkpoint should run without throwing
      expect(() => db.checkpoint()).not.toThrow();
    });

    it('isOpen() returns true for open database', () => {
      expect(db.isOpen()).toBe(true);
    });

    it('getPath() returns database path', () => {
      const path = db.getPath();
      expect(path).toBe(':memory:');
    });

    it('exec() runs raw SQL statements', () => {
      // Create a temporary table using exec
      expect(() => {
        db.exec('CREATE TABLE IF NOT EXISTS test_exec (id INTEGER PRIMARY KEY, value TEXT)');
      }).not.toThrow();

      // Verify we can use it
      db.run('INSERT INTO test_exec (value) VALUES (?)', 'test-value');
      const result = db.get<{ value: string }>('SELECT value FROM test_exec WHERE value = ?', 'test-value');
      expect(result?.value).toBe('test-value');
    });
  });
});
