'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

import { createLogger } from '@/lib/logger';
import {
  fetchOpenPositions,
  fetchUserPositions,
  ConfidentialPositionAccount,
  PositionStatusEnum,
  PositionSide as OnChainPositionSide,
  positionIdToString,
} from '@/lib/confidex-client';
import { usePerpetualStore, PerpPosition, PositionSide, PositionStatus } from '@/stores/perpetuals-store';
import { SOL_PERP_MARKET_PDA } from '@/lib/constants';

const log = createLogger('positions');

/**
 * Map on-chain position status to store status
 */
function mapPositionStatus(status: PositionStatusEnum): PositionStatus {
  switch (status) {
    case PositionStatusEnum.Open:
      return 'open';
    case PositionStatusEnum.Closed:
      return 'closed';
    case PositionStatusEnum.Liquidated:
      return 'liquidated';
    case PositionStatusEnum.AutoDeleveraged:
      return 'auto_deleveraged';
    case PositionStatusEnum.PendingLiquidationCheck:
      return 'open'; // Treat pending liquidation as open for UI purposes
    default:
      return 'open';
  }
}

/**
 * Map on-chain position side to store side
 */
function mapPositionSide(side: OnChainPositionSide): PositionSide {
  return side === OnChainPositionSide.Long ? 'long' : 'short';
}

/**
 * Convert on-chain ConfidentialPositionAccount to store PerpPosition
 */
function toStorePerpPosition(
  pda: PublicKey,
  position: ConfidentialPositionAccount
): PerpPosition {
  return {
    id: pda.toString(),
    positionId: positionIdToString(position.positionId),
    market: position.market,
    marketSymbol: 'SOL-PERP', // TODO: Lookup from market registry
    trader: position.trader,
    side: mapPositionSide(position.side),
    leverage: position.leverage,
    encryptedSize: position.encryptedSize,
    encryptedEntryPrice: position.encryptedEntryPrice,
    encryptedCollateral: position.encryptedCollateral,
    encryptedRealizedPnl: position.encryptedRealizedPnl,
    encryptedLiqBelow: position.encryptedLiqBelow,
    encryptedLiqAbove: position.encryptedLiqAbove,
    riskLevel: 'unknown', // Will be updated by MPC batch check
    thresholdVerified: position.thresholdVerified,
    entryCumulativeFunding: position.entryCumulativeFunding,
    pendingFunding: BigInt(0), // Calculated separately
    status: mapPositionStatus(position.status),
    createdAt: new Date(Number(position.createdAtHour) * 1000),
    lastUpdated: new Date(Number(position.lastUpdatedHour) * 1000),
    partialCloseCount: position.partialCloseCount,
    autoDeleveragePriority: Number(position.autoDeleveragePriority),
  };
}

export interface UsePositionsReturn {
  positions: PerpPosition[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  positionCount: number;
  openPositionCount: number;
}

/**
 * Hook for fetching and syncing user's perpetual positions from on-chain
 * Automatically populates the perpetuals store when positions are fetched
 */
export function usePositions(): UsePositionsReturn {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { positions, setPositions } = usePerpetualStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch positions from on-chain and update store
   */
  const refresh = useCallback(async () => {
    if (!publicKey) {
      setPositions([]);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      log.debug('Fetching positions for', { trader: publicKey.toString() });

      // Fetch all positions (including closed for history)
      const onChainPositions = await fetchUserPositions(connection, publicKey);

      log.debug('Fetched positions from chain:', { count: onChainPositions.length });

      // Convert to store format
      const storePositions = onChainPositions.map(({ pda, position }) =>
        toStorePerpPosition(pda, position)
      );

      // Filter to only open positions for the main positions array
      const openPositions = storePositions.filter(p => p.status === 'open');

      log.debug('Open positions:', { count: openPositions.length });

      // Update store
      setPositions(openPositions);

      // Log details for debugging
      for (const pos of openPositions) {
        log.debug('Position:', {
          id: pos.id.slice(0, 8) + '...',
          positionId: pos.positionId.slice(0, 8) + '...',
          side: pos.side,
          leverage: pos.leverage,
          status: pos.status,
          verified: pos.thresholdVerified,
        });
      }
    } catch (err) {
      log.error('Error fetching positions', {
        error: err instanceof Error ? err.message : String(err),
      });
      setError(err instanceof Error ? err.message : 'Failed to fetch positions');
    } finally {
      setIsLoading(false);
    }
  }, [publicKey, connection, setPositions]);

  // Fetch positions on mount and when wallet changes
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Set up polling for position updates (every 30 seconds)
  useEffect(() => {
    if (!publicKey) return;

    const interval = setInterval(() => {
      refresh();
    }, 30000);

    return () => clearInterval(interval);
  }, [publicKey, refresh]);

  // Calculate derived values
  const openPositionCount = positions.filter(p => p.status === 'open').length;

  return {
    positions,
    isLoading,
    error,
    refresh,
    positionCount: positions.length,
    openPositionCount,
  };
}

/**
 * Hook for fetching positions for a specific market
 */
export function useMarketPositions(marketPda?: PublicKey): {
  positions: PerpPosition[];
  isLoading: boolean;
} {
  const { positions, isLoading } = usePositions();

  const marketPositions = marketPda
    ? positions.filter(p => p.market.equals(marketPda))
    : positions;

  return {
    positions: marketPositions,
    isLoading,
  };
}

/**
 * Hook for getting a single position by PDA
 */
export function usePosition(positionPda?: string): {
  position: PerpPosition | null;
  isLoading: boolean;
} {
  const { positions, isLoading } = usePositions();

  const position = positionPda
    ? positions.find(p => p.id === positionPda) || null
    : null;

  return {
    position,
    isLoading,
  };
}
