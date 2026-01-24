/**
 * Streaming module configuration
 *
 * Follows the configuration pattern from crank/config.ts
 */

import { z } from 'zod';

// =============================================================================
// Configuration Schema
// =============================================================================

const StreamingConfigSchema = z.object({
  enabled: z.boolean().default(false),

  websocket: z.object({
    enabled: z.boolean().default(true),
    path: z.string().default('/ws'),
    pingTimeout: z.number().int().positive().default(60000),
    pingInterval: z.number().int().positive().default(25000),
    maxPayloadSize: z.number().int().positive().default(1024 * 100), // 100KB
  }),

  redis: z.object({
    enabled: z.boolean().default(false),
    url: z.string().url().optional(),
    pubChannel: z.string().default('confidex:events'),
    keyPrefix: z.string().default('confidex:'),
    connectionTimeout: z.number().int().positive().default(10000),
    maxRetriesPerRequest: z.number().int().min(0).default(3),
  }),

  rateLimit: z.object({
    maxConnectionsPerIp: z.number().int().positive().default(10),
    maxSubscriptionsPerClient: z.number().int().positive().default(20),
    messagesPerMinute: z.number().int().positive().default(100),
  }),

  broadcast: z.object({
    globalStatsIntervalMs: z.number().int().positive().default(10000), // 10s
    marketStatsIntervalMs: z.number().int().positive().default(30000), // 30s
    batchDelayMs: z.number().int().min(0).default(50), // Batch events within 50ms
  }),
});

export type StreamingConfig = z.infer<typeof StreamingConfigSchema>;

// =============================================================================
// Configuration Loader
// =============================================================================

/**
 * Load streaming configuration from environment variables
 */
export function loadStreamingConfig(): StreamingConfig {
  const rawConfig = {
    enabled: process.env.STREAMING_ENABLED === 'true',

    websocket: {
      enabled: process.env.WS_ENABLED !== 'false',
      path: process.env.WS_PATH || '/ws',
      pingTimeout: parseInt(process.env.WS_PING_TIMEOUT || '60000', 10),
      pingInterval: parseInt(process.env.WS_PING_INTERVAL || '25000', 10),
      maxPayloadSize: parseInt(process.env.WS_MAX_PAYLOAD_SIZE || '102400', 10),
    },

    redis: {
      enabled: process.env.REDIS_ENABLED === 'true',
      url: process.env.REDIS_URL || undefined,
      pubChannel: process.env.REDIS_PUB_CHANNEL || 'confidex:events',
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'confidex:',
      connectionTimeout: parseInt(process.env.REDIS_CONNECTION_TIMEOUT || '10000', 10),
      maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES || '3', 10),
    },

    rateLimit: {
      maxConnectionsPerIp: parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP || '10', 10),
      maxSubscriptionsPerClient: parseInt(process.env.WS_MAX_SUBSCRIPTIONS || '20', 10),
      messagesPerMinute: parseInt(process.env.WS_MESSAGES_PER_MINUTE || '100', 10),
    },

    broadcast: {
      globalStatsIntervalMs: parseInt(process.env.GLOBAL_STATS_INTERVAL_MS || '10000', 10),
      marketStatsIntervalMs: parseInt(process.env.MARKET_STATS_INTERVAL_MS || '30000', 10),
      batchDelayMs: parseInt(process.env.BROADCAST_BATCH_DELAY_MS || '50', 10),
    },
  };

  // Validate and return
  return StreamingConfigSchema.parse(rawConfig);
}

// =============================================================================
// Default Configuration
// =============================================================================

/**
 * Default development configuration
 */
export const DEFAULT_DEV_CONFIG: StreamingConfig = {
  enabled: true,
  websocket: {
    enabled: true,
    path: '/ws',
    pingTimeout: 60000,
    pingInterval: 25000,
    maxPayloadSize: 102400,
  },
  redis: {
    enabled: false, // Redis optional in dev
    url: 'redis://localhost:6379',
    pubChannel: 'confidex:events',
    keyPrefix: 'confidex:',
    connectionTimeout: 10000,
    maxRetriesPerRequest: 3,
  },
  rateLimit: {
    maxConnectionsPerIp: 10,
    maxSubscriptionsPerClient: 20,
    messagesPerMinute: 100,
  },
  broadcast: {
    globalStatsIntervalMs: 10000,
    marketStatsIntervalMs: 30000,
    batchDelayMs: 50,
  },
};

/**
 * Production configuration with Redis enabled
 */
export const DEFAULT_PROD_CONFIG: StreamingConfig = {
  ...DEFAULT_DEV_CONFIG,
  redis: {
    ...DEFAULT_DEV_CONFIG.redis,
    enabled: true,
  },
  rateLimit: {
    maxConnectionsPerIp: 5, // Stricter in production
    maxSubscriptionsPerClient: 10,
    messagesPerMinute: 60,
  },
};

// =============================================================================
// Validation Helpers
// =============================================================================

/**
 * Validate that a channel name is valid
 */
export function isValidChannel(channel: string): boolean {
  const validPrefixes = [
    'orders',
    'trades',
    'liquidations',
    'positions',
    'global',
    'market:',
    'prices',
  ];

  return validPrefixes.some((prefix) => channel === prefix || channel.startsWith(prefix));
}

/**
 * Get the base channel from a specific channel
 * e.g., 'orders:ABC123' -> 'orders'
 */
export function getBaseChannel(channel: string): string {
  const colonIndex = channel.indexOf(':');
  return colonIndex === -1 ? channel : channel.substring(0, colonIndex);
}

/**
 * Get the identifier from a channel (if any)
 * e.g., 'orders:ABC123' -> 'ABC123'
 */
export function getChannelIdentifier(channel: string): string | null {
  const colonIndex = channel.indexOf(':');
  return colonIndex === -1 ? null : channel.substring(colonIndex + 1);
}
