/**
 * Encryption Utilities for Production MPC
 *
 * Extracts components from V2 encrypted blobs for Arcium MPC operations.
 *
 * V2 Format: [nonce (16 bytes) | ciphertext (32 bytes) | ephemeral_pubkey (16 bytes)]
 * Total: 64 bytes
 *
 * Note: The ephemeral pubkey in the blob is truncated to 16 bytes.
 * For production MPC, we use the full 32-byte ephemeral pubkey stored on the order account.
 */

/**
 * Components extracted from a V2 encrypted blob
 */
export interface ArciumInputs {
  /** 32-byte ciphertext for MPC operations */
  ciphertext: Uint8Array;
  /** 128-bit nonce as bigint */
  nonce: bigint;
  /** Truncated 16-byte ephemeral pubkey from blob (use full key from order account instead) */
  truncatedEphemeralPubkey: Uint8Array;
}

/**
 * Read a u128 (16 bytes) as little-endian bigint
 */
export function readU128LE(data: Uint8Array): bigint {
  let result = BigInt(0);
  for (let i = 15; i >= 0; i--) {
    result = (result << BigInt(8)) | BigInt(data[i]);
  }
  return result;
}

/**
 * Write a bigint as u128 little-endian bytes
 */
export function writeU128LE(value: bigint): Uint8Array {
  const result = new Uint8Array(16);
  let v = value;
  for (let i = 0; i < 16; i++) {
    result[i] = Number(v & BigInt(0xff));
    v = v >> BigInt(8);
  }
  return result;
}

/**
 * Extract components from a V2 encrypted blob
 *
 * @param blob - 64-byte V2 encrypted blob
 * @returns Extracted components for MPC operations
 */
export function extractFromV2Blob(blob: Uint8Array): ArciumInputs {
  if (blob.length !== 64) {
    throw new Error(`Invalid V2 blob length: expected 64, got ${blob.length}`);
  }

  // V2 Format: [nonce (16) | ciphertext (32) | ephemeral_pubkey (16)]
  const nonce = readU128LE(blob.slice(0, 16));
  const ciphertext = blob.slice(16, 48);
  const truncatedEphemeralPubkey = blob.slice(48, 64);

  return {
    ciphertext: new Uint8Array(ciphertext),
    nonce,
    truncatedEphemeralPubkey: new Uint8Array(truncatedEphemeralPubkey),
  };
}

/**
 * Build input data for Arcium compare_prices computation
 *
 * @param buyInputs - Extracted inputs from buy order's encrypted price
 * @param sellInputs - Extracted inputs from sell order's encrypted price
 * @param ephemeralPubkey - Full 32-byte ephemeral pubkey from order account
 * @returns Combined input buffer for MPC operation
 */
export function buildComparePricesInput(
  buyInputs: ArciumInputs,
  sellInputs: ArciumInputs,
  ephemeralPubkey: Uint8Array
): Uint8Array {
  // Format: [buy_ciphertext(32) | sell_ciphertext(32) | nonce(16) | ephemeral_pubkey(32)]
  // Total: 112 bytes

  const result = new Uint8Array(112);

  // Buy price ciphertext (32 bytes)
  result.set(buyInputs.ciphertext, 0);

  // Sell price ciphertext (32 bytes)
  result.set(sellInputs.ciphertext, 32);

  // Use buy order's nonce (both should decrypt with same MXE key)
  const nonceBytes = writeU128LE(buyInputs.nonce);
  result.set(nonceBytes, 64);

  // Full ephemeral pubkey from order account (32 bytes)
  result.set(ephemeralPubkey.slice(0, 32), 80);

  return result;
}

/**
 * Validate that a blob is V2 format
 *
 * V2 is the ONLY supported format - V1 (plaintext prefix) has been removed.
 * This function throws if the blob is not valid V2 format.
 *
 * @throws Error if blob is not valid V2 format
 */
export function validateV2Format(blob: Uint8Array): void {
  if (blob.length !== 64) {
    throw new Error(`Invalid blob length: expected 64 bytes (V2 format), got ${blob.length}`);
  }

  // V2 format should have high entropy nonce in bytes 8-15
  // If all zeros, it's likely an uninitialized or V1 format blob
  const bytes8to15 = blob.slice(8, 16);
  const isLikelyUninitialized = bytes8to15.every((b) => b === 0);

  if (isLikelyUninitialized) {
    throw new Error('Invalid V2 blob: nonce region appears uninitialized (all zeros). V1 format is no longer supported.');
  }
}

/**
 * Debug helper: print V2 blob structure
 *
 * Only supports V2 format. V1 format has been removed.
 */
export function debugPrintBlob(blob: Uint8Array, label: string = 'blob'): void {
  const toHex = (arr: Uint8Array) =>
    Array.from(arr)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  console.log(`[${label}] Length: ${blob.length}`);
  console.log(`  Bytes 0-15 (nonce):   ${toHex(blob.slice(0, 16))}`);
  console.log(`  Bytes 16-47 (cipher): ${toHex(blob.slice(16, 48))}`);
  console.log(`  Bytes 48-63 (ephem):  ${toHex(blob.slice(48, 64))}`);

  if (blob.length === 64) {
    try {
      // Validate format first (throws if V1-like)
      validateV2Format(blob);
      const inputs = extractFromV2Blob(blob);
      console.log(`  V2 nonce: ${inputs.nonce}`);
    } catch (e) {
      console.log(`  Error: ${e instanceof Error ? e.message : e}`);
    }
  }
}
