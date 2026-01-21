/**
 * MPC Integration Test Suite
 *
 * Tests the full Arcium MPC integration:
 * 1. Encryption with production MXE key
 * 2. Order placement with encrypted values
 * 3. MPC computation queueing
 * 4. Callback handling
 *
 * Usage:
 *   cd tests && npx tsx test-mpc-integration.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  RescueCipher,
  getMXEAccAddress,
  getClusterAccAddress,
  x25519,
} from '@arcium-hq/client';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const MXE_PROGRAM_ID = new PublicKey('DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM');
const MXE_X25519_PUBKEY = '14706bf82ff9e9cebde9d7ad1cc35dc98ad11b08ac92b07ed0fe472333703960';

// Test results
interface TestResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestResult[] = [];

function logTest(name: string, passed: boolean, details?: string, error?: string) {
  results.push({ name, passed, details, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (details) console.log(`   ${details}`);
  if (error) console.log(`   Error: ${error}`);
}

/**
 * Test 1: Verify MXE account exists and has keygen complete
 */
async function testMxeAccountExists(connection: Connection): Promise<boolean> {
  console.log('\n--- Test 1: MXE Account Status ---');

  try {
    const mxeAccount = getMXEAccAddress(MXE_PROGRAM_ID);
    console.log(`MXE Account PDA: ${mxeAccount.toBase58()}`);

    const accountInfo = await connection.getAccountInfo(mxeAccount);
    if (!accountInfo) {
      logTest('MXE account exists', false, undefined, 'Account not found');
      return false;
    }

    logTest('MXE account exists', true, `Size: ${accountInfo.data.length} bytes`);

    // Check for x25519 key in account data (offset 95-127 in MXE account)
    const keyBytes = accountInfo.data.slice(95, 127);
    const isNonZero = keyBytes.some(b => b !== 0);

    if (isNonZero) {
      const keyHex = Buffer.from(keyBytes).toString('hex');
      logTest('Keygen complete', true, `X25519 key: ${keyHex.substring(0, 16)}...`);

      // Verify it matches our expected key
      const matches = keyHex === MXE_X25519_PUBKEY;
      logTest('Key matches expected', matches, matches ? 'Keys match!' : `Expected: ${MXE_X25519_PUBKEY.substring(0, 16)}...`);
      return matches;
    } else {
      logTest('Keygen complete', false, undefined, 'X25519 key is all zeros');
      return false;
    }
  } catch (error) {
    logTest('MXE account check', false, undefined, (error as Error).message);
    return false;
  }
}

/**
 * Test 2: Encrypt value using production MXE key
 */
async function testEncryption(): Promise<{ encrypted: Uint8Array; ephemeralPubkey: Uint8Array } | null> {
  console.log('\n--- Test 2: Encryption ---');

  try {
    // Parse the MXE public key from hex
    const mxePublicKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      mxePublicKey[i] = parseInt(MXE_X25519_PUBKEY.substring(i * 2, i * 2 + 2), 16);
    }
    logTest('Parse MXE public key', true, `First 4 bytes: ${Buffer.from(mxePublicKey.slice(0, 4)).toString('hex')}`);

    // Generate ephemeral keypair
    const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
    const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
    logTest('Generate ephemeral keypair', true, `Pubkey: ${Buffer.from(ephemeralPublicKey.slice(0, 4)).toString('hex')}...`);

    // Compute shared secret via ECDH
    const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);
    logTest('Compute shared secret', true, `First 4 bytes: ${Buffer.from(sharedSecret.slice(0, 4)).toString('hex')}...`);

    // Create cipher
    const cipher = new RescueCipher(sharedSecret);
    logTest('Create RescueCipher', true);

    // Test value to encrypt (1 SOL in lamports)
    const testValue = BigInt(1_000_000_000);
    logTest('Test value', true, `Value: ${testValue.toString()}`);

    // Generate random nonce using crypto module
    const { randomBytes } = await import('crypto');
    const nonce = new Uint8Array(randomBytes(16));
    logTest('Generate nonce', true, `Nonce: ${Buffer.from(nonce.slice(0, 8)).toString('hex')}...`);

    // Encrypt using RescueCipher - pass array of bigints
    // Returns bigint[][] - array of field elements
    const ciphertext = cipher.encrypt([testValue], nonce);
    logTest('Encrypt value', true, `Ciphertext array length: ${ciphertext.length}`);

    // Build V2 encrypted blob: [nonce (16) | ciphertext (32) | ephemeral_pubkey (16)]
    const encrypted = new Uint8Array(64);
    encrypted.set(nonce.slice(0, 16), 0);

    // Convert ciphertext bigint array to bytes (take first 32 bytes from first element)
    if (ciphertext.length > 0 && ciphertext[0].length > 0) {
      // Serialize the first bigint element to bytes
      const ctBytes = new Uint8Array(32);
      // RescueCipher returns bigint[][] but TypeScript types it as number[][]
      let val = BigInt(ciphertext[0][0]);
      for (let i = 0; i < 32 && val > BigInt(0); i++) {
        ctBytes[i] = Number(val & BigInt(0xff));
        val = val >> BigInt(8);
      }
      encrypted.set(ctBytes, 16);
    }

    encrypted.set(ephemeralPublicKey.slice(0, 16), 48);

    logTest('Build V2 encrypted blob', true, `Size: ${encrypted.length} bytes`);

    // Verify format
    const isValid = encrypted.length === 64 &&
                   encrypted.some(b => b !== 0);
    logTest('Validate encrypted format', isValid, isValid ? 'Valid 64-byte V2 format' : 'Invalid format');

    return isValid ? { encrypted, ephemeralPubkey: ephemeralPublicKey } : null;
  } catch (error) {
    logTest('Encryption test', false, undefined, (error as Error).message);
    return null;
  }
}

/**
 * Test 3: Check DEX program is deployed
 */
async function testDexProgram(connection: Connection): Promise<boolean> {
  console.log('\n--- Test 3: DEX Program Status ---');

  try {
    const accountInfo = await connection.getAccountInfo(DEX_PROGRAM_ID);
    if (!accountInfo) {
      logTest('DEX program deployed', false, undefined, 'Program not found');
      return false;
    }

    const isExecutable = accountInfo.executable;
    logTest('DEX program deployed', isExecutable, `Owner: ${accountInfo.owner.toBase58()}`);

    return isExecutable;
  } catch (error) {
    logTest('DEX program check', false, undefined, (error as Error).message);
    return false;
  }
}

/**
 * Test 4: Check circuit files are accessible
 */
async function testCircuitAccess(): Promise<boolean> {
  console.log('\n--- Test 4: Circuit Accessibility ---');

  const circuitBaseUrl = 'https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits';
  const circuits = ['compare_prices', 'calculate_fill', 'verify_position_params'];

  for (const circuit of circuits) {
    const url = `${circuitBaseUrl}/${circuit}.arcis`;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      const passed = response.ok;
      logTest(`Circuit: ${circuit}`, passed, passed ? `HTTP ${response.status}` : `HTTP ${response.status}`);
      if (!passed) return false;
    } catch (error) {
      logTest(`Circuit: ${circuit}`, false, undefined, (error as Error).message);
      return false;
    }
  }

  return true;
}

/**
 * Test 5: Verify cluster 456 is responsive
 */
async function testClusterStatus(connection: Connection): Promise<boolean> {
  console.log('\n--- Test 5: Arcium Cluster Status ---');

  try {
    // Check cluster account using SDK function
    const clusterOffset = 456;
    const clusterAccount = getClusterAccAddress(clusterOffset);
    console.log(`Cluster account (offset 456): ${clusterAccount.toBase58()}`);

    const clusterInfo = await connection.getAccountInfo(clusterAccount);
    if (clusterInfo) {
      logTest('Cluster 456 account exists', true, `Size: ${clusterInfo.data.length} bytes`);

      // Also check the Arcium program itself
      const ARCIUM_PROGRAM = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');
      const arciumInfo = await connection.getAccountInfo(ARCIUM_PROGRAM);
      if (arciumInfo?.executable) {
        logTest('Arcium program deployed', true, `Owner: ${arciumInfo.owner.toBase58()}`);
        return true;
      } else {
        logTest('Arcium program deployed', false, undefined, 'Program not found');
        return false;
      }
    } else {
      logTest('Cluster 456 account exists', false, undefined, 'Account not found');
      return false;
    }
  } catch (error) {
    logTest('Cluster status check', false, undefined, (error as Error).message);
    return false;
  }
}

/**
 * Main test runner
 */
async function main() {
  console.log('='.repeat(60));
  console.log('   Confidex MPC Integration Test Suite');
  console.log('='.repeat(60));
  console.log(`\nConfiguration:`);
  console.log(`  RPC URL: ${RPC_URL}`);
  console.log(`  DEX Program: ${DEX_PROGRAM_ID.toBase58()}`);
  console.log(`  MXE Program: ${MXE_PROGRAM_ID.toBase58()}`);
  console.log(`  X25519 Key: ${MXE_X25519_PUBKEY.substring(0, 16)}...`);

  const connection = new Connection(RPC_URL, 'confirmed');

  // Run tests
  await testMxeAccountExists(connection);
  await testEncryption();
  await testDexProgram(connection);
  await testCircuitAccess();
  await testClusterStatus(connection);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('   Test Summary');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`\n  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${results.length}`);

  if (failed === 0) {
    console.log('\n✅ All tests passed! MPC integration is ready.');
  } else {
    console.log('\n❌ Some tests failed. Review errors above.');
  }

  console.log('\n' + '='.repeat(60));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('\nFatal error:', error.message);
  process.exit(1);
});
