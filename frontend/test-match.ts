/**
 * Test script to match orders via MPC
 *
 * This script:
 * 1. Fetches open orders for the SOL/USDC pair
 * 2. Finds matchable buy/sell pairs
 * 3. Executes match_orders transaction with MPC accounts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildMatchOrdersTransaction,
  fetchOpenOrdersForPair,
  derivePairPda,
  deriveOrderPda,
  fetchOrder,
  getPlaintextFromEncrypted,
  Side,
  OrderStatus,
} from './src/lib/confidex-client';

// Configuration
const RPC_URL = 'https://api.devnet.solana.com';

// Token mints (devnet)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const DUMMY_USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

async function main() {
  // Load keypair
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const crank = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Crank/Signer:', crank.publicKey.toString());

  const connection = new Connection(RPC_URL, 'confirmed');

  // Get trading pair PDA
  const [pairPda] = derivePairPda(WSOL_MINT, DUMMY_USDC_MINT);
  console.log('Trading Pair PDA:', pairPda.toString());

  // Fetch open orders
  console.log('\nFetching open orders...');
  const openOrders = await fetchOpenOrdersForPair(connection, pairPda);

  if (openOrders.length === 0) {
    console.log('No open orders found. Create some orders first!');
    return;
  }

  console.log(`Found ${openOrders.length} open order(s):`);

  const buyOrders = openOrders.filter(o => o.order.side === Side.Buy);
  const sellOrders = openOrders.filter(o => o.order.side === Side.Sell);

  console.log(`  Buy orders: ${buyOrders.length}`);
  console.log(`  Sell orders: ${sellOrders.length}`);

  // Display order details
  for (const { pda, order } of openOrders) {
    const amount = getPlaintextFromEncrypted(order.encryptedAmount);
    const price = getPlaintextFromEncrypted(order.encryptedPrice);
    const filled = getPlaintextFromEncrypted(order.encryptedFilled);

    console.log(`\n  Order PDA: ${pda.toString()}`);
    console.log(`    Side: ${order.side === Side.Buy ? 'BUY' : 'SELL'}`);
    console.log(`    Status: ${OrderStatus[order.status]}`);
    console.log(`    Amount: ${amount.toString()} (${Number(amount) / 1e9} SOL)`);
    console.log(`    Price: ${price.toString()} (${Number(price) / 1e6} USDC)`);
    console.log(`    Filled: ${filled.toString()}`);
    console.log(`    Maker: ${order.maker.toString()}`);
    console.log(`    Eligibility Verified: ${order.eligibilityProofVerified}`);
  }

  // Check if we can match any orders
  if (buyOrders.length === 0 || sellOrders.length === 0) {
    console.log('\nNeed both buy and sell orders to match!');

    if (buyOrders.length > 0) {
      console.log('\nYou have a BUY order. Create a SELL order to match.');
    } else {
      console.log('\nYou have a SELL order. Create a BUY order to match.');
    }
    return;
  }

  // Find a matchable pair (different makers, both verified)
  let matchablePair: { buy: typeof buyOrders[0]; sell: typeof sellOrders[0] } | null = null;

  for (const buy of buyOrders) {
    for (const sell of sellOrders) {
      // For testing, allow same maker (self-match)
      // In production, orders from the same maker shouldn't match
      if (buy.order.eligibilityProofVerified && sell.order.eligibilityProofVerified) {
        matchablePair = { buy, sell };
        break;
      }
    }
    if (matchablePair) break;
  }

  if (!matchablePair) {
    console.log('\nNo matchable order pairs found (need verified eligibility on both sides)');
    return;
  }

  const { buy, sell } = matchablePair;
  console.log('\n=== Matchable Pair Found ===');
  console.log('Buy Order:', buy.pda.toString());
  console.log('Sell Order:', sell.pda.toString());

  const buyPrice = getPlaintextFromEncrypted(buy.order.encryptedPrice);
  const sellPrice = getPlaintextFromEncrypted(sell.order.encryptedPrice);

  console.log(`\nBuy Price: ${Number(buyPrice) / 1e6} USDC`);
  console.log(`Sell Price: ${Number(sellPrice) / 1e6} USDC`);

  if (buyPrice >= sellPrice) {
    console.log('✓ Prices can match (buy >= sell)');
  } else {
    console.log('✗ Prices cannot match (buy < sell)');
    console.log('  Note: Match will still be attempted - MPC will verify');
  }

  // Ask for confirmation
  console.log('\nPress Ctrl+C to cancel, or wait 3 seconds to proceed...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Build and send match transaction
  console.log('\nBuilding match_orders transaction...');

  try {
    // Check command line args for async flag
    const useAsync = process.argv.includes('--async');
    console.log(`Using ${useAsync ? 'ASYNC' : 'SYNC'} MPC flow`);

    const tx = await buildMatchOrdersTransaction({
      connection,
      crank: crank.publicKey,
      buyOrderPda: buy.pda,
      sellOrderPda: sell.pda,
      baseMint: WSOL_MINT,
      quoteMint: DUMMY_USDC_MINT,
      useAsyncMpc: useAsync,
    });

    console.log('Sending transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [crank], {
      commitment: 'confirmed',
    });

    console.log('\n=== Match Transaction Confirmed ===');
    console.log('Signature:', sig);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Fetch updated order states
    console.log('\nFetching updated order states...');

    const updatedBuy = await fetchOrder(connection, buy.pda);
    const updatedSell = await fetchOrder(connection, sell.pda);

    if (updatedBuy) {
      console.log(`\nBuy Order Status: ${OrderStatus[updatedBuy.status]}`);
      console.log(`  Filled: ${getPlaintextFromEncrypted(updatedBuy.encryptedFilled).toString()}`);
      if (updatedBuy.status === OrderStatus.Matching) {
        console.log('  → Order is in MATCHING state, awaiting MPC callback');
      }
    }

    if (updatedSell) {
      console.log(`\nSell Order Status: ${OrderStatus[updatedSell.status]}`);
      console.log(`  Filled: ${getPlaintextFromEncrypted(updatedSell.encryptedFilled).toString()}`);
      if (updatedSell.status === OrderStatus.Matching) {
        console.log('  → Order is in MATCHING state, awaiting MPC callback');
      }
    }

  } catch (error) {
    console.error('\nMatch transaction failed:', error);

    if (error instanceof Error && error.message.includes('logs')) {
      console.log('\nProgram logs may contain more details.');
    }
  }
}

main().catch(console.error);
