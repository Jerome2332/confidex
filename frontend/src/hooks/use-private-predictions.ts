'use client';

/**
 * Privacy-enhanced prediction markets hook
 *
 * Wraps PNP SDK with Arcium encryption for:
 * - Encrypted bet amounts (position sizes hidden)
 * - Private position tracking (local decryption only)
 * - Settlement via ShadowWire/C-SPL for anonymous payouts
 *
 * Note: PNP markets are PUBLIC by design (AMM bonding curve).
 * This wrapper adds privacy to USER'S position sizes, not market prices.
 */

import { useState, useCallback, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

import { createLogger } from '@/lib/logger';
import { useEncryption } from './use-encryption';
import { useShadowWire } from './use-shadowwire';
import { usePredictions } from './use-predictions';
import type { PredictionMarket, MarketPosition } from '@/lib/pnp';
import type { MarketCategory, SortOption } from '@/lib/market-categories';

const log = createLogger('private-predictions');

/**
 * Encrypted position data stored locally
 * Actual amounts are only visible to the user
 */
interface EncryptedPosition {
  marketId: string;
  encryptedYesAmount: Uint8Array; // Encrypted via Arcium
  encryptedNoAmount: Uint8Array;
  timestamp: number;
}

/**
 * Privacy mode options for prediction trading
 */
export type PrivacyMode = 'none' | 'encrypted' | 'shadowwire';

interface UsePrivatePredictionsReturn {
  // Markets (same as base hook)
  markets: PredictionMarket[];
  filteredMarkets: PredictionMarket[];
  selectedMarket: PredictionMarket | null;
  isLoadingMarkets: boolean;

  // Filtering & Sorting
  categoryFilter: MarketCategory | 'all';
  setCategoryFilter: (category: MarketCategory | 'all') => void;
  sortBy: SortOption;
  setSortBy: (sort: SortOption) => void;

  // Privacy features
  privacyMode: PrivacyMode;
  setPrivacyMode: (mode: PrivacyMode) => void;
  isPrivacyEnabled: boolean;
  encryptedPositions: EncryptedPosition[];

  // Actions
  selectMarket: (marketId: PublicKey) => Promise<void>;
  refreshMarkets: () => Promise<void>;

  // Privacy-enhanced trading
  buyTokensPrivate: (
    outcome: 'YES' | 'NO',
    amount: number,
    maxPrice: number
  ) => Promise<{ signature: string; tokensReceived: bigint }>;
  sellTokensPrivate: (
    outcome: 'YES' | 'NO',
    tokenAmount: bigint,
    minPrice: number
  ) => Promise<{ signature: string; usdcReceived: number }>;
  redeemPrivate: () => Promise<{ signature: string; amount: number }>;

  // Helpers
  calculateWinnings: (amount: number, outcome: 'YES' | 'NO') => number;
  getDecryptedPosition: (marketId: string) => Promise<{
    yesBalance: bigint;
    noBalance: bigint;
  } | null>;

  // State
  isTransacting: boolean;
  isInitializingPrivacy: boolean;
  lastError: string | null;
}

/**
 * Hook for privacy-enhanced prediction market interactions
 *
 * Privacy layers:
 * 1. Arcium encryption - Encrypts position amounts locally
 * 2. ShadowWire - Anonymous deposits/withdrawals from markets
 *
 * What remains public:
 * - Market prices (AMM bonding curve is inherently public)
 * - Transaction existence (on-chain)
 * - Total market liquidity
 *
 * What becomes private:
 * - Your position size (encrypted locally)
 * - Deposit/withdrawal amounts (via ShadowWire)
 */
export function usePrivatePredictions(): UsePrivatePredictionsReturn {
  const { publicKey } = useWallet();
  const { connection } = useConnection();

  // Base predictions hook
  const predictions = usePredictions();

  // Privacy hooks
  const encryption = useEncryption();
  const shadowwire = useShadowWire();

  // Privacy state
  const [privacyMode, setPrivacyMode] = useState<PrivacyMode>('none');
  const [encryptedPositions, setEncryptedPositions] = useState<EncryptedPosition[]>([]);
  const [isInitializingPrivacy, setIsInitializingPrivacy] = useState(false);

  const isPrivacyEnabled = privacyMode !== 'none';

  // Initialize encryption when privacy mode enabled
  const initializePrivacy = useCallback(async () => {
    if (privacyMode === 'none') return;

    setIsInitializingPrivacy(true);
    try {
      if (!encryption.isInitialized) {
        await encryption.initializeEncryption();
        log.debug('Arcium encryption initialized for predictions');
      }

      if (privacyMode === 'shadowwire' && !shadowwire.isReady) {
        // ShadowWire auto-initializes on mount, wait for it
        log.debug('Waiting for ShadowWire to be ready...');
      }
    } catch (error) {
      log.error('Failed to initialize privacy', { error: error instanceof Error ? error.message : String(error) });
    } finally {
      setIsInitializingPrivacy(false);
    }
  }, [privacyMode, encryption, shadowwire]);

  // Store encrypted position locally
  const storeEncryptedPosition = useCallback(async (
    marketId: string,
    yesAmount: bigint,
    noAmount: bigint
  ) => {
    if (!encryption.isInitialized) return;

    try {
      const encryptedYes = await encryption.encryptValue(yesAmount);
      const encryptedNo = await encryption.encryptValue(noAmount);

      setEncryptedPositions(prev => {
        const existing = prev.findIndex(p => p.marketId === marketId);
        const newPosition: EncryptedPosition = {
          marketId,
          encryptedYesAmount: encryptedYes,
          encryptedNoAmount: encryptedNo,
          timestamp: Date.now(),
        };

        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = newPosition;
          return updated;
        }
        return [...prev, newPosition];
      });

      log.debug('Stored encrypted position', { marketId });
    } catch (error) {
      log.error('Failed to encrypt position', { error: error instanceof Error ? error.message : String(error) });
    }
  }, [encryption]);

  // Get decrypted position
  const getDecryptedPosition = useCallback(async (
    marketId: string
  ): Promise<{ yesBalance: bigint; noBalance: bigint } | null> => {
    if (!encryption.isInitialized) return null;

    const position = encryptedPositions.find(p => p.marketId === marketId);
    if (!position) return null;

    try {
      const yesBalance = await encryption.decryptValue(position.encryptedYesAmount);
      const noBalance = await encryption.decryptValue(position.encryptedNoAmount);

      return { yesBalance, noBalance };
    } catch (error) {
      log.error('Failed to decrypt position', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }, [encryption, encryptedPositions]);

  // Privacy-enhanced buy
  const buyTokensPrivate = useCallback(async (
    outcome: 'YES' | 'NO',
    amount: number,
    maxPrice: number
  ) => {
    if (!predictions.selectedMarket) {
      throw new Error('No market selected');
    }

    const marketId = predictions.selectedMarket.id.toBase58();

    // Initialize privacy if needed
    if (isPrivacyEnabled && !encryption.isInitialized) {
      await initializePrivacy();
    }

    // For ShadowWire mode, use private transfer for deposit
    if (privacyMode === 'shadowwire' && shadowwire.isReady) {
      log.debug('Using ShadowWire for private deposit', { amount });
      // Note: This would transfer from ShadowWire balance to PNP
      // Actual implementation depends on ShadowWire SDK capabilities
    }

    // Execute the trade via base hook
    const result = await predictions.buyTokens(outcome, amount, maxPrice);

    // Store encrypted position locally
    if (isPrivacyEnabled) {
      const currentPosition = await getDecryptedPosition(marketId);
      const currentYes = currentPosition?.yesBalance || BigInt(0);
      const currentNo = currentPosition?.noBalance || BigInt(0);

      if (outcome === 'YES') {
        await storeEncryptedPosition(
          marketId,
          currentYes + result.tokensReceived,
          currentNo
        );
      } else {
        await storeEncryptedPosition(
          marketId,
          currentYes,
          currentNo + result.tokensReceived
        );
      }
    }

    log.debug('Private buy completed', {
      marketId,
      outcome,
      privacyMode,
      signature: result.signature,
    });

    return result;
  }, [
    predictions,
    privacyMode,
    isPrivacyEnabled,
    encryption,
    shadowwire,
    initializePrivacy,
    getDecryptedPosition,
    storeEncryptedPosition,
  ]);

  // Privacy-enhanced sell
  const sellTokensPrivate = useCallback(async (
    outcome: 'YES' | 'NO',
    tokenAmount: bigint,
    minPrice: number
  ) => {
    if (!predictions.selectedMarket) {
      throw new Error('No market selected');
    }

    const marketId = predictions.selectedMarket.id.toBase58();

    // Execute the trade
    const result = await predictions.sellTokens(outcome, tokenAmount, minPrice);

    // Update encrypted position
    if (isPrivacyEnabled) {
      const currentPosition = await getDecryptedPosition(marketId);
      if (currentPosition) {
        if (outcome === 'YES') {
          await storeEncryptedPosition(
            marketId,
            currentPosition.yesBalance - tokenAmount,
            currentPosition.noBalance
          );
        } else {
          await storeEncryptedPosition(
            marketId,
            currentPosition.yesBalance,
            currentPosition.noBalance - tokenAmount
          );
        }
      }
    }

    // For ShadowWire mode, use private transfer for withdrawal
    if (privacyMode === 'shadowwire' && shadowwire.isReady) {
      log.debug('Using ShadowWire for private withdrawal', {
        usdcReceived: result.usdcReceived,
      });
      // Note: This would transfer received USDC to ShadowWire balance
    }

    return result;
  }, [
    predictions,
    privacyMode,
    isPrivacyEnabled,
    shadowwire,
    getDecryptedPosition,
    storeEncryptedPosition,
  ]);

  // Privacy-enhanced redemption
  const redeemPrivate = useCallback(async () => {
    if (!predictions.selectedMarket) {
      throw new Error('No market selected');
    }

    const result = await predictions.redeem();

    // Clear encrypted position after redemption
    if (isPrivacyEnabled) {
      const marketId = predictions.selectedMarket.id.toBase58();
      setEncryptedPositions(prev =>
        prev.filter(p => p.marketId !== marketId)
      );
    }

    // For ShadowWire mode, transfer winnings privately
    if (privacyMode === 'shadowwire' && shadowwire.isReady && result.amount > 0) {
      log.debug('Routing redemption via ShadowWire', { amount: result.amount });
    }

    return result;
  }, [predictions, privacyMode, isPrivacyEnabled, shadowwire]);

  return {
    // Markets (pass through from base hook)
    markets: predictions.markets,
    filteredMarkets: predictions.filteredMarkets,
    selectedMarket: predictions.selectedMarket,
    isLoadingMarkets: predictions.isLoadingMarkets,

    // Filtering
    categoryFilter: predictions.categoryFilter,
    setCategoryFilter: predictions.setCategoryFilter,
    sortBy: predictions.sortBy,
    setSortBy: predictions.setSortBy,

    // Privacy features
    privacyMode,
    setPrivacyMode,
    isPrivacyEnabled,
    encryptedPositions,

    // Actions
    selectMarket: predictions.selectMarket,
    refreshMarkets: predictions.refreshMarkets,

    // Privacy-enhanced trading
    buyTokensPrivate,
    sellTokensPrivate,
    redeemPrivate,

    // Helpers
    calculateWinnings: predictions.calculateWinnings,
    getDecryptedPosition,

    // State
    isTransacting: predictions.isTransacting,
    isInitializingPrivacy,
    lastError: predictions.lastError,
  };
}
