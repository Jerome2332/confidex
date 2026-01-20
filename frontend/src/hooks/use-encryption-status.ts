'use client';

/**
 * Encryption Status Hook
 *
 * Provides a lightweight status view of the encryption system for UI display.
 * This is separate from useUnifiedEncryption to avoid unnecessary re-renders
 * when only status information is needed.
 */

import { useMemo } from 'react';
import { useUnifiedEncryption } from './use-unified-encryption';
import { useSettingsStore, type PreferredEncryptionProvider } from '@/stores/settings-store';
import { type EncryptionProvider, ENV_FORCE_PROVIDER, INCO_ENABLED } from '@/lib/constants';
import { type KeySource } from './use-encryption';

export type ProviderStatus = 'ready' | 'demo' | 'unavailable';

export interface EncryptionStatus {
  /** Currently active encryption provider */
  provider: EncryptionProvider;
  /** Whether using production-ready encryption */
  isProductionReady: boolean;
  /** Source of the encryption key */
  keySource: KeySource | 'inco' | null;
  /** Arcium provider status */
  arciumStatus: ProviderStatus;
  /** Inco provider status */
  incoStatus: ProviderStatus;
  /** User's preferred provider setting */
  preferredProvider: PreferredEncryptionProvider;
  /** Whether the user can switch providers (not locked by admin) */
  canSwitch: boolean;
  /** Whether encryption is initialized */
  isInitialized: boolean;
  /** Human-readable status message */
  statusMessage: string;
}

/**
 * Hook providing encryption status for UI components
 *
 * Usage:
 * ```tsx
 * const { provider, isProductionReady, statusMessage } = useEncryptionStatus();
 *
 * return (
 *   <div>
 *     <span>{provider}</span>
 *     <span>{statusMessage}</span>
 *   </div>
 * );
 * ```
 */
export function useEncryptionStatus(): EncryptionStatus {
  const unified = useUnifiedEncryption();
  const { preferredEncryptionProvider, arciumEnabled, incoEnabled } = useSettingsStore();

  const arciumStatus = useMemo<ProviderStatus>(() => {
    if (!arciumEnabled) return 'unavailable';
    if (!unified.isInitialized) return 'unavailable';
    if (unified.provider === 'arcium') {
      return unified.isProductionReady ? 'ready' : 'demo';
    }
    // Arcium is available but not selected
    return unified.keySource === 'demo' ? 'demo' : 'ready';
  }, [arciumEnabled, unified.isInitialized, unified.provider, unified.isProductionReady, unified.keySource]);

  const incoStatus = useMemo<ProviderStatus>(() => {
    if (!INCO_ENABLED || !incoEnabled) return 'unavailable';
    if (unified.provider === 'inco') return 'ready';
    // Check if Inco is initialized via the unified hook
    return 'unavailable'; // Simplified - Inco is either active or unavailable
  }, [incoEnabled, unified.provider]);

  const canSwitch = useMemo(() => {
    return !ENV_FORCE_PROVIDER;
  }, []);

  const statusMessage = useMemo(() => {
    if (!unified.isInitialized) {
      return 'Initializing encryption...';
    }

    if (ENV_FORCE_PROVIDER) {
      return `Locked to ${ENV_FORCE_PROVIDER} by admin`;
    }

    if (unified.provider === 'demo') {
      return 'Using demo encryption (not production-ready)';
    }

    if (unified.provider === 'arcium') {
      if (unified.isProductionReady) {
        return `Arcium MPC (${unified.keySource === 'env' ? 'env key' : 'SDK key'})`;
      }
      return 'Arcium MPC (demo mode)';
    }

    if (unified.provider === 'inco') {
      return 'Inco TEE encryption active';
    }

    return 'Unknown provider state';
  }, [unified.isInitialized, unified.provider, unified.isProductionReady, unified.keySource]);

  return {
    provider: unified.provider,
    isProductionReady: unified.isProductionReady,
    keySource: unified.keySource,
    arciumStatus,
    incoStatus,
    preferredProvider: preferredEncryptionProvider,
    canSwitch,
    isInitialized: unified.isInitialized,
    statusMessage,
  };
}
