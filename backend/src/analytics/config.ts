/**
 * Analytics configuration
 */

import { z } from 'zod';
import type { AnalyticsConfig } from './types.js';

// =============================================================================
// Configuration Schema
// =============================================================================

const AnalyticsConfigSchema = z.object({
  databaseUrl: z.string().min(1),
  poolSize: z.number().int().positive().default(10),
  connectionTimeoutMs: z.number().int().positive().default(30000),
  idleTimeoutMs: z.number().int().positive().default(10000),
  logQueries: z.boolean().default(false),
  snapshotIntervalMs: z.number().int().positive().default(60000), // 1 minute
});

// =============================================================================
// Configuration Loader
// =============================================================================

/**
 * Load analytics configuration from environment variables
 */
export function loadAnalyticsConfig(): AnalyticsConfig {
  const rawConfig = {
    databaseUrl: process.env.TIMESCALE_URL || process.env.DATABASE_URL || '',
    poolSize: parseInt(process.env.ANALYTICS_POOL_SIZE || '10', 10),
    connectionTimeoutMs: parseInt(process.env.ANALYTICS_CONNECTION_TIMEOUT_MS || '30000', 10),
    idleTimeoutMs: parseInt(process.env.ANALYTICS_IDLE_TIMEOUT_MS || '10000', 10),
    logQueries: process.env.ANALYTICS_LOG_QUERIES === 'true',
    snapshotIntervalMs: parseInt(process.env.ANALYTICS_SNAPSHOT_INTERVAL_MS || '60000', 10),
  };

  return AnalyticsConfigSchema.parse(rawConfig);
}

/**
 * Check if analytics is enabled (has database URL)
 */
export function isAnalyticsEnabled(): boolean {
  const url = process.env.TIMESCALE_URL || process.env.DATABASE_URL;
  return Boolean(url && url.length > 0);
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_ANALYTICS_CONFIG: AnalyticsConfig = {
  databaseUrl: 'postgres://localhost:5432/confidex_analytics',
  poolSize: 10,
  connectionTimeoutMs: 30000,
  idleTimeoutMs: 10000,
  logQueries: false,
  snapshotIntervalMs: 60000,
};
