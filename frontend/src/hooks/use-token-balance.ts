'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from '@solana/spl-token';
import { TRADING_PAIRS } from '@/lib/constants';

// Native SOL mint (not wrapped SOL)
const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey(TRADING_PAIRS[0].quoteMint);

export interface TokenBalances {
  sol: bigint;
  usdc: bigint;
  solUiAmount: string;
  usdcUiAmount: string;
}

export interface UseTokenBalanceReturn {
  balances: TokenBalances;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching user's regular SPL token balances (for wrapping)
 */
export function useTokenBalance(): UseTokenBalanceReturn {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [balances, setBalances] = useState<TokenBalances>({
    sol: BigInt(0),
    usdc: BigInt(0),
    solUiAmount: '0',
    usdcUiAmount: '0.00',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      console.log('[useTokenBalance] Fetching SPL token balances for', publicKey.toString());

      // Fetch native SOL balance
      const solBalance = await connection.getBalance(publicKey);
      const solBigInt = BigInt(solBalance);

      // Fetch USDC balance
      let usdcBalance = BigInt(0);
      try {
        const usdcAta = await getAssociatedTokenAddress(USDC_MINT, publicKey);
        const usdcAccount = await getAccount(connection, usdcAta);
        usdcBalance = usdcAccount.amount;
      } catch (err) {
        if (!(err instanceof TokenAccountNotFoundError)) {
          console.warn('[useTokenBalance] Error fetching USDC:', err);
        }
        // USDC account doesn't exist, balance is 0
      }

      const newBalances: TokenBalances = {
        sol: solBigInt,
        usdc: usdcBalance,
        solUiAmount: formatBalance(solBigInt, 9),
        usdcUiAmount: formatBalance(usdcBalance, 6),
      };

      setBalances(newBalances);

      console.log('[useTokenBalance] Balances fetched:');
      console.log('  SOL:', newBalances.solUiAmount);
      console.log('  USDC:', newBalances.usdcUiAmount);
    } catch (err) {
      console.error('[useTokenBalance] Error fetching balances:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, formatBalance]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Refresh every 15 seconds
  useEffect(() => {
    if (!publicKey) return;

    const interval = setInterval(() => {
      refresh();
    }, 15000);

    return () => clearInterval(interval);
  }, [publicKey, refresh]);

  return {
    balances,
    isLoading,
    error,
    refresh,
  };
}
