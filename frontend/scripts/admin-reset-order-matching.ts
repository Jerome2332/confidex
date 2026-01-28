/**
 * Admin Reset Order Matching
 *
 * This script resets the is_matching flag on stuck orders so they can be
 * cancelled or re-matched. Orders get stuck when MPC callbacks never arrive.
 *
 * Usage:
 *   npx ts-node scripts/admin-reset-order-matching.ts [order_nonces...]
 *
 * Examples:
 *   npx ts-node scripts/admin-reset-order-matching.ts 28 29 32  # Reset specific orders
 *   npx ts-node scripts/admin-reset-order-matching.ts           # Reset all stuck orders
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a5993fde-e283-4034-82cf-6a6fef562a19';
const connection = new Connection(RPC_URL, 'confirmed');
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// User wallet with stuck orders
const USER_WALLET = new PublicKey('GCHbQpxZNpubDhQrXPLXD59Pp4irvaiB4vcyGSKno1EW');

// V5 order size
const ORDER_SIZE_V5 = 366;

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const ADMIN_RESET_ORDER_MATCHING_DISCRIMINATOR = getDiscriminator('admin_reset_order_matching');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    DEX_PROGRAM_ID
  );
}

function deriveOrderPda(maker: PublicKey, nonce: bigint): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce);

  return PublicKey.findProgramAddressSync(
    [Buffer.from('order'), maker.toBuffer(), nonceBuffer],
    DEX_PROGRAM_ID
  );
}

interface StuckOrder {
  pda: PublicKey;
  nonce: bigint;
  isMatching: boolean;
  status: number;
}

async function findStuckOrders(wallet: PublicKey): Promise<StuckOrder[]> {
  const accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [
      { dataSize: ORDER_SIZE_V5 },
      { memcmp: { offset: 8, bytes: wallet.toBase58() } },
    ],
  });

  const stuckOrders: StuckOrder[] = [];

  for (const { pubkey, account } of accounts) {
    const data = account.data;
    const status = data[266];
    const isMatching = data[332] === 1;

    // Extract order_nonce
    const nonceView = new DataView(data.buffer, data.byteOffset + 291, 8);
    const nonce = nonceView.getBigUint64(0, true);

    // Only include orders that are Active (status=0) AND is_matching=true
    if (status === 0 && isMatching) {
      stuckOrders.push({
        pda: pubkey,
        nonce,
        isMatching,
        status,
      });
    }
  }

  return stuckOrders.sort((a, b) => Number(a.nonce - b.nonce));
}

async function main() {
  // Parse command line args for specific nonces
  const args = process.argv.slice(2);
  const targetNonces = args.length > 0
    ? args.map(n => BigInt(n))
    : null;

  // Load admin keypair (id.json is exchange authority on devnet)
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}. Set up Solana CLI first.`);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const adminKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Admin wallet:', adminKeypair.publicKey.toString());

  // Verify admin is exchange authority
  const [exchangePda] = deriveExchangePda();
  const exchangeInfo = await connection.getAccountInfo(exchangePda);
  if (!exchangeInfo) {
    throw new Error('Exchange account not found');
  }

  const exchangeAuthority = new PublicKey(exchangeInfo.data.slice(8, 40));
  console.log('Exchange authority:', exchangeAuthority.toString());

  if (!exchangeAuthority.equals(adminKeypair.publicKey)) {
    throw new Error(
      `Admin wallet ${adminKeypair.publicKey.toString()} is not exchange authority ${exchangeAuthority.toString()}`
    );
  }
  console.log('Admin authority verified!\n');

  // Find stuck orders
  console.log(`Looking for stuck orders (wallet: ${USER_WALLET.toString()})...\n`);
  const allStuckOrders = await findStuckOrders(USER_WALLET);

  if (allStuckOrders.length === 0) {
    console.log('No stuck orders found (is_matching=true). Nothing to reset.');
    return;
  }

  // Filter to target nonces if specified
  const ordersToReset = targetNonces
    ? allStuckOrders.filter(o => targetNonces.includes(o.nonce))
    : allStuckOrders;

  if (ordersToReset.length === 0) {
    console.log(`No orders found matching nonces: ${targetNonces?.join(', ')}`);
    console.log(`Found stuck orders: ${allStuckOrders.map(o => o.nonce.toString()).join(', ')}`);
    return;
  }

  console.log(`Found ${ordersToReset.length} stuck orders to reset:`);
  for (const order of ordersToReset) {
    console.log(`  Nonce ${order.nonce}: ${order.pda.toString()}`);
  }
  console.log();

  // Build instruction: discriminator only (no args)
  const instructionData = ADMIN_RESET_ORDER_MATCHING_DISCRIMINATOR;

  for (const order of ordersToReset) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Resetting order nonce ${order.nonce}`);
    console.log(`  PDA: ${order.pda.toString()}`);

    const ix = new TransactionInstruction({
      programId: DEX_PROGRAM_ID,
      keys: [
        { pubkey: exchangePda, isSigner: false, isWritable: false },
        { pubkey: order.pda, isSigner: false, isWritable: true },
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data: instructionData,
    });

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }));
    tx.add(ix);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    tx.recentBlockhash = blockhash;
    tx.feePayer = adminKeypair.publicKey;

    // Simulate first
    console.log('  Simulating...');
    try {
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.log('  Simulation failed:', JSON.stringify(sim.value.err));
        console.log('  Logs:', sim.value.logs?.slice(-5).join('\n    '));
        continue;
      }
      console.log(`  Simulation success (${sim.value.unitsConsumed} CU)`);
    } catch (simError) {
      console.log('  Simulation error:', simError);
      continue;
    }

    // Sign and send
    tx.sign(adminKeypair);
    console.log('  Sending transaction...');

    try {
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log('  Tx:', signature);

      await connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );

      console.log('  Order matching reset successfully!');
      console.log('  Order can now be cancelled via frontend');
    } catch (sendError: any) {
      console.log('  Send error:', sendError.message);
      if (sendError.logs) {
        console.log('  Logs:', sendError.logs.slice(-5).join('\n    '));
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done! Orders can now be cancelled from the frontend.');
}

main().catch(console.error);
