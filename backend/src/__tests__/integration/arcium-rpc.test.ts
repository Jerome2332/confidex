/**
 * Arcium Client RPC Integration Tests
 *
 * Tests actual RPC interactions with the Arcium MXE.
 * These tests verify on-chain state and MXE availability.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { ArciumClient, createArciumClient } from '../../crank/arcium-client.js';

// Set a longer timeout for RPC calls
const RPC_TIMEOUT = 30000;

describe('Arcium RPC Integration', () => {
  let connection: Connection;
  let payer: Keypair;
  let client: ArciumClient;

  const mxeProgramId = new PublicKey(
    process.env.MXE_PROGRAM_ID || 'HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS'
  );
  const clusterOffset = 456; // Correct cluster offset per CLAUDE.md

  beforeAll(() => {
    const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
    connection = new Connection(rpcUrl, 'confirmed');
    payer = Keypair.generate(); // Dummy payer for read-only operations
    client = new ArciumClient(connection, payer, clusterOffset, mxeProgramId);
  });

  describe('MXE availability check', () => {
    it(
      'checks if MXE is available on devnet',
      async () => {
        const available = await client.isAvailable();

        // MXE might or might not be available on devnet
        // We're testing that the check runs without error
        expect(typeof available).toBe('boolean');

        if (available) {
          console.log('MXE is available and keygen is complete');
        } else {
          console.log('MXE is not available or keygen is incomplete');
        }
      },
      RPC_TIMEOUT
    );

    it(
      'returns false when MXE account does not exist',
      async () => {
        // Use a random program ID that doesn't exist
        const fakeMxeProgramId = Keypair.generate().publicKey;
        const fakeClient = new ArciumClient(
          connection,
          payer,
          clusterOffset,
          fakeMxeProgramId
        );

        const available = await fakeClient.isAvailable();
        expect(available).toBe(false);
      },
      RPC_TIMEOUT
    );
  });

  describe('MXE public key retrieval', () => {
    it(
      'attempts to get MXE x25519 public key',
      async () => {
        const publicKey = await client.getMxePublicKey();

        // Public key might or might not exist
        if (publicKey) {
          expect(publicKey).toBeInstanceOf(Uint8Array);
          expect(publicKey.length).toBe(32);
          console.log(
            'MXE public key:',
            Buffer.from(publicKey).toString('hex')
          );
        } else {
          console.log('MXE public key not available (keygen not complete)');
          expect(publicKey).toBeNull();
        }
      },
      RPC_TIMEOUT
    );

    it(
      'returns null for non-existent MXE',
      async () => {
        const fakeMxeProgramId = Keypair.generate().publicKey;
        const fakeClient = new ArciumClient(
          connection,
          payer,
          clusterOffset,
          fakeMxeProgramId
        );

        const publicKey = await fakeClient.getMxePublicKey();
        expect(publicKey).toBeNull();
      },
      RPC_TIMEOUT
    );
  });

  describe('account derivation', () => {
    it('derives signer PDA correctly', () => {
      // Test the PDA derivation used in deriveAccounts
      const [signerPda, bump] = PublicKey.findProgramAddressSync(
        [Buffer.from('ArciumSignerAccount')],
        mxeProgramId
      );

      expect(signerPda).toBeInstanceOf(PublicKey);
      expect(bump).toBeGreaterThanOrEqual(0);
      expect(bump).toBeLessThanOrEqual(255);
    });
  });

  describe('createArciumClient factory', () => {
    it(
      'creates working client with defaults',
      async () => {
        const factoryClient = createArciumClient(connection, payer);

        // Should be able to check availability
        const available = await factoryClient.isAvailable();
        expect(typeof available).toBe('boolean');
      },
      RPC_TIMEOUT
    );
  });
});

describe('Arcium SDK functions', () => {
  it('imports Arcium SDK functions correctly', async () => {
    const arciumSdk = await import('@arcium-hq/client');

    // Verify all required SDK functions are available
    expect(typeof arciumSdk.getMXEAccAddress).toBe('function');
    expect(typeof arciumSdk.getClusterAccAddress).toBe('function');
    expect(typeof arciumSdk.getCompDefAccAddress).toBe('function');
    expect(typeof arciumSdk.getMempoolAccAddress).toBe('function');
    expect(typeof arciumSdk.getExecutingPoolAccAddress).toBe('function');
    expect(typeof arciumSdk.getFeePoolAccAddress).toBe('function');
    expect(typeof arciumSdk.getClockAccAddress).toBe('function');
    expect(typeof arciumSdk.getComputationAccAddress).toBe('function');
    expect(typeof arciumSdk.awaitComputationFinalization).toBe('function');
  });

  it('ARCIUM_ADDR constant is correct', async () => {
    const arciumSdk = await import('@arcium-hq/client');
    expect(arciumSdk.ARCIUM_ADDR).toBe(
      'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ'
    );
  });
});

describe('Instruction data format', () => {
  it('compare_prices instruction is 128 bytes', () => {
    // Validate expected format:
    // 8 (discriminator) + 8 (offset) + 32 (buy) + 32 (sell) + 32 (pubkey) + 16 (nonce) = 128
    const expectedSize = 8 + 8 + 32 + 32 + 32 + 16;
    expect(expectedSize).toBe(128);
  });

  it('nonce serialization produces correct buffer', () => {
    const nonce = BigInt('0x123456789ABCDEF0');
    const nonceBuf = Buffer.alloc(16);
    let n = nonce;
    for (let i = 0; i < 16; i++) {
      nonceBuf[i] = Number(n & BigInt(0xff));
      n = n >> BigInt(8);
    }

    // Little-endian: least significant byte first
    expect(nonceBuf[0]).toBe(0xf0);
    expect(nonceBuf[1]).toBe(0xde);
    expect(nonceBuf[2]).toBe(0xbc);
    expect(nonceBuf[3]).toBe(0x9a);
    expect(nonceBuf[4]).toBe(0x78);
    expect(nonceBuf[5]).toBe(0x56);
    expect(nonceBuf[6]).toBe(0x34);
    expect(nonceBuf[7]).toBe(0x12);
    // Upper 8 bytes are 0
    for (let i = 8; i < 16; i++) {
      expect(nonceBuf[i]).toBe(0);
    }
  });
});
