/**
 * Admin Reset All Stuck Orders
 *
 * This script resets the is_matching flag on ALL stuck orders across all wallets.
 * After reset, orders can be cancelled normally by their owners.
 *
 * Usage:
 *   npx tsx scripts/admin-reset-all-stuck-orders.ts
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

interface StuckOrder {
  pda: PublicKey;
  nonce: bigint;
  maker: PublicKey;
  side: number;
}

async function findAllStuckOrders(): Promise<StuckOrder[]> {
  const accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [{ dataSize: ORDER_SIZE_V5 }],
  });

  const stuckOrders: StuckOrder[] = [];

  for (const { pubkey, account } of accounts) {
    const data = account.data;
    const maker = new PublicKey(data.slice(8, 40));
    const side = data[72];
    const status = data[266];
    const isMatching = data[332] === 1;
    const nonceView = new DataView(data.buffer, data.byteOffset + 291, 8);
    const nonce = nonceView.getBigUint64(0, true);

    // Only include Active orders with is_matching=true
    if (status === 0 && isMatching) {
      stuckOrders.push({ pda: pubkey, nonce, maker, side });
    }
  }

  return stuckOrders.sort((a, b) => Number(a.nonce - b.nonce));
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Admin Reset: Clear is_matching Flag on Stuck Orders');
  console.log('='.repeat(60));
  console.log('');

  // Load admin keypair
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`Keypair not found at ${keypairPath}`);
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
  if (!exchangeAuthority.equals(adminKeypair.publicKey)) {
    throw new Error(
      `Admin wallet ${adminKeypair.publicKey.toString()} is not exchange authority ${exchangeAuthority.toString()}`
    );
  }
  console.log('Admin authority verified!');
  console.log('');

  // Find all stuck orders
  console.log('Finding stuck orders (is_matching=true)...');
  const stuckOrders = await findAllStuckOrders();

  if (stuckOrders.length === 0) {
    console.log('No stuck orders found. All clear!');
    return;
  }

  console.log(`Found ${stuckOrders.length} stuck orders:`);
  for (const order of stuckOrders) {
    console.log(`  #${order.nonce}: ${order.pda.toBase58().slice(0, 20)}... (${order.side === 0 ? 'BUY' : 'SELL'})`);
  }
  console.log('');

  // Process each stuck order
  let successCount = 0;
  let failCount = 0;

  for (const order of stuckOrders) {
    console.log('-'.repeat(60));
    console.log(`Resetting order #${order.nonce}`);
    console.log(`  PDA: ${order.pda.toString()}`);
    console.log(`  Maker: ${order.maker.toString()}`);

    // Build instruction: discriminator only (no args)
    const instructionData = ADMIN_RESET_ORDER_MATCHING_DISCRIMINATOR;

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

    // Simulate
    console.log('  Simulating...');
    try {
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.log('  Simulation failed:', JSON.stringify(sim.value.err));
        const relevantLogs = sim.value.logs?.slice(-5) || [];
        for (const log of relevantLogs) {
          console.log('    ', log);
        }
        failCount++;
        continue;
      }
      console.log(`  Simulation OK (${sim.value.unitsConsumed} CU)`);
    } catch (simError: any) {
      console.log('  Simulation error:', simError.message);
      failCount++;
      continue;
    }

    // Send transaction
    tx.sign(adminKeypair);
    console.log('  Sending...');

    try {
      const signature = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`  Tx: ${signature}`);

      await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      console.log('  SUCCESS - is_matching flag reset!');
      successCount++;
    } catch (sendError: any) {
      console.log('  Send error:', sendError.message);
      failCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 300));
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary:');
  console.log(`  Total stuck orders: ${stuckOrders.length}`);
  console.log(`  Successfully reset: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log('='.repeat(60));

  if (successCount > 0) {
    console.log('');
    console.log('Orders can now be cancelled normally from the frontend!');
  }
}

main().catch(console.error);
