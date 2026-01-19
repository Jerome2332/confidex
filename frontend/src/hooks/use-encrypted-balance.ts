'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

import { createLogger } from '@/lib/logger';

const log = createLogger('encryption');
import {
  fetchUserBalance,
  deriveUserBalancePda,
  getBalanceFromEncrypted,
  UserConfidentialBalance,
} from '@/lib/confidex-client';
import { useEncryption } from './use-encryption';
import { TRADING_PAIRS } from '@/lib/constants';

// Token mints from constants
const SOL_MINT = new PublicKey(TRADING_PAIRS[0].baseMint);
const USDC_MINT = new PublicKey(TRADING_PAIRS[0].quoteMint);

// Encrypted balance format version
// Version 1: Plaintext in first 8 bytes (current dev mode)
// Version 2: Full Arcium encryption (when C-SPL ready)
export const ENCRYPTION_VERSION = 1;

export interface EncryptedBalanceState {
  // Raw encrypted balances (64 bytes each)
  solEncrypted: Uint8Array;
  usdcEncrypted: Uint8Array;
  // Decrypted values (only available to owner)
  sol: bigint;
  usdc: bigint;
  // UI-friendly amounts
  solUiAmount: string;
  usdcUiAmount: string;
  // Account data
  solAccount: UserConfidentialBalance | null;
  usdcAccount: UserConfidentialBalance | null;
}

export interface UseEncryptedBalanceReturn {
  balances: EncryptedBalanceState;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  // Encrypted comparison (simulated MPC)
  canAfford: (amount: bigint, token: 'SOL' | 'USDC') => Promise<boolean>;
  // Encrypt a new balance value
  encryptBalance: (amount: bigint) => Promise<Uint8Array>;
  // Check if balances are truly encrypted (vs dev mode)
  isEncrypted: boolean;
}

/**
 * Hook for fetching and managing user's encrypted token balances
 * Supports both dev mode (plaintext in first 8 bytes) and
 * production mode (full Arcium encryption when C-SPL is ready)
 */
export function useEncryptedBalance(): UseEncryptedBalanceReturn {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { encryptValue, decryptValue, isInitialized: encryptionReady } = useEncryption();

  const [balances, setBalances] = useState<EncryptedBalanceState>({
    solEncrypted: new Uint8Array(64),
    usdcEncrypted: new Uint8Array(64),
    sol: BigInt(0),
    usdc: BigInt(0),
    solUiAmount: '0',
    usdcUiAmount: '0.00',
    solAccount: null,
    usdcAccount: null,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Format balance to UI-friendly string
   */
  const formatBalance = useCallback((amount: bigint, decimals: number): string => {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const remainder = amount % divisor;
    const fractionStr = remainder.toString().padStart(decimals, '0');

    if (decimals === 9) {
      return `${whole}.${fractionStr.slice(0, 4)}`;
    } else {
      return `${whole}.${fractionStr.slice(0, 2)}`;
    }
  }, []);

  /**
   * Detect if encrypted balance uses full Arcium encryption
   * vs dev mode plaintext
   */
  const detectEncryptionMode = useCallback((encryptedBalance: Uint8Array): boolean => {
    // In dev mode, only first 8 bytes are used (balance as u64 LE)
    // and remaining bytes are zero
    // In production, full 64 bytes have encrypted data
    const tailBytes = encryptedBalance.slice(16, 64);
    const hasEncryptedData = tailBytes.some(b => b !== 0);
    return hasEncryptedData;
  }, []);

  /**
   * Decrypt balance based on encryption mode
   */
  const decryptBalance = useCallback(
    async (encryptedBalance: Uint8Array): Promise<bigint> => {
      const isFullyEncrypted = detectEncryptionMode(encryptedBalance);

      if (!isFullyEncrypted) {
        // Dev mode: read plaintext from first 8 bytes
        return getBalanceFromEncrypted(encryptedBalance);
      }

      // Production mode: use Arcium decryption
      if (!encryptionReady) {
        log.warn('Encryption not initialized, falling back to dev mode');
        return getBalanceFromEncrypted(encryptedBalance);
      }

      try {
        return await decryptValue(encryptedBalance);
      } catch (err) {
        log.error('Decryption failed, falling back to dev mode', { error: err instanceof Error ? err.message : String(err) });
        return getBalanceFromEncrypted(encryptedBalance);
      }
    },
    [detectEncryptionMode, encryptionReady, decryptValue]
  );

  /**
   * Encrypt a balance value using Arcium
   */
  const encryptBalance = useCallback(
    async (amount: bigint): Promise<Uint8Array> => {
      if (ENCRYPTION_VERSION === 1 || !encryptionReady) {
        // Dev mode: store plaintext in first 8 bytes
        const result = new Uint8Array(64);
        const view = new DataView(result.buffer);
        view.setBigUint64(0, amount, true); // little-endian
        log.debug('Dev mode: storing plaintext balance');
        return result;
      }

      // Production mode: full Arcium encryption
      return encryptValue(amount);
    },
    [encryptionReady, encryptValue]
  );

  /**
   * Check if user can afford an amount (simulated MPC comparison)
   * In production, this would be done via Arcium encrypted comparison
   */
  const canAfford = useCallback(
    async (amount: bigint, token: 'SOL' | 'USDC'): Promise<boolean> => {
      const balance = token === 'SOL' ? balances.sol : balances.usdc;

      if (ENCRYPTION_VERSION === 1) {
        // Dev mode: direct comparison
        return balance >= amount;
      }

      // Production mode: would use Arcium MPC comparison
      // For now, simulate by using decrypted values
      // TODO: Replace with actual Arcium compare_encrypted CPI
      log.debug('Simulating MPC balance comparison');
      log.debug('  Required:', { toString: amount.toString() });
      log.debug('  Available:', { toString: balance.toString() });

      // Simulate MPC latency
      await new Promise(resolve => setTimeout(resolve, 100));

      return balance >= amount;
    },
    [balances.sol, balances.usdc]
  );

  /**
   * Fetch native wallet balances (fallback when C-SPL not initialized)
   */
  const fetchNativeBalances = useCallback(async (): Promise<{
    sol: bigint;
    usdc: bigint;
  }> => {
    if (!publicKey) {
      console.log('[Balance] No publicKey for native balance fetch');
      return { sol: BigInt(0), usdc: BigInt(0) };
    }

    try {
      console.log('[Balance] Fetching native SOL balance for', publicKey.toString());
      // Fetch native SOL balance
      const solBalance = await connection.getBalance(publicKey);
      const solBigInt = BigInt(solBalance);
      console.log('[Balance] Native SOL balance:', solBalance, 'lamports');

      // Fetch USDC token account balance
      let usdcBigInt = BigInt(0);
      try {
        const usdcAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);
        console.log('[Balance] USDC ATA:', usdcAta.toString(), 'for mint:', USDC_MINT.toString());
        const usdcAccount = await getAccount(connection, usdcAta);
        usdcBigInt = usdcAccount.amount;
        console.log('[Balance] USDC token balance:', usdcBigInt.toString());
      } catch (e) {
        // No USDC account exists - that's fine
        console.log('[Balance] No USDC token account found (this is OK if you have no USDC)');
      }

      return { sol: solBigInt, usdc: usdcBigInt };
    } catch (err) {
      console.error('[Balance] Error fetching native balances:', err);
      return { sol: BigInt(0), usdc: BigInt(0) };
    }
  }, [publicKey, connection]);

  /**
   * Fetch balances from on-chain accounts
   * Falls back to native wallet balances when C-SPL accounts don't exist
   */
  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalances({
        solEncrypted: new Uint8Array(64),
        usdcEncrypted: new Uint8Array(64),
        sol: BigInt(0),
        usdc: BigInt(0),
        solUiAmount: '0',
        usdcUiAmount: '0.00',
        solAccount: null,
        usdcAccount: null,
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      log.debug('[useEncryptedBalance] Fetching encrypted balances for', { toString: publicKey.toString() });

      // Fetch both C-SPL balances in parallel
      const [solResult, usdcResult] = await Promise.all([
        fetchUserBalance(connection, publicKey, SOL_MINT),
        fetchUserBalance(connection, publicKey, USDC_MINT),
      ]);

      // Check if C-SPL accounts exist AND have non-zero balances
      const hasCsplAccounts = solResult.account !== null || usdcResult.account !== null;
      const csplSolBalance = solResult.balance;
      const csplUsdcBalance = usdcResult.balance;
      const hasCsplBalances = csplSolBalance > BigInt(0) || csplUsdcBalance > BigInt(0);

      console.log('[Balance] C-SPL check:', {
        accountsExist: hasCsplAccounts,
        solAccount: !!solResult.account,
        usdcAccount: !!usdcResult.account,
        csplSolBalance: csplSolBalance.toString(),
        csplUsdcBalance: csplUsdcBalance.toString(),
        hasNonZeroBalance: hasCsplBalances
      });

      let solDecrypted: bigint;
      let usdcDecrypted: bigint;
      let solEncrypted: Uint8Array;
      let usdcEncrypted: Uint8Array;

      // Only use C-SPL if accounts have non-zero balances
      // Otherwise fall back to native wallet balances for devnet testing
      if (hasCsplAccounts && hasCsplBalances) {
        // Use C-SPL encrypted balances
        solEncrypted = solResult.account?.encryptedBalance || new Uint8Array(64);
        usdcEncrypted = usdcResult.account?.encryptedBalance || new Uint8Array(64);

        // Decrypt balances
        [solDecrypted, usdcDecrypted] = await Promise.all([
          decryptBalance(solEncrypted),
          decryptBalance(usdcEncrypted),
        ]);
        console.log('[Balance] Using C-SPL encrypted balances');
      } else {
        // Fall back to native wallet balances (devnet testing mode)
        console.log('[Balance] Falling back to native wallet balances (C-SPL empty or not initialized)...');
        const nativeBalances = await fetchNativeBalances();
        console.log('[Balance] Native balances fetched:', { sol: nativeBalances.sol.toString(), usdc: nativeBalances.usdc.toString() });
        solDecrypted = nativeBalances.sol;
        usdcDecrypted = nativeBalances.usdc;
        solEncrypted = new Uint8Array(64);
        usdcEncrypted = new Uint8Array(64);
      }

      const newBalances: EncryptedBalanceState = {
        solEncrypted,
        usdcEncrypted,
        sol: solDecrypted,
        usdc: usdcDecrypted,
        solUiAmount: formatBalance(solDecrypted, 9),
        usdcUiAmount: formatBalance(usdcDecrypted, 6),
        solAccount: solResult.account,
        usdcAccount: usdcResult.account,
      };

      setBalances(newBalances);

      log.debug('Balances fetched:');
      console.log('  SOL:', newBalances.solUiAmount, '(encrypted:', hasCsplAccounts && detectEncryptionMode(solEncrypted), ')');
      console.log('  USDC:', newBalances.usdcUiAmount, '(encrypted:', hasCsplAccounts && detectEncryptionMode(usdcEncrypted), ')');
    } catch (err) {
      log.error('Error fetching balances', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, formatBalance, decryptBalance, detectEncryptionMode, fetchNativeBalances]);

  // Determine if any balances are truly encrypted
  const isEncrypted = useMemo(() => {
    return (
      detectEncryptionMode(balances.solEncrypted) ||
      detectEncryptionMode(balances.usdcEncrypted)
    );
  }, [balances.solEncrypted, balances.usdcEncrypted, detectEncryptionMode]);

  // Fetch balances on mount and when wallet changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Set up polling for balance updates (every 30 seconds)
  useEffect(() => {
    if (!publicKey) return;

    const interval = setInterval(() => {
      refresh();
    }, 30000);

    return () => clearInterval(interval);
  }, [publicKey, refresh]);

  return {
    balances,
    isLoading,
    error,
    refresh,
    canAfford,
    encryptBalance,
    isEncrypted,
  };
}

/**
 * Hook for getting the PDA addresses for user balance accounts
 */
export function useBalancePdas() {
  const { publicKey } = useWallet();

  return useMemo(() => {
    if (!publicKey) return null;

    const [solPda] = deriveUserBalancePda(publicKey, SOL_MINT);
    const [usdcPda] = deriveUserBalancePda(publicKey, USDC_MINT);

    return {
      solBalancePda: solPda.toString(),
      usdcBalancePda: usdcPda.toString(),
    };
  }, [publicKey]);
}
