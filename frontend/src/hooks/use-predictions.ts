'use client';

import { useState, useCallback, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import {
  PredictionMarket,
  MarketPosition,
  fetchActiveMarkets,
  fetchMarket,
  getUserPositions,
  buyOutcomeTokens,
  sellOutcomeTokens,
  redeemWinnings,
  calculatePotentialWinnings,
  createMarket,
} from '@/lib/pnp';

interface UsePredictionsReturn {
  // Markets
  markets: PredictionMarket[];
  selectedMarket: PredictionMarket | null;
  isLoadingMarkets: boolean;

  // User positions
  positions: MarketPosition[];
  isLoadingPositions: boolean;

  // Actions
  selectMarket: (marketId: PublicKey) => Promise<void>;
  refreshMarkets: () => Promise<void>;

  // Trading
  buyTokens: (
    outcome: 'YES' | 'NO',
    amount: number,
    maxPrice: number
  ) => Promise<{ signature: string; tokensReceived: bigint }>;
  sellTokens: (
    outcome: 'YES' | 'NO',
    tokenAmount: bigint,
    minPrice: number
  ) => Promise<{ signature: string; usdcReceived: number }>;
  redeem: () => Promise<{ signature: string; amount: number }>;

  // Helpers
  calculateWinnings: (amount: number, outcome: 'YES' | 'NO') => number;

  // Transaction state
  isTransacting: boolean;
  lastError: string | null;
}

/**
 * Hook for interacting with PNP prediction markets
 */
export function usePredictions(): UsePredictionsReturn {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction } = useWallet();

  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<PredictionMarket | null>(null);
  const [positions, setPositions] = useState<MarketPosition[]>([]);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [isTransacting, setIsTransacting] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Fetch active markets
  const refreshMarkets = useCallback(async () => {
    setIsLoadingMarkets(true);
    setLastError(null);

    try {
      const activeMarkets = await fetchActiveMarkets(connection, 20);
      setMarkets(activeMarkets);
    } catch (error) {
      console.error('Failed to fetch markets:', error);
      setLastError('Failed to load markets');
    } finally {
      setIsLoadingMarkets(false);
    }
  }, [connection]);

  // Fetch user positions
  const refreshPositions = useCallback(async () => {
    if (!publicKey) return;

    setIsLoadingPositions(true);

    try {
      const userPositions = await getUserPositions(connection, publicKey);
      setPositions(userPositions);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    } finally {
      setIsLoadingPositions(false);
    }
  }, [connection, publicKey]);

  // Select a market
  const selectMarket = useCallback(async (marketId: PublicKey) => {
    setIsLoadingMarkets(true);
    setLastError(null);

    try {
      const market = await fetchMarket(connection, marketId);
      setSelectedMarket(market);
    } catch (error) {
      console.error('Failed to fetch market:', error);
      setLastError('Failed to load market details');
    } finally {
      setIsLoadingMarkets(false);
    }
  }, [connection]);

  // Buy outcome tokens
  const buyTokens = useCallback(async (
    outcome: 'YES' | 'NO',
    amount: number,
    maxPrice: number
  ) => {
    if (!publicKey || !signTransaction || !selectedMarket) {
      throw new Error('Wallet not connected or no market selected');
    }

    setIsTransacting(true);
    setLastError(null);

    try {
      const result = await buyOutcomeTokens(
        connection,
        selectedMarket.id,
        outcome,
        amount,
        maxPrice,
        { publicKey, signTransaction, sendTransaction }
      );

      // Refresh market and positions
      await Promise.all([
        selectMarket(selectedMarket.id),
        refreshPositions(),
      ]);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      setLastError(message);
      throw error;
    } finally {
      setIsTransacting(false);
    }
  }, [connection, publicKey, signTransaction, sendTransaction, selectedMarket, selectMarket, refreshPositions]);

  // Sell outcome tokens
  const sellTokens = useCallback(async (
    outcome: 'YES' | 'NO',
    tokenAmount: bigint,
    minPrice: number
  ) => {
    if (!publicKey || !signTransaction || !selectedMarket) {
      throw new Error('Wallet not connected or no market selected');
    }

    setIsTransacting(true);
    setLastError(null);

    try {
      const result = await sellOutcomeTokens(
        connection,
        selectedMarket.id,
        outcome,
        tokenAmount,
        minPrice,
        { publicKey, signTransaction, sendTransaction }
      );

      // Refresh market and positions
      await Promise.all([
        selectMarket(selectedMarket.id),
        refreshPositions(),
      ]);

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transaction failed';
      setLastError(message);
      throw error;
    } finally {
      setIsTransacting(false);
    }
  }, [connection, publicKey, signTransaction, sendTransaction, selectedMarket, selectMarket, refreshPositions]);

  // Redeem winnings
  const redeem = useCallback(async () => {
    if (!publicKey || !signTransaction || !selectedMarket) {
      throw new Error('Wallet not connected or no market selected');
    }

    if (!selectedMarket.resolved) {
      throw new Error('Market not yet resolved');
    }

    setIsTransacting(true);
    setLastError(null);

    try {
      const result = await redeemWinnings(
        connection,
        selectedMarket.id,
        { publicKey, signTransaction, sendTransaction }
      );

      await refreshPositions();

      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Redemption failed';
      setLastError(message);
      throw error;
    } finally {
      setIsTransacting(false);
    }
  }, [connection, publicKey, signTransaction, sendTransaction, selectedMarket, refreshPositions]);

  // Calculate potential winnings helper
  const calculateWinnings = useCallback((amount: number, outcome: 'YES' | 'NO') => {
    if (!selectedMarket) return 0;

    const price = outcome === 'YES'
      ? selectedMarket.yesToken.price
      : selectedMarket.noToken.price;

    return calculatePotentialWinnings(amount, price);
  }, [selectedMarket]);

  // Load markets on mount
  useEffect(() => {
    refreshMarkets();
  }, [refreshMarkets]);

  // Load positions when wallet connects
  useEffect(() => {
    if (publicKey) {
      refreshPositions();
    } else {
      setPositions([]);
    }
  }, [publicKey, refreshPositions]);

  return {
    markets,
    selectedMarket,
    isLoadingMarkets,
    positions,
    isLoadingPositions,
    selectMarket,
    refreshMarkets,
    buyTokens,
    sellTokens,
    redeem,
    calculateWinnings,
    isTransacting,
    lastError,
  };
}
