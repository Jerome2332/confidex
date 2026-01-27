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

  // ============================================================================
  // DEVNET TEST SCRIPT - Hardcoded proof for local testing only
  // ============================================================================
  // In production, proofs MUST be generated dynamically via the proof server.
  // This script is for devnet testing where the blacklist is always empty.
  //
  // To generate a fresh proof:
  //   cd circuits/eligibility && nargo execute && sunspot prove
  //
  // Or use the proof server:
  //   PROOF_SERVER_URL=http://localhost:3001 npx ts-node place-sell-order.ts
  // ============================================================================
  const DEVNET_EMPTY_TREE_PROOF_HEX = '05658bdf0b36f28cc76ed405af210b96aec06122ced12a8a7c61526c8025413d16dec5fb09b4281cb14d9e0717cbe2d6800946998cce0e5db4f9e058552036e308b44b7ad9c14c51e4a141c1668d04bc0b36851844d65bbec979ca5b86571bff2e6645241dad7836d75561cbef38e4f3cec7badc4368fe31119e8448540cada70d40c9b41b23fe2f8e528f3fb32d553d5bf4d326058e20379d69d7f0f93582a70c0a7811ea0573c2e5f4ce67547ecb220edbb14e8c8a1b094e189c3b4379865b2288ab2c5ceb0841a50c8a8301cf346b31c23f7705060792bf196ea2b89eb8f206fd2fa7a32949d0478bb138ec6b78d75395f9b913a22028a89ad9df556a8f6b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
  const eligibilityProof = new Uint8Array(
    DEVNET_EMPTY_TREE_PROOF_HEX.match(/.{2}/g)!.map(b => parseInt(b, 16))
  );
  console.log('[DEVNET TEST] Using pre-generated ZK proof (324 bytes):', eligibilityProof.length);
  console.log('[DEVNET TEST] WARNING: This script is for devnet testing only!');

  // Ephemeral X25519 public key (simulated - random for dev testing)
  // In production, this comes from the encryption context
  const ephemeralPubkey = new Uint8Array(32);
  crypto.getRandomValues(ephemeralPubkey);

  console.log('\nPlacing SELL order:');
  console.log('  Amount:', Number(amount) / 1e9, 'SOL');
  console.log('  Price:', Number(price) / 1e6, 'USDC');

  try {
    const { transaction: tx, orderNonce } = await buildPlaceOrderTransaction({
      connection,
      maker: maker.publicKey,
      baseMint: WSOL_MINT,
      quoteMint: DUMMY_USDC_MINT,
      side: Side.Sell,
      orderType: OrderType.Limit,
      encryptedAmount: new Uint8Array(encryptedAmount),
      encryptedPrice: new Uint8Array(encryptedPrice),
      eligibilityProof: new Uint8Array(eligibilityProof),
      ephemeralPubkey,
    });

    // Add compute budget for ZK verification
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000, // ZK proofs need ~200K CU
    });
    tx.instructions.unshift(computeBudgetIx);

    console.log('\nSending transaction (with 400K CU budget)...');
    console.log('Order nonce:', orderNonce.toString());
    const sig = await sendAndConfirmTransaction(connection, tx, [maker], {
      commitment: 'confirmed',
    });

    console.log('\n=== Order Placed ===');
    console.log('Signature:', sig);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Derive order PDA using the nonce
    const [orderPda] = deriveOrderPda(maker.publicKey, orderNonce);
    console.log('\nOrder PDA:', orderPda.toString());

  } catch (error) {
    console.error('\nFailed to place order:', error);
  }
}

main().catch(console.error);
