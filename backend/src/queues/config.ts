/**
 * Queue configuration
 */

import { z } from 'zod';
import type { QueueConfig } from './types.js';

// =============================================================================
// Configuration Schema
// =============================================================================

const QueueConfigSchema = z.object({
  redisUrl: z.string().default('redis://localhost:6379'),
  prefix: z.string().default('confidex'),
  defaultJobOptions: z.object({
    attempts: z.number().int().positive().default(3),
    backoffType: z.enum(['exponential', 'fixed']).default('exponential'),
    backoffDelay: z.number().int().positive().default(1000),
    removeOnComplete: z.number().int().min(0).default(1000),
    removeOnFail: z.number().int().min(0).default(5000),
  }),
  concurrency: z.number().int().positive().default(5),
  rateLimit: z.object({
    max: z.number().int().positive().default(10),
    duration: z.number().int().positive().default(1000),
  }),
});

// =============================================================================
// Configuration Loader
// =============================================================================

/**
 * Load queue configuration from environment variables
 */
export function loadQueueConfig(): QueueConfig {
  const rawConfig = {
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    prefix: process.env.QUEUE_PREFIX || 'confidex',
    defaultJobOptions: {
      attempts: parseInt(process.env.QUEUE_JOB_ATTEMPTS || '3', 10),
      backoffType: (process.env.QUEUE_BACKOFF_TYPE || 'exponential') as 'exponential' | 'fixed',
      backoffDelay: parseInt(process.env.QUEUE_BACKOFF_DELAY || '1000', 10),
      removeOnComplete: parseInt(process.env.QUEUE_REMOVE_ON_COMPLETE || '1000', 10),
      removeOnFail: parseInt(process.env.QUEUE_REMOVE_ON_FAIL || '5000', 10),
    },
    concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
    rateLimit: {
      max: parseInt(process.env.QUEUE_RATE_LIMIT_MAX || '10', 10),
      duration: parseInt(process.env.QUEUE_RATE_LIMIT_DURATION || '1000', 10),
    },
  };

  return QueueConfigSchema.parse(rawConfig);
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  redisUrl: 'redis://localhost:6379',
  prefix: 'confidex',
  defaultJobOptions: {
    attempts: 3,
    backoffType: 'exponential',
    backoffDelay: 1000,
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
  concurrency: 5,
  rateLimit: {
    max: 10,
    duration: 1000,
  },
};

// =============================================================================
// Queue Names
// =============================================================================

export const QUEUE_NAMES = {
  LIQUIDATIONS: 'liquidations',
  SETTLEMENTS: 'settlements',
  MPC_CALLBACKS: 'mpc-callbacks',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
