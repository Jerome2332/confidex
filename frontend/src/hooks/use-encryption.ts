'use client';

import { useState, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';

import { createLogger } from '@/lib/logger';

const log = createLogger('encryption');
// Arcium imports - includes x25519 re-export from @noble/curves
import {
  RescueCipher,
  getMXEPublicKey,
  serializeLE,
  deserializeLE,
  x25519
} from '@arcium-hq/client';

// MXE Program ID (devnet - from constants)
const MXE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_MXE_PROGRAM_ID ||
  'CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE'
);

// Encryption context for Arcium
interface EncryptionContext {
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  cipher: RescueCipher;
}

interface UseEncryptionReturn {
  context: EncryptionContext | null;
  isInitialized: boolean;
  initializeEncryption: () => Promise<void>;
  encryptValue: (value: bigint) => Promise<Uint8Array>;
  decryptValue: (encrypted: Uint8Array) => Promise<bigint>;
  getEphemeralPublicKey: () => Uint8Array | null;
}

/**
 * Hook for managing Arcium encryption context
 * Uses X25519 key exchange and RescueCipher for encryption
 */
export function useEncryption(): UseEncryptionReturn {
  const { publicKey, signMessage } = useWallet();
  const { connection } = useConnection();
  const [context, setContext] = useState<EncryptionContext | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const nonceCounter = useRef(0);

  const initializeEncryption = useCallback(async () => {
    if (!publicKey) {
      throw new Error('Wallet not connected');
    }

    try {
      log.debug('Initializing Arcium encryption...');

      // Create a minimal provider for fetching MXE public key
      // Note: In browser, we can't create a full AnchorProvider without a wallet
      // So we'll try to fetch the MXE public key, or fall back to simulation

      let mxePublicKey: Uint8Array;

      try {
        // Try to fetch MXE public key from devnet
        // This requires an AnchorProvider which needs a wallet
        const provider = new AnchorProvider(
          connection,
          {
            publicKey,
            signTransaction: async (tx) => tx,
            signAllTransactions: async (txs) => txs,
          },
          { commitment: 'confirmed' }
        );

        const fetchedKey = await getMXEPublicKey(provider, MXE_PROGRAM_ID);

        if (fetchedKey) {
          mxePublicKey = fetchedKey;
          log.debug('Fetched MXE public key from devnet');
        } else {
          throw new Error('MXE public key not found');
        }
      } catch (fetchError) {
        // Fall back to using a deterministic key for demo purposes
        // In production, this MUST be fetched from the actual MXE
        log.warn('Could not fetch MXE key, using demo mode:', { fetchError });

        // Use a deterministic "demo" MXE public key
        // This is NOT secure - only for hackathon demo
        mxePublicKey = new Uint8Array(32);
        const demoSeed = new TextEncoder().encode('confidex-demo-mxe-key-v1');
        const hashBuffer = await crypto.subtle.digest('SHA-256', demoSeed);
        new Uint8Array(hashBuffer).forEach((b, i) => {
          if (i < 32) mxePublicKey[i] = b;
        });
      }

      // Generate ephemeral X25519 keypair
      const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
      const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

      log.debug('Generated ephemeral keypair');

      // Compute shared secret via X25519 ECDH
      const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);

      log.debug('Computed shared secret via X25519');

      // Initialize RescueCipher with shared secret
      const cipher = new RescueCipher(sharedSecret);

      log.debug('Initialized RescueCipher');

      setContext({
        mxePublicKey,
        sharedSecret,
        ephemeralPublicKey,
        cipher,
      });
      setIsInitialized(true);

      log.debug('Encryption context ready');
    } catch (error) {
      log.error('Failed to initialize', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }, [publicKey, connection]);

  const encryptValue = useCallback(
    async (value: bigint): Promise<Uint8Array> => {
      if (!context) {
        throw new Error('Encryption not initialized');
      }

      // Generate a unique nonce for this encryption
      const nonce = new Uint8Array(16);
      crypto.getRandomValues(nonce);

      // Increment counter to ensure uniqueness
      nonceCounter.current += 1;
      const counterBytes = new DataView(nonce.buffer);
      counterBytes.setUint32(12, nonceCounter.current, true);

      // Encrypt using RescueCipher
      // The value is passed as an array of bigints
      const encrypted = context.cipher.encrypt([value], nonce);

      // HYBRID FORMAT (for on-chain balance validation + MPC matching):
      // [plaintext (8 bytes) | nonce (8 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
      //
      // Why plaintext is included:
      // - On-chain balance validation requires knowing the order amount/price
      // - Until C-SPL encrypted balances are live, we can't do encrypted balance checks
      // - The plaintext allows balance escrow; MPC uses ciphertext for price comparison
      //
      // Privacy guarantees:
      // - Order amounts are visible on-chain (necessary for balance validation)
      // - MPC still uses encrypted values for price comparison (no price leak during matching)
      // - Full privacy will be achieved when C-SPL enables encrypted balance operations
      const result = new Uint8Array(64);

      // Bytes 0-7: plaintext value (for on-chain balance validation)
      const plaintextBytes = serializeLE(value, 8);
      result.set(plaintextBytes, 0);

      // Bytes 8-15: truncated nonce (for MPC decryption)
      result.set(nonce.slice(0, 8), 8);

      // Bytes 16-47: ciphertext (for MPC price comparison)
      if (encrypted.length > 0 && encrypted[0].length >= 32) {
        result.set(new Uint8Array(encrypted[0].slice(0, 32)), 16);
      } else {
        // Fallback: serialize the encrypted value directly
        const ctBytes = serializeLE(BigInt(encrypted[0]?.[0] || 0), 32);
        result.set(ctBytes, 16);
      }

      // Bytes 48-63: truncated ephemeral public key (for MPC decryption routing)
      result.set(context.ephemeralPublicKey.slice(0, 16), 48);

      return result;
    },
    [context]
  );

  const decryptValue = useCallback(
    async (encrypted: Uint8Array): Promise<bigint> => {
      if (!context) {
        throw new Error('Encryption not initialized');
      }

      if (encrypted.length !== 64) {
        throw new Error('Invalid encrypted value length');
      }

      // HYBRID FORMAT:
      // [plaintext (8 bytes) | nonce (8 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]

      // For client-side decryption, we can just read the plaintext directly
      // (This is used for displaying user's own order values)
      const plaintext = deserializeLE(encrypted.slice(0, 8));

      return plaintext;
    },
    [context]
  );

  const getEphemeralPublicKey = useCallback((): Uint8Array | null => {
    return context?.ephemeralPublicKey || null;
  }, [context]);

  return {
    context,
    isInitialized,
    initializeEncryption,
    encryptValue,
    decryptValue,
    getEphemeralPublicKey,
  };
}
