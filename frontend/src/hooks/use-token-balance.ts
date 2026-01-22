'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, TokenAccountNotFoundError } from '@solana/spl-token';
import { TRADING_PAIRS, LIGHT_PROTOCOL_ENABLED } from '@/lib/constants';
import { getCompressedBalance, isLightProtocolAvailable } from '@/lib/confidex-client';

import { createLogger } from '@/lib/logger';

const log = createLogger('balance');

// Native SOL mint (not wrapped SOL)
const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey(TRADING_PAIRS[0].quoteMint);

export interface TokenBalances {
  sol: bigint;
  usdc: bigint;
  solUiAmount: string;
  usdcUiAmount: string;
  // Light Protocol compressed balances
  solCompressed: bigint;
  usdcCompressed: bigint;
  solCompressedUiAmount: string;
  usdcCompressedUiAmount: string;
  // Totals (regular + compressed)
  solTotal: bigint;
  usdcTotal: bigint;
  solTotalUiAmount: string;
  usdcTotalUiAmount: string;
  // Compression status
  hasCompressedBalances: boolean;
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
const EMPTY_BALANCES: TokenBalances = {
  sol: BigInt(0),
  usdc: BigInt(0),
  solUiAmount: '0',
  usdcUiAmount: '0.00',
  solCompressed: BigInt(0),
  usdcCompressed: BigInt(0),
  solCompressedUiAmount: '0',
  usdcCompressedUiAmount: '0.00',
  solTotal: BigInt(0),
  usdcTotal: BigInt(0),
  solTotalUiAmount: '0',
  usdcTotalUiAmount: '0.00',
  hasCompressedBalances: false,
};

export function useTokenBalance(): UseTokenBalanceReturn {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [balances, setBalances] = useState<TokenBalances>(EMPTY_BALANCES);
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
      setBalances(EMPTY_BALANCES);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      log.debug('Fetching SPL token balances for', { wallet: publicKey.toString() });

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
          log.warn('Error fetching USDC:', { err });
        }
        // USDC account doesn't exist, balance is 0
      }

      // Fetch Light Protocol compressed balances (if enabled)
      let solCompressed = BigInt(0);
      let usdcCompressed = BigInt(0);

      if (LIGHT_PROTOCOL_ENABLED && isLightProtocolAvailable()) {
        try {
          log.debug('Fetching Light Protocol compressed balances...');

          // Fetch compressed SOL (WSOL) balance
          solCompressed = await getCompressedBalance(publicKey, NATIVE_SOL_MINT);

          // Fetch compressed USDC balance
          usdcCompressed = await getCompressedBalance(publicKey, USDC_MINT);

          log.debug('Compressed balances fetched', {
            solCompressed: solCompressed.toString(),
            usdcCompressed: usdcCompressed.toString(),
          });
        } catch (err) {
          log.warn('Error fetching compressed balances', {
            error: err instanceof Error ? err.message : String(err),
          });
          // Continue with zero compressed balances
        }
      }

      // Calculate totals
      const solTotal = solBigInt + solCompressed;
      const usdcTotal = usdcBalance + usdcCompressed;
      const hasCompressedBalances = solCompressed > BigInt(0) || usdcCompressed > BigInt(0);

      const newBalances: TokenBalances = {
        // Regular balances
        sol: solBigInt,
        usdc: usdcBalance,
        solUiAmount: formatBalance(solBigInt, 9),
        usdcUiAmount: formatBalance(usdcBalance, 6),
        // Compressed balances
        solCompressed,
        usdcCompressed,
        solCompressedUiAmount: formatBalance(solCompressed, 9),
        usdcCompressedUiAmount: formatBalance(usdcCompressed, 6),
        // Totals
        solTotal,
        usdcTotal,
        solTotalUiAmount: formatBalance(solTotal, 9),
        usdcTotalUiAmount: formatBalance(usdcTotal, 6),
        // Status
        hasCompressedBalances,
      };

      setBalances(newBalances);

      log.debug('Balances fetched:', {
        sol: newBalances.solUiAmount,
        usdc: newBalances.usdcUiAmount,
        solCompressed: newBalances.solCompressedUiAmount,
        usdcCompressed: newBalances.usdcCompressedUiAmount,
        hasCompressed: hasCompressedBalances,
      });
    } catch (err) {
      log.error('Error fetching balances', { error: err instanceof Error ? err.message : String(err) });
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
