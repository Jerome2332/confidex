'use client';

/**
 * Unified Encryption Provider Hook
 *
 * Provides a single interface for encryption that automatically selects
 * the best available provider based on configuration and availability.
 *
 * Provider Selection Priority:
 * 1. ENV_FORCE_PROVIDER - Admin emergency override (highest priority)
 * 2. User preference from settings store (runtime-switchable)
 * 3. Auto mode (default): Arcium prod > Inco > Arcium demo > demo fallback
 *
 * This allows the application to gracefully degrade when primary
 * encryption infrastructure is unavailable on devnet, while also
 * supporting runtime provider switching via the settings UI.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useEncryption, KeySource } from './use-encryption';
import { useIncoEncryption } from './use-inco-encryption';
import { useSettingsStore } from '@/stores/settings-store';
import { createLogger } from '@/lib/logger';
import {
  INCO_ENABLED,
  ENV_FORCE_PROVIDER,
  ENV_ARCIUM_ENABLED,
  type EncryptionProvider,
} from '@/lib/constants';

const log = createLogger('unified-encryption');

interface UseUnifiedEncryptionReturn {
  /** Currently active encryption provider */
  provider: EncryptionProvider;
  /** Whether encryption is initialized and ready */
  isInitialized: boolean;
  /** Whether using production-ready encryption (not demo mode) */
  isProductionReady: boolean;
  /** Source of the encryption key (for Arcium) or 'inco' for Inco */
  keySource: KeySource | 'inco' | null;
  /** Initialize the encryption system */
  initializeEncryption: () => Promise<void>;
  /**
   * Encrypt a value using the active provider
   * Returns 64-byte ciphertext (Arcium) or 16-byte handle (Inco)
   * padded to 64 bytes for consistency
   */
  encryptValue: (value: bigint) => Promise<Uint8Array>;
  /**
   * Decrypt a value using the active provider
   * Handles both 64-byte Arcium ciphertext and padded Inco handles
   */
  decryptValue: (encrypted: Uint8Array) => Promise<bigint>;
  /** Get provider-specific metadata */
  getProviderInfo: () => {
    provider: EncryptionProvider;
    isProductionReady: boolean;
    programId: string | null;
  };
}

/**
 * Hook that unifies Arcium and Inco encryption providers
 *
 * Usage:
 * ```tsx
 * const {
 *   provider,
 *   isProductionReady,
 *   encryptValue,
 *   initializeEncryption
 * } = useUnifiedEncryption();
 *
 * useEffect(() => {
 *   initializeEncryption();
 * }, []);
 *
 * // Works with any available provider
 * const encrypted = await encryptValue(BigInt(1000));
 *
 * // Check if production-ready
 * if (!isProductionReady) {
 *   console.warn('Using demo encryption - not suitable for production');
 * }
 * ```
 */
export function useUnifiedEncryption(): UseUnifiedEncryptionReturn {
  const arcium = useEncryption();
  const inco = useIncoEncryption();
  const [activeProvider, setActiveProvider] = useState<EncryptionProvider>('demo');

  // Read user preferences from settings store
  const {
    preferredEncryptionProvider,
    arciumEnabled: userArciumEnabled,
    incoEnabled: userIncoEnabled,
    autoFallbackEnabled,
  } = useSettingsStore();

  // Combine env and user settings (env takes precedence)
  const arciumEnabled = ENV_ARCIUM_ENABLED && userArciumEnabled;
  const incoEnabled = INCO_ENABLED && userIncoEnabled;

  // Determine the best available provider based on priority cascade
  const provider = useMemo<EncryptionProvider>(() => {
    // LEVEL 1: Environment force override (admin emergency switch)
    if (ENV_FORCE_PROVIDER) {
      log.info('Using forced provider from environment', { provider: ENV_FORCE_PROVIDER });
      return ENV_FORCE_PROVIDER;
    }

    // LEVEL 2: User explicit preference (if not 'auto')
    if (preferredEncryptionProvider === 'inco') {
      if (incoEnabled && inco.isInitialized) {
        return 'inco';
      }
      // Preferred Inco but not available
      if (!autoFallbackEnabled) {
        log.warn('Inco preferred but unavailable, fallback disabled');
        return 'demo';
      }
      log.debug('Inco preferred but unavailable, falling back to auto selection');
    }

    if (preferredEncryptionProvider === 'arcium') {
      if (arciumEnabled && arcium.isInitialized) {
        return 'arcium';
      }
      // Preferred Arcium but not available
      if (!autoFallbackEnabled) {
        log.warn('Arcium preferred but unavailable, fallback disabled');
        return 'demo';
      }
      log.debug('Arcium preferred but unavailable, falling back to auto selection');
    }

    // LEVEL 3: Auto mode - select best available provider
    // Priority 3a: Arcium in production mode (real MXE key)
    if (arciumEnabled && arcium.isInitialized && arcium.isProductionMode) {
      return 'arcium';
    }

    // Priority 3b: Inco if enabled and initialized
    if (incoEnabled && inco.isInitialized) {
      return 'inco';
    }

    // Priority 3c: Arcium demo mode (still uses RescueCipher, just with demo key)
    if (arciumEnabled && arcium.isInitialized) {
      return 'arcium';
    }

    // Fallback: demo mode indicator
    return 'demo';
  }, [
    preferredEncryptionProvider,
    arciumEnabled,
    incoEnabled,
    autoFallbackEnabled,
    arcium.isInitialized,
    arcium.isProductionMode,
    inco.isInitialized,
  ]);

  // Update active provider when dependencies change
  useEffect(() => {
    if (activeProvider !== provider) {
      log.info('Encryption provider changed', {
        from: activeProvider,
        to: provider,
      });
      setActiveProvider(provider);
    }
  }, [provider, activeProvider]);

  const isProductionReady = useMemo(() => {
    if (provider === 'arcium') {
      return arcium.isProductionMode;
    }
    if (provider === 'inco') {
      return true; // Inco is always production-ready when available
    }
    return false;
  }, [provider, arcium.isProductionMode]);

  const keySource = useMemo((): KeySource | 'inco' | null => {
    if (provider === 'arcium') {
      return arcium.keySource;
    }
    if (provider === 'inco') {
      return 'inco';
    }
    return null;
  }, [provider, arcium.keySource]);

  const initializeEncryption = useCallback(async () => {
    log.debug('Initializing unified encryption...', {
      preferredProvider: preferredEncryptionProvider,
      arciumEnabled,
      incoEnabled,
    });

    // Initialize Arcium if enabled
    if (arciumEnabled) {
      try {
        await arcium.initializeEncryption();
        log.debug('Arcium encryption initialized', {
          isProductionMode: arcium.isProductionMode,
          keySource: arcium.keySource,
        });
      } catch (arciumError) {
        log.warn('Arcium initialization failed', {
          error: arciumError instanceof Error ? arciumError.message : String(arciumError),
        });
      }
    } else {
      log.debug('Arcium disabled by configuration');
    }

    // Initialize Inco if enabled
    if (incoEnabled) {
      try {
        await inco.initialize();
        log.debug('Inco encryption initialized');
      } catch (incoError) {
        log.warn('Inco initialization failed', {
          error: incoError instanceof Error ? incoError.message : String(incoError),
        });
      }
    } else {
      log.debug('Inco disabled by configuration');
    }

    log.info('Unified encryption ready', {
      selectedProvider: provider,
      preferredProvider: preferredEncryptionProvider,
      isProductionReady,
      arciumReady: arcium.isInitialized,
      incoReady: inco.isInitialized,
    });
  }, [
    arcium,
    inco,
    provider,
    preferredEncryptionProvider,
    arciumEnabled,
    incoEnabled,
    isProductionReady,
  ]);

  const encryptValue = useCallback(
    async (value: bigint): Promise<Uint8Array> => {
      if (provider === 'inco' && inco.isInitialized) {
        // Inco returns 16-byte handle, pad to 64 bytes for consistency
        const handle = await inco.encryptValue(value);
        const padded = new Uint8Array(64);
        // Format: [0x02 (inco marker)] [handle (16)] [zeros (47)]
        padded[0] = 0x02; // Marker byte to identify Inco format
        padded.set(handle, 1);
        return padded;
      }

      // Default to Arcium (or demo mode)
      return arcium.encryptValue(value);
    },
    [provider, arcium, inco]
  );

  const decryptValue = useCallback(
    async (encrypted: Uint8Array): Promise<bigint> => {
      // Check for Inco format marker
      if (encrypted[0] === 0x02 && provider === 'inco' && inco.isInitialized) {
        const handle = encrypted.slice(1, 17);
        return inco.decryptHandle(handle);
      }

      // Default to Arcium decryption
      return arcium.decryptValue(encrypted);
    },
    [provider, arcium, inco]
  );

  const getProviderInfo = useCallback(() => {
    return {
      provider,
      isProductionReady,
      programId:
        provider === 'inco'
          ? inco.context?.programId ?? null
          : provider === 'arcium'
            ? process.env.NEXT_PUBLIC_MXE_PROGRAM_ID ?? null
            : null,
    };
  }, [provider, isProductionReady, inco.context]);

  return {
    provider,
    isInitialized: arcium.isInitialized || inco.isInitialized,
    isProductionReady,
    keySource,
    initializeEncryption,
    encryptValue,
    decryptValue,
    getProviderInfo,
  };
}
