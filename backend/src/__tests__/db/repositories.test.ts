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
  });
});
