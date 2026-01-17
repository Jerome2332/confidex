/**
 * Crank Service Configuration
 *
 * Loads configuration from environment variables with sensible defaults.
 */

export interface CrankConfig {
  // Enable/disable the crank service
  enabled: boolean;

  // Polling interval in milliseconds
  pollingIntervalMs: number;

  // Whether to use async MPC flow (true) or sync simulation (false)
  useAsyncMpc: boolean;

  // Maximum concurrent match attempts
  maxConcurrentMatches: number;

  // Minimum SOL balance for the crank wallet before warning
  minSolBalance: number;

  // Path to crank wallet keypair
  walletPath: string;

  // RPC URL (prefer Helius for better rate limits)
  rpcUrl: string;

  // Circuit breaker settings
  circuitBreaker: {
    // Number of consecutive errors before pausing
    errorThreshold: number;
    // Pause duration in milliseconds after circuit breaker trips
    pauseDurationMs: number;
  };

  // Token mints (devnet defaults)
  tokens: {
    wsolMint: string;
    usdcMint: string;
  };

  // Program IDs
  programs: {
    confidexDex: string;
    arciumMxe: string;
  };
}

/**
 * Load configuration from environment variables
 */
export function loadCrankConfig(): CrankConfig {
  return {
    enabled: process.env.CRANK_ENABLED === 'true',

    pollingIntervalMs: parseInt(process.env.CRANK_POLLING_INTERVAL_MS || '5000', 10),

    // Default to true for production-grade privacy (set CRANK_USE_ASYNC_MPC=false to disable)
    useAsyncMpc: process.env.CRANK_USE_ASYNC_MPC !== 'false',

    maxConcurrentMatches: parseInt(process.env.CRANK_MAX_CONCURRENT_MATCHES || '5', 10),

    minSolBalance: parseFloat(process.env.CRANK_MIN_SOL_BALANCE || '0.1'),

    walletPath: process.env.CRANK_WALLET_PATH || './keys/crank-wallet.json',

    rpcUrl: process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.devnet.solana.com',

    circuitBreaker: {
      errorThreshold: parseInt(process.env.CRANK_ERROR_THRESHOLD || '10', 10),
      pauseDurationMs: parseInt(process.env.CRANK_PAUSE_DURATION_MS || '60000', 10),
    },

    tokens: {
      wsolMint: process.env.WSOL_MINT || 'So11111111111111111111111111111111111111112',
      usdcMint: process.env.USDC_MINT || 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
    },

    programs: {
      confidexDex: process.env.CONFIDEX_PROGRAM_ID || '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB',
      arciumMxe: process.env.MXE_PROGRAM_ID || 'CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE',
    },
  };
}

/**
 * Validate configuration and log warnings
 */
export function validateConfig(config: CrankConfig): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  if (config.enabled && config.rpcUrl === 'https://api.devnet.solana.com') {
    warnings.push('Using public devnet RPC - consider using Helius for better rate limits');
  }

  if (config.pollingIntervalMs < 1000) {
    warnings.push('Polling interval is very aggressive (<1s), may hit rate limits');
  }

  if (config.maxConcurrentMatches > 10) {
    warnings.push('High concurrent match count may overwhelm RPC');
  }

  return { valid: true, warnings };
}
