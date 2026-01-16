'use client';

import { useState, useCallback, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
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
      console.log('[Encryption] Initializing Arcium encryption...');

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
          console.log('[Encryption] Fetched MXE public key from devnet');
        } else {
          throw new Error('MXE public key not found');
        }
      } catch (fetchError) {
        // Fall back to using a deterministic key for demo purposes
        // In production, this MUST be fetched from the actual MXE
        console.warn('[Encryption] Could not fetch MXE key, using demo mode:', fetchError);

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

      console.log('[Encryption] Generated ephemeral keypair');
      console.log('[Encryption] Ephemeral public key:', Buffer.from(ephemeralPublicKey).toString('hex').slice(0, 16) + '...');

      // Compute shared secret via X25519 ECDH
      const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);

      console.log('[Encryption] Computed shared secret via X25519');

      // Initialize RescueCipher with shared secret
      const cipher = new RescueCipher(sharedSecret);

      console.log('[Encryption] Initialized RescueCipher');

      setContext({
        mxePublicKey,
        sharedSecret,
        ephemeralPublicKey,
        cipher,
      });
      setIsInitialized(true);

      console.log('[Encryption] Encryption context ready');
    } catch (error) {
      console.error('[Encryption] Failed to initialize:', error);
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

      console.log('[Encryption] Encrypting value with nonce:', Buffer.from(nonce).toString('hex').slice(0, 16) + '...');

      // Encrypt using RescueCipher
      // The value is passed as an array of bigints
      const encrypted = context.cipher.encrypt([value], nonce);

      // The result is number[][] - flatten to a single Uint8Array
      // Each encrypted block is 32 bytes, but we need 64 bytes total
      // Format: [nonce (16 bytes) | ciphertext (32 bytes) | ephemeral_pubkey_hash (16 bytes)]
      const result = new Uint8Array(64);

      // Copy nonce (first 16 bytes)
      result.set(nonce, 0);

      // Copy ciphertext (next 32 bytes)
      if (encrypted.length > 0 && encrypted[0].length >= 32) {
        result.set(new Uint8Array(encrypted[0].slice(0, 32)), 16);
      } else {
        // Fallback: serialize the encrypted value directly
        const ctBytes = serializeLE(BigInt(encrypted[0]?.[0] || 0), 32);
        result.set(ctBytes, 16);
      }

      // Last 16 bytes: hash of ephemeral public key (for decryption routing)
      const pubkeyBuffer = new Uint8Array(context.ephemeralPublicKey).buffer as ArrayBuffer;
      const pubkeyHash = await crypto.subtle.digest('SHA-256', pubkeyBuffer);
      result.set(new Uint8Array(pubkeyHash).slice(0, 16), 48);

      console.log('[Encryption] Encrypted value, output length:', result.length);

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

      // Extract nonce (first 16 bytes)
      const nonce = encrypted.slice(0, 16);

      // Extract ciphertext (next 32 bytes)
      const ciphertextBytes = encrypted.slice(16, 48);
      const ciphertext = deserializeLE(ciphertextBytes);

      // Decrypt using RescueCipher
      const decrypted = context.cipher.decrypt_raw([ciphertext], nonce);

      return decrypted[0];
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
