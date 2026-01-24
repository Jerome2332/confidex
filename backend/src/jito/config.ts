/**
 * Jito configuration
 */

import { z } from 'zod';
import type { JitoConfig } from './types.js';
import { JITO_BLOCK_ENGINES } from './types.js';

// =============================================================================
// Configuration Schema
// =============================================================================

const JitoConfigSchema = z.object({
  blockEngineUrl: z.string().url(),
  authToken: z.string().optional(),
  defaultTipLamports: z.number().int().positive().default(10000), // 0.00001 SOL
  minTipLamports: z.number().int().positive().default(1000),
  maxTipLamports: z.number().int().positive().default(100000000), // 0.1 SOL max
  submissionTimeoutMs: z.number().int().positive().default(10000),
  statusPollIntervalMs: z.number().int().positive().default(1000),
  maxStatusPollAttempts: z.number().int().positive().default(30),
});

// =============================================================================
// Configuration Loader
// =============================================================================

/**
 * Load Jito configuration from environment variables
 */
export function loadJitoConfig(): JitoConfig {
  const isDevnet = process.env.SOLANA_NETWORK === 'devnet' || process.env.NODE_ENV !== 'production';

  const rawConfig = {
    blockEngineUrl:
      process.env.JITO_BLOCK_ENGINE_URL ||
      (isDevnet ? JITO_BLOCK_ENGINES.devnet : JITO_BLOCK_ENGINES.mainnet.default),
    authToken: process.env.JITO_AUTH_TOKEN,
    defaultTipLamports: parseInt(process.env.JITO_DEFAULT_TIP_LAMPORTS || '10000', 10),
    minTipLamports: parseInt(process.env.JITO_MIN_TIP_LAMPORTS || '1000', 10),
    maxTipLamports: parseInt(process.env.JITO_MAX_TIP_LAMPORTS || '100000000', 10),
    submissionTimeoutMs: parseInt(process.env.JITO_SUBMISSION_TIMEOUT_MS || '10000', 10),
    statusPollIntervalMs: parseInt(process.env.JITO_STATUS_POLL_INTERVAL_MS || '1000', 10),
    maxStatusPollAttempts: parseInt(process.env.JITO_MAX_STATUS_POLL_ATTEMPTS || '30', 10),
  };

  return JitoConfigSchema.parse(rawConfig);
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_JITO_CONFIG: JitoConfig = {
  blockEngineUrl: JITO_BLOCK_ENGINES.mainnet.default,
  defaultTipLamports: 10000,
  minTipLamports: 1000,
  maxTipLamports: 100000000,
  submissionTimeoutMs: 10000,
  statusPollIntervalMs: 1000,
  maxStatusPollAttempts: 30,
};

// =============================================================================
// Tip Calculation Helpers
// =============================================================================

/**
 * Calculate tip based on position value and current market conditions
 */
export function calculateDynamicTip(
  config: JitoConfig,
  positionValueLamports: bigint,
  competitionLevel: 'low' | 'medium' | 'high' = 'medium'
): number {
  // Base tip
  let tip = config.defaultTipLamports;

  // Adjust based on competition level
  const multipliers = {
    low: 1,
    medium: 2,
    high: 5,
  };
  tip *= multipliers[competitionLevel];

  // Optionally scale with position size (larger positions = higher tip)
  // e.g., 0.01% of position value
  const positionBasedTip = Number(positionValueLamports / BigInt(10000));
  tip = Math.max(tip, positionBasedTip);

  // Clamp to min/max
  return Math.min(Math.max(tip, config.minTipLamports), config.maxTipLamports);
}
