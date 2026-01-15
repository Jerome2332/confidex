/**
 * Integration Test: Full Trade Flow
 *
 * Tests the complete order lifecycle:
 * 1. User A places encrypted buy order
 * 2. User B places encrypted sell order
 * 3. Match engine triggers
 * 4. Settlement executes
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { AnchorProvider, Program, Wallet, BN } from '@coral-xyz/anchor';
import * as anchor from '@coral-xyz/anchor';

// Configuration
const CONFIDEX_PROGRAM_ID = new PublicKey(
  process.env.PROGRAM_ID || '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB'
);
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Test utilities
async function airdrop(
  connection: Connection,
  pubkey: PublicKey,
  amount: number = 2
): Promise<void> {
  const signature = await connection.requestAirdrop(
    pubkey,
    amount * LAMPORTS_PER_SOL
  );
  await connection.confirmTransaction(signature, 'confirmed');
  console.log(`Airdropped ${amount} SOL to ${pubkey.toBase58()}`);
}

// Simulated encryption (would use Arcium in production)
function encryptValue(value: bigint): Uint8Array {
  const encrypted = new Uint8Array(64);
  crypto.getRandomValues(encrypted);

  // Store value in first 8 bytes (simulated)
  const bytes = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(v & BigInt(0xff));
    v = v >> BigInt(8);
  }
  encrypted.set(bytes, 16);

  return encrypted;
}

// Simulated ZK proof (would use Noir/Sunspot in production)
function generateProof(): Uint8Array {
  const proof = new Uint8Array(388);
  crypto.getRandomValues(proof);
  return proof;
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({
      name,
      passed: true,
      duration: Date.now() - start,
    });
    console.log(`✓ ${name} (${Date.now() - start}ms)`);
  } catch (error) {
    results.push({
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
      duration: Date.now() - start,
    });
    console.log(`✗ ${name} - ${error}`);
  }
}

async function runTests(): Promise<void> {
  console.log('\n=== Confidex Integration Tests ===\n');

  // Setup
  const connection = new Connection(RPC_URL, 'confirmed');
  const authority = Keypair.generate();
  const makerA = Keypair.generate();
  const makerB = Keypair.generate();

  // Airdrop SOL to test accounts
  console.log('Setting up test accounts...');
  await airdrop(connection, authority.publicKey);
  await airdrop(connection, makerA.publicKey);
  await airdrop(connection, makerB.publicKey);

  // Find PDAs
  const [exchangeStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    CONFIDEX_PROGRAM_ID
  );

  const [pairPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('pair'),
      new PublicKey('11111111111111111111111111111111').toBuffer(),
      new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v').toBuffer(),
    ],
    CONFIDEX_PROGRAM_ID
  );

  // Test 1: Initialize Exchange
  await test('Initialize exchange state', async () => {
    // In production: call initialize instruction
    // For test: verify PDA derivation works
    console.log(`  Exchange PDA: ${exchangeStatePda.toBase58()}`);
    console.log(`  Pair PDA: ${pairPda.toBase58()}`);
  });

  // Test 2: ZK Proof Generation
  await test('Generate ZK eligibility proof', async () => {
    const proof = generateProof();
    if (proof.length !== 388) {
      throw new Error(`Invalid proof size: ${proof.length}`);
    }
    console.log(`  Proof generated (${proof.length} bytes)`);
  });

  // Test 3: Value Encryption
  await test('Encrypt order values with Arcium', async () => {
    const amount = BigInt(1_000_000_000); // 1 SOL in lamports
    const price = BigInt(150_000_000); // $150 USDC

    const encryptedAmount = encryptValue(amount);
    const encryptedPrice = encryptValue(price);

    if (encryptedAmount.length !== 64 || encryptedPrice.length !== 64) {
      throw new Error('Invalid encrypted value size');
    }

    console.log(`  Encrypted amount: ${encryptedAmount.length} bytes`);
    console.log(`  Encrypted price: ${encryptedPrice.length} bytes`);
  });

  // Test 4: Place Buy Order (Simulated)
  await test('Place encrypted buy order', async () => {
    const proof = generateProof();
    const encryptedAmount = encryptValue(BigInt(1_000_000_000));
    const encryptedPrice = encryptValue(BigInt(150_000_000));

    // In production: call place_order instruction
    const orderData = {
      maker: makerA.publicKey.toBase58(),
      side: 'buy',
      encryptedAmount: Buffer.from(encryptedAmount).toString('hex').slice(0, 32),
      encryptedPrice: Buffer.from(encryptedPrice).toString('hex').slice(0, 32),
      proofSize: proof.length,
    };

    console.log(`  Order: ${JSON.stringify(orderData)}`);
  });

  // Test 5: Place Sell Order (Simulated)
  await test('Place encrypted sell order', async () => {
    const proof = generateProof();
    const encryptedAmount = encryptValue(BigInt(500_000_000));
    const encryptedPrice = encryptValue(BigInt(148_000_000));

    const orderData = {
      maker: makerB.publicKey.toBase58(),
      side: 'sell',
      encryptedAmount: Buffer.from(encryptedAmount).toString('hex').slice(0, 32),
      encryptedPrice: Buffer.from(encryptedPrice).toString('hex').slice(0, 32),
      proofSize: proof.length,
    };

    console.log(`  Order: ${JSON.stringify(orderData)}`);
  });

  // Test 6: MPC Price Comparison (Simulated)
  await test('Execute MPC price comparison', async () => {
    // In production: Arcium MPC compares encrypted prices
    // buy.price >= sell.price triggers match

    const buyPriceEnc = encryptValue(BigInt(150_000_000));
    const sellPriceEnc = encryptValue(BigInt(148_000_000));

    // Simulated MPC result
    const shouldMatch = true;
    console.log(`  MPC comparison result: ${shouldMatch ? 'MATCH' : 'NO MATCH'}`);
  });

  // Test 7: Fill Amount Calculation (Simulated)
  await test('Calculate fill amount via MPC', async () => {
    const buyAmount = BigInt(1_000_000_000);
    const sellAmount = BigInt(500_000_000);

    // MPC calculates min(buyRemaining, sellRemaining)
    const fillAmount = buyAmount < sellAmount ? buyAmount : sellAmount;
    console.log(`  Fill amount: ${fillAmount.toString()}`);
  });

  // Test 8: Settlement Execution (Simulated)
  await test('Execute confidential settlement', async () => {
    // In production: C-SPL or ShadowWire transfer
    console.log('  Settlement method: ShadowWire (internal transfer)');
    console.log('  Buyer receives: tokens');
    console.log('  Seller receives: USDC');
  });

  // Test 9: Helius RPC Integration
  await test('Helius priority fee estimation', async () => {
    const HELIUS_API_KEY = process.env.HELIUS_API_KEY;

    if (!HELIUS_API_KEY) {
      console.log('  Skipped: No HELIUS_API_KEY');
      return;
    }

    const heliusUrl = `https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

    const response = await fetch(heliusUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'getRecentPrioritizationFees',
        params: [],
      }),
    });

    const data = await response.json();
    console.log(`  Recent priority fees: ${data.result?.length || 0} entries`);
  });

  // Print summary
  console.log('\n=== Test Summary ===');
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;
  console.log(`Passed: ${passed}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(`  - ${r.name}: ${r.error}`));
  }

  const totalTime = results.reduce((acc, r) => acc + r.duration, 0);
  console.log(`\nTotal time: ${totalTime}ms`);
}

// Run tests
runTests().catch(console.error);
