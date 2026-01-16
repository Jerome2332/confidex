'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
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
        console.warn('[useEncryptedBalance] Encryption not initialized, falling back to dev mode');
        return getBalanceFromEncrypted(encryptedBalance);
      }

      try {
        return await decryptValue(encryptedBalance);
      } catch (err) {
        console.error('[useEncryptedBalance] Decryption failed, falling back to dev mode:', err);
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
        console.log('[useEncryptedBalance] Dev mode: storing plaintext balance');
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
      console.log('[useEncryptedBalance] Simulating MPC balance comparison');
      console.log('  Required:', amount.toString());
      console.log('  Available:', balance.toString());

      // Simulate MPC latency
      await new Promise(resolve => setTimeout(resolve, 100));

      return balance >= amount;
    },
    [balances.sol, balances.usdc]
  );

  /**
   * Fetch balances from on-chain accounts
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
      console.log('[useEncryptedBalance] Fetching encrypted balances for', publicKey.toString());

      // Fetch both balances in parallel
      const [solResult, usdcResult] = await Promise.all([
        fetchUserBalance(connection, publicKey, SOL_MINT),
        fetchUserBalance(connection, publicKey, USDC_MINT),
      ]);

      // Get encrypted balance arrays
      const solEncrypted = solResult.account?.encryptedBalance || new Uint8Array(64);
      const usdcEncrypted = usdcResult.account?.encryptedBalance || new Uint8Array(64);

      // Decrypt balances
      const [solDecrypted, usdcDecrypted] = await Promise.all([
        decryptBalance(solEncrypted),
        decryptBalance(usdcEncrypted),
      ]);

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

      console.log('[useEncryptedBalance] Balances fetched:');
      console.log('  SOL:', newBalances.solUiAmount, '(encrypted:', detectEncryptionMode(solEncrypted), ')');
      console.log('  USDC:', newBalances.usdcUiAmount, '(encrypted:', detectEncryptionMode(usdcEncrypted), ')');
    } catch (err) {
      console.error('[useEncryptedBalance] Error fetching balances:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, formatBalance, decryptBalance, detectEncryptionMode]);

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
