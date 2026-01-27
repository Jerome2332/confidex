/**
 * Batch Account Fetcher
 *
 * Optimizes RPC calls by batching multiple account fetches into single
 * getMultipleAccountsInfo calls. Reduces RPC round trips and improves
 * crank performance during high-volume periods.
 *
 * Features:
 * - Batch getMultipleAccountsInfo calls (max 100 accounts per call)
 * - Parallel batch processing with controlled concurrency
 * - Automatic chunking for large account sets
 * - Prometheus metrics for batch performance
 */

import { Connection, PublicKey, AccountInfo, Commitment } from '@solana/web3.js';
import { logger } from '../lib/logger.js';
import { Histogram, Counter } from 'prom-client';
import { metricsRegistry } from '../routes/metrics.js';

const log = logger.crank;

// Maximum accounts per getMultipleAccountsInfo call
const MAX_ACCOUNTS_PER_BATCH = 100;

// Default concurrency for parallel batch processing
const DEFAULT_CONCURRENCY = 5;

// Prometheus metrics for batch performance
export const batchFetchDuration = new Histogram({
  name: 'confidex_batch_fetch_duration_seconds',
  help: 'Duration of batch account fetch operations',
  labelNames: ['type'], // 'orders', 'positions', 'pairs'
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [metricsRegistry],
});

export const batchFetchAccounts = new Counter({
  name: 'confidex_batch_fetch_accounts_total',
  help: 'Total number of accounts fetched in batches',
  labelNames: ['type'],
  registers: [metricsRegistry],
});

export const batchFetchCalls = new Counter({
  name: 'confidex_batch_fetch_calls_total',
  help: 'Total number of RPC batch calls made',
  labelNames: ['type', 'status'], // status: 'success', 'partial', 'failed'
  registers: [metricsRegistry],
});

export interface BatchFetchResult<T> {
  pubkey: PublicKey;
  account: AccountInfo<T> | null;
}

export interface BatchFetcherConfig {
  /** Maximum accounts per batch (default: 100) */
  maxAccountsPerBatch: number;
  /** Maximum concurrent batch requests (default: 5) */
  concurrency: number;
  /** Commitment level (default: 'confirmed') */
  commitment: Commitment;
  /** Retry failed batches (default: true) */
  retryOnFailure: boolean;
  /** Maximum retries per batch (default: 2) */
  maxRetries: number;
}

const DEFAULT_CONFIG: BatchFetcherConfig = {
  maxAccountsPerBatch: MAX_ACCOUNTS_PER_BATCH,
  concurrency: DEFAULT_CONCURRENCY,
  commitment: 'confirmed',
  retryOnFailure: true,
  maxRetries: 2,
};

export class BatchFetcher {
  private connection: Connection;
  private config: BatchFetcherConfig;

  constructor(connection: Connection, config: Partial<BatchFetcherConfig> = {}) {
    this.connection = connection;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fetch multiple accounts in batched RPC calls
   */
  async fetchAccounts(
    pubkeys: PublicKey[],
    type: string = 'generic'
  ): Promise<BatchFetchResult<Buffer>[]> {
    if (pubkeys.length === 0) {
      return [];
    }

    const startTime = Date.now();
    const chunks = this.chunkArray(pubkeys, this.config.maxAccountsPerBatch);

    log.debug(
      {
        totalAccounts: pubkeys.length,
        chunks: chunks.length,
        type,
      },
      'Starting batch fetch'
    );

    // Process chunks with controlled concurrency
    const results: BatchFetchResult<Buffer>[] = [];
    const chunkResults = await this.processChunksWithConcurrency(chunks, type);

    // Flatten results maintaining order
    for (const chunkResult of chunkResults) {
      results.push(...chunkResult);
    }

    const durationSec = (Date.now() - startTime) / 1000;
    batchFetchDuration.observe({ type }, durationSec);
    batchFetchAccounts.inc({ type }, pubkeys.length);

    log.debug(
      {
        totalAccounts: pubkeys.length,
        durationMs: Math.round(durationSec * 1000),
        type,
      },
      'Batch fetch completed'
    );

    return results;
  }

  /**
   * Fetch accounts and filter out null results
   */
  async fetchExistingAccounts(
    pubkeys: PublicKey[],
    type: string = 'generic'
  ): Promise<Array<{ pubkey: PublicKey; account: AccountInfo<Buffer> }>> {
    const results = await this.fetchAccounts(pubkeys, type);
    return results.filter(
      (r): r is { pubkey: PublicKey; account: AccountInfo<Buffer> } =>
        r.account !== null
    );
  }

  /**
   * Fetch accounts and return as a Map
   */
  async fetchAccountsAsMap(
    pubkeys: PublicKey[],
    type: string = 'generic'
  ): Promise<Map<string, AccountInfo<Buffer>>> {
    const results = await this.fetchAccounts(pubkeys, type);
    const map = new Map<string, AccountInfo<Buffer>>();

    for (const { pubkey, account } of results) {
      if (account) {
        map.set(pubkey.toString(), account);
      }
    }

    return map;
  }

  /**
   * Process chunks with controlled concurrency using p-limit pattern
   */
  private async processChunksWithConcurrency(
    chunks: PublicKey[][],
    type: string
  ): Promise<BatchFetchResult<Buffer>[][]> {
    const results: BatchFetchResult<Buffer>[][] = [];
    const activePromises: Promise<BatchFetchResult<Buffer>[]>[] = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const promise = this.fetchChunkWithRetry(chunk, type, i);

      activePromises.push(promise);

      // When we reach concurrency limit, wait for one to complete
      if (activePromises.length >= this.config.concurrency) {
        const completed = await Promise.race(
          activePromises.map((p, index) => p.then(() => index))
        );
        const result = await activePromises[completed];
        results.push(result);
        activePromises.splice(completed, 1);
      }
    }

    // Wait for remaining promises
    const remaining = await Promise.all(activePromises);
    results.push(...remaining);

    return results;
  }

  /**
   * Fetch a single chunk with retry logic
   */
  private async fetchChunkWithRetry(
    pubkeys: PublicKey[],
    type: string,
    chunkIndex: number
  ): Promise<BatchFetchResult<Buffer>[]> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        const accountInfos = await this.connection.getMultipleAccountsInfo(
          pubkeys,
          { commitment: this.config.commitment }
        );

        batchFetchCalls.inc({ type, status: 'success' });

        return pubkeys.map((pubkey, index) => ({
          pubkey,
          account: accountInfos[index],
        }));
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.config.maxRetries && this.config.retryOnFailure) {
          log.warn(
            {
              chunkIndex,
              attempt: attempt + 1,
              maxRetries: this.config.maxRetries,
              error: lastError.message,
            },
            'Batch fetch failed, retrying'
          );

          // Exponential backoff
          await this.sleep(100 * Math.pow(2, attempt));
        }
      }
    }

    // All retries failed
    batchFetchCalls.inc({ type, status: 'failed' });
    log.error(
      {
        chunkIndex,
        accountCount: pubkeys.length,
        error: lastError?.message,
      },
      'Batch fetch failed after all retries'
    );

    // Return null results for failed batch
    return pubkeys.map((pubkey) => ({
      pubkey,
      account: null,
    }));
  }

  /**
   * Split array into chunks
   */
  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Update connection (for failover scenarios)
   */
  setConnection(connection: Connection): void {
    this.connection = connection;
  }
}

/**
 * Create batch fetcher from environment
 */
export function createBatchFetcherFromEnv(connection: Connection): BatchFetcher {
  const config: Partial<BatchFetcherConfig> = {
    maxAccountsPerBatch: parseInt(
      process.env.BATCH_FETCH_MAX_ACCOUNTS || '100',
      10
    ),
    concurrency: parseInt(process.env.BATCH_FETCH_CONCURRENCY || '5', 10),
    commitment: (process.env.BATCH_FETCH_COMMITMENT as Commitment) || 'confirmed',
    retryOnFailure: process.env.BATCH_FETCH_RETRY !== 'false',
    maxRetries: parseInt(process.env.BATCH_FETCH_MAX_RETRIES || '2', 10),
  };

  return new BatchFetcher(connection, config);
}

/**
 * Utility: Fetch orders by PDAs with batching
 */
export async function fetchOrdersByPdas(
  connection: Connection,
  orderPdas: PublicKey[]
): Promise<Map<string, AccountInfo<Buffer>>> {
  const fetcher = new BatchFetcher(connection);
  return fetcher.fetchAccountsAsMap(orderPdas, 'orders');
}

/**
 * Utility: Fetch positions by PDAs with batching
 */
export async function fetchPositionsByPdas(
  connection: Connection,
  positionPdas: PublicKey[]
): Promise<Map<string, AccountInfo<Buffer>>> {
  const fetcher = new BatchFetcher(connection);
  return fetcher.fetchAccountsAsMap(positionPdas, 'positions');
}
