'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useWallet, useConnection, useAnchorWallet } from '@solana/wallet-adapter-react';
import { AnchorProvider } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';

import { createLogger } from '@/lib/logger';

const log = createLogger('hooks');
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
  initializeSDK,
} from '@/lib/pnp';
import {
  categorizeMarket,
  type MarketCategory,
  type SortOption,
} from '@/lib/market-categories';

interface UsePredictionsReturn {
  // Markets
  markets: PredictionMarket[];
  filteredMarkets: PredictionMarket[];
  selectedMarket: PredictionMarket | null;
  isLoadingMarkets: boolean;
  isSearching: boolean;

  // Filtering & Sorting
  categoryFilter: MarketCategory | 'all';
  setCategoryFilter: (category: MarketCategory | 'all') => void;
  sortBy: SortOption;
  setSortBy: (sort: SortOption) => void;

  // User positions
  positions: MarketPosition[];
  isLoadingPositions: boolean;

  // Actions
  selectMarket: (marketId: PublicKey) => Promise<void>;
  fetchMarketById: (marketId: string) => Promise<PredictionMarket | null>;
  refreshMarkets: () => Promise<void>;
  searchMarkets: (query: string) => Promise<void>;

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

  // Market creation
  createNewMarket: (
    question: string,
    endTime: Date,
    initialLiquidity: number
  ) => Promise<PredictionMarket>;
  isCreatingMarket: boolean;

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
  const anchorWallet = useAnchorWallet();

  // Create AnchorProvider when wallet is available (for SDK compatibility)
  const provider = useMemo(() => {
    if (!anchorWallet) return null;
    return new AnchorProvider(connection, anchorWallet, {
      preflightCommitment: 'confirmed',
    });
  }, [connection, anchorWallet]);

  const [markets, setMarkets] = useState<PredictionMarket[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<PredictionMarket | null>(null);
  const [positions, setPositions] = useState<MarketPosition[]>([]);
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(false);
  const [isLoadingPositions, setIsLoadingPositions] = useState(false);
  const [isTransacting, setIsTransacting] = useState(false);
  const [isCreatingMarket, setIsCreatingMarket] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  // Filtering & Sorting state
  const [categoryFilter, setCategoryFilter] = useState<MarketCategory | 'all'>('all');
  const [sortBy, setSortBy] = useState<SortOption>('ending-soon');

  // Filtered and sorted markets
  const filteredMarkets = useMemo(() => {
    let result = [...markets];

    // Apply category filter
    if (categoryFilter !== 'all') {
      result = result.filter((market) => categorizeMarket(market.question) === categoryFilter);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'ending-soon':
          return a.endTime.getTime() - b.endTime.getTime();
        case 'newest':
          // Assuming markets without creation date, sort by end time descending as proxy
          return b.endTime.getTime() - a.endTime.getTime();
        case 'alphabetical':
          return a.question.localeCompare(b.question);
        default:
          return 0;
      }
    });

    return result;
  }, [markets, categoryFilter, sortBy]);

  // Fetch active markets (optionally with search)
  const refreshMarkets = useCallback(async (search?: string) => {
    if (search) {
      setIsSearching(true);
    } else {
      setIsLoadingMarkets(true);
    }
    setLastError(null);

    try {
      const activeMarkets = await fetchActiveMarkets(connection, 50, search);
      setMarkets(activeMarkets);
    } catch (error) {
      log.error('Failed to fetch markets:', { error: error instanceof Error ? error.message : String(error) });
      setLastError('Failed to load markets');
    } finally {
      setIsLoadingMarkets(false);
      setIsSearching(false);
    }
  }, [connection]);

  // Search markets by query
  const searchMarkets = useCallback(async (query: string) => {
    await refreshMarkets(query || undefined);
  }, [refreshMarkets]);

  // Fetch user positions
  const refreshPositions = useCallback(async () => {
    if (!publicKey) return;

    setIsLoadingPositions(true);

    try {
      const userPositions = await getUserPositions(connection, publicKey);
      setPositions(userPositions);
    } catch (error) {
      log.error('Failed to fetch positions:', { error: error instanceof Error ? error.message : String(error) });
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
      log.error('Failed to fetch market:', { error: error instanceof Error ? error.message : String(error) });
      setLastError('Failed to load market details');
    } finally {
      setIsLoadingMarkets(false);
    }
  }, [connection]);

  // Fetch a market by ID string (for detail pages)
  const fetchMarketById = useCallback(async (marketId: string): Promise<PredictionMarket | null> => {
    try {
      const pubkey = new PublicKey(marketId);
      const market = await fetchMarket(connection, pubkey);
      return market;
    } catch (error) {
      log.error('Failed to fetch market by ID:', { error: error instanceof Error ? error.message : String(error) });
      return null;
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

  // Create a new market
  const createNewMarket = useCallback(async (
    question: string,
    endTime: Date,
    initialLiquidity: number
  ): Promise<PredictionMarket> => {
    setIsCreatingMarket(true);
    setLastError(null);

    try {
      const market = await createMarket(question, endTime, initialLiquidity);

      // Refresh markets to include the new one
      await refreshMarkets();

      return market;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create market';
      setLastError(message);
      throw error;
    } finally {
      setIsCreatingMarket(false);
    }
  }, [refreshMarkets]);

  // Initialize SDK and load markets on mount
  useEffect(() => {
    // Pre-load SDK to avoid delay on first transaction
    initializeSDK().then((available) => {
      if (available) {
        log.debug('PNP SDK initialized');
      }
    });
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
    filteredMarkets,
    selectedMarket,
    isLoadingMarkets,
    isSearching,
    categoryFilter,
    setCategoryFilter,
    sortBy,
    setSortBy,
    positions,
    isLoadingPositions,
    selectMarket,
    fetchMarketById,
    refreshMarkets: () => refreshMarkets(),
    searchMarkets,
    buyTokens,
    sellTokens,
    redeem,
    calculateWinnings,
    createNewMarket,
    isCreatingMarket,
    isTransacting,
    lastError,
  };
}
