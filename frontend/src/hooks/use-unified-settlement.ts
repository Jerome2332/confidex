'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  settlementManager,
  type SettlementMethod,
  type SettlementCapabilities,
  type SettlementTransferParams,
  type SettlementTransferResult,
  type SettlementBalance,
  type SettlementToken,
} from '@/lib/settlement';
import { useSettingsStore } from '@/stores/settings-store';

export interface UseUnifiedSettlementReturn {
  /** Whether any provider is ready */
  isReady: boolean;
  /** Whether providers are initializing */
  isInitializing: boolean;
  /** Initialization error if any */
  error: string | null;

  /** Currently active settlement method (from settings) */
  activeMethod: SettlementMethod;
  /** Capabilities of the active provider */
  activeCapabilities: SettlementCapabilities | null;
  /** All available settlement methods */
  availableMethods: SettlementCapabilities[];
  /** All registered methods (including unavailable) */
  allMethods: SettlementCapabilities[];

  /** Execute a transfer */
  transfer: (
    params: Omit<SettlementTransferParams, 'wallet'>
  ) => Promise<SettlementTransferResult>;
  /** Get balance for a token */
  getBalance: (token: SettlementToken) => Promise<SettlementBalance | null>;

  /** Current provider's fee in basis points */
  currentFeeBps: number;
  /** Calculate fee for a given amount */
  estimatedFee: (amount: number) => number;
  /** Human-readable status message */
  statusMessage: string;
}

/**
 * Unified hook for settlement operations
 * Automatically routes to the correct provider based on settings
 */
export function useUnifiedSettlement(): UseUnifiedSettlementReturn {
  const { publicKey, signMessage } = useWallet();
  const { settlementMethod, setSettlementMethod } = useSettingsStore();

  const [isReady, setIsReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize providers on mount
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (isReady || isInitializing) return;

      setIsInitializing(true);
      setError(null);

      try {
        // Initialize based on selected method
        await settlementManager.initializeProvider(settlementMethod);

        if (!cancelled) {
          setIsReady(settlementManager.isAnyProviderReady());
          console.log('[useUnifiedSettlement] Initialization complete');
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof Error ? err.message : 'Failed to initialize settlement';
          setError(message);
          console.error('[useUnifiedSettlement] Initialization error:', err);
        }
      } finally {
        if (!cancelled) {
          setIsInitializing(false);
        }
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [settlementMethod]);

  // Get all registered methods
  const allMethods = useMemo(() => {
    return settlementManager.getAllCapabilities();
  }, []);

  // Get available methods
  const availableMethods = useMemo(() => {
    return settlementManager.getAvailableCapabilities();
  }, []);

  // Get active provider capabilities
  const activeCapabilities = useMemo(() => {
    const provider = settlementManager.getProvider(settlementMethod);
    return provider?.capabilities ?? null;
  }, [settlementMethod]);

  // Current fee
  const currentFeeBps = useMemo(() => {
    return settlementManager.getFeeBps(settlementMethod);
  }, [settlementMethod]);

  // Calculate estimated fee
  const estimatedFee = useCallback(
    (amount: number) => {
      return settlementManager.calculateFee(amount, settlementMethod);
    },
    [settlementMethod]
  );

  // Status message
  const statusMessage = useMemo(() => {
    const status = settlementManager.getStatus(settlementMethod);
    return status.message;
  }, [settlementMethod, isReady, isInitializing]);

  // Execute transfer
  const transfer = useCallback(
    async (
      params: Omit<SettlementTransferParams, 'wallet'>
    ): Promise<SettlementTransferResult> => {
      if (!signMessage) {
        throw new Error('Wallet not connected');
      }

      const provider = settlementManager.getProvider(settlementMethod);

      if (!provider?.isReady()) {
        // Try fallback to auto
        const fallback = settlementManager.getProvider('auto');
        if (fallback?.isReady()) {
          console.log('[useUnifiedSettlement] Falling back to auto provider');
          return fallback.transfer({
            ...params,
            wallet: { signMessage },
          });
        }
        throw new Error('No settlement provider available');
      }

      console.log('[useUnifiedSettlement] Executing transfer via', provider.capabilities.name);

      return provider.transfer({
        ...params,
        wallet: { signMessage },
      });
    },
    [settlementMethod, signMessage]
  );

  // Get balance
  const getBalance = useCallback(
    async (token: SettlementToken): Promise<SettlementBalance | null> => {
      if (!publicKey) {
        return null;
      }

      const provider = settlementManager.getProvider(settlementMethod);

      if (!provider?.isReady()) {
        const fallback = settlementManager.getProvider('auto');
        if (fallback?.isReady()) {
          return fallback.getBalance(publicKey.toBase58(), token);
        }
        return null;
      }

      return provider.getBalance(publicKey.toBase58(), token);
    },
    [settlementMethod, publicKey]
  );

  return {
    isReady,
    isInitializing,
    error,
    activeMethod: settlementMethod,
    activeCapabilities,
    availableMethods,
    allMethods,
    transfer,
    getBalance,
    currentFeeBps,
    estimatedFee,
    statusMessage,
  };
}

/**
 * Hook for settlement method selection (for settings UI)
 */
export function useSettlementSelector() {
  const { settlementMethod, setSettlementMethod, showSettlementFees, setShowSettlementFees } =
    useSettingsStore();

  const allMethods = useMemo(() => {
    return settlementManager.getAllCapabilities();
  }, []);

  const getMethodStatus = useCallback((method: SettlementMethod) => {
    return settlementManager.getStatus(method);
  }, []);

  return {
    currentMethod: settlementMethod,
    setMethod: setSettlementMethod,
    showFees: showSettlementFees,
    setShowFees: setShowSettlementFees,
    allMethods,
    getMethodStatus,
  };
}
