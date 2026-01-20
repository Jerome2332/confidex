'use client';

/**
 * Inco Lightning Encryption Hook
 *
 * Provides TEE-based confidential computing as an alternative to Arcium MPC.
 * Uses Intel TDX trusted execution environment for encrypted operations.
 *
 * Key differences from Arcium:
 * - TEE-based (hardware trust) vs MPC (cryptographic trust)
 * - Lower latency (~100ms vs ~500ms)
 * - Handles are 16-byte references to encrypted values (vs 64-byte ciphertexts)
 *
 * @see https://docs.inco.org/svm
 */

import { useState, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { createLogger } from '@/lib/logger';
import { INCO_PROGRAM_ID, INCO_ENABLED } from '@/lib/constants';

const log = createLogger('inco-encryption');

// Inco encrypted handle (128-bit reference to encrypted value)
export type IncoHandle = Uint8Array; // 16 bytes

interface IncoEncryptionContext {
  /** Whether Inco is enabled via environment */
  isEnabled: boolean;
  /** Program ID for CPI operations */
  programId: string;
}

interface UseIncoEncryptionReturn {
  /** Whether Inco encryption is available and initialized */
  isInitialized: boolean;
  /** Whether Inco is enabled via configuration */
  isEnabled: boolean;
  /** Initialize Inco encryption (loads SDK) */
  initialize: () => Promise<void>;
  /**
   * Encrypt a value to an Inco handle
   * The handle is a 16-byte reference that the covalidator can operate on
   */
  encryptValue: (value: bigint) => Promise<IncoHandle>;
  /**
   * Request decryption of an Inco handle
   * Note: This requires proper Allowance PDA setup for access control
   */
  decryptHandle: (handle: IncoHandle) => Promise<bigint>;
  /** Get the encryption context */
  context: IncoEncryptionContext | null;
}

/**
 * Hook for Inco Lightning TEE-based encryption
 *
 * Usage:
 * ```tsx
 * const { initialize, encryptValue, isInitialized } = useIncoEncryption();
 *
 * useEffect(() => {
 *   if (INCO_ENABLED) {
 *     initialize();
 *   }
 * }, []);
 *
 * const handle = await encryptValue(BigInt(1000));
 * ```
 */
export function useIncoEncryption(): UseIncoEncryptionReturn {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const [isInitialized, setIsInitialized] = useState(false);
  const [context, setContext] = useState<IncoEncryptionContext | null>(null);

  const initialize = useCallback(async () => {
    if (!INCO_ENABLED) {
      log.debug('Inco Lightning is disabled via configuration');
      return;
    }

    try {
      log.debug('Initializing Inco Lightning encryption...');

      // Dynamically import Inco SDK to avoid SSR issues
      // The SDK may not be available if not installed
      let incoSdk: typeof import('@inco/solana-sdk') | null = null;

      try {
        incoSdk = await import('@inco/solana-sdk');
        log.debug('Inco SDK loaded successfully');
      } catch (importError) {
        log.warn('Inco SDK not available - install with: pnpm add @inco/solana-sdk', {
          error: importError instanceof Error ? importError.message : String(importError),
        });
        return;
      }

      setContext({
        isEnabled: true,
        programId: INCO_PROGRAM_ID.toBase58(),
      });
      setIsInitialized(true);

      log.info('Inco Lightning encryption initialized', {
        programId: INCO_PROGRAM_ID.toBase58(),
      });
    } catch (error) {
      log.error('Failed to initialize Inco encryption', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }, []);

  const encryptValue = useCallback(
    async (value: bigint): Promise<IncoHandle> => {
      if (!isInitialized || !context) {
        throw new Error('Inco encryption not initialized');
      }

      try {
        // Dynamically import encryption function
        const { encryptValue: incoEncrypt } = await import('@inco/solana-sdk');

        // Inco expects a number, convert bigint
        // Note: This limits precision to Number.MAX_SAFE_INTEGER
        const numValue = Number(value);
        if (numValue > Number.MAX_SAFE_INTEGER) {
          log.warn('Value exceeds safe integer range, precision may be lost', {
            value: value.toString(),
          });
        }

        const encrypted = await incoEncrypt(numValue);

        // Convert to Uint8Array handle (16 bytes)
        const handle = new Uint8Array(16);
        if (encrypted && typeof encrypted === 'object') {
          if (ArrayBuffer.isView(encrypted)) {
            // It's a TypedArray (Uint8Array, etc.)
            const view = encrypted as Uint8Array;
            handle.set(view.slice(0, 16));
          } else {
            // Handle may be returned as object with bytes
            const bytes = (encrypted as { bytes?: number[] }).bytes;
            if (bytes) {
              bytes.slice(0, 16).forEach((b, i) => (handle[i] = b));
            }
          }
        }

        log.debug('Encrypted value with Inco', {
          handlePrefix: Array.from(handle.slice(0, 4))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
        });

        return handle;
      } catch (error) {
        log.error('Failed to encrypt with Inco', {
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [isInitialized, context]
  );

  const decryptHandle = useCallback(
    async (handle: IncoHandle): Promise<bigint> => {
      if (!isInitialized || !context) {
        throw new Error('Inco encryption not initialized');
      }

      if (!publicKey) {
        throw new Error('Wallet not connected - required for decryption');
      }

      try {
        // Inco decryption requires:
        // 1. An Allowance PDA that grants the wallet access to the encrypted value
        // 2. Wallet signature for authorization
        // 3. The covalidator to process the decryption request
        //
        // This is a simplified stub - full implementation requires proper
        // Allowance PDA setup and wallet adapter integration.
        //
        // For now, log a warning and return 0 since we can't decrypt without
        // the full infrastructure in place.
        log.warn('Inco decryption not fully implemented - requires Allowance PDA setup', {
          handlePrefix: Array.from(handle.slice(0, 4))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''),
        });

        // TODO: Implement full Inco decryption when infrastructure is ready
        // const { decrypt } = await import('@inco/solana-sdk');
        // const result = await decrypt(handles, wallet);

        return BigInt(0);
      } catch (error) {
        log.error('Failed to decrypt Inco handle', {
          error: error instanceof Error ? error.message : String(error),
        });
        // Return 0 on failure (similar to Arcium fallback)
        return BigInt(0);
      }
    },
    [isInitialized, context, publicKey]
  );

  return {
    isInitialized,
    isEnabled: INCO_ENABLED,
    initialize,
    encryptValue,
    decryptHandle,
    context,
  };
}
