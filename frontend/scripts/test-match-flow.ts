/**
 * Test Match Flow
 *
 * Directly calls match_orders to test the MPC matching and callback flow.
 * Usage: cd frontend && npx tsx scripts/test-match-flow.ts <buy_nonce> <sell_nonce>
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  getClusterAccAddress,
  getFeePoolAccAddress,
  getClockAccAddress,
  x25519,
} from '@arcium-hq/client';
import BN from 'bn.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const RPC_URL = process.env.RPC_URL || 'https://devnet.helius-rpc.com/?api-key=a5993fde-e283-4034-82cf-6a6fef562a19';
const connection = new Connection(RPC_URL, 'confirmed');

const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

const CLUSTER_OFFSET = 456;

// Discriminator: sha256("global:match_orders")[0..8]
const MATCH_ORDERS_DISCRIMINATOR = Buffer.from([0x11, 0x01, 0xc9, 0x5d, 0x07, 0x33, 0xfb, 0x86]);

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('exchange')], DEX_PROGRAM_ID);
}

function derivePairPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pair'), WSOL_MINT.toBuffer(), USDC_MINT.toBuffer()],
    DEX_PROGRAM_ID
  );
}

function deriveOrderPda(maker: PublicKey, nonce: bigint): [PublicKey, number] {
  const nonceBuf = Buffer.alloc(8);
  nonceBuf.writeBigUInt64LE(nonce);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('order'), maker.toBuffer(), nonceBuf],
    DEX_PROGRAM_ID
  );
}

async function getOrderMaker(orderPda: PublicKey): Promise<PublicKey> {
  const info = await connection.getAccountInfo(orderPda);
  if (!info) throw new Error(`Order not found: ${orderPda.toBase58()}`);
  // Maker is at offset 8 (after discriminator)
  return new PublicKey(info.data.slice(8, 40));
}

async function getOrderInfo(orderPda: PublicKey): Promise<{ maker: PublicKey; status: number; isMatching: boolean }> {
  const info = await connection.getAccountInfo(orderPda);
  if (!info) throw new Error(`Order not found: ${orderPda.toBase58()}`);
  const maker = new PublicKey(info.data.slice(8, 40));
  const status = info.data[266];
  const isMatching = info.data[332] === 1;
  return { maker, status, isMatching };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/test-match-flow.ts <buy_nonce> <sell_nonce>');
    console.error('Example: npx tsx scripts/test-match-flow.ts 63 64');
    process.exit(1);
  }

  const buyNonce = BigInt(args[0]);
  const sellNonce = BigInt(args[1]);

  console.log('='.repeat(60));
  console.log('   Test Match Flow (MPC Price Comparison)');
  console.log('='.repeat(60));
  console.log('');

  // Load crank keypair
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const crank = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log('Crank:', crank.publicKey.toBase58());

  // Get order PDAs and info
  // For this test, we need the actual makers - let me search for the orders
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda();

  // Fetch all orders to find the ones with these nonces
  const accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [{ dataSize: 366 }],
  });

  let buyOrderPda: PublicKey | null = null;
  let sellOrderPda: PublicKey | null = null;

  for (const { pubkey, account } of accounts) {
    const data = account.data;
    const nonceView = new DataView(data.buffer, data.byteOffset + 291, 8);
    const nonce = nonceView.getBigUint64(0, true);

    if (nonce === buyNonce) {
      buyOrderPda = pubkey;
    } else if (nonce === sellNonce) {
      sellOrderPda = pubkey;
    }
  }

  if (!buyOrderPda) {
    console.error(`Buy order #${buyNonce} not found`);
    process.exit(1);
  }
  if (!sellOrderPda) {
    console.error(`Sell order #${sellNonce} not found`);
    process.exit(1);
  }

  console.log(`Buy order #${buyNonce}: ${buyOrderPda.toBase58()}`);
  console.log(`Sell order #${sellNonce}: ${sellOrderPda.toBase58()}`);

  const buyInfo = await getOrderInfo(buyOrderPda);
  const sellInfo = await getOrderInfo(sellOrderPda);

  console.log(`  Buy order status: ${buyInfo.status}, isMatching: ${buyInfo.isMatching}`);
  console.log(`  Sell order status: ${sellInfo.status}, isMatching: ${sellInfo.isMatching}`);

  if (buyInfo.status !== 0) {
    console.error(`Buy order is not active (status=${buyInfo.status})`);
    process.exit(1);
  }
  if (sellInfo.status !== 0) {
    console.error(`Sell order is not active (status=${sellInfo.status})`);
    process.exit(1);
  }
  if (buyInfo.isMatching || sellInfo.isMatching) {
    console.error('One of the orders is already being matched');
    process.exit(1);
  }

  console.log('');
  console.log('Building match_orders transaction...');

  // Generate computation offset and keys
  const computationOffset = new BN(crypto.randomBytes(8));
  const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
  const ephemeralPubkey = x25519.getPublicKey(ephemeralPrivateKey);
  const nonce = crypto.randomBytes(16);

  console.log(`  Computation offset: ${computationOffset.toString()}`);

  // Derive Arcium accounts
  const mxeSignPda = PublicKey.findProgramAddressSync(
    [Buffer.from('ArciumSignerAccount')],
    MXE_PROGRAM_ID
  )[0];
  const mxeAccount = getMXEAccAddress(MXE_PROGRAM_ID);
  const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
  const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
  const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
  const compDefOffset = Buffer.from(getCompDefAccOffset('compare_prices')).readUInt32LE(0);
  const compDefAccount = getCompDefAccAddress(MXE_PROGRAM_ID, compDefOffset);
  const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
  const poolAccount = getFeePoolAccAddress();
  const clockAccount = getClockAccAddress();

  console.log(`  Computation account: ${computationAccount.toBase58()}`);

  // Build instruction data: discriminator(8) + offset(8) + pubkey(32) + nonce(16) = 64 bytes
  const data = Buffer.alloc(64);
  let offset = 0;
  MATCH_ORDERS_DISCRIMINATOR.copy(data, offset); offset += 8;
  computationOffset.toArrayLike(Buffer, 'le', 8).copy(data, offset); offset += 8;
  Buffer.from(ephemeralPubkey).copy(data, offset); offset += 32;
  nonce.copy(data, offset);

  // Build accounts: 6 primary + 11 remaining
  const keys = [
    // Primary accounts (MatchOrders struct)
    { pubkey: exchangePda, isSigner: false, isWritable: false },
    { pubkey: pairPda, isSigner: false, isWritable: true },
    { pubkey: buyOrderPda, isSigner: false, isWritable: true },
    { pubkey: sellOrderPda, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: crank.publicKey, isSigner: true, isWritable: true },
    // Remaining accounts (MXE infrastructure)
    { pubkey: mxeSignPda, isSigner: false, isWritable: true },
    { pubkey: mxeAccount, isSigner: false, isWritable: true },
    { pubkey: mempoolAccount, isSigner: false, isWritable: true },
    { pubkey: executingPool, isSigner: false, isWritable: true },
    { pubkey: computationAccount, isSigner: false, isWritable: true },
    { pubkey: compDefAccount, isSigner: false, isWritable: false },
    { pubkey: clusterAccount, isSigner: false, isWritable: true },
    { pubkey: poolAccount, isSigner: false, isWritable: true },
    { pubkey: clockAccount, isSigner: false, isWritable: true },
    { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: MXE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    programId: DEX_PROGRAM_ID,
    keys,
    data,
  });

  const tx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }))
    .add(ix);

  console.log('');
  console.log('Sending match_orders transaction...');

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [crank], {
      commitment: 'confirmed',
      skipPreflight: false,
    });

    console.log('');
    console.log('✅ match_orders succeeded!');
    console.log(`   Signature: ${sig}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    console.log('');
    console.log('MPC computation queued. Wait ~30-60s for Arcium to execute...');
    console.log('');
    console.log('Expected flow:');
    console.log('  1. MPC nodes execute compare_prices');
    console.log('  2. MXE receives result via compare_prices_callback');
    console.log('  3. MXE CPIs to DEX finalize_match');
    console.log('  4. DEX updates order status');
    console.log('');
    console.log('Monitor with:');
    console.log('  arcium mempool 456 -u devnet');
    console.log('  arcium execpool 456 -u devnet');
    console.log('');
    console.log('The request_id stored in orders should be the computation account key:');
    console.log(`  ${computationAccount.toBase58()}`);

  } catch (err: any) {
    console.error('');
    console.error('❌ match_orders failed:', err.message);
    if (err.logs) {
      console.error('');
      console.error('Logs:');
      err.logs.forEach((log: string) => console.error('  ', log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
