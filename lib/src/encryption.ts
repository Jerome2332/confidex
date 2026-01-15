/**
 * Arcium encryption utilities for Confidex
 *
 * Uses the Rescue cipher with X25519 key exchange as specified
 * in the Arcium SDK documentation.
 */

import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { randomBytes } from '@noble/hashes/utils';
import type { EncryptedU64, EncryptionContext } from './types.js';
import { ENCRYPTED_VALUE_SIZE } from './constants.js';

/**
 * Generate a new encryption keypair for client-side use
 */
export function generateKeypair(): {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
} {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/**
 * Create an encryption context with the MXE public key
 *
 * @param mxePublicKey - The MXE cluster's public key (32 bytes)
 * @returns Encryption context with shared secret
 */
export function createEncryptionContext(
  mxePublicKey: Uint8Array
): EncryptionContext {
  const { privateKey, publicKey } = generateKeypair();

  // Compute X25519 shared secret
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);

  return {
    mxePublicKey,
    sharedSecret: new Uint8Array(sharedSecret),
  };
}

/**
 * Encrypt a u64 value using the Rescue cipher
 *
 * In production, this uses the @arcium-hq/client RescueCipher.
 * This is a simplified implementation for development.
 *
 * @param value - The plaintext u64 value
 * @param context - Encryption context with shared secret
 * @returns 64-byte encrypted value
 */
export function encryptU64(
  value: bigint,
  context: EncryptionContext
): EncryptedU64 {
  const encrypted = new Uint8Array(ENCRYPTED_VALUE_SIZE);

  // Generate random nonce (16 bytes)
  const nonce = randomBytes(16);

  // Convert value to 8 bytes (little-endian)
  const valueBytes = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    valueBytes[i] = Number(v & BigInt(0xff));
    v = v >> BigInt(8);
  }

  // In production, use RescueCipher:
  // const cipher = new RescueCipher(context.sharedSecret);
  // const ciphertext = cipher.encrypt(valueBytes, nonce);

  // Development simulation: XOR with key stream derived from shared secret
  const keyStream = deriveKeyStream(context.sharedSecret, nonce, 48);

  // Layout: [nonce (16)] [ciphertext (8)] [tag (24)] [padding (16)]
  encrypted.set(nonce, 0);

  // XOR plaintext with key stream
  for (let i = 0; i < 8; i++) {
    encrypted[16 + i] = valueBytes[i] ^ keyStream[i];
  }

  // Compute authentication tag (simulated)
  const tag = sha256(
    new Uint8Array([...context.sharedSecret, ...nonce, ...valueBytes])
  ).slice(0, 24);
  encrypted.set(tag, 24);

  // Random padding
  encrypted.set(randomBytes(16), 48);

  return encrypted;
}

/**
 * Decrypt a u64 value (for balance reveal)
 *
 * @param encrypted - The 64-byte encrypted value
 * @param context - Encryption context with shared secret
 * @returns The decrypted u64 value
 */
export function decryptU64(
  encrypted: EncryptedU64,
  context: EncryptionContext
): bigint {
  if (encrypted.length !== ENCRYPTED_VALUE_SIZE) {
    throw new Error(`Invalid encrypted value size: ${encrypted.length}`);
  }

  // Extract components
  const nonce = encrypted.slice(0, 16);
  const ciphertext = encrypted.slice(16, 24);

  // In production, use RescueCipher:
  // const cipher = new RescueCipher(context.sharedSecret);
  // const plaintext = cipher.decrypt(ciphertext, nonce);

  // Development simulation: XOR with key stream
  const keyStream = deriveKeyStream(context.sharedSecret, nonce, 8);

  const valueBytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    valueBytes[i] = ciphertext[i] ^ keyStream[i];
  }

  // Convert to bigint (little-endian)
  let value = BigInt(0);
  for (let i = 7; i >= 0; i--) {
    value = (value << BigInt(8)) | BigInt(valueBytes[i]);
  }

  return value;
}

/**
 * Encrypt order parameters (amount and price)
 *
 * @param amount - Order amount in base units
 * @param price - Order price in quote units per base unit
 * @param context - Encryption context
 * @returns Encrypted amount and price
 */
export function encryptOrderParams(
  amount: bigint,
  price: bigint,
  context: EncryptionContext
): {
  encryptedAmount: EncryptedU64;
  encryptedPrice: EncryptedU64;
} {
  return {
    encryptedAmount: encryptU64(amount, context),
    encryptedPrice: encryptU64(price, context),
  };
}

/**
 * Create a zero-encrypted value (for initial filled amounts)
 */
export function zeroEncrypted(context: EncryptionContext): EncryptedU64 {
  return encryptU64(BigInt(0), context);
}

/**
 * Derive a key stream from shared secret and nonce
 * (Simplified HKDF-like derivation for development)
 */
function deriveKeyStream(
  sharedSecret: Uint8Array,
  nonce: Uint8Array,
  length: number
): Uint8Array {
  const keyStream = new Uint8Array(length);
  let counter = 0;

  while (counter * 32 < length) {
    const input = new Uint8Array([
      ...sharedSecret,
      ...nonce,
      counter & 0xff,
      (counter >> 8) & 0xff,
    ]);
    const hash = sha256(input);
    const start = counter * 32;
    const copyLen = Math.min(32, length - start);
    keyStream.set(hash.slice(0, copyLen), start);
    counter++;
  }

  return keyStream;
}

/**
 * Verify that an encrypted value has valid structure
 */
export function isValidEncrypted(value: Uint8Array): boolean {
  return value.length === ENCRYPTED_VALUE_SIZE;
}

/**
 * Compare if two encrypted values could be equal
 * (Only checks structure, not actual equality - that requires MPC)
 */
export function encryptedStructureMatch(
  a: EncryptedU64,
  b: EncryptedU64
): boolean {
  return a.length === b.length && a.length === ENCRYPTED_VALUE_SIZE;
}
