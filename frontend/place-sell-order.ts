/**
 * Place a Sell Order for Testing
 *
 * Creates a sell order at 150 USDC for 1 SOL to match the existing buy order.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildPlaceOrderTransaction,
  derivePairPda,
  deriveOrderPda,
  Side,
  OrderType,
  fetchOrderCount,
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
  const maker = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Maker:', maker.publicKey.toString());

  const connection = new Connection(RPC_URL, 'confirmed');

  // Fetch exchange order count to get next order ID
  const orderCount = await fetchOrderCount(connection);
  if (orderCount === null) {
    console.error('Could not fetch order count');
    return;
  }

  const orderId = Number(orderCount);
  console.log('Order ID will be:', orderId);

  // Get trading pair PDA
  const [pairPda] = derivePairPda(WSOL_MINT, DUMMY_USDC_MINT);
  console.log('Trading Pair PDA:', pairPda.toString());

  // Order params: Sell 1 SOL at 150 USDC
  const amount = BigInt(1_000_000_000); // 1 SOL (9 decimals)
  const price = BigInt(150_000_000);    // 150 USDC (6 decimals)

  // Encrypt values (simulated - plaintext in first 8 bytes for dev)
  const encryptedAmount = new Uint8Array(64);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64LE(amount);
  encryptedAmount.set(amountBuf, 0);

  const encryptedPrice = new Uint8Array(64);
  const priceBuf = Buffer.alloc(8);
  priceBuf.writeBigUInt64LE(price);
  encryptedPrice.set(priceBuf, 0);

  // ZK proof (simulated - empty for dev)
  const eligibilityProof = new Uint8Array(324);

  console.log('\nPlacing SELL order:');
  console.log('  Amount:', Number(amount) / 1e9, 'SOL');
  console.log('  Price:', Number(price) / 1e6, 'USDC');

  try {
    const tx = await buildPlaceOrderTransaction({
      connection,
      maker: maker.publicKey,
      baseMint: WSOL_MINT,
      quoteMint: DUMMY_USDC_MINT,
      side: Side.Sell,
      orderType: OrderType.Limit,
      encryptedAmount: new Uint8Array(encryptedAmount),
      encryptedPrice: new Uint8Array(encryptedPrice),
      eligibilityProof: new Uint8Array(eligibilityProof),
    });

    // Add compute budget for ZK verification
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000, // ZK proofs need ~200K CU
    });
    tx.instructions.unshift(computeBudgetIx);

    console.log('\nSending transaction (with 400K CU budget)...');
    const sig = await sendAndConfirmTransaction(connection, tx, [maker], {
      commitment: 'confirmed',
    });

    console.log('\n=== Order Placed ===');
    console.log('Signature:', sig);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Derive order PDA
    const [orderPda] = deriveOrderPda(maker.publicKey, BigInt(orderId));
    console.log('\nOrder PDA:', orderPda.toString());

  } catch (error) {
    console.error('\nFailed to place order:', error);
  }
}

main().catch(console.error);
