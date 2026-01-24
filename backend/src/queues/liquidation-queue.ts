/**
 * Liquidation Queue
 *
 * BullMQ-based job queue for reliable liquidation processing.
 * Features:
 * - Automatic retries with exponential backoff
 * - Job deduplication by position PDA
 * - Priority-based processing (higher leverage = higher priority)
 * - Rate limiting to prevent overwhelming the network
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { createLogger } from '../lib/logger.js';
import { getEventBroadcaster } from '../index.js';
import type { QueueConfig, LiquidationJob, LiquidationResult, QueueStats, JobPriority } from './types.js';
import { QUEUE_NAMES } from './config.js';

const log = createLogger('liquidation-queue');

// =============================================================================
// Liquidation Queue
// =============================================================================

export class LiquidationQueue {
  private queue: Queue<LiquidationJob, LiquidationResult>;
  private worker: Worker<LiquidationJob, LiquidationResult> | null = null;
  private queueEvents: QueueEvents | null = null;
  private redis: Redis;
  private isShuttingDown = false;

  constructor(
    private config: QueueConfig,
    private onProcess: (job: LiquidationJob) => Promise<LiquidationResult>
  ) {
    this.redis = new Redis(config.redisUrl, {
      maxRetriesPerRequest: null, // Required for BullMQ
      enableReadyCheck: false,
    });

    this.queue = new Queue<LiquidationJob, LiquidationResult>(QUEUE_NAMES.LIQUIDATIONS, {
      connection: this.redis,
      prefix: config.prefix,
      defaultJobOptions: {
        attempts: config.defaultJobOptions.attempts,
        backoff: {
          type: config.defaultJobOptions.backoffType,
          delay: config.defaultJobOptions.backoffDelay,
        },
        removeOnComplete: {
          count: config.defaultJobOptions.removeOnComplete,
        },
        removeOnFail: {
          count: config.defaultJobOptions.removeOnFail,
        },
      },
    });
  }

  // ===========================================================================
  // Initialization
  // ===========================================================================

  /**
   * Start the queue worker
   */
  async start(): Promise<void> {
    if (this.worker) {
      log.warn('Liquidation queue worker already running');
      return;
    }

    // Create worker
    this.worker = new Worker<LiquidationJob, LiquidationResult>(
      QUEUE_NAMES.LIQUIDATIONS,
      async (job) => this.processJob(job),
      {
        connection: this.redis.duplicate(),
        prefix: this.config.prefix,
        concurrency: this.config.concurrency,
        limiter: {
          max: this.config.rateLimit.max,
          duration: this.config.rateLimit.duration,
        },
      }
    );

    // Setup event handlers
    this.setupWorkerEvents();

    // Setup queue events for monitoring
    this.queueEvents = new QueueEvents(QUEUE_NAMES.LIQUIDATIONS, {
      connection: this.redis.duplicate(),
      prefix: this.config.prefix,
    });

    this.setupQueueEvents();

    log.info(
      {
        concurrency: this.config.concurrency,
        rateLimit: this.config.rateLimit,
      },
      'Liquidation queue worker started'
    );
  }

  /**
   * Setup worker event handlers
   */
  private setupWorkerEvents(): void {
    if (!this.worker) return;

    this.worker.on('completed', (job, result) => {
      if (result.success) {
        log.info(
          {
            jobId: job.id,
            position: job.data.positionPda.slice(0, 12),
            signature: result.signature?.slice(0, 12),
            processingTime: result.processingTimeMs,
          },
          'Liquidation completed'
        );

        // Broadcast liquidation executed event
        const broadcaster = getEventBroadcaster();
        if (broadcaster) {
          broadcaster.liquidationExecuted({
            positionPda: job.data.positionPda,
            marketPda: job.data.marketPda,
            side: job.data.side,
            owner: '', // Would need to track owner in job
            liquidator: '', // Would be crank wallet
            signature: result.signature,
          });
        }
      }
    });

    this.worker.on('failed', (job, err) => {
      if (!job) return;

      log.error(
        {
          jobId: job.id,
          position: job.data.positionPda.slice(0, 12),
          error: err.message,
          attempts: job.attemptsMade,
          maxAttempts: job.opts.attempts,
        },
        'Liquidation job failed'
      );

      // Broadcast liquidation failed event if all retries exhausted
      if (job.attemptsMade >= (job.opts.attempts ?? 3)) {
        const broadcaster = getEventBroadcaster();
        if (broadcaster) {
          broadcaster.liquidationFailed({
            positionPda: job.data.positionPda,
            marketPda: job.data.marketPda,
            side: job.data.side,
            owner: '',
          });
        }
      }
    });

    this.worker.on('error', (err) => {
      log.error({ error: err.message }, 'Liquidation worker error');
    });
  }

  /**
   * Setup queue event handlers for monitoring
   */
  private setupQueueEvents(): void {
    if (!this.queueEvents) return;

    this.queueEvents.on('waiting', ({ jobId }) => {
      log.debug({ jobId }, 'Liquidation job waiting');
    });

    this.queueEvents.on('active', ({ jobId }) => {
      log.debug({ jobId }, 'Liquidation job active');
    });

    this.queueEvents.on('stalled', ({ jobId }) => {
      log.warn({ jobId }, 'Liquidation job stalled');
    });
  }

  // ===========================================================================
  // Job Processing
  // ===========================================================================

  /**
   * Process a liquidation job
   */
  private async processJob(job: Job<LiquidationJob>): Promise<LiquidationResult> {
    const startTime = Date.now();
    const { positionPda, marketPda, markPrice } = job.data;

    log.debug(
      {
        jobId: job.id,
        position: positionPda.slice(0, 12),
        attempt: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts,
      },
      'Processing liquidation job'
    );

    try {
      const result = await this.onProcess(job.data);

      return {
        ...result,
        processingTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);

      // Check if position is already liquidated/closed (don't retry)
      if (
        errorMsg.includes('AlreadyLiquidated') ||
        errorMsg.includes('PositionClosed') ||
        errorMsg.includes('Position not found') ||
        errorMsg.includes('InvalidPositionStatus')
      ) {
        log.info(
          { position: positionPda.slice(0, 12), reason: errorMsg },
          'Position already liquidated or closed, skipping'
        );
        return {
          success: true,
          alreadyLiquidated: true,
          processingTimeMs: Date.now() - startTime,
        };
      }

      // Re-throw to trigger retry
      throw err;
    }
  }

  // ===========================================================================
  // Job Management
  // ===========================================================================

  /**
   * Add a liquidation job to the queue
   * Returns the job ID (or existing job ID if duplicate)
   */
  async addJob(job: LiquidationJob): Promise<string> {
    if (this.isShuttingDown) {
      throw new Error('Queue is shutting down');
    }

    // Use position PDA as job ID for deduplication
    const jobId = `liq-${job.positionPda}`;

    // Check for existing job
    const existingJob = await this.queue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'active' || state === 'waiting' || state === 'delayed') {
        log.debug(
          { jobId, state, position: job.positionPda.slice(0, 12) },
          'Liquidation job already queued'
        );
        return jobId;
      }
    }

    // Calculate priority based on leverage (higher leverage = higher priority)
    const priority = this.calculatePriority(job);

    const addedJob = await this.queue.add('liquidate', job, {
      jobId,
      priority,
    });

    log.debug(
      {
        jobId: addedJob.id,
        position: job.positionPda.slice(0, 12),
        priority,
        leverage: job.leverage,
      },
      'Liquidation job added'
    );

    // Broadcast liquidation detected event
    const broadcaster = getEventBroadcaster();
    if (broadcaster) {
      broadcaster.liquidationDetected({
        positionPda: job.positionPda,
        marketPda: job.marketPda,
        side: job.side,
        owner: '', // Would need owner info
      });
    }

    return addedJob.id!;
  }

  /**
   * Calculate job priority based on position characteristics
   * Lower number = higher priority
   */
  private calculatePriority(job: LiquidationJob): number {
    // Higher leverage = more urgent (lower priority number)
    // e.g., 100x leverage -> priority 1
    //       10x leverage -> priority 10
    //       1x leverage -> priority 100
    const leveragePriority = Math.max(1, Math.floor(100 / job.leverage));

    return leveragePriority;
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string): Promise<Job<LiquidationJob, LiquidationResult> | undefined> {
    return this.queue.getJob(jobId);
  }

  /**
   * Remove a job from the queue
   */
  async removeJob(jobId: string): Promise<void> {
    const job = await this.queue.getJob(jobId);
    if (job) {
      await job.remove();
      log.debug({ jobId }, 'Liquidation job removed');
    }
  }

  // ===========================================================================
  // Queue Statistics
  // ===========================================================================

  /**
   * Get queue statistics
   */
  async getStats(): Promise<QueueStats> {
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
      this.queue.isPaused(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused: paused ? 1 : 0,
    };
  }

  /**
   * Get recent failed jobs
   */
  async getFailedJobs(limit: number = 10): Promise<Job<LiquidationJob, LiquidationResult>[]> {
    return this.queue.getFailed(0, limit - 1);
  }

  /**
   * Retry all failed jobs
   */
  async retryAllFailed(): Promise<number> {
    const failed = await this.queue.getFailed();
    let count = 0;

    for (const job of failed) {
      await job.retry();
      count++;
    }

    log.info({ count }, 'Retried failed liquidation jobs');
    return count;
  }

  // ===========================================================================
  // Queue Control
  // ===========================================================================

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    await this.queue.pause();
    log.info('Liquidation queue paused');
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    await this.queue.resume();
    log.info('Liquidation queue resumed');
  }

  /**
   * Drain the queue (remove all waiting jobs)
   */
  async drain(): Promise<void> {
    await this.queue.drain();
    log.info('Liquidation queue drained');
  }

  /**
   * Clean old jobs
   */
  async clean(grace: number = 60000, limit: number = 1000): Promise<void> {
    await this.queue.clean(grace, limit, 'completed');
    await this.queue.clean(grace, limit, 'failed');
    log.info({ grace, limit }, 'Liquidation queue cleaned');
  }

  // ===========================================================================
  // Shutdown
  // ===========================================================================

  /**
   * Gracefully shutdown the queue
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;

    log.info('Shutting down liquidation queue...');

    // Close queue events
    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }

    // Close worker (waits for active jobs to complete)
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    // Close queue
    await this.queue.close();

    // Close Redis connection
    await this.redis.quit();

    log.info('Liquidation queue shut down');
  }
}
