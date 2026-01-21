/**
 * Script to initialize the Exchange blacklist root to the empty tree root
 * Run: cd frontend && npx tsx scripts/init-blacklist-root.ts
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  Keypair,
} from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const RPC_URL = process.env.HELIUS_RPC_URL || 'https://api.devnet.solana.com';

// Poseidon2 empty tree root (20-level SMT)
const EMPTY_TREE_ROOT_HEX = '3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387';

async function main() {
  console.log('='.repeat(60));
  console.log('  Initialize Blacklist Root (Empty Tree)');
  console.log('='.repeat(60));

  // Load the authority keypair (id.json - the exchange authority)
  const keypairPath = path.join(process.env.HOME || '', '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log(`Authority: ${authority.publicKey.toBase58()}`);

  // Connect to devnet
  const connection = new Connection(RPC_URL, 'confirmed');

  // Derive exchange PDA
  const [exchangePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    PROGRAM_ID
  );
  console.log(`Exchange PDA: ${exchangePda.toBase58()}`);

  // Check current exchange account
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (!exchangeAccount) {
    console.error('Exchange account not found!');
    process.exit(1);
  }
  console.log(`Exchange account size: ${exchangeAccount.data.length} bytes`);

  // Read current blacklist root (offset 77-109 in ExchangeState)
  const currentRoot = exchangeAccount.data.slice(77, 109);
  const currentRootHex = Buffer.from(currentRoot).toString('hex');
  console.log(`\nCurrent blacklist root: ${currentRootHex}`);

  // Parse expected root
  const expectedRoot = Buffer.from(EMPTY_TREE_ROOT_HEX, 'hex');
  const expectedRootHex = EMPTY_TREE_ROOT_HEX;
  console.log(`Expected blacklist root: ${expectedRootHex}`);

  // Check if already set
  if (currentRootHex === expectedRootHex) {
    console.log('\n✓ Blacklist root already set to empty tree root. No action needed.');
    process.exit(0);
  }

  // Check if it's all zeros (uninitialized)
  const isZeros = currentRoot.every((b: number) => b === 0);
  if (!isZeros) {
    console.log('\n⚠️  WARNING: Blacklist root is not zeros (already set to something else)');
    console.log('Do you want to overwrite it? (This script will proceed anyway)');
  }

  // Compute the instruction discriminator for update_blacklist
  // Anchor uses sha256("global:<instruction_name>")[0..8]
  const hash = crypto.createHash('sha256')
    .update(Buffer.from('global:update_blacklist'))
    .digest();
  const discriminator = hash.slice(0, 8);
  console.log(`\nDiscriminator: ${discriminator.toString('hex')}`);

  // Build the update_blacklist instruction
  // Instruction data: discriminator (8) + new_root (32)
  const instructionData = Buffer.concat([
    discriminator,
    expectedRoot,
  ]);

  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    data: instructionData,
  });

  // Build and send the transaction
  console.log('\nSending update_blacklist transaction...');
  const transaction = new Transaction().add(instruction);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = authority.publicKey;

  transaction.sign(authority);

  const signature = await connection.sendRawTransaction(transaction.serialize());
  console.log(`Transaction sent: ${signature}`);

  // Wait for confirmation
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash,
    lastValidBlockHeight,
  });

  if (confirmation.value.err) {
    console.error('Transaction failed:', confirmation.value.err);
    process.exit(1);
  }

  console.log('Transaction confirmed!');

  // Verify the update
  const updatedAccount = await connection.getAccountInfo(exchangePda);
  if (!updatedAccount) {
    console.error('Failed to fetch updated account!');
    process.exit(1);
  }

  const newRoot = updatedAccount.data.slice(77, 109);
  const newRootHex = Buffer.from(newRoot).toString('hex');
  console.log(`\nNew blacklist root: ${newRootHex}`);

  if (newRootHex === expectedRootHex) {
    console.log('✓ Blacklist root successfully updated to empty tree root!');
    console.log('\nThe on-chain verifier will now accept proofs for the empty blacklist.');
  } else {
    console.error(`Update failed! Root is ${newRootHex} (expected ${expectedRootHex})`);
    process.exit(1);
  }
}

main().catch(console.error);
