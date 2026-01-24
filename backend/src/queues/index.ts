/**
 * Queues Module
 *
 * BullMQ-based job queues for reliable async processing.
 */

// Configuration
export { loadQueueConfig, QUEUE_NAMES, DEFAULT_QUEUE_CONFIG } from './config.js';
export type { QueueName } from './config.js';

// Liquidation Queue
export { LiquidationQueue } from './liquidation-queue.js';

// Types
export type {
  LiquidationJob,
  LiquidationResult,
  SettlementJob,
  SettlementResult,
  MpcCallbackJob,
  MpcCallbackResult,
  QueueConfig,
  QueueStats,
} from './types.js';

export { JobPriority } from './types.js';
