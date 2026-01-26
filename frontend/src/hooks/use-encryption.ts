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
  getMXEAccAddress,
  ARCIUM_ADDR,
  serializeLE,
  deserializeLE,
  x25519
} from '@arcium-hq/client';

// MXE Program ID (devnet - from constants, Jan 22 2026 deployment)
const MXE_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_MXE_PROGRAM_ID ||
  '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi'
);

// Optional: Override MXE public key via environment variable (hex-encoded 32 bytes)
// Use this when you have a properly initialized Arcium MXE with keygen complete
const MXE_PUBLIC_KEY_OVERRIDE = process.env.NEXT_PUBLIC_MXE_X25519_PUBKEY;

// Arcium program ID for reference
const ARCIUM_PROGRAM_ID = new PublicKey(ARCIUM_ADDR);

/**
 * Encryption format version
 * V1 (HYBRID): [plaintext (8) | nonce (8) | ciphertext (32) | ephemeral_pubkey (16)]
 * V2 (PURE):   [nonce (16) | ciphertext (32) | ephemeral_pubkey (16)]
 *
 * V2 provides full privacy - no plaintext visible on-chain.
 * Requires MPC for all validations (balance checks, etc.)
 */
const ENCRYPTION_VERSION = 2;

// Key source types for tracking where the MXE key came from
export type KeySource = 'env' | 'sdk' | 'demo';

// Encryption context for Arcium
interface EncryptionContext {
  mxePublicKey: Uint8Array;
  sharedSecret: Uint8Array;
  ephemeralPublicKey: Uint8Array;
  cipher: RescueCipher;
  /** True if using a real MXE key (env or SDK), false for demo mode */
  isProductionMode: boolean;
  /** Source of the MXE public key */
  keySource: KeySource;
}

interface UseEncryptionReturn {
  context: EncryptionContext | null;
  isInitialized: boolean;
  /** True if encryption is using a real MXE key */
  isProductionMode: boolean;
  /** Source of the encryption key */
  keySource: KeySource | null;
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
  const { publicKey } = useWallet();
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

      let mxePublicKey: Uint8Array;
      let keySource: KeySource = 'demo';

      // Priority 1: Use environment variable override if provided
      if (MXE_PUBLIC_KEY_OVERRIDE) {
        try {
          const hexKey = MXE_PUBLIC_KEY_OVERRIDE.replace(/^0x/, '');
          if (hexKey.length === 64) {
            mxePublicKey = new Uint8Array(32);
            for (let i = 0; i < 32; i++) {
              mxePublicKey[i] = parseInt(hexKey.slice(i * 2, i * 2 + 2), 16);
            }
            keySource = 'env';
            log.info('Using MXE public key from environment variable (production mode)');
          } else {
            throw new Error('Invalid hex length');
          }
        } catch (parseError) {
          log.error('Failed to parse NEXT_PUBLIC_MXE_X25519_PUBKEY, must be 64 hex chars:', { parseError });
          throw new Error('Invalid MXE public key override format');
        }
      } else {
        // Priority 2: Try to fetch from Arcium SDK
        try {
          const provider = new AnchorProvider(
            connection,
            {
              publicKey,
              signTransaction: async (tx) => tx,
              signAllTransactions: async (txs) => txs,
            },
            { commitment: 'confirmed' }
          );

          // getMXEPublicKey looks for an mxeAccount PDA under the Arcium program
          // derived from: ["MXEAccount", mxeProgramId]
          const mxeAccAddress = getMXEAccAddress(MXE_PROGRAM_ID);
          log.debug('Looking for MXE account', { address: mxeAccAddress.toBase58() });
          log.debug('Arcium program', { address: ARCIUM_PROGRAM_ID.toBase58() });

          const fetchedKey = await getMXEPublicKey(provider, MXE_PROGRAM_ID);

          if (fetchedKey && !fetchedKey.every(b => b === 0)) {
            mxePublicKey = fetchedKey;
            keySource = 'sdk';
            log.info('Fetched MXE x25519 public key from Arcium devnet (production mode)');
          } else {
            throw new Error('MXE x25519 key not set (keygen not complete)');
          }
        } catch (fetchError) {
          // Priority 3: Fall back to demo mode
          // This happens when:
          // 1. The mxeAccount PDA doesn't exist (MXE not registered with Arcium)
          // 2. The mxeAccount exists but utilityPubkeys.x25519Pubkey is not set (keygen incomplete)
          //
          // On Arcium devnet (Jan 2026), most MXEs have not completed keygen,
          // so this fallback is expected for hackathon demos.
          log.warn('MXE key fetch failed - using demo mode. Reason:', {
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
            note: 'This is expected on devnet when MXE keygen is not complete. ' +
                  'Set NEXT_PUBLIC_MXE_X25519_PUBKEY for production use.'
          });

          // Generate deterministic demo key from MXE program ID
          // This ensures consistent encryption within the same MXE context
          // Note: The seed string is arbitrary and doesn't reference actual clusters
          mxePublicKey = new Uint8Array(32);
          keySource = 'demo';
          const demoSeed = new TextEncoder().encode(
            `confidex-demo-mxe-${MXE_PROGRAM_ID.toBase58()}-v2`
          );
          const hashBuffer = await crypto.subtle.digest('SHA-256', demoSeed);
          new Uint8Array(hashBuffer).forEach((b, i) => {
            if (i < 32) mxePublicKey[i] = b;
          });

          log.debug('Demo MXE key generated', {
            first8Bytes: Array.from(mxePublicKey.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('')
          });
        }
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

      const isProductionMode = keySource !== 'demo';

      setContext({
        mxePublicKey,
        sharedSecret,
        ephemeralPublicKey,
        cipher,
        isProductionMode,
        keySource,
      });
      setIsInitialized(true);

      log.debug('Encryption context ready', {
        isProductionMode,
        keySource,
        mxeKeyPrefix: Array.from(mxePublicKey.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join('')
      });
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

      const result = new Uint8Array(64);

      if (ENCRYPTION_VERSION === 2) {
        // PURE CIPHERTEXT FORMAT (V2):
        // [nonce (16 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
        //
        // Full privacy - no plaintext visible on-chain.
        // All validations (balance checks, price comparisons) done via MPC.
        //
        // Privacy guarantees:
        // - Order amounts are encrypted (private)
        // - Order prices are encrypted (private)
        // - MPC performs all comparisons without revealing values

        // Bytes 0-15: full nonce (for MPC decryption)
        result.set(nonce, 0);

        // Bytes 16-47: ciphertext (for MPC operations)
        if (encrypted.length > 0 && encrypted[0].length >= 32) {
          result.set(new Uint8Array(encrypted[0].slice(0, 32)), 16);
        } else {
          // Fallback: serialize the encrypted value directly
          const ctBytes = serializeLE(BigInt(encrypted[0]?.[0] || 0), 32);
          result.set(ctBytes, 16);
        }

        // Bytes 48-63: truncated ephemeral public key (for MPC decryption routing)
        result.set(context.ephemeralPublicKey.slice(0, 16), 48);
      } else {
        // HYBRID FORMAT (V1 - legacy):
        // [plaintext (8 bytes) | nonce (8 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
        //
        // Why plaintext is included:
        // - On-chain balance validation requires knowing the order amount/price
        // - Until C-SPL encrypted balances are live, we can't do encrypted balance checks
        // - The plaintext allows balance escrow; MPC uses ciphertext for price comparison

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
      }

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

      if (ENCRYPTION_VERSION === 2) {
        // PURE CIPHERTEXT FORMAT (V2):
        // [nonce (16 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
        //
        // Client-side decryption requires the full RescueCipher decrypt flow.
        // Extract nonce and ciphertext, then decrypt.
        const nonce = encrypted.slice(0, 16);
        const ciphertext = encrypted.slice(16, 48);

        // Convert ciphertext bytes back to the format RescueCipher expects
        // Note: RescueCipher.decrypt expects an array of Uint8Array chunks
        try {
          const decrypted = context.cipher.decrypt([ciphertext] as unknown as number[][], nonce);
          if (decrypted && decrypted.length > 0) {
            return BigInt(decrypted[0]);
          }
        } catch (decryptError) {
          log.warn('RescueCipher decryption failed, value may be from different session', { decryptError });
        }

        // Fallback: return 0 if decryption fails (can happen if encrypted with different key)
        return BigInt(0);
      } else {
        // HYBRID FORMAT (V1 - legacy):
        // [plaintext (8 bytes) | nonce (8 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
        //
        // For client-side decryption, we can just read the plaintext directly
        // (This is used for displaying user's own order values)
        const plaintext = deserializeLE(encrypted.slice(0, 8));
        return plaintext;
      }
    },
    [context]
  );

  const getEphemeralPublicKey = useCallback((): Uint8Array | null => {
    return context?.ephemeralPublicKey || null;
  }, [context]);

  return {
    context,
    isInitialized,
    isProductionMode: context?.isProductionMode ?? false,
    keySource: context?.keySource ?? null,
    initializeEncryption,
    encryptValue,
    decryptValue,
    getEphemeralPublicKey,
  };
}
