import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  readU128LE,
  writeU128LE,
  extractFromV2Blob,
  buildComparePricesInput,
  validateV2Format,
  debugPrintBlob,
  ArciumInputs,
} from '../../crank/encryption-utils.js';

describe('encryption-utils', () => {
  describe('readU128LE', () => {
    it('reads zero correctly', () => {
      const data = new Uint8Array(16).fill(0);
      expect(readU128LE(data)).toBe(BigInt(0));
    });

    it('reads one correctly', () => {
      const data = new Uint8Array(16).fill(0);
      data[0] = 1; // Little-endian: LSB first
      expect(readU128LE(data)).toBe(BigInt(1));
    });

    it('reads max u128 correctly', () => {
      const data = new Uint8Array(16).fill(0xff);
      // Max u128 = 2^128 - 1
      const expected = (BigInt(1) << BigInt(128)) - BigInt(1);
      expect(readU128LE(data)).toBe(expected);
    });

    it('reads known value correctly', () => {
      // 0x0102030405060708091011121314151617 in little-endian
      const data = new Uint8Array([
        0xf0, 0xde, 0xbc, 0x9a, 0x78, 0x56, 0x34, 0x12,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      ]);
      // Little-endian: 0x123456789ABCDEF0
      expect(readU128LE(data)).toBe(BigInt('0x123456789ABCDEF0'));
    });

    it('handles arbitrary values', () => {
      const data = new Uint8Array([
        0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
        0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10,
      ]);
      // Should read as little-endian
      const result = readU128LE(data);
      expect(typeof result).toBe('bigint');
      expect(result > BigInt(0)).toBe(true);
    });
  });

  describe('writeU128LE', () => {
    it('writes zero correctly', () => {
      const result = writeU128LE(BigInt(0));
      expect(result.length).toBe(16);
      expect(result.every((b) => b === 0)).toBe(true);
    });

    it('writes one correctly', () => {
      const result = writeU128LE(BigInt(1));
      expect(result[0]).toBe(1);
      expect(result.slice(1).every((b) => b === 0)).toBe(true);
    });

    it('writes max u128 correctly', () => {
      const maxU128 = (BigInt(1) << BigInt(128)) - BigInt(1);
      const result = writeU128LE(maxU128);
      expect(result.every((b) => b === 0xff)).toBe(true);
    });

    it('writes known value correctly', () => {
      const value = BigInt('0x123456789ABCDEF0');
      const result = writeU128LE(value);
      expect(result[0]).toBe(0xf0);
      expect(result[1]).toBe(0xde);
      expect(result[2]).toBe(0xbc);
      expect(result[3]).toBe(0x9a);
      expect(result[4]).toBe(0x78);
      expect(result[5]).toBe(0x56);
      expect(result[6]).toBe(0x34);
      expect(result[7]).toBe(0x12);
    });

    it('is reversible with readU128LE', () => {
      const original = BigInt('0xFEDCBA9876543210FEDCBA9876543210');
      const written = writeU128LE(original);
      const readBack = readU128LE(written);
      expect(readBack).toBe(original);
    });
  });

  describe('extractFromV2Blob', () => {
    it('throws on invalid blob length', () => {
      expect(() => extractFromV2Blob(new Uint8Array(32))).toThrow(
        'Invalid V2 blob length: expected 64, got 32'
      );
      expect(() => extractFromV2Blob(new Uint8Array(128))).toThrow(
        'Invalid V2 blob length: expected 64, got 128'
      );
    });

    it('extracts components from valid V2 blob', () => {
      // Create a 64-byte V2 blob
      // Format: [nonce (16) | ciphertext (32) | ephemeral_pubkey (16)]
      const blob = new Uint8Array(64);

      // Set nonce (bytes 0-15)
      for (let i = 0; i < 16; i++) {
        blob[i] = i + 1;
      }

      // Set ciphertext (bytes 16-47)
      for (let i = 16; i < 48; i++) {
        blob[i] = i + 0x10;
      }

      // Set ephemeral pubkey (bytes 48-63)
      for (let i = 48; i < 64; i++) {
        blob[i] = i + 0x30;
      }

      const result = extractFromV2Blob(blob);

      expect(result.ciphertext.length).toBe(32);
      expect(result.truncatedEphemeralPubkey.length).toBe(16);
      expect(typeof result.nonce).toBe('bigint');
    });

    it('extracts correct nonce', () => {
      const blob = new Uint8Array(64).fill(0);
      // Set nonce as little-endian 42
      blob[0] = 42;

      const result = extractFromV2Blob(blob);

      expect(result.nonce).toBe(BigInt(42));
    });

    it('extracts correct ciphertext', () => {
      const blob = new Uint8Array(64).fill(0);
      // Set ciphertext bytes 16-47 to 0xAB
      for (let i = 16; i < 48; i++) {
        blob[i] = 0xab;
      }

      const result = extractFromV2Blob(blob);

      expect(result.ciphertext.length).toBe(32);
      expect(result.ciphertext.every((b) => b === 0xab)).toBe(true);
    });

    it('extracts correct truncated ephemeral pubkey', () => {
      const blob = new Uint8Array(64).fill(0);
      // Set ephemeral pubkey bytes 48-63 to 0xCD
      for (let i = 48; i < 64; i++) {
        blob[i] = 0xcd;
      }

      const result = extractFromV2Blob(blob);

      expect(result.truncatedEphemeralPubkey.length).toBe(16);
      expect(result.truncatedEphemeralPubkey.every((b) => b === 0xcd)).toBe(true);
    });

    it('returns new Uint8Array instances (not views)', () => {
      const blob = new Uint8Array(64).fill(0x55);

      const result = extractFromV2Blob(blob);

      // Modify original blob
      blob.fill(0xff);

      // Result should not be affected
      expect(result.ciphertext.every((b) => b === 0x55)).toBe(true);
      expect(result.truncatedEphemeralPubkey.every((b) => b === 0x55)).toBe(true);
    });
  });

  describe('buildComparePricesInput', () => {
    it('creates 112-byte output buffer', () => {
      const buyInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32).fill(0x11),
        nonce: BigInt(123),
        truncatedEphemeralPubkey: new Uint8Array(16).fill(0x22),
      };

      const sellInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32).fill(0x33),
        nonce: BigInt(456),
        truncatedEphemeralPubkey: new Uint8Array(16).fill(0x44),
      };

      const ephemeralPubkey = new Uint8Array(32).fill(0x55);

      const result = buildComparePricesInput(buyInputs, sellInputs, ephemeralPubkey);

      expect(result.length).toBe(112);
    });

    it('places buy ciphertext in bytes 0-31', () => {
      const buyInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32).fill(0xaa),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const sellInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32).fill(0xbb),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const ephemeralPubkey = new Uint8Array(32);

      const result = buildComparePricesInput(buyInputs, sellInputs, ephemeralPubkey);

      const buyCiphertext = result.slice(0, 32);
      expect(buyCiphertext.every((b) => b === 0xaa)).toBe(true);
    });

    it('places sell ciphertext in bytes 32-63', () => {
      const buyInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32).fill(0xaa),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const sellInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32).fill(0xbb),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const ephemeralPubkey = new Uint8Array(32);

      const result = buildComparePricesInput(buyInputs, sellInputs, ephemeralPubkey);

      const sellCiphertext = result.slice(32, 64);
      expect(sellCiphertext.every((b) => b === 0xbb)).toBe(true);
    });

    it('places buy nonce in bytes 64-79', () => {
      const buyInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32),
        nonce: BigInt(42),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const sellInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32),
        nonce: BigInt(999), // Should be ignored - buy nonce is used
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const ephemeralPubkey = new Uint8Array(32);

      const result = buildComparePricesInput(buyInputs, sellInputs, ephemeralPubkey);

      const nonceBytes = result.slice(64, 80);
      const readNonce = readU128LE(nonceBytes);
      expect(readNonce).toBe(BigInt(42));
    });

    it('places ephemeral pubkey in bytes 80-111', () => {
      const buyInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const sellInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const ephemeralPubkey = new Uint8Array(32).fill(0xee);

      const result = buildComparePricesInput(buyInputs, sellInputs, ephemeralPubkey);

      const pubkeyBytes = result.slice(80, 112);
      expect(pubkeyBytes.every((b) => b === 0xee)).toBe(true);
    });

    it('truncates ephemeral pubkey if longer than 32 bytes', () => {
      const buyInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      const sellInputs: ArciumInputs = {
        ciphertext: new Uint8Array(32),
        nonce: BigInt(0),
        truncatedEphemeralPubkey: new Uint8Array(16),
      };

      // Provide a longer pubkey - should be truncated to 32 bytes
      const ephemeralPubkey = new Uint8Array(64).fill(0xff);

      const result = buildComparePricesInput(buyInputs, sellInputs, ephemeralPubkey);

      expect(result.length).toBe(112);
      const pubkeyBytes = result.slice(80, 112);
      expect(pubkeyBytes.length).toBe(32);
    });
  });

  describe('validateV2Format', () => {
    it('throws for wrong length', () => {
      expect(() => validateV2Format(new Uint8Array(32))).toThrow(
        'Invalid blob length: expected 64 bytes'
      );
      expect(() => validateV2Format(new Uint8Array(128))).toThrow(
        'Invalid blob length: expected 64 bytes'
      );
      expect(() => validateV2Format(new Uint8Array(0))).toThrow(
        'Invalid blob length: expected 64 bytes'
      );
    });

    it('throws for V1-like format (zeros in bytes 8-15)', () => {
      // V1-like format: bytes 8-15 are all zeros (looks like padding after plaintext)
      const v1Blob = new Uint8Array(64);
      // Set data in first 8 bytes
      v1Blob[0] = 0x42;
      v1Blob[1] = 0x01;
      // Bytes 8-15 are zeros (uninitialized nonce region)
      // Rest has some data (ciphertext)
      for (let i = 16; i < 64; i++) {
        v1Blob[i] = i;
      }

      expect(() => validateV2Format(v1Blob)).toThrow(
        'V1 format is no longer supported'
      );
    });

    it('does not throw for valid V2 format (high entropy in bytes 8-15)', () => {
      // V2 format: bytes 0-15 are nonce (high entropy)
      const v2Blob = new Uint8Array(64);
      for (let i = 0; i < 16; i++) {
        v2Blob[i] = Math.floor(Math.random() * 256);
      }
      // Ensure bytes 8-15 have at least one non-zero byte
      v2Blob[10] = 0xab;
      // Fill rest with random data
      for (let i = 16; i < 64; i++) {
        v2Blob[i] = Math.floor(Math.random() * 256);
      }

      expect(() => validateV2Format(v2Blob)).not.toThrow();
    });

    it('accepts V2 format with single non-zero byte in 8-15', () => {
      const blob = new Uint8Array(64).fill(0);
      // Set just one non-zero byte in range 8-15
      blob[12] = 0x01;

      expect(() => validateV2Format(blob)).not.toThrow();
    });

    it('rejects blob with all zeros in nonce region (bytes 8-15)', () => {
      const blob = new Uint8Array(64).fill(0);
      // First 8 bytes can have data
      blob[0] = 0x42;
      // Bytes 8-15 are zeros (uninitialized)
      // Bytes 16+ can have data
      blob[20] = 0xff;

      expect(() => validateV2Format(blob)).toThrow(
        'V1 format is no longer supported'
      );
    });
  });

  describe('debugPrintBlob', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('prints blob with default label', () => {
      const blob = new Uint8Array(64).fill(0x42);

      debugPrintBlob(blob);

      expect(consoleSpy).toHaveBeenCalledWith('[blob] Length: 64');
    });

    it('prints blob with custom label', () => {
      const blob = new Uint8Array(64).fill(0x42);

      debugPrintBlob(blob, 'myBlob');

      expect(consoleSpy).toHaveBeenCalledWith('[myBlob] Length: 64');
    });

    it('prints byte sections', () => {
      const blob = new Uint8Array(64).fill(0);
      blob[0] = 0xab;
      blob[10] = 0xff; // Make it valid V2 format

      debugPrintBlob(blob);

      // Should print multiple sections: Length + 3 byte sections + V2 nonce
      expect(consoleSpy).toHaveBeenCalledTimes(5);
    });

    it('prints V2 nonce for valid V2 format', () => {
      const blob = new Uint8Array(64);
      // Make it V2 format (non-zero in bytes 8-15)
      blob[10] = 0xff;

      debugPrintBlob(blob);

      // Should include V2 nonce line
      const calls = consoleSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes('V2 nonce'))).toBe(true);
    });

    it('prints error for invalid format', () => {
      const blob = new Uint8Array(64);
      // Make it look like V1 (zeros in bytes 8-15)
      blob[0] = 42;

      debugPrintBlob(blob);

      // Should include error message since V1 is no longer supported
      const calls = consoleSpy.mock.calls.map((c) => String(c));
      // Error is logged with the exception
      expect(calls.some((c) => c.includes('Error') || c.includes('V1'))).toBe(true);
    });

    it('converts bytes to hex correctly', () => {
      const blob = new Uint8Array(64).fill(0);
      blob[0] = 0x0f; // Should be '0f' with padding
      blob[10] = 0xff; // Make it valid V2

      debugPrintBlob(blob);

      // Check that hex is formatted with padding
      const calls = consoleSpy.mock.calls.map((c) => c[0]);
      const bytesLine = calls.find((c) => c.includes('nonce'));
      expect(bytesLine).toContain('0f');
    });
  });

  describe('roundtrip tests', () => {
    it('read/write u128 roundtrip preserves value', () => {
      const testValues = [
        BigInt(0),
        BigInt(1),
        BigInt(255),
        BigInt(256),
        BigInt('18446744073709551615'), // max u64
        BigInt('340282366920938463463374607431768211455'), // max u128
        BigInt('123456789012345678901234567890'),
      ];

      for (const value of testValues) {
        const written = writeU128LE(value);
        const readBack = readU128LE(written);
        expect(readBack).toBe(value);
      }
    });

    it('extract and rebuild preserves data structure', () => {
      // Create a valid V2 blob
      const originalBlob = new Uint8Array(64);
      for (let i = 0; i < 64; i++) {
        originalBlob[i] = i;
      }
      // Ensure V2 format (non-zero in bytes 8-15)
      originalBlob[10] = 0xff;

      const inputs = extractFromV2Blob(originalBlob);

      // Verify extracted components match original blob sections
      expect(inputs.ciphertext).toEqual(originalBlob.slice(16, 48));
      expect(inputs.truncatedEphemeralPubkey).toEqual(originalBlob.slice(48, 64));
    });
  });
});
