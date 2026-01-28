/**
 * Admin Cleanup Stuck Orders
 *
 * This script force-cancels ALL stuck orders (is_matching=true) across all wallets.
 * These orders got stuck because MPC callbacks failed before the request_id fix.
 *
 * Usage:
 *   npx tsx scripts/admin-cleanup-stuck-orders.ts
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  SystemProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const RPC_URL = 'https://devnet.helius-rpc.com/?api-key=a5993fde-e283-4034-82cf-6a6fef562a19';
const connection = new Connection(RPC_URL, 'confirmed');
const DEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// Token mints (devnet)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// V5 order size
const ORDER_SIZE_V5 = 366;

function getDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const ADMIN_FORCE_CANCEL_ORDER_DISCRIMINATOR = getDiscriminator('admin_force_cancel_order');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    DEX_PROGRAM_ID
  );
}

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('pair'), baseMint.toBuffer(), quoteMint.toBuffer()],
    DEX_PROGRAM_ID
  );
}

function deriveUserBalancePda(owner: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_balance'), owner.toBuffer(), mint.toBuffer()],
    DEX_PROGRAM_ID
  );
}

const Side = {
  Buy: 0,
  Sell: 1,
} as const;
type Side = typeof Side[keyof typeof Side];

interface StuckOrder {
  pda: PublicKey;
  nonce: bigint;
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  status: number;
  isMatching: boolean;
}

async function findAllStuckOrders(): Promise<StuckOrder[]> {
  const accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [{ dataSize: ORDER_SIZE_V5 }],
  });

  const stuckOrders: StuckOrder[] = [];

  for (const { pubkey, account } of accounts) {
    const data = account.data;
    const maker = new PublicKey(data.slice(8, 40));
    const pair = new PublicKey(data.slice(40, 72));
    const side = data[72] as Side;
    const status = data[266];
    const isMatching = data[332] === 1;
    const nonceView = new DataView(data.buffer, data.byteOffset + 291, 8);
    const nonce = nonceView.getBigUint64(0, true);

    // Only include Active orders with is_matching=true
    if (status === 0 && isMatching) {
      stuckOrders.push({
        pda: pubkey,
        nonce,
        maker,
        pair,
        side,
        status,
        isMatching,
      });
    }
  }

  return stuckOrders.sort((a, b) => Number(a.nonce - b.nonce));
}

async function ensureUserBalanceExists(
  user: PublicKey,
  mint: PublicKey
): Promise<boolean> {
  const [balancePda] = deriveUserBalancePda(user, mint);
  const info = await connection.getAccountInfo(balancePda);
  return info !== null;
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Admin Cleanup: Force Cancel Stuck Orders');
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
  console.log('');

  // Group by maker for display
  const byMaker = new Map<string, StuckOrder[]>();
  for (const order of stuckOrders) {
    const makerStr = order.maker.toBase58();
    if (!byMaker.has(makerStr)) {
      byMaker.set(makerStr, []);
    }
    byMaker.get(makerStr)!.push(order);
  }

  for (const [maker, orders] of byMaker) {
    console.log(`Maker: ${maker}`);
    for (const order of orders) {
      console.log(`  Nonce ${order.nonce}: ${order.side === Side.Buy ? 'BUY' : 'SELL'}`);
    }
  }
  console.log('');

  // Derive trading pair PDA (SOL/USDC)
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);

  // Process each stuck order
  let successCount = 0;
  let failCount = 0;

  for (const order of stuckOrders) {
    console.log('-'.repeat(60));
    console.log(`Processing order #${order.nonce}`);
    console.log(`  PDA: ${order.pda.toString()}`);
    console.log(`  Maker: ${order.maker.toString()}`);
    console.log(`  Side: ${order.side === Side.Buy ? 'BUY' : 'SELL'}`);

    // Derive user balance PDAs for this maker
    const [userBaseBalance] = deriveUserBalancePda(order.maker, WSOL_MINT);
    const [userQuoteBalance] = deriveUserBalancePda(order.maker, USDC_MINT);

    // Check if user balance accounts exist
    const baseExists = await ensureUserBalanceExists(order.maker, WSOL_MINT);
    const quoteExists = await ensureUserBalanceExists(order.maker, USDC_MINT);

    if (!baseExists || !quoteExists) {
      console.log(`  SKIP: User balance accounts don't exist (base: ${baseExists}, quote: ${quoteExists})`);
      failCount++;
      continue;
    }

    // Build instruction data: discriminator + refund_amount (0 for cleanup)
    const instructionData = Buffer.alloc(8 + 8);
    ADMIN_FORCE_CANCEL_ORDER_DISCRIMINATOR.copy(instructionData, 0);
    instructionData.writeBigUInt64LE(BigInt(0), 8);

    const ix = new TransactionInstruction({
      programId: DEX_PROGRAM_ID,
      keys: [
        { pubkey: exchangePda, isSigner: false, isWritable: false },
        { pubkey: pairPda, isSigner: false, isWritable: true },
        { pubkey: order.pda, isSigner: false, isWritable: true },
        { pubkey: userBaseBalance, isSigner: false, isWritable: true },
        { pubkey: userQuoteBalance, isSigner: false, isWritable: true },
        { pubkey: adminKeypair.publicKey, isSigner: true, isWritable: false },
      ],
      data: instructionData,
    });

    const tx = new Transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }));
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

      console.log('  SUCCESS - Order cancelled!');
      successCount++;
    } catch (sendError: any) {
      console.log('  Send error:', sendError.message);
      failCount++;
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary:');
  console.log(`  Total stuck orders: ${stuckOrders.length}`);
  console.log(`  Successfully cancelled: ${successCount}`);
  console.log(`  Failed: ${failCount}`);
  console.log('='.repeat(60));
}

main().catch(console.error);
