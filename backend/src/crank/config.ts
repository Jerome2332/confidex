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

  // Database path for persistence
  dbPath: string;

  // Graceful shutdown timeout in milliseconds
  shutdownTimeoutMs: number;

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

  // Production MPC settings
  mpc: {
    // Use real Arcium MPC instead of simulated results
    useRealMpc: boolean;
    // Full Arcium MXE Program ID (deployed via `arcium deploy`)
    fullMxeProgramId: string;
    // Arcium cluster offset (456 for v0.6.3)
    clusterOffset: number;
    // MPC computation timeout in milliseconds
    timeoutMs: number;
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

    dbPath: process.env.CRANK_DB_PATH || './data/crank.db',

    shutdownTimeoutMs: parseInt(process.env.CRANK_SHUTDOWN_TIMEOUT_MS || '30000', 10),

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
      // DEPRECATED: Legacy custom MXE - use mpc.fullMxeProgramId instead for production
      // This was used during development when CPI format differed from Arcium SDK.
      // For production MPC, use the fullMxeProgramId (DoT4u...) deployed via `arcium deploy`.
      arciumMxe: process.env.MXE_PROGRAM_ID || 'CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE',
    },

    mpc: {
      // Default to true for production - disable explicitly with CRANK_USE_REAL_MPC=false
      useRealMpc: process.env.CRANK_USE_REAL_MPC !== 'false',
      // Full Arcium MXE deployed via `arcium deploy`
      fullMxeProgramId: process.env.FULL_MXE_PROGRAM_ID || 'DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM',
      // Devnet cluster offset (456 for v0.6.3, 789 for backup)
      clusterOffset: parseInt(process.env.ARCIUM_CLUSTER_OFFSET || '456', 10),
      // MPC timeout (2 minutes default)
      timeoutMs: parseInt(process.env.MPC_TIMEOUT_MS || '120000', 10),
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

  // MPC-specific warnings
  if (config.mpc.useRealMpc) {
    warnings.push('PRODUCTION MPC MODE ENABLED - using real Arcium cluster for encrypted computation');

    if (config.mpc.clusterOffset !== 456 && config.mpc.clusterOffset !== 789) {
      warnings.push(`Non-standard cluster offset: ${config.mpc.clusterOffset} (expected 456 or 789 for devnet)`);
    }

    if (config.mpc.timeoutMs < 30000) {
      warnings.push('MPC timeout is very short (<30s) - may cause false failures');
    }
  } else {
    // Warn when demo mode is explicitly enabled
    warnings.push('⚠️ DEMO MPC MODE - Set CRANK_USE_REAL_MPC=true for production (default is now true)');
  }

  return { valid: true, warnings };
}
