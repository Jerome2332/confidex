import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Connection, PublicKey, Keypair, AccountInfo } from '@solana/web3.js';
import {
  BatchFetcher,
  createBatchFetcherFromEnv,
  fetchOrdersByPdas,
  fetchPositionsByPdas,
} from '../../crank/batch-fetcher.js';

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

function createMockAccountInfo(data: Buffer): AccountInfo<Buffer> {
  return {
    data,
    executable: false,
    lamports: 1000000,
    owner: Keypair.generate().publicKey,
    rentEpoch: 0,
  };
}

describe('BatchFetcher', () => {
  let fetcher: BatchFetcher;
  let mockConnection: Connection;

  beforeEach(() => {
    mockConnection = {
      getMultipleAccountsInfo: vi.fn(),
    } as unknown as Connection;

    fetcher = new BatchFetcher(mockConnection, {
      maxAccountsPerBatch: 10,
      concurrency: 2,
      retryOnFailure: true,
      maxRetries: 1,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('creates fetcher with default config', () => {
      const defaultFetcher = new BatchFetcher(mockConnection);
      expect(defaultFetcher).toBeDefined();
    });

    it('creates fetcher with custom config', () => {
      const customFetcher = new BatchFetcher(mockConnection, {
        maxAccountsPerBatch: 50,
        concurrency: 10,
        commitment: 'finalized',
        retryOnFailure: false,
        maxRetries: 0,
      });
      expect(customFetcher).toBeDefined();
    });
  });

  describe('fetchAccounts', () => {
    it('returns empty array for empty input', async () => {
      const results = await fetcher.fetchAccounts([]);
      expect(results).toEqual([]);
      expect(mockConnection.getMultipleAccountsInfo).not.toHaveBeenCalled();
    });

    it('fetches single account', async () => {
      const pubkey = Keypair.generate().publicKey;
      const accountInfo = createMockAccountInfo(Buffer.from('test'));

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue([
        accountInfo,
      ]);

      const results = await fetcher.fetchAccounts([pubkey], 'test');

      expect(results).toHaveLength(1);
      expect(results[0].pubkey).toEqual(pubkey);
      expect(results[0].account).toEqual(accountInfo);
    });

    it('fetches multiple accounts in single batch', async () => {
      const pubkeys = Array.from({ length: 5 }, () => Keypair.generate().publicKey);
      const accountInfos = pubkeys.map((_, i) =>
        createMockAccountInfo(Buffer.from(`test${i}`))
      );

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
        accountInfos
      );

      const results = await fetcher.fetchAccounts(pubkeys, 'test');

      expect(results).toHaveLength(5);
      expect(mockConnection.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    });

    it('splits large requests into batches', async () => {
      const pubkeys = Array.from({ length: 25 }, () => Keypair.generate().publicKey);
      const accountInfos = pubkeys.map((_, i) =>
        createMockAccountInfo(Buffer.from(`test${i}`))
      );

      // Mock returns for each batch (10, 10, 5)
      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(accountInfos.slice(0, 10))
        .mockResolvedValueOnce(accountInfos.slice(10, 20))
        .mockResolvedValueOnce(accountInfos.slice(20, 25));

      const results = await fetcher.fetchAccounts(pubkeys, 'test');

      expect(results).toHaveLength(25);
      expect(mockConnection.getMultipleAccountsInfo).toHaveBeenCalledTimes(3);
    });

    it('handles null accounts (deleted/non-existent)', async () => {
      const pubkeys = Array.from({ length: 3 }, () => Keypair.generate().publicKey);

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue([
        createMockAccountInfo(Buffer.from('exists')),
        null, // Deleted account
        createMockAccountInfo(Buffer.from('exists2')),
      ]);

      const results = await fetcher.fetchAccounts(pubkeys, 'test');

      expect(results).toHaveLength(3);
      expect(results[0].account).not.toBeNull();
      expect(results[1].account).toBeNull();
      expect(results[2].account).not.toBeNull();
    });

    it('retries failed batches', async () => {
      const pubkeys = [Keypair.generate().publicKey];
      const accountInfo = createMockAccountInfo(Buffer.from('test'));

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(new Error('RPC error'))
        .mockResolvedValueOnce([accountInfo]);

      const results = await fetcher.fetchAccounts(pubkeys, 'test');

      expect(results).toHaveLength(1);
      expect(results[0].account).toEqual(accountInfo);
      expect(mockConnection.getMultipleAccountsInfo).toHaveBeenCalledTimes(2);
    });

    it('returns null accounts after max retries', async () => {
      const pubkeys = [Keypair.generate().publicKey];

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>)
        .mockRejectedValue(new Error('RPC error'));

      const results = await fetcher.fetchAccounts(pubkeys, 'test');

      expect(results).toHaveLength(1);
      expect(results[0].account).toBeNull();
      // Initial + 1 retry = 2 calls
      expect(mockConnection.getMultipleAccountsInfo).toHaveBeenCalledTimes(2);
    });
  });

  describe('fetchExistingAccounts', () => {
    it('filters out null accounts', async () => {
      const pubkeys = Array.from({ length: 3 }, () => Keypair.generate().publicKey);

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue([
        createMockAccountInfo(Buffer.from('exists')),
        null,
        createMockAccountInfo(Buffer.from('exists2')),
      ]);

      const results = await fetcher.fetchExistingAccounts(pubkeys, 'test');

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.account).not.toBeNull());
    });
  });

  describe('fetchAccountsAsMap', () => {
    it('returns accounts as a Map', async () => {
      const pubkeys = Array.from({ length: 3 }, () => Keypair.generate().publicKey);
      const accountInfos = pubkeys.map((_, i) =>
        createMockAccountInfo(Buffer.from(`test${i}`))
      );

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue(
        accountInfos
      );

      const map = await fetcher.fetchAccountsAsMap(pubkeys, 'test');

      expect(map.size).toBe(3);
      pubkeys.forEach((pk, i) => {
        expect(map.get(pk.toString())).toEqual(accountInfos[i]);
      });
    });

    it('excludes null accounts from map', async () => {
      const pubkeys = Array.from({ length: 3 }, () => Keypair.generate().publicKey);

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue([
        createMockAccountInfo(Buffer.from('exists')),
        null,
        null,
      ]);

      const map = await fetcher.fetchAccountsAsMap(pubkeys, 'test');

      expect(map.size).toBe(1);
      expect(map.has(pubkeys[0].toString())).toBe(true);
      expect(map.has(pubkeys[1].toString())).toBe(false);
    });
  });

  describe('setConnection', () => {
    it('updates the connection', async () => {
      const newConnection = {
        getMultipleAccountsInfo: vi.fn().mockResolvedValue([
          createMockAccountInfo(Buffer.from('new')),
        ]),
      } as unknown as Connection;

      fetcher.setConnection(newConnection);

      const pubkeys = [Keypair.generate().publicKey];
      await fetcher.fetchAccounts(pubkeys);

      expect(newConnection.getMultipleAccountsInfo).toHaveBeenCalled();
      expect(mockConnection.getMultipleAccountsInfo).not.toHaveBeenCalled();
    });
  });

  describe('createBatchFetcherFromEnv', () => {
    it('creates fetcher with default env values', () => {
      const envFetcher = createBatchFetcherFromEnv(mockConnection);
      expect(envFetcher).toBeDefined();
    });

    it('respects environment variables', () => {
      const originalEnv = { ...process.env };

      process.env.BATCH_FETCH_MAX_ACCOUNTS = '50';
      process.env.BATCH_FETCH_CONCURRENCY = '10';
      process.env.BATCH_FETCH_COMMITMENT = 'finalized';
      process.env.BATCH_FETCH_RETRY = 'false';
      process.env.BATCH_FETCH_MAX_RETRIES = '3';

      const envFetcher = createBatchFetcherFromEnv(mockConnection);
      expect(envFetcher).toBeDefined();

      // Restore env
      process.env = originalEnv;
    });
  });

  describe('utility functions', () => {
    it('fetchOrdersByPdas creates fetcher and fetches', async () => {
      const pubkeys = [Keypair.generate().publicKey];
      const accountInfo = createMockAccountInfo(Buffer.from('order'));

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue([
        accountInfo,
      ]);

      const map = await fetchOrdersByPdas(mockConnection, pubkeys);

      expect(map.size).toBe(1);
      expect(mockConnection.getMultipleAccountsInfo).toHaveBeenCalled();
    });

    it('fetchPositionsByPdas creates fetcher and fetches', async () => {
      const pubkeys = [Keypair.generate().publicKey];
      const accountInfo = createMockAccountInfo(Buffer.from('position'));

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockResolvedValue([
        accountInfo,
      ]);

      const map = await fetchPositionsByPdas(mockConnection, pubkeys);

      expect(map.size).toBe(1);
      expect(mockConnection.getMultipleAccountsInfo).toHaveBeenCalled();
    });
  });

  describe('concurrency control', () => {
    it('processes batches with controlled concurrency', async () => {
      // Create 30 pubkeys which will be split into 3 batches of 10
      const pubkeys = Array.from({ length: 30 }, () => Keypair.generate().publicKey);

      let activeCalls = 0;
      let maxActiveCalls = 0;

      (mockConnection.getMultipleAccountsInfo as ReturnType<typeof vi.fn>).mockImplementation(
        async () => {
          activeCalls++;
          maxActiveCalls = Math.max(maxActiveCalls, activeCalls);

          // Simulate some async work
          await new Promise((resolve) => setTimeout(resolve, 10));

          activeCalls--;

          return Array(10).fill(createMockAccountInfo(Buffer.from('test')));
        }
      );

      await fetcher.fetchAccounts(pubkeys, 'test');

      // With concurrency of 2, we should never have more than 2 active calls
      expect(maxActiveCalls).toBeLessThanOrEqual(2);
    });
  });
});
