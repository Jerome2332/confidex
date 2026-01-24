import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Store original env
const originalEnv = { ...process.env };

// Import after setting up environment
import { loadCrankConfig, validateConfig, CrankConfig } from '../../crank/config.js';

describe('Crank Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to original state before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('loadCrankConfig', () => {
    it('returns default configuration when no env vars are set', () => {
      // Clear all crank-related env vars
      delete process.env.CRANK_ENABLED;
      delete process.env.CRANK_POLLING_INTERVAL_MS;
      delete process.env.CRANK_USE_ASYNC_MPC;
      delete process.env.CRANK_MAX_CONCURRENT_MATCHES;
      delete process.env.CRANK_MIN_SOL_BALANCE;
      delete process.env.CRANK_WALLET_PATH;
      delete process.env.HELIUS_RPC_URL;
      delete process.env.RPC_URL;
      delete process.env.CRANK_DB_PATH;

      const config = loadCrankConfig();

      expect(config.enabled).toBe(false);
      expect(config.pollingIntervalMs).toBe(5000);
      expect(config.useAsyncMpc).toBe(true); // Default is true
      expect(config.maxConcurrentMatches).toBe(5);
      expect(config.minSolBalance).toBe(0.1);
      expect(config.walletPath).toBe('./keys/crank-wallet.json');
      expect(config.rpcUrl).toBe('https://api.devnet.solana.com');
      expect(config.dbPath).toBe('./data/crank.db');
    });

    it('loads enabled flag from CRANK_ENABLED', () => {
      process.env.CRANK_ENABLED = 'true';

      const config = loadCrankConfig();

      expect(config.enabled).toBe(true);
    });

    it('loads polling interval from env', () => {
      process.env.CRANK_POLLING_INTERVAL_MS = '10000';

      const config = loadCrankConfig();

      expect(config.pollingIntervalMs).toBe(10000);
    });

    it('respects CRANK_USE_ASYNC_MPC=false to disable async MPC', () => {
      process.env.CRANK_USE_ASYNC_MPC = 'false';

      const config = loadCrankConfig();

      expect(config.useAsyncMpc).toBe(false);
    });

    it('loads max concurrent matches from env', () => {
      process.env.CRANK_MAX_CONCURRENT_MATCHES = '10';

      const config = loadCrankConfig();

      expect(config.maxConcurrentMatches).toBe(10);
    });

    it('loads min SOL balance from env as float', () => {
      process.env.CRANK_MIN_SOL_BALANCE = '0.5';

      const config = loadCrankConfig();

      expect(config.minSolBalance).toBe(0.5);
    });

    it('loads wallet path from env', () => {
      process.env.CRANK_WALLET_PATH = '/custom/path/wallet.json';

      const config = loadCrankConfig();

      expect(config.walletPath).toBe('/custom/path/wallet.json');
    });

    it('prefers HELIUS_RPC_URL over RPC_URL', () => {
      process.env.HELIUS_RPC_URL = 'https://helius.example.com';
      process.env.RPC_URL = 'https://other.example.com';

      const config = loadCrankConfig();

      expect(config.rpcUrl).toBe('https://helius.example.com');
    });

    it('falls back to RPC_URL when HELIUS_RPC_URL is not set', () => {
      delete process.env.HELIUS_RPC_URL;
      process.env.RPC_URL = 'https://custom-rpc.example.com';

      const config = loadCrankConfig();

      expect(config.rpcUrl).toBe('https://custom-rpc.example.com');
    });

    it('loads database path from env', () => {
      process.env.CRANK_DB_PATH = '/data/custom.db';

      const config = loadCrankConfig();

      expect(config.dbPath).toBe('/data/custom.db');
    });

    it('loads shutdown timeout from env', () => {
      process.env.CRANK_SHUTDOWN_TIMEOUT_MS = '60000';

      const config = loadCrankConfig();

      expect(config.shutdownTimeoutMs).toBe(60000);
    });

    describe('circuit breaker settings', () => {
      it('loads error threshold from env', () => {
        process.env.CRANK_ERROR_THRESHOLD = '5';

        const config = loadCrankConfig();

        expect(config.circuitBreaker.errorThreshold).toBe(5);
      });

      it('loads pause duration from env', () => {
        process.env.CRANK_PAUSE_DURATION_MS = '120000';

        const config = loadCrankConfig();

        expect(config.circuitBreaker.pauseDurationMs).toBe(120000);
      });

      it('uses default circuit breaker values', () => {
        delete process.env.CRANK_ERROR_THRESHOLD;
        delete process.env.CRANK_PAUSE_DURATION_MS;

        const config = loadCrankConfig();

        expect(config.circuitBreaker.errorThreshold).toBe(10);
        expect(config.circuitBreaker.pauseDurationMs).toBe(60000);
      });
    });

    describe('token settings', () => {
      it('loads token mints from env', () => {
        process.env.WSOL_MINT = 'CustomWsolMint111111111111111111111111111';
        process.env.USDC_MINT = 'CustomUsdcMint111111111111111111111111111';

        const config = loadCrankConfig();

        expect(config.tokens.wsolMint).toBe('CustomWsolMint111111111111111111111111111');
        expect(config.tokens.usdcMint).toBe('CustomUsdcMint111111111111111111111111111');
      });

      it('uses default devnet token mints', () => {
        delete process.env.WSOL_MINT;
        delete process.env.USDC_MINT;

        const config = loadCrankConfig();

        expect(config.tokens.wsolMint).toBe('So11111111111111111111111111111111111111112');
        expect(config.tokens.usdcMint).toBe('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');
      });
    });

    describe('program IDs', () => {
      it('loads program IDs from env', () => {
        process.env.CONFIDEX_PROGRAM_ID = 'CustomConfidexProgramId11111111111111111';
        process.env.MXE_PROGRAM_ID = 'CustomMxeProgramId111111111111111111111';

        const config = loadCrankConfig();

        expect(config.programs.confidexDex).toBe('CustomConfidexProgramId11111111111111111');
        expect(config.programs.arciumMxe).toBe('CustomMxeProgramId111111111111111111111');
      });

      it('uses default program IDs', () => {
        delete process.env.CONFIDEX_PROGRAM_ID;
        delete process.env.MXE_PROGRAM_ID;

        const config = loadCrankConfig();

        expect(config.programs.confidexDex).toBe('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
        expect(config.programs.arciumMxe).toBe('HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS');
      });
    });

    describe('MPC settings', () => {
      it('loads MPC settings from env', () => {
        process.env.CRANK_USE_REAL_MPC = 'true';
        process.env.FULL_MXE_PROGRAM_ID = 'FullMxeProgramId11111111111111111111111';
        process.env.ARCIUM_CLUSTER_OFFSET = '789';
        process.env.MPC_TIMEOUT_MS = '180000';

        const config = loadCrankConfig();

        expect(config.mpc.useRealMpc).toBe(true);
        expect(config.mpc.fullMxeProgramId).toBe('FullMxeProgramId11111111111111111111111');
        expect(config.mpc.clusterOffset).toBe(789);
        expect(config.mpc.timeoutMs).toBe(180000);
      });

      it('disables real MPC with CRANK_USE_REAL_MPC=false', () => {
        process.env.CRANK_USE_REAL_MPC = 'false';

        const config = loadCrankConfig();

        expect(config.mpc.useRealMpc).toBe(false);
      });

      it('defaults to real MPC enabled', () => {
        delete process.env.CRANK_USE_REAL_MPC;

        const config = loadCrankConfig();

        expect(config.mpc.useRealMpc).toBe(true);
      });

      it('uses default cluster offset 456', () => {
        delete process.env.ARCIUM_CLUSTER_OFFSET;

        const config = loadCrankConfig();

        expect(config.mpc.clusterOffset).toBe(456);
      });

      it('uses default MPC timeout of 2 minutes', () => {
        delete process.env.MPC_TIMEOUT_MS;

        const config = loadCrankConfig();

        expect(config.mpc.timeoutMs).toBe(120000);
      });
    });
  });

  describe('validateConfig', () => {
    it('returns valid: true for any configuration', () => {
      const config = loadCrankConfig();

      const result = validateConfig(config);

      expect(result.valid).toBe(true);
    });

    it('warns about public devnet RPC when crank is enabled', () => {
      process.env.CRANK_ENABLED = 'true';
      delete process.env.HELIUS_RPC_URL;
      delete process.env.RPC_URL;

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings).toContain('Using public devnet RPC - consider using Helius for better rate limits');
    });

    it('does not warn about devnet RPC when crank is disabled', () => {
      process.env.CRANK_ENABLED = 'false';
      delete process.env.HELIUS_RPC_URL;
      delete process.env.RPC_URL;

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings).not.toContain('Using public devnet RPC - consider using Helius for better rate limits');
    });

    it('warns about aggressive polling interval', () => {
      process.env.CRANK_POLLING_INTERVAL_MS = '500';

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings).toContain('Polling interval is very aggressive (<1s), may hit rate limits');
    });

    it('warns about high concurrent match count', () => {
      process.env.CRANK_MAX_CONCURRENT_MATCHES = '15';

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings).toContain('High concurrent match count may overwhelm RPC');
    });

    it('warns about production MPC mode when enabled', () => {
      process.env.CRANK_USE_REAL_MPC = 'true';

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings).toContain('PRODUCTION MPC MODE ENABLED - using real Arcium cluster for encrypted computation');
    });

    it('warns about demo MPC mode when disabled', () => {
      process.env.CRANK_USE_REAL_MPC = 'false';

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings.some(w => w.includes('DEMO MPC MODE'))).toBe(true);
    });

    it('warns about non-standard cluster offset', () => {
      process.env.CRANK_USE_REAL_MPC = 'true';
      process.env.ARCIUM_CLUSTER_OFFSET = '999';

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings.some(w => w.includes('Non-standard cluster offset'))).toBe(true);
    });

    it('does not warn about standard cluster offsets 456 or 789', () => {
      process.env.CRANK_USE_REAL_MPC = 'true';
      process.env.ARCIUM_CLUSTER_OFFSET = '456';

      const config456 = loadCrankConfig();
      const result456 = validateConfig(config456);

      expect(result456.warnings.some(w => w.includes('Non-standard cluster offset'))).toBe(false);

      process.env.ARCIUM_CLUSTER_OFFSET = '789';

      const config789 = loadCrankConfig();
      const result789 = validateConfig(config789);

      expect(result789.warnings.some(w => w.includes('Non-standard cluster offset'))).toBe(false);
    });

    it('warns about short MPC timeout', () => {
      process.env.CRANK_USE_REAL_MPC = 'true';
      process.env.MPC_TIMEOUT_MS = '15000';

      const config = loadCrankConfig();
      const result = validateConfig(config);

      expect(result.warnings.some(w => w.includes('MPC timeout is very short'))).toBe(true);
    });
  });
});
