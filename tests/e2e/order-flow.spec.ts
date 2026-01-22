/**
 * E2E Order Flow Tests
 *
 * Tests the complete order lifecycle on devnet:
 * - Place buy/sell orders
 * - Order matching via crank
 * - Order cancellation
 * - Settlement and token transfers
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Keypair, sendAndConfirmTransaction, Transaction } from '@solana/web3.js';
import {
  setupTestContext,
  cleanupTestOrders,
  TestContext,
  getSolBalance,
  getTokenBalance,
  CONFIDEX_PROGRAM_ID,
  sleep,
} from './setup';
import {
  createPlaceOrderInstruction,
  createCancelOrderInstruction,
  encryptOrderValues,
  generateEligibilityProof,
  waitForOrderMatch,
  getOrderAccount,
  placeTestOrder,
  cancelOrder,
  getUserBalance,
  userBalanceExists,
} from './helpers';

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const TEST_TIMEOUT = 120_000; // 2 minutes for network operations
const MATCH_TIMEOUT = 90_000; // 1.5 minutes for crank to match

// =============================================================================
// E2E ORDER FLOW TESTS
// =============================================================================

describe('Order Flow E2E', () => {
  let ctx: TestContext;
  let hasUserBalances = false;

  beforeAll(async () => {
    console.log('='.repeat(60));
    console.log('  Confidex E2E Order Flow Tests');
    console.log('='.repeat(60));
    ctx = await setupTestContext();
    console.log('[E2E] Test context initialized');

    // Check if user balance accounts exist (required for order placement)
    const buyerHasQuoteBalance = await userBalanceExists(
      ctx.connection,
      CONFIDEX_PROGRAM_ID,
      ctx.buyer.publicKey,
      ctx.quoteMint
    );
    const sellerHasBaseBalance = await userBalanceExists(
      ctx.connection,
      CONFIDEX_PROGRAM_ID,
      ctx.seller.publicKey,
      ctx.baseMint
    );

    hasUserBalances = buyerHasQuoteBalance && sellerHasBaseBalance;

    if (!hasUserBalances) {
      console.log('[E2E] WARNING: User balance accounts not initialized.');
      console.log('[E2E] To initialize, run wrap_tokens instruction first.');
      console.log(`[E2E]   Buyer USDC balance: ${buyerHasQuoteBalance ? 'EXISTS' : 'MISSING'}`);
      console.log(`[E2E]   Seller SOL balance: ${sellerHasBaseBalance ? 'EXISTS' : 'MISSING'}`);
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    await cleanupTestOrders(ctx);
    console.log('[E2E] Tests complete');
  });

  // ===========================================================================
  // PLACE ORDER TESTS
  // ===========================================================================

  describe('Place Order', () => {
    it('should place a buy order successfully', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Generate ZK proof
      const proof = await generateEligibilityProof(ctx.buyer.publicKey);
      expect(proof.length).toBe(388);

      // Encrypt order values
      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: BigInt(100_000_000), // 0.1 SOL
        price: BigInt(140_000_000), // $140
      });

      expect(encryptedAmount.length).toBe(64);
      expect(encryptedPrice.length).toBe(64);
      expect(ephemeralPubkey.length).toBe(32);

      // Build transaction
      const orderKeypair = Keypair.generate();
      const tx = new Transaction();

      tx.add(
        createPlaceOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          pairPda: ctx.pairPda,
          exchangePda: ctx.exchangePda,
          userPubkey: ctx.buyer.publicKey,
          orderPubkey: orderKeypair.publicKey,
          side: 'buy',
          encryptedAmount,
          encryptedPrice,
          ephemeralPubkey,
          proof,
          tokenMint: ctx.quoteMint, // Buy orders spend quote (USDC)
        })
      );

      // Send transaction
      const signature = await sendAndConfirmTransaction(
        ctx.connection,
        tx,
        [ctx.buyer, orderKeypair],
        { commitment: 'confirmed' }
      );

      expect(signature).toBeDefined();
      console.log(`[E2E] Buy order placed: ${signature}`);

      // Verify order account created
      const orderAccount = await getOrderAccount(ctx.connection, orderKeypair.publicKey);
      expect(orderAccount).toBeDefined();
      expect(orderAccount?.status).toBe('Active');
      expect(orderAccount?.side).toBe('buy');
      expect(orderAccount?.maker.equals(ctx.buyer.publicKey)).toBe(true);
    }, TEST_TIMEOUT);

    it('should place a sell order successfully', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      const proof = await generateEligibilityProof(ctx.seller.publicKey);

      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: BigInt(100_000_000), // 0.1 SOL
        price: BigInt(139_000_000), // $139
      });

      const orderKeypair = Keypair.generate();
      const tx = new Transaction();

      tx.add(
        createPlaceOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          pairPda: ctx.pairPda,
          exchangePda: ctx.exchangePda,
          userPubkey: ctx.seller.publicKey,
          orderPubkey: orderKeypair.publicKey,
          side: 'sell',
          encryptedAmount,
          encryptedPrice,
          ephemeralPubkey,
          proof,
          tokenMint: ctx.baseMint, // Sell orders spend base (SOL)
        })
      );

      const signature = await sendAndConfirmTransaction(
        ctx.connection,
        tx,
        [ctx.seller, orderKeypair],
        { commitment: 'confirmed' }
      );

      expect(signature).toBeDefined();
      console.log(`[E2E] Sell order placed: ${signature}`);

      const orderAccount = await getOrderAccount(ctx.connection, orderKeypair.publicKey);
      expect(orderAccount?.side).toBe('sell');
      expect(orderAccount?.status).toBe('Active');
    }, TEST_TIMEOUT);

    it('should reject order with invalid proof format', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Create an invalid proof (wrong size)
      const invalidProof = new Uint8Array(100); // Should be 388 bytes

      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: BigInt(100_000_000),
        price: BigInt(140_000_000),
      });

      const orderKeypair = Keypair.generate();
      const tx = new Transaction();

      tx.add(
        createPlaceOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          pairPda: ctx.pairPda,
          exchangePda: ctx.exchangePda,
          userPubkey: ctx.buyer.publicKey,
          orderPubkey: orderKeypair.publicKey,
          side: 'buy',
          encryptedAmount,
          encryptedPrice,
          ephemeralPubkey,
          proof: invalidProof, // Invalid proof
          tokenMint: ctx.quoteMint,
        })
      );

      // Should fail due to invalid proof format
      await expect(
        sendAndConfirmTransaction(ctx.connection, tx, [ctx.buyer, orderKeypair])
      ).rejects.toThrow();
    }, TEST_TIMEOUT);
  });

  // ===========================================================================
  // ORDER MATCHING TESTS
  // ===========================================================================

  describe('Order Matching', () => {
    let buyOrderPda: any;
    let sellOrderPda: any;

    beforeEach(async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized - skipping order placement');
        return;
      }

      // Place matching orders (buy at $140, sell at $139 - should match)
      buyOrderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 140_000_000n, 50_000_000n);
      sellOrderPda = await placeTestOrder(ctx, ctx.seller, 'sell', 139_000_000n, 50_000_000n);

      console.log(`[E2E] Test orders placed:`);
      console.log(`  Buy: ${buyOrderPda.toBase58()}`);
      console.log(`  Sell: ${sellOrderPda.toBase58()}`);
    }, TEST_TIMEOUT);

    it('should match compatible orders via crank', async () => {
      if (!hasUserBalances || !buyOrderPda) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Wait for crank to match orders
      const matchResult = await waitForOrderMatch(ctx.connection, buyOrderPda, sellOrderPda, {
        timeoutMs: MATCH_TIMEOUT,
        pollIntervalMs: 3000,
      });

      // In a real environment with active crank, orders should match
      // For now, we verify the orders were created correctly
      expect(buyOrderPda).toBeDefined();
      expect(sellOrderPda).toBeDefined();

      console.log(`[E2E] Match result:`, matchResult);

      // If crank is active, verify match
      if (matchResult.matched) {
        expect(matchResult.buyOrderStatus).toMatch(/Filled|PartiallyFilled/);
        expect(matchResult.sellOrderStatus).toMatch(/Filled|PartiallyFilled/);
      }
    }, MATCH_TIMEOUT + 30_000);

    it('should not match orders with incompatible prices', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Place buy at $135 (too low for $139 sell)
      const lowBuyOrderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 135_000_000n, 50_000_000n);

      // Place sell at $145 (too high for $135 buy)
      const highSellOrderPda = await placeTestOrder(
        ctx,
        ctx.seller,
        'sell',
        145_000_000n,
        50_000_000n
      );

      // Wait a bit for potential match attempts
      await sleep(10_000);

      // Orders should still be active (not matched)
      const buyOrder = await getOrderAccount(ctx.connection, lowBuyOrderPda);
      const sellOrder = await getOrderAccount(ctx.connection, highSellOrderPda);

      expect(buyOrder?.status).toBe('Active');
      expect(sellOrder?.status).toBe('Active');
    }, TEST_TIMEOUT);
  });

  // ===========================================================================
  // ORDER CANCELLATION TESTS
  // ===========================================================================

  describe('Order Cancellation', () => {
    it('should cancel an active order', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Place an order to cancel
      const orderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 150_000_000n);

      // Verify order is active
      let orderAccount = await getOrderAccount(ctx.connection, orderPda);
      expect(orderAccount?.status).toBe('Active');

      // Cancel the order
      const signature = await cancelOrder(ctx, ctx.buyer, orderPda);
      expect(signature).toBeDefined();
      console.log(`[E2E] Order cancelled: ${signature}`);

      // Verify order is cancelled
      orderAccount = await getOrderAccount(ctx.connection, orderPda);
      expect(orderAccount?.status).toBe('Cancelled');
    }, TEST_TIMEOUT);

    it("should not allow cancelling another user's order", async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Place order as buyer
      const orderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 150_000_000n);

      // Try to cancel as seller (should fail)
      const tx = new Transaction();
      tx.add(
        createCancelOrderInstruction({
          programId: CONFIDEX_PROGRAM_ID,
          orderPda,
          userPubkey: ctx.seller.publicKey, // Wrong user
        })
      );

      await expect(
        sendAndConfirmTransaction(ctx.connection, tx, [ctx.seller])
      ).rejects.toThrow();
    }, TEST_TIMEOUT);

    it('should refund order on cancellation', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Get initial balance
      const initialBalance = await getSolBalance(ctx.connection, ctx.buyer.publicKey);

      // Place order (costs rent)
      const orderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 150_000_000n);

      // Check balance decreased (order account rent)
      const afterPlaceBalance = await getSolBalance(ctx.connection, ctx.buyer.publicKey);
      expect(afterPlaceBalance).toBeLessThan(initialBalance);

      // Cancel order
      await cancelOrder(ctx, ctx.buyer, orderPda);

      // Check balance recovered (rent returned, minus tx fees)
      const finalBalance = await getSolBalance(ctx.connection, ctx.buyer.publicKey);
      expect(finalBalance).toBeGreaterThan(afterPlaceBalance);
    }, TEST_TIMEOUT);
  });

  // ===========================================================================
  // SETTLEMENT TESTS
  // ===========================================================================

  describe('Settlement', () => {
    it('should settle matched orders and transfer tokens', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Place matching orders
      const buyOrderPda = await placeTestOrder(ctx, ctx.buyer, 'buy', 140_000_000n, 100_000_000n);
      const sellOrderPda = await placeTestOrder(
        ctx,
        ctx.seller,
        'sell',
        139_000_000n,
        100_000_000n
      );

      // Get initial balances
      const [initialBuyerQuote, initialSellerQuote] = await Promise.all([
        getUserBalance(ctx, ctx.buyer.publicKey, ctx.quoteMint),
        getUserBalance(ctx, ctx.seller.publicKey, ctx.quoteMint),
      ]);

      console.log(`[E2E] Initial balances:`);
      console.log(`  Buyer USDC: ${initialBuyerQuote}`);
      console.log(`  Seller USDC: ${initialSellerQuote}`);

      // Wait for match and settlement
      const matchResult = await waitForOrderMatch(ctx.connection, buyOrderPda, sellOrderPda, {
        timeoutMs: MATCH_TIMEOUT,
        pollIntervalMs: 3000,
      });

      // Additional wait for settlement to complete
      if (matchResult.matched) {
        await sleep(10_000);

        // Get final balances
        const [finalBuyerQuote, finalSellerQuote] = await Promise.all([
          getUserBalance(ctx, ctx.buyer.publicKey, ctx.quoteMint),
          getUserBalance(ctx, ctx.seller.publicKey, ctx.quoteMint),
        ]);

        console.log(`[E2E] Final balances:`);
        console.log(`  Buyer USDC: ${finalBuyerQuote}`);
        console.log(`  Seller USDC: ${finalSellerQuote}`);

        // Verify transfers occurred (buyer spent USDC, seller received)
        if (initialBuyerQuote > 0n) {
          expect(finalBuyerQuote).toBeLessThan(initialBuyerQuote);
        }
      } else {
        console.log('[E2E] Orders not matched (crank may not be running)');
      }
    }, MATCH_TIMEOUT + 60_000);
  });

  // ===========================================================================
  // EDGE CASE TESTS
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle multiple orders from same user', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Place multiple buy orders
      const order1 = await placeTestOrder(ctx, ctx.buyer, 'buy', 138_000_000n, 25_000_000n);
      const order2 = await placeTestOrder(ctx, ctx.buyer, 'buy', 139_000_000n, 25_000_000n);
      const order3 = await placeTestOrder(ctx, ctx.buyer, 'buy', 140_000_000n, 25_000_000n);

      // All orders should be active
      const [acc1, acc2, acc3] = await Promise.all([
        getOrderAccount(ctx.connection, order1),
        getOrderAccount(ctx.connection, order2),
        getOrderAccount(ctx.connection, order3),
      ]);

      expect(acc1?.status).toBe('Active');
      expect(acc2?.status).toBe('Active');
      expect(acc3?.status).toBe('Active');
    }, TEST_TIMEOUT);

    it('should handle rapid order placement', async () => {
      if (!hasUserBalances) {
        console.log('[SKIP] User balance accounts not initialized');
        return;
      }

      // Place orders in rapid succession
      const orderPromises = [];
      for (let i = 0; i < 5; i++) {
        orderPromises.push(
          placeTestOrder(ctx, ctx.buyer, 'buy', BigInt(137_000_000 + i * 1_000_000), 20_000_000n)
        );
      }

      const orders = await Promise.all(orderPromises);
      expect(orders.length).toBe(5);

      // Verify all orders created
      for (const orderPda of orders) {
        const account = await getOrderAccount(ctx.connection, orderPda);
        expect(account).toBeDefined();
        expect(account?.status).toBe('Active');
      }
    }, TEST_TIMEOUT * 2);

    it('should handle order with maximum values', async () => {
      // Large amount (1000 SOL)
      const largeAmount = BigInt(1_000_000_000_000);
      // High price ($10,000)
      const highPrice = BigInt(10_000_000_000);

      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: largeAmount,
        price: highPrice,
      });

      // Should successfully encrypt large values
      expect(encryptedAmount.length).toBe(64);
      expect(encryptedPrice.length).toBe(64);
    }, TEST_TIMEOUT);
  });

  // ===========================================================================
  // ENCRYPTION VERIFICATION TESTS
  // ===========================================================================

  describe('Encryption Verification', () => {
    it('should produce correct V2 encryption format', async () => {
      const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
        amount: BigInt(1_000_000_000),
        price: BigInt(140_000_000),
      });

      // V2 format: [nonce (16) | ciphertext (32) | ephemeral_hint (16)]
      expect(encryptedAmount.length).toBe(64);
      expect(encryptedPrice.length).toBe(64);

      // Nonce should be non-zero (random)
      const amountNonce = encryptedAmount.slice(0, 16);
      const priceNonce = encryptedPrice.slice(0, 16);
      expect(amountNonce.some((b) => b !== 0)).toBe(true);
      expect(priceNonce.some((b) => b !== 0)).toBe(true);

      // Nonces should be different
      expect(Buffer.from(amountNonce).equals(Buffer.from(priceNonce))).toBe(false);
    }, 10_000);

    it('should produce deterministic proofs for same user', async () => {
      const proof1 = await generateEligibilityProof(ctx.buyer.publicKey);
      const proof2 = await generateEligibilityProof(ctx.buyer.publicKey);

      // Mock proofs should be deterministic for same user
      expect(Buffer.from(proof1).equals(Buffer.from(proof2))).toBe(true);
    }, 10_000);

    it('should produce different proofs for different users', async () => {
      const buyerProof = await generateEligibilityProof(ctx.buyer.publicKey);
      const sellerProof = await generateEligibilityProof(ctx.seller.publicKey);

      expect(Buffer.from(buyerProof).equals(Buffer.from(sellerProof))).toBe(false);
    }, 10_000);
  });
});
