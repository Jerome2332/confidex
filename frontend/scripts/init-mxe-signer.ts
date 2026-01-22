/**
 * Initialize MXE Signer Account
 *
 * This script calls the MXE program directly to initialize the ArciumSignerAccount PDA.
 * The account uses `init_if_needed` so it will be created on the first call.
 *
 * Usage: npx tsx scripts/init-mxe-signer.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Import Arcium SDK
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
  ARCIUM_ADDR,
} from '@arcium-hq/client';

// Constants
const MXE_PROGRAM_ID = new PublicKey('HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS');
const CLUSTER_OFFSET = 456;
const SIGN_PDA_SEED = Buffer.from('ArciumSignerAccount');

// Compute discriminator for "global:compare_prices"
function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Initialize MXE Signer Account');
  console.log('='.repeat(60));

  // Setup connection
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`\nRPC: ${rpcUrl}`);

  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log(`Wallet: ${walletKeypair.publicKey.toBase58()}`);

  // Check wallet balance
  const balance = await connection.getBalance(walletKeypair.publicKey);
  console.log(`Balance: ${balance / 1e9} SOL`);

  if (balance < 0.01 * 1e9) {
    console.error('\n❌ Insufficient balance. Need at least 0.01 SOL');
    process.exit(1);
  }

  // Derive sign_pda_account
  const [signPdaAccount, bump] = PublicKey.findProgramAddressSync(
    [SIGN_PDA_SEED],
    MXE_PROGRAM_ID
  );
  console.log(`\nSign PDA Account: ${signPdaAccount.toBase58()}`);
  console.log(`Bump: ${bump}`);

  // Check if account already exists
  const accountInfo = await connection.getAccountInfo(signPdaAccount);
  if (accountInfo) {
    console.log(`\n✅ Sign PDA Account already exists (${accountInfo.data.length} bytes)`);
    console.log('   No initialization needed.');
    return;
  }

  console.log('\n⚠️  Sign PDA Account does NOT exist - will initialize...');

  // Get computation definition offset for compare_prices
  const compDefOffset = Buffer.from(getCompDefAccOffset('compare_prices')).readUInt32LE(0);

  // Generate a random computation offset
  const computationOffset = new BN(Math.floor(Math.random() * 1e15));

  // Derive all required accounts
  const mxeAccount = getMXEAccAddress(MXE_PROGRAM_ID);
  const mempoolAccount = getMempoolAccAddress(CLUSTER_OFFSET);
  const executingPool = getExecutingPoolAccAddress(CLUSTER_OFFSET);
  const computationAccount = getComputationAccAddress(CLUSTER_OFFSET, computationOffset);
  const compDefAccount = getCompDefAccAddress(MXE_PROGRAM_ID, compDefOffset);
  const clusterAccount = getClusterAccAddress(CLUSTER_OFFSET);
  const poolAccount = getFeePoolAccAddress();
  const clockAccount = getClockAccAddress();
  const arciumProgram = new PublicKey(ARCIUM_ADDR);

  console.log('\nDerived Accounts:');
  console.log(`  mxeAccount:         ${mxeAccount.toBase58()}`);
  console.log(`  mempoolAccount:     ${mempoolAccount.toBase58()}`);
  console.log(`  executingPool:      ${executingPool.toBase58()}`);
  console.log(`  computationAccount: ${computationAccount.toBase58()}`);
  console.log(`  compDefAccount:     ${compDefAccount.toBase58()}`);
  console.log(`  clusterAccount:     ${clusterAccount.toBase58()}`);
  console.log(`  poolAccount:        ${poolAccount.toBase58()}`);
  console.log(`  clockAccount:       ${clockAccount.toBase58()}`);
  console.log(`  arciumProgram:      ${arciumProgram.toBase58()}`);

  // Verify compDefAccount exists
  const compDefInfo = await connection.getAccountInfo(compDefAccount);
  if (!compDefInfo) {
    console.error('\n❌ Computation definition account does not exist!');
    console.error('   Run init_compare_prices_comp_def first.');
    process.exit(1);
  }
  console.log(`\n✅ CompDef account exists (${compDefInfo.data.length} bytes)`);

  // Build instruction data for compare_prices manually
  // Layout:
  //   8 bytes: discriminator
  //   8 bytes: computation_offset (u64 LE)
  //   32 bytes: buy_price_ciphertext
  //   32 bytes: sell_price_ciphertext
  //   32 bytes: pub_key
  //   16 bytes: nonce (u128 LE)
  //   1 byte: buy_order Option tag (0 = None)
  //   1 byte: sell_order Option tag (0 = None)

  const discriminator = computeDiscriminator('compare_prices');
  console.log(`\nDiscriminator: ${discriminator.toString('hex')}`);

  const instructionData = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 1 + 1);
  let offset = 0;

  // Discriminator
  discriminator.copy(instructionData, offset);
  offset += 8;

  // computation_offset (u64 LE)
  const compOffsetBuf = computationOffset.toArrayLike(Buffer, 'le', 8);
  compOffsetBuf.copy(instructionData, offset);
  offset += 8;

  // buy_price_ciphertext (32 bytes, zeros)
  offset += 32;

  // sell_price_ciphertext (32 bytes, zeros)
  offset += 32;

  // pub_key (32 bytes, zeros)
  offset += 32;

  // nonce (u128 LE, 16 bytes, zeros)
  offset += 16;

  // buy_order Option<Pubkey> = None (1 byte tag = 0)
  instructionData[offset] = 0;
  offset += 1;

  // sell_order Option<Pubkey> = None (1 byte tag = 0)
  instructionData[offset] = 0;
  offset += 1;

  console.log(`Instruction data length: ${instructionData.length} bytes`);

  // Build account metas in the exact order expected by the MXE program
  // Based on ComparePrices struct in lib.rs:
  //   payer (signer, mut)
  //   sign_pda_account (mut)
  //   mxe_account
  //   mempool_account (mut)
  //   executing_pool (mut)
  //   computation_account (mut)
  //   comp_def_account
  //   cluster_account (mut)
  //   pool_account (mut)
  //   clock_account (mut)
  //   system_program
  //   arcium_program

  const instruction = new TransactionInstruction({
    programId: MXE_PROGRAM_ID,
    keys: [
      { pubkey: walletKeypair.publicKey, isSigner: true, isWritable: true },   // payer
      { pubkey: signPdaAccount, isSigner: false, isWritable: true },           // sign_pda_account
      { pubkey: mxeAccount, isSigner: false, isWritable: false },              // mxe_account
      { pubkey: mempoolAccount, isSigner: false, isWritable: true },           // mempool_account
      { pubkey: executingPool, isSigner: false, isWritable: true },            // executing_pool
      { pubkey: computationAccount, isSigner: false, isWritable: true },       // computation_account
      { pubkey: compDefAccount, isSigner: false, isWritable: false },          // comp_def_account
      { pubkey: clusterAccount, isSigner: false, isWritable: true },           // cluster_account
      { pubkey: poolAccount, isSigner: false, isWritable: true },              // pool_account
      { pubkey: clockAccount, isSigner: false, isWritable: true },             // clock_account
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
      { pubkey: arciumProgram, isSigner: false, isWritable: false },           // arcium_program
    ],
    data: instructionData,
  });

  console.log('\n📤 Sending compare_prices transaction to initialize sign_pda_account...');

  try {
    const transaction = new Transaction().add(instruction);
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = walletKeypair.publicKey;

    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [walletKeypair],
      { commitment: 'confirmed' }
    );

    console.log(`\n✅ Transaction sent: ${signature}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);

    // Verify account was created
    const newAccountInfo = await connection.getAccountInfo(signPdaAccount);
    if (newAccountInfo) {
      console.log(`\n✅ Sign PDA Account created successfully (${newAccountInfo.data.length} bytes)`);
    } else {
      console.log('\n⚠️  Account info not found after transaction - may need to wait for confirmation');
    }

  } catch (error: any) {
    console.error('\n❌ Transaction failed:', error.message);

    if (error.logs) {
      console.error('\nTransaction logs:');
      error.logs.forEach((log: string) => console.error(`  ${log}`));
    }

    // Check if account was created despite error
    const finalAccountInfo = await connection.getAccountInfo(signPdaAccount);
    if (finalAccountInfo) {
      console.log(`\n✅ Despite error, Sign PDA Account exists (${finalAccountInfo.data.length} bytes)`);
    }
  }
}

main().catch(console.error);
