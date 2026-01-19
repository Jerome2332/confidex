'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';

import { createLogger } from '@/lib/logger';

const log = createLogger('hooks');
import {
  getTransactionsByAddress,
  getProgramTransactions,
  ParsedTransaction,
} from '@/lib/helius-client';

// Program ID for Confidex DEX
const CONFIDEX_PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || '';

// Settlement status for privacy layers
export type SettlementStatus =
  | 'pending'      // Order placed, awaiting match
  | 'mpc_queued'   // MPC computation queued
  | 'mpc_matching' // MPC price comparison in progress
  | 'mpc_matched'  // MPC found a match
  | 'settling'     // Settlement in progress (ShadowWire/C-SPL)
  | 'settled'      // Fully settled
  | 'failed';      // Settlement failed

// Privacy layer used for settlement
export type SettlementLayer = 'shadowwire' | 'cspl' | 'public' | 'unknown';

export interface Trade {
  id: string;
  signature: string;
  side: 'buy' | 'sell';
  pair: string;
  price: number | null; // null if encrypted/unknown
  amount: string; // Encrypted trades show '***'
  timestamp: Date;
  txSignature: string;
  isMine: boolean;
  type: string;
  description: string;
  fee: number;
  status: 'success' | 'failed';
  // Settlement tracking
  settlementStatus?: SettlementStatus;
  settlementLayer?: SettlementLayer;
  mpcRequestId?: string;
  settlementSignature?: string;
}

export interface TradeHistoryState {
  trades: Trade[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  lastSignature: string | null;
}

// Parse a Helius transaction into our Trade format
function parseTransactionToTrade(
  tx: ParsedTransaction,
  userAddress: string | null
): Trade | null {
  try {
    // Check if this is a Confidex transaction
    const isConfidexTx = tx.instructions?.some(
      ix => ix.programId === CONFIDEX_PROGRAM_ID
    );

    // Determine if user is involved
    const isMine = userAddress
      ? tx.feePayer === userAddress ||
        (tx.nativeTransfers?.some(
          t => t.fromUserAccount === userAddress || t.toUserAccount === userAddress
        ) ?? false) ||
        (tx.tokenTransfers?.some(
          t => t.fromUserAccount === userAddress || t.toUserAccount === userAddress
        ) ?? false)
      : false;

    // Determine trade side based on token transfers
    // If user is sending tokens, it's a sell; if receiving, it's a buy
    let side: 'buy' | 'sell' = 'buy';
    if (userAddress && tx.tokenTransfers) {
      const userSending = tx.tokenTransfers.some(
        t => t.fromUserAccount === userAddress
      );
      side = userSending ? 'sell' : 'buy';
    }

    // For non-Confidex trades, try to extract price from description or token transfers
    let price: number | null = null;
    let amount = '***'; // Default to encrypted for Confidex trades

    if (!isConfidexTx && tx.tokenTransfers && tx.tokenTransfers.length > 0) {
      // For regular swaps, show the amount
      const transfer = tx.tokenTransfers[0];
      amount = (transfer.tokenAmount / 1e9).toFixed(4); // Assuming SOL decimals
    }

    // Determine pair from token transfers
    let pair = 'SOL/USDC';
    if (tx.tokenTransfers) {
      // Could parse mints to determine actual pair
      // For now, default to SOL/USDC
    }

    // Determine settlement status from transaction type/description
    let settlementStatus: SettlementStatus = 'pending';
    let settlementLayer: SettlementLayer = 'unknown';

    if (isConfidexTx) {
      // Parse Confidex-specific transaction types
      const desc = tx.description?.toLowerCase() || '';
      if (desc.includes('settle') || desc.includes('fill')) {
        settlementStatus = 'settled';
        settlementLayer = desc.includes('shadowwire') ? 'shadowwire' : 'cspl';
      } else if (desc.includes('match') || desc.includes('mpc')) {
        settlementStatus = 'mpc_matched';
      } else if (desc.includes('order') || desc.includes('place')) {
        settlementStatus = 'pending';
      }
    } else {
      // Non-Confidex trades are public and settled immediately
      settlementStatus = 'settled';
      settlementLayer = 'public';
    }

    return {
      id: tx.signature,
      signature: tx.signature,
      side,
      pair,
      price: isConfidexTx ? null : price, // Price hidden for Confidex trades
      amount: isConfidexTx ? '***' : amount, // Amount hidden for Confidex trades
      timestamp: new Date(tx.timestamp * 1000),
      txSignature: tx.signature,
      isMine,
      type: tx.type || 'UNKNOWN',
      description: tx.description || '',
      fee: tx.fee / 1e9, // Convert lamports to SOL
      status: 'success',
      settlementStatus,
      settlementLayer,
    };
  } catch (error) {
    log.error('Error parsing transaction', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export function useTradeHistory(options: {
  mode: 'user' | 'program' | 'all';
  limit?: number;
  autoRefresh?: boolean;
  refreshInterval?: number;
} = { mode: 'all', limit: 20, autoRefresh: true, refreshInterval: 30000 }) {
  const { publicKey } = useWallet();
  const [state, setState] = useState<TradeHistoryState>({
    trades: [],
    isLoading: true,
    error: null,
    hasMore: true,
    lastSignature: null,
  });

  const mountedRef = useRef(true);
  const fetchingRef = useRef(false);

  // Fetch trades
  const fetchTrades = useCallback(
    async (loadMore = false) => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;

      try {
        if (!loadMore) {
          setState(prev => ({ ...prev, isLoading: true, error: null }));
        }

        let transactions: ParsedTransaction[] = [];
        const userAddress = publicKey?.toBase58() || null;

        const fetchOptions = {
          limit: options.limit || 20,
          before: loadMore ? state.lastSignature || undefined : undefined,
        };

        if (options.mode === 'user' && userAddress) {
          // Fetch user's transactions
          transactions = await getTransactionsByAddress(userAddress, fetchOptions);
        } else if (options.mode === 'program' && CONFIDEX_PROGRAM_ID) {
          // Fetch program transactions
          transactions = await getProgramTransactions(CONFIDEX_PROGRAM_ID, fetchOptions);
        } else {
          // For 'all' mode, fetch program transactions (shows all DEX activity)
          if (CONFIDEX_PROGRAM_ID) {
            transactions = await getProgramTransactions(CONFIDEX_PROGRAM_ID, fetchOptions);
          }
        }

        if (!mountedRef.current) return;

        // Parse transactions into trades
        const newTrades = transactions
          .map(tx => parseTransactionToTrade(tx, userAddress))
          .filter((trade): trade is Trade => trade !== null);

        // Update state
        setState(prev => ({
          ...prev,
          trades: loadMore ? [...prev.trades, ...newTrades] : newTrades,
          isLoading: false,
          hasMore: newTrades.length === (options.limit || 20),
          lastSignature: newTrades.length > 0 ? newTrades[newTrades.length - 1].signature : prev.lastSignature,
        }));

        log.debug('[useTradeHistory] Fetched trades:', { length: newTrades.length });
      } catch (error) {
        log.error('Error fetching trades', { error: error instanceof Error ? error.message : String(error) });
        if (mountedRef.current) {
          setState(prev => ({
            ...prev,
            isLoading: false,
            error: error instanceof Error ? error.message : 'Failed to fetch trades',
          }));
        }
      } finally {
        fetchingRef.current = false;
      }
    },
    [publicKey, options.mode, options.limit, state.lastSignature]
  );

  // Load more trades
  const loadMore = useCallback(() => {
    if (state.hasMore && !state.isLoading) {
      fetchTrades(true);
    }
  }, [fetchTrades, state.hasMore, state.isLoading]);

  // Refresh trades
  const refresh = useCallback(() => {
    setState(prev => ({ ...prev, lastSignature: null }));
    fetchTrades(false);
  }, [fetchTrades]);

  // Initial fetch and auto-refresh
  useEffect(() => {
    mountedRef.current = true;

    // Initial fetch
    fetchTrades(false);

    // Auto-refresh interval
    let intervalId: NodeJS.Timeout | null = null;
    if (options.autoRefresh) {
      intervalId = setInterval(() => {
        fetchTrades(false);
      }, options.refreshInterval || 30000);
    }

    return () => {
      mountedRef.current = false;
      if (intervalId) clearInterval(intervalId);
    };
  }, [options.mode, publicKey?.toBase58()]);

  // Filter helpers
  const getUserTrades = useCallback(() => {
    return state.trades.filter(t => t.isMine);
  }, [state.trades]);

  const getBuyTrades = useCallback(() => {
    return state.trades.filter(t => t.side === 'buy');
  }, [state.trades]);

  const getSellTrades = useCallback(() => {
    return state.trades.filter(t => t.side === 'sell');
  }, [state.trades]);

  return {
    ...state,
    refresh,
    loadMore,
    getUserTrades,
    getBuyTrades,
    getSellTrades,
  };
}

// Simpler hook for just fetching user's trade history
export function useUserTrades() {
  return useTradeHistory({ mode: 'user', limit: 20 });
}

// Hook for program-wide trade history
export function useProgramTrades() {
  return useTradeHistory({ mode: 'program', limit: 20 });
}
