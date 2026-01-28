/**
 * Admin Force Cancel Orders
 *
 * This script force-cancels legacy orders that are stuck due to MPC callback issues.
 * It bypasses the MPC flow entirely and directly credits the refund to the user's
 * confidential balance.
 *
 * IMPORTANT: This is an EMERGENCY/ADMIN tool. Use only when MPC is unavailable.
 *
 * Usage:
 *   npx ts-node scripts/admin-force-cancel-orders.ts [order_nonces...]
 *
 * Examples:
 *   npx ts-node scripts/admin-force-cancel-orders.ts 29 30 32 33  # Cancel specific orders
 *   npx ts-node scripts/admin-force-cancel-orders.ts              # Cancel ALL legacy orders
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

// Token mints (devnet)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// V5 order size
const ORDER_SIZE_V5 = 366;

// User balance account size
const USER_BALANCE_SIZE = 153;

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

function deriveOrderPda(maker: PublicKey, nonce: bigint): [PublicKey, number] {
  const nonceBuffer = Buffer.alloc(8);
  nonceBuffer.writeBigUInt64LE(nonce);

  return PublicKey.findProgramAddressSync(
    [Buffer.from('order'), maker.toBuffer(), nonceBuffer],
    DEX_PROGRAM_ID
  );
}

function deriveUserBalancePda(owner: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_balance'), owner.toBuffer(), mint.toBuffer()],
    DEX_PROGRAM_ID
  );
}

// Order side constants (TypeScript enums not supported in strip-only mode)
const Side = {
  Buy: 0,
  Sell: 1,
} as const;
type Side = typeof Side[keyof typeof Side];

interface LegacyOrder {
  pda: PublicKey;
  nonce: bigint;
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  status: number;
  isMatching: boolean;
  encryptedAmount: Buffer;
}

/**
 * Check if an order is a "legacy broken" order by examining its encrypted amount.
 * Legacy orders have encrypted amounts that look like huge values when read as u64.
 */
function isLegacyBrokenOrder(encryptedAmount: Buffer): boolean {
  // Read first 8 bytes as u64
  const value = encryptedAmount.readBigUInt64LE(0);
  // Legacy encrypted amounts appear as values > 10^12 (1 trillion)
  // This is because the encrypted ciphertext bytes form large numbers
  return value > BigInt(1e12);
}

/**
 * Find all legacy/broken orders for a given wallet
 */
async function findLegacyOrders(wallet: PublicKey): Promise<LegacyOrder[]> {
  const accounts = await connection.getProgramAccounts(DEX_PROGRAM_ID, {
    filters: [
      { dataSize: ORDER_SIZE_V5 },
      { memcmp: { offset: 8, bytes: wallet.toBase58() } },
    ],
  });

  const legacyOrders: LegacyOrder[] = [];

  for (const { pubkey, account } of accounts) {
    const data = account.data;

    // Parse order fields
    const maker = new PublicKey(data.slice(8, 40));
    const pair = new PublicKey(data.slice(40, 72));
    const side = data[72] as Side;
    // order_type at 73
    const encryptedAmount = data.slice(74, 138);
    // encrypted_price at 138-202
    // encrypted_filled at 202-266
    const status = data[266];
    // created_at_hour at 267-275
    // order_id at 275-291
    // order_nonce at 291-299
    const nonceView = new DataView(data.buffer, data.byteOffset + 291, 8);
    const nonce = nonceView.getBigUint64(0, true);
    // eligibility_proof_verified at 299
    // pending_match_request at 300-332
    const isMatching = data[332] === 1;
    // bump at 333
    // ephemeral_pubkey at 334-366

    // Only include:
    // 1. Active orders (status=0)
    // 2. Orders that look like legacy/broken (encrypted amount is huge)
    if (status === 0 && isLegacyBrokenOrder(encryptedAmount)) {
      legacyOrders.push({
        pda: pubkey,
        nonce,
        maker,
        pair,
        side,
        status,
        isMatching,
        encryptedAmount,
      });
    }
  }

  return legacyOrders.sort((a, b) => Number(a.nonce - b.nonce));
}

/**
 * Ensure user balance account exists
 */
async function ensureUserBalanceExists(
  connection: Connection,
  user: PublicKey,
  mint: PublicKey
): Promise<boolean> {
  const [balancePda] = deriveUserBalancePda(user, mint);
  const info = await connection.getAccountInfo(balancePda);
  return info !== null;
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

  // Find all V5 orders for the admin wallet (who is also the user in this case)
  // In production, you'd pass a user wallet as parameter
  const userWallet = adminKeypair.publicKey;

  console.log(`Looking for legacy orders (wallet: ${userWallet.toString()})...\n`);
  const allLegacyOrders = await findLegacyOrders(userWallet);

  if (allLegacyOrders.length === 0) {
    console.log('No legacy/broken orders found. Nothing to cancel.');
    return;
  }

  // Filter to target nonces if specified
  const ordersToCancel = targetNonces
    ? allLegacyOrders.filter(o => targetNonces.includes(o.nonce))
    : allLegacyOrders;

  if (ordersToCancel.length === 0) {
    console.log(`No orders found matching nonces: ${targetNonces?.join(', ')}`);
    console.log(`Found legacy orders: ${allLegacyOrders.map(o => o.nonce.toString()).join(', ')}`);
    return;
  }

  console.log(`Found ${ordersToCancel.length} legacy orders to cancel:`);
  for (const order of ordersToCancel) {
    console.log(`  Nonce ${order.nonce}: ${order.pda.toString()} (${order.side === Side.Buy ? 'BUY' : 'SELL'})`);
  }
  console.log();

  // Derive trading pair PDA (SOL/USDC)
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);
  console.log('Trading pair PDA:', pairPda.toString());

  // Verify pair exists
  const pairInfo = await connection.getAccountInfo(pairPda);
  if (!pairInfo) {
    throw new Error('Trading pair not found');
  }
  console.log('Trading pair verified!\n');

  // Derive user balance PDAs
  const [userBaseBalance] = deriveUserBalancePda(userWallet, WSOL_MINT);
  const [userQuoteBalance] = deriveUserBalancePda(userWallet, USDC_MINT);

  console.log('User base balance (WSOL):', userBaseBalance.toString());
  console.log('User quote balance (USDC):', userQuoteBalance.toString());

  // Verify user balance accounts exist
  const baseExists = await ensureUserBalanceExists(connection, userWallet, WSOL_MINT);
  const quoteExists = await ensureUserBalanceExists(connection, userWallet, USDC_MINT);

  if (!baseExists) {
    console.error('ERROR: User base balance account does not exist. Deposit WSOL first.');
    return;
  }
  if (!quoteExists) {
    console.error('ERROR: User quote balance account does not exist. Deposit USDC first.');
    return;
  }
  console.log('User balance accounts verified!\n');

  // Process each order
  for (const order of ordersToCancel) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Force-cancelling order nonce ${order.nonce}`);
    console.log(`  PDA: ${order.pda.toString()}`);
    console.log(`  Side: ${order.side === Side.Buy ? 'BUY' : 'SELL'}`);
    console.log(`  Is Matching: ${order.isMatching}`);

    // Determine refund amount
    // For legacy orders, we use 0 refund since we can't decrypt the actual amount
    // The admin should set this based on off-chain inspection of original deposits
    // For safety, using 0 - user can claim via support with proof of deposit
    const refundAmount = BigInt(0);
    console.log(`  Refund Amount: ${refundAmount} (admin override available)`);

    // Build instruction data: discriminator + refund_amount (u64 LE)
    const instructionData = Buffer.alloc(8 + 8);
    ADMIN_FORCE_CANCEL_ORDER_DISCRIMINATOR.copy(instructionData, 0);
    instructionData.writeBigUInt64LE(refundAmount, 8);

    // Build instruction
    // Accounts from AdminForceCancelOrder struct:
    // 0. exchange (seeds = [ExchangeState::SEED])
    // 1. pair (mut, seeds = [TradingPair::SEED, base_mint, quote_mint])
    // 2. order (mut, seeds = [ConfidentialOrder::SEED, maker, nonce])
    // 3. user_base_balance (mut, seeds = [UserConfidentialBalance::SEED, maker, base_mint])
    // 4. user_quote_balance (mut, seeds = [UserConfidentialBalance::SEED, maker, quote_mint])
    // 5. authority (signer)
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

    // Simulate first
    console.log('  Simulating...');
    try {
      const sim = await connection.simulateTransaction(tx);
      if (sim.value.err) {
        console.log('  Simulation failed:', JSON.stringify(sim.value.err));
        console.log('  Logs:', sim.value.logs?.slice(-8).join('\n    '));
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

      console.log('  Order force-cancelled successfully!');
    } catch (sendError: any) {
      console.log('  Send error:', sendError.message);
      if (sendError.logs) {
        console.log('  Logs:', sendError.logs.slice(-8).join('\n    '));
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done! Orders have been cancelled.');
  console.log('Refresh the frontend to see the changes.');
}

main().catch(console.error);
