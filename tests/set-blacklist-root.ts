/**
 * Set Blacklist Root on Devnet
 *
 * This script sets the empty tree root (Poseidon2) on the deployed Exchange.
 * Required for ZK eligibility proof verification.
 *
 * Usage: npx ts-node tests/set-blacklist-root.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Program ID (devnet)
const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// PDA seed
const EXCHANGE_SEED = Buffer.from('exchange');

// Poseidon2 empty tree root (computed from circuit)
// This is the merkle root of an empty SMT with depth 20
const POSEIDON2_EMPTY_ROOT_HEX = '3039bcb20f03fd9c8650138ef2cfe643edeed152f9c20999f43aeed54d79e387';

// Compute instruction discriminator
function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const UPDATE_BLACKLIST_DISCRIMINATOR = computeDiscriminator('update_blacklist');

// Derive Exchange PDA
function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], PROGRAM_ID);
}

// Build update_blacklist instruction
function buildUpdateBlacklistInstruction(
  authority: PublicKey,
  newRoot: Buffer
): TransactionInstruction {
  const [exchangePda] = deriveExchangePda();

  // Instruction data: discriminator(8) + new_root(32)
  const data = Buffer.alloc(8 + 32);
  UPDATE_BLACKLIST_DISCRIMINATOR.copy(data, 0);
  newRoot.copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

async function main() {
  console.log('=== Setting Blacklist Root ===\n');

  // Load keypair from default Solana location
  const keypairPath = path.join(
    process.env.HOME || '~',
    '.config/solana/id.json'
  );

  if (!fs.existsSync(keypairPath)) {
    console.error('Error: Keypair not found at', keypairPath);
    console.error('Please run: solana-keygen new');
    process.exit(1);
  }

  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Authority:', authority.publicKey.toString());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Derive Exchange PDA
  const [exchangePda] = deriveExchangePda();
  console.log('Exchange PDA:', exchangePda.toString());

  // Parse the empty root hex to bytes
  const emptyRoot = Buffer.from(POSEIDON2_EMPTY_ROOT_HEX, 'hex');
  console.log('Empty tree root:', POSEIDON2_EMPTY_ROOT_HEX);

  // Check current blacklist root
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (!exchangeAccount) {
    console.error('Error: Exchange not initialized');
    process.exit(1);
  }

  // Read current blacklist root (offset 77)
  const blacklistOffset = 8 + 32 + 32 + 2 + 2 + 1;
  const currentRoot = exchangeAccount.data.slice(blacklistOffset, blacklistOffset + 32);
  console.log('Current root:', Buffer.from(currentRoot).toString('hex'));

  // Check if already set
  if (Buffer.from(currentRoot).equals(emptyRoot)) {
    console.log('✓ Blacklist root already set to empty tree root');
    return;
  }

  console.log('\n→ Updating blacklist root...');

  const tx = new Transaction().add(
    buildUpdateBlacklistInstruction(authority.publicKey, emptyRoot)
  );

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [authority], {
      commitment: 'confirmed',
    });
    console.log('✓ Blacklist root updated:', sig);
  } catch (error) {
    console.error('Error updating blacklist root:', error);
    process.exit(1);
  }

  // Verify update
  const updatedAccount = await connection.getAccountInfo(exchangePda);
  if (updatedAccount) {
    const newRoot = updatedAccount.data.slice(blacklistOffset, blacklistOffset + 32);
    console.log('\n=== Verification ===');
    console.log('New root:', Buffer.from(newRoot).toString('hex'));
    console.log('Expected:', POSEIDON2_EMPTY_ROOT_HEX);
    console.log('Match:', Buffer.from(newRoot).equals(emptyRoot) ? 'YES ✓' : 'NO ✗');
  }
}

main().catch(console.error);
