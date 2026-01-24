/**
 * Blacklist RPC Mock Tests
 *
 * These tests mock the RPC connection to test error handling paths
 * and success paths that can't be tested with real RPCs.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original module
const originalSolanaWeb3 = await import('@solana/web3.js');

describe('fetchBlacklistRoot RPC error handling', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty tree root when getAccountInfo throws', async () => {
    // Mock the Connection class to throw
    vi.doMock('@solana/web3.js', async () => {
      const actual = await vi.importActual<typeof import('@solana/web3.js')>(
        '@solana/web3.js'
      );
      return {
        ...actual,
        Connection: vi.fn().mockImplementation(() => ({
          getAccountInfo: vi.fn().mockRejectedValue(new Error('RPC timeout')),
        })),
      };
    });

    // Suppress expected error log
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Import after mocking
    const { fetchBlacklistRoot, getEmptyTreeRoot } = await import(
      '../../lib/blacklist.js'
    );

    const result = await fetchBlacklistRoot();
    const emptyRoot = getEmptyTreeRoot();

    // Should return empty tree root on error
    expect(result).toBe(emptyRoot);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch blacklist root:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });

  it('returns empty tree root when network error occurs', async () => {
    vi.doMock('@solana/web3.js', async () => {
      const actual = await vi.importActual<typeof import('@solana/web3.js')>(
        '@solana/web3.js'
      );
      return {
        ...actual,
        Connection: vi.fn().mockImplementation(() => ({
          getAccountInfo: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        })),
      };
    });

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { fetchBlacklistRoot, getEmptyTreeRoot } = await import(
      '../../lib/blacklist.js'
    );

    const result = await fetchBlacklistRoot();
    expect(result).toBe(getEmptyTreeRoot());

    consoleErrorSpy.mockRestore();
  });
});

describe('syncToOnChain success path', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns transaction signature on successful sync', async () => {
    const mockSignature = 'mockTxSig123456789';

    vi.doMock('@solana/web3.js', async () => {
      const actual = await vi.importActual<typeof import('@solana/web3.js')>(
        '@solana/web3.js'
      );
      return {
        ...actual,
        Connection: vi.fn().mockImplementation(() => ({
          getAccountInfo: vi.fn().mockResolvedValue(null),
        })),
        sendAndConfirmTransaction: vi.fn().mockResolvedValue(mockSignature),
      };
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { syncToOnChain, _resetSMTForTesting } = await import(
      '../../lib/blacklist.js'
    );

    // Reset SMT to get a clean state
    _resetSMTForTesting();

    const { Keypair } = await import('@solana/web3.js');
    const adminKeypair = Keypair.generate();

    const signature = await syncToOnChain(adminKeypair);

    expect(signature).toBe(mockSignature);
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('Synced blacklist root to on-chain')
    );

    consoleLogSpy.mockRestore();
  });
});

describe('fetchBlacklistRoot account data parsing', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty tree root when account exists but is uninitialized', async () => {
    // Create account data with all zeros at blacklist_root offset
    const accountData = Buffer.alloc(200);
    accountData.fill(0);

    vi.doMock('@solana/web3.js', async () => {
      const actual = await vi.importActual<typeof import('@solana/web3.js')>(
        '@solana/web3.js'
      );
      return {
        ...actual,
        Connection: vi.fn().mockImplementation(() => ({
          getAccountInfo: vi.fn().mockResolvedValue({
            data: accountData,
            owner: actual.PublicKey.default,
            lamports: 1000000,
          }),
        })),
      };
    });

    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const { fetchBlacklistRoot, getEmptyTreeRoot } = await import(
      '../../lib/blacklist.js'
    );

    const result = await fetchBlacklistRoot();
    expect(result).toBe(getEmptyTreeRoot());
    expect(consoleLogSpy).toHaveBeenCalledWith(
      'On-chain blacklist root is empty, using computed empty tree root'
    );

    consoleLogSpy.mockRestore();
  });

  it('returns on-chain root when account has non-zero root', async () => {
    // Create account data with non-zero blacklist root
    // Offset: 8 (discriminator) + 32 (authority) + 32 (fee_recipient) + 2 + 2 + 1 = 77
    const accountData = Buffer.alloc(200);
    const blacklistRootOffset = 77;
    // Set a specific pattern at the blacklist root position
    for (let i = 0; i < 32; i++) {
      accountData[blacklistRootOffset + i] = i + 1;
    }

    vi.doMock('@solana/web3.js', async () => {
      const actual = await vi.importActual<typeof import('@solana/web3.js')>(
        '@solana/web3.js'
      );
      return {
        ...actual,
        Connection: vi.fn().mockImplementation(() => ({
          getAccountInfo: vi.fn().mockResolvedValue({
            data: accountData,
            owner: actual.PublicKey.default,
            lamports: 1000000,
          }),
        })),
      };
    });

    const { fetchBlacklistRoot, getEmptyTreeRoot } = await import(
      '../../lib/blacklist.js'
    );

    const result = await fetchBlacklistRoot();

    // Should be a hex string starting with 0x
    expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    // Should NOT be the empty tree root
    expect(result).not.toBe(getEmptyTreeRoot());
    // Should contain our pattern (01 02 03 04...)
    expect(result).toBe(
      '0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'
    );
  });

  it('returns empty tree root when account does not exist', async () => {
    vi.doMock('@solana/web3.js', async () => {
      const actual = await vi.importActual<typeof import('@solana/web3.js')>(
        '@solana/web3.js'
      );
      return {
        ...actual,
        Connection: vi.fn().mockImplementation(() => ({
          getAccountInfo: vi.fn().mockResolvedValue(null),
        })),
      };
    });

    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { fetchBlacklistRoot, getEmptyTreeRoot } = await import(
      '../../lib/blacklist.js'
    );

    const result = await fetchBlacklistRoot();
    expect(result).toBe(getEmptyTreeRoot());
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      'ExchangeState not found, using empty tree root'
    );

    consoleWarnSpy.mockRestore();
  });
});
