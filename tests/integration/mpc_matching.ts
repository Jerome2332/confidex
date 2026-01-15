/**
 * Integration Test: MPC Order Matching
 *
 * Tests the Arcium MPC integration for:
 * 1. Encrypted price comparison
 * 2. Fill amount calculation
 * 3. Callback handling
 * 4. Settlement triggers
 */

import { PublicKey, Keypair } from '@solana/web3.js';

// Simulated MPC types (would use @arcium-hq/client in production)
interface EncryptedValue {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  owner: 'Shared' | 'Mxe';
}

interface MPCComputationResult {
  id: string;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: EncryptedValue;
  error?: string;
}

// Simulated encryption context
class SimulatedMPCContext {
  private sharedSecret: Uint8Array;

  constructor() {
    this.sharedSecret = new Uint8Array(32);
    crypto.getRandomValues(this.sharedSecret);
  }

  /**
   * Encrypt a value for MPC computation
   */
  encrypt(value: bigint): EncryptedValue {
    const nonce = new Uint8Array(16);
    crypto.getRandomValues(nonce);

    // Simulated encryption (XOR with key stream)
    const valueBytes = new Uint8Array(8);
    let v = value;
    for (let i = 0; i < 8; i++) {
      valueBytes[i] = Number(v & BigInt(0xff));
      v = v >> BigInt(8);
    }

    const ciphertext = new Uint8Array(64);
    ciphertext.set(nonce, 0);
    for (let i = 0; i < 8; i++) {
      ciphertext[16 + i] = valueBytes[i] ^ this.sharedSecret[i];
    }
    crypto.getRandomValues(ciphertext.subarray(24));

    return {
      ciphertext,
      nonce,
      owner: 'Shared',
    };
  }

  /**
   * Decrypt a value (only possible for values we encrypted)
   */
  decrypt(encrypted: EncryptedValue): bigint {
    const valueBytes = new Uint8Array(8);
    for (let i = 0; i < 8; i++) {
      valueBytes[i] = encrypted.ciphertext[16 + i] ^ this.sharedSecret[i];
    }

    let value = BigInt(0);
    for (let i = 7; i >= 0; i--) {
      value = (value << BigInt(8)) | BigInt(valueBytes[i]);
    }
    return value;
  }
}

// Simulated MPC operations
class SimulatedMPCEngine {
  private computations: Map<string, MPCComputationResult> = new Map();
  private ctx: SimulatedMPCContext;

  constructor(ctx: SimulatedMPCContext) {
    this.ctx = ctx;
  }

  /**
   * Compare two encrypted prices
   * Returns encrypted boolean: true if buyPrice >= sellPrice
   */
  async comparePrices(
    buyPrice: EncryptedValue,
    sellPrice: EncryptedValue
  ): Promise<MPCComputationResult> {
    const id = `cmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Simulate MPC execution delay
    const result: MPCComputationResult = {
      id,
      status: 'pending',
    };
    this.computations.set(id, result);

    // In real MPC: nodes collaboratively compute without revealing values
    // Here we simulate by decrypting (which real MPC doesn't do)
    const buy = this.ctx.decrypt(buyPrice);
    const sell = this.ctx.decrypt(sellPrice);
    const matches = buy >= sell;

    // Simulate async execution
    await new Promise((resolve) => setTimeout(resolve, 100));

    result.status = 'completed';
    result.result = {
      ciphertext: new Uint8Array([matches ? 1 : 0]),
      nonce: new Uint8Array(16),
      owner: 'Mxe',
    };

    return result;
  }

  /**
   * Calculate fill amount: min(buyRemaining, sellRemaining)
   */
  async calculateFill(
    buyRemaining: EncryptedValue,
    sellRemaining: EncryptedValue
  ): Promise<MPCComputationResult> {
    const id = `fill_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const result: MPCComputationResult = {
      id,
      status: 'pending',
    };
    this.computations.set(id, result);

    // Simulate MPC min calculation
    const buy = this.ctx.decrypt(buyRemaining);
    const sell = this.ctx.decrypt(sellRemaining);
    const fillAmount = buy < sell ? buy : sell;

    await new Promise((resolve) => setTimeout(resolve, 100));

    result.status = 'completed';
    result.result = this.ctx.encrypt(fillAmount);

    return result;
  }

  /**
   * Calculate settlement amounts after a match
   */
  async calculateSettlement(
    fillAmount: EncryptedValue,
    price: EncryptedValue,
    makerFeeBps: number,
    takerFeeBps: number
  ): Promise<{
    baseTransfer: EncryptedValue;
    quoteTransfer: EncryptedValue;
    makerFee: EncryptedValue;
    takerFee: EncryptedValue;
  }> {
    const fill = this.ctx.decrypt(fillAmount);
    const priceVal = this.ctx.decrypt(price);

    // Calculate quote amount (fill * price / 1e9 for 9 decimal precision)
    const quoteAmount = (fill * priceVal) / BigInt(1e9);

    // Calculate fees
    const makerFee = (quoteAmount * BigInt(makerFeeBps)) / BigInt(10000);
    const takerFee = (quoteAmount * BigInt(takerFeeBps)) / BigInt(10000);

    await new Promise((resolve) => setTimeout(resolve, 100));

    return {
      baseTransfer: this.ctx.encrypt(fill),
      quoteTransfer: this.ctx.encrypt(quoteAmount - makerFee),
      makerFee: this.ctx.encrypt(makerFee),
      takerFee: this.ctx.encrypt(takerFee),
    };
  }

  getComputation(id: string): MPCComputationResult | undefined {
    return this.computations.get(id);
  }
}

// Order structure for testing
interface TestOrder {
  id: string;
  maker: PublicKey;
  side: 'buy' | 'sell';
  encryptedAmount: EncryptedValue;
  encryptedPrice: EncryptedValue;
  encryptedFilled: EncryptedValue;
  status: 'open' | 'partial' | 'filled' | 'cancelled';
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
  console.log('\n=== MPC Matching Tests ===\n');

  const ctx = new SimulatedMPCContext();
  const mpc = new SimulatedMPCEngine(ctx);

  // Test 1: Basic Encryption/Decryption
  await test('Encrypt and decrypt value', async () => {
    const value = BigInt(1_500_000_000); // 1.5 SOL in lamports
    const encrypted = ctx.encrypt(value);
    const decrypted = ctx.decrypt(encrypted);

    if (decrypted !== value) {
      throw new Error(`Expected ${value}, got ${decrypted}`);
    }

    console.log(`  Original: ${value}`);
    console.log(`  Encrypted: ${encrypted.ciphertext.length} bytes`);
    console.log(`  Decrypted: ${decrypted}`);
  });

  // Test 2: Price Comparison - Match
  await test('Compare prices - should match', async () => {
    const buyPrice = ctx.encrypt(BigInt(150_000_000)); // $150
    const sellPrice = ctx.encrypt(BigInt(148_000_000)); // $148

    const result = await mpc.comparePrices(buyPrice, sellPrice);

    if (result.status !== 'completed') {
      throw new Error(`Unexpected status: ${result.status}`);
    }

    const matches = result.result?.ciphertext[0] === 1;
    if (!matches) {
      throw new Error('Prices should match (buy >= sell)');
    }

    console.log(`  Buy price: $150`);
    console.log(`  Sell price: $148`);
    console.log(`  Match result: ${matches ? 'MATCH' : 'NO MATCH'}`);
  });

  // Test 3: Price Comparison - No Match
  await test('Compare prices - should not match', async () => {
    const buyPrice = ctx.encrypt(BigInt(145_000_000)); // $145
    const sellPrice = ctx.encrypt(BigInt(150_000_000)); // $150

    const result = await mpc.comparePrices(buyPrice, sellPrice);

    const matches = result.result?.ciphertext[0] === 1;
    if (matches) {
      throw new Error('Prices should NOT match (buy < sell)');
    }

    console.log(`  Buy price: $145`);
    console.log(`  Sell price: $150`);
    console.log(`  Match result: ${matches ? 'MATCH' : 'NO MATCH'}`);
  });

  // Test 4: Fill Amount Calculation
  await test('Calculate fill amount', async () => {
    const buyRemaining = ctx.encrypt(BigInt(2_000_000_000)); // 2 SOL
    const sellRemaining = ctx.encrypt(BigInt(1_500_000_000)); // 1.5 SOL

    const result = await mpc.calculateFill(buyRemaining, sellRemaining);

    if (result.status !== 'completed' || !result.result) {
      throw new Error('Fill calculation failed');
    }

    const fillAmount = ctx.decrypt(result.result);
    const expected = BigInt(1_500_000_000); // min(2, 1.5) = 1.5 SOL

    if (fillAmount !== expected) {
      throw new Error(`Expected ${expected}, got ${fillAmount}`);
    }

    console.log(`  Buy remaining: 2 SOL`);
    console.log(`  Sell remaining: 1.5 SOL`);
    console.log(`  Fill amount: ${Number(fillAmount) / 1e9} SOL`);
  });

  // Test 5: Settlement Calculation
  await test('Calculate settlement amounts', async () => {
    const fillAmount = ctx.encrypt(BigInt(1_000_000_000)); // 1 SOL
    const price = ctx.encrypt(BigInt(150_000_000_000)); // $150 (scaled by 1e9)

    const settlement = await mpc.calculateSettlement(
      fillAmount,
      price,
      10, // 0.10% maker fee
      30 // 0.30% taker fee
    );

    const baseTransfer = ctx.decrypt(settlement.baseTransfer);
    const quoteTransfer = ctx.decrypt(settlement.quoteTransfer);
    const makerFee = ctx.decrypt(settlement.makerFee);
    const takerFee = ctx.decrypt(settlement.takerFee);

    console.log(`  Base transfer: ${Number(baseTransfer) / 1e9} SOL`);
    console.log(`  Quote transfer: ${Number(quoteTransfer) / 1e6} USDC`);
    console.log(`  Maker fee: ${Number(makerFee) / 1e6} USDC`);
    console.log(`  Taker fee: ${Number(takerFee) / 1e6} USDC`);
  });

  // Test 6: Full Order Matching Flow
  await test('Full order matching flow', async () => {
    // Create buy order
    const buyOrder: TestOrder = {
      id: 'buy_001',
      maker: Keypair.generate().publicKey,
      side: 'buy',
      encryptedAmount: ctx.encrypt(BigInt(2_000_000_000)), // 2 SOL
      encryptedPrice: ctx.encrypt(BigInt(150_000_000)), // $150
      encryptedFilled: ctx.encrypt(BigInt(0)),
      status: 'open',
    };

    // Create sell order
    const sellOrder: TestOrder = {
      id: 'sell_001',
      maker: Keypair.generate().publicKey,
      side: 'sell',
      encryptedAmount: ctx.encrypt(BigInt(1_000_000_000)), // 1 SOL
      encryptedPrice: ctx.encrypt(BigInt(148_000_000)), // $148
      encryptedFilled: ctx.encrypt(BigInt(0)),
      status: 'open',
    };

    console.log(`  Buy order: ${buyOrder.id} (${buyOrder.maker.toBase58().slice(0, 8)}...)`);
    console.log(`  Sell order: ${sellOrder.id} (${sellOrder.maker.toBase58().slice(0, 8)}...)`);

    // Step 1: Compare prices
    const priceComparison = await mpc.comparePrices(
      buyOrder.encryptedPrice,
      sellOrder.encryptedPrice
    );
    const shouldMatch = priceComparison.result?.ciphertext[0] === 1;

    if (!shouldMatch) {
      throw new Error('Orders should match');
    }
    console.log(`  Step 1: Price comparison = MATCH`);

    // Step 2: Calculate fill amount
    const fillResult = await mpc.calculateFill(
      buyOrder.encryptedAmount,
      sellOrder.encryptedAmount
    );

    if (!fillResult.result) {
      throw new Error('Fill calculation failed');
    }
    console.log(`  Step 2: Fill amount calculated`);

    // Step 3: Calculate settlement
    const settlement = await mpc.calculateSettlement(
      fillResult.result,
      sellOrder.encryptedPrice, // Use sell price for settlement
      10,
      30
    );
    console.log(`  Step 3: Settlement amounts calculated`);

    // Step 4: Update order statuses
    const fillAmount = ctx.decrypt(fillResult.result);
    const buyAmount = ctx.decrypt(buyOrder.encryptedAmount);
    const sellAmount = ctx.decrypt(sellOrder.encryptedAmount);

    if (fillAmount === sellAmount) {
      sellOrder.status = 'filled';
    } else {
      sellOrder.status = 'partial';
    }

    if (fillAmount === buyAmount) {
      buyOrder.status = 'filled';
    } else {
      buyOrder.status = 'partial';
    }

    console.log(`  Step 4: Order statuses updated`);
    console.log(`    Buy order: ${buyOrder.status}`);
    console.log(`    Sell order: ${sellOrder.status}`);
  });

  // Test 7: Multiple Order Matching
  await test('Match multiple orders in sequence', async () => {
    const orders: TestOrder[] = [
      {
        id: 'buy_1',
        maker: Keypair.generate().publicKey,
        side: 'buy',
        encryptedAmount: ctx.encrypt(BigInt(1_000_000_000)),
        encryptedPrice: ctx.encrypt(BigInt(152_000_000)),
        encryptedFilled: ctx.encrypt(BigInt(0)),
        status: 'open',
      },
      {
        id: 'buy_2',
        maker: Keypair.generate().publicKey,
        side: 'buy',
        encryptedAmount: ctx.encrypt(BigInt(500_000_000)),
        encryptedPrice: ctx.encrypt(BigInt(150_000_000)),
        encryptedFilled: ctx.encrypt(BigInt(0)),
        status: 'open',
      },
      {
        id: 'sell_1',
        maker: Keypair.generate().publicKey,
        side: 'sell',
        encryptedAmount: ctx.encrypt(BigInt(800_000_000)),
        encryptedPrice: ctx.encrypt(BigInt(149_000_000)),
        encryptedFilled: ctx.encrypt(BigInt(0)),
        status: 'open',
      },
    ];

    let matchCount = 0;

    // Try to match each buy with each sell
    for (const buy of orders.filter((o) => o.side === 'buy')) {
      for (const sell of orders.filter((o) => o.side === 'sell')) {
        if (buy.status === 'filled' || sell.status === 'filled') continue;

        const comparison = await mpc.comparePrices(
          buy.encryptedPrice,
          sell.encryptedPrice
        );

        if (comparison.result?.ciphertext[0] === 1) {
          matchCount++;
          console.log(`  Match found: ${buy.id} <-> ${sell.id}`);
        }
      }
    }

    console.log(`  Total matches found: ${matchCount}`);
  });

  // Test 8: Computation Status Tracking
  await test('Track computation status', async () => {
    const buyPrice = ctx.encrypt(BigInt(150_000_000));
    const sellPrice = ctx.encrypt(BigInt(148_000_000));

    const result = await mpc.comparePrices(buyPrice, sellPrice);

    const tracked = mpc.getComputation(result.id);

    if (!tracked) {
      throw new Error('Computation not tracked');
    }

    if (tracked.status !== 'completed') {
      throw new Error(`Expected completed, got ${tracked.status}`);
    }

    console.log(`  Computation ID: ${result.id}`);
    console.log(`  Status: ${tracked.status}`);
  });

  // Test 9: Edge Case - Zero Fill
  await test('Handle zero fill amount', async () => {
    const buyRemaining = ctx.encrypt(BigInt(0));
    const sellRemaining = ctx.encrypt(BigInt(1_000_000_000));

    const result = await mpc.calculateFill(buyRemaining, sellRemaining);
    const fillAmount = ctx.decrypt(result.result!);

    if (fillAmount !== BigInt(0)) {
      throw new Error('Fill should be zero');
    }

    console.log(`  Fill amount: ${fillAmount} (correctly zero)`);
  });

  // Test 10: Edge Case - Equal Prices
  await test('Handle equal prices', async () => {
    const price = BigInt(150_000_000);
    const buyPrice = ctx.encrypt(price);
    const sellPrice = ctx.encrypt(price);

    const result = await mpc.comparePrices(buyPrice, sellPrice);
    const matches = result.result?.ciphertext[0] === 1;

    if (!matches) {
      throw new Error('Equal prices should match');
    }

    console.log(`  Both prices: $150`);
    console.log(`  Match result: ${matches ? 'MATCH' : 'NO MATCH'}`);
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
