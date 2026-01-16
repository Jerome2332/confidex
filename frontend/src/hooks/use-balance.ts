'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

import { createLogger } from '@/lib/logger';

const log = createLogger('balance');
import {
  fetchUserBalance,
  deriveUserBalancePda,
} from '@/lib/confidex-client';
import { TRADING_PAIRS } from '@/lib/constants';

// Token mints from constants
const SOL_MINT = new PublicKey(TRADING_PAIRS[0].baseMint);
const USDC_MINT = new PublicKey(TRADING_PAIRS[0].quoteMint);

export interface BalanceState {
  sol: bigint;
  usdc: bigint;
  solUiAmount: string;
  usdcUiAmount: string;
}

export interface UseBalanceReturn {
  balances: BalanceState;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  hasSufficientBalance: (amount: bigint, token: 'SOL' | 'USDC') => boolean;
}

/**
 * Hook for fetching user's wrapped token balances from on-chain
 */
export function useBalance(): UseBalanceReturn {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [balances, setBalances] = useState<BalanceState>({
    sol: BigInt(0),
    usdc: BigInt(0),
    solUiAmount: '0',
    usdcUiAmount: '0.00',
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
      // SOL: show up to 4 decimal places
      return `${whole}.${fractionStr.slice(0, 4)}`;
    } else {
      // USDC: show 2 decimal places
      return `${whole}.${fractionStr.slice(0, 2)}`;
    }
  }, []);

  /**
   * Fetch balances from on-chain accounts
   */
  const refresh = useCallback(async () => {
    if (!publicKey) {
      setBalances({
        sol: BigInt(0),
        usdc: BigInt(0),
        solUiAmount: '0',
        usdcUiAmount: '0.00',
      });
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      log.debug('[useBalance] Fetching wrapped balances for', { toString: publicKey.toString() });

      // Fetch both balances in parallel
      const [solResult, usdcResult] = await Promise.all([
        fetchUserBalance(connection, publicKey, SOL_MINT),
        fetchUserBalance(connection, publicKey, USDC_MINT),
      ]);

      const newBalances: BalanceState = {
        sol: solResult.balance,
        usdc: usdcResult.balance,
        solUiAmount: formatBalance(solResult.balance, 9),
        usdcUiAmount: formatBalance(usdcResult.balance, 6),
      };

      setBalances(newBalances);

      log.debug('Balances fetched:');
      log.debug('  SOL:', { solUiAmount: newBalances.solUiAmount });
      log.debug('  USDC:', { usdcUiAmount: newBalances.usdcUiAmount });
    } catch (err) {
      log.error('Error fetching balances', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, formatBalance]);

  /**
   * Check if user has sufficient wrapped balance
   */
  const hasSufficientBalance = useCallback(
    (amount: bigint, token: 'SOL' | 'USDC'): boolean => {
      const balance = token === 'SOL' ? balances.sol : balances.usdc;
      return balance >= amount;
    },
    [balances]
  );

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
    hasSufficientBalance,
  };
}

/**
 * Hook for getting the PDA addresses for user balance accounts
 * Useful for displaying account info or debugging
 */
export function useBalancePdas() {
  const { publicKey } = useWallet();

  const getPdas = useCallback(() => {
    if (!publicKey) return null;

    const [solPda] = deriveUserBalancePda(publicKey, SOL_MINT);
    const [usdcPda] = deriveUserBalancePda(publicKey, USDC_MINT);

    return {
      solBalancePda: solPda.toString(),
      usdcBalancePda: usdcPda.toString(),
    };
  }, [publicKey]);

  return getPdas();
}
