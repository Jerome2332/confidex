/**
 * Initialize Computation Definitions for Confidex MXE
 *
 * This script initializes all 10 computation definition accounts on the MXE.
 * Each circuit needs its comp_def initialized before it can be used for MPC operations.
 *
 * Usage:
 *   cd arcium-mxe && npx tsx scripts/init-comp-defs.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  getCompDefAccOffset,
  getMXEAccAddress,
  ARCIUM_ADDR,
} from '@arcium-hq/client';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

// Configuration
const MXE_PROGRAM_ID = new PublicKey(
  process.env.MXE_PROGRAM_ID || '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi'
);
const RPC_URL =
  process.env.RPC_URL ||
  'https://api.devnet.solana.com';
const ARCIUM_PROGRAM_ID = new PublicKey(ARCIUM_ADDR);

// Keypair path - must match MXE authority (id.json is 3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm)
const KEYPAIR_PATH =
  process.env.KEYPAIR_PATH ||
  path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');

// All circuits to initialize
const CIRCUITS = [
  'compare_prices',
  'calculate_fill',
  'verify_position_params',
  'check_liquidation',
  'batch_liquidation_check',
  'calculate_pnl',
  'calculate_funding',
  'add_encrypted',
  'sub_encrypted',
  'mul_encrypted',
  // Phase 2+ circuits
  'check_balance',
  'check_order_balance',
  'decrypt_for_settlement',
  'calculate_refund',
  'batch_compare_prices',
  'batch_calculate_fill',
];

// Anchor discriminator for each init function
// The discriminator is sha256("global:init_<circuit_name>_comp_def")[0..8]
function getInstructionDiscriminator(circuitName: string): Buffer {
  const instructionName = `global:init_${circuitName}_comp_def`;
  const hash = createHash('sha256').update(instructionName).digest();
  return hash.slice(0, 8);
}

// Get comp_def offset from circuit name (same as Arcium SDK)
function getCompDefOffset(circuitName: string): number {
  const offsetBytes = getCompDefAccOffset(circuitName);
  return Buffer.from(offsetBytes).readUInt32LE(0);
}

// Derive comp_def account PDA
function getCompDefAccAddress(
  mxeProgramId: PublicKey,
  compDefOffset: number
): PublicKey {
  const offsetBuffer = Buffer.alloc(4);
  offsetBuffer.writeUInt32LE(compDefOffset, 0);

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('ComputationDefinitionAccount'), mxeProgramId.toBuffer(), offsetBuffer],
    ARCIUM_PROGRAM_ID
  );
  return pda;
}

// Load keypair from file
async function loadKeypair(): Promise<Keypair> {
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

// Build init comp def instruction
function buildInitCompDefInstruction(
  payer: PublicKey,
  mxeAccount: PublicKey,
  compDefAccount: PublicKey,
  circuitName: string
): TransactionInstruction {
  const discriminator = getInstructionDiscriminator(circuitName);

  // Accounts order from the Rust struct:
  // 1. payer (signer, mut)
  // 2. mxe_account (mut)
  // 3. comp_def_account (mut) - will be initialized via CPI
  // 4. arcium_program
  // 5. system_program
  const keys = [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: mxeAccount, isSigner: false, isWritable: true },
    { pubkey: compDefAccount, isSigner: false, isWritable: true },
    { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    keys,
    programId: MXE_PROGRAM_ID,
    data: discriminator, // Just the discriminator, no additional args
  });
}

// Check if a comp_def account already exists
async function compDefExists(
  connection: Connection,
  compDefAccount: PublicKey
): Promise<boolean> {
  const info = await connection.getAccountInfo(compDefAccount);
  return info !== null && info.data.length > 0;
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Confidex MXE - Initialize Computation Definitions');
  console.log('='.repeat(60));
  console.log();

  console.log('Configuration:');
  console.log('  MXE Program ID:', MXE_PROGRAM_ID.toBase58());
  console.log('  Arcium Program:', ARCIUM_PROGRAM_ID.toBase58());
  console.log('  RPC URL:', RPC_URL.slice(0, 50) + '...');
  console.log();

  // Load keypair
  const keypair = await loadKeypair();
  console.log('Authority:', keypair.publicKey.toBase58());

  const connection = new Connection(RPC_URL, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  console.log('Balance:', (balance / 1e9).toFixed(4), 'SOL');

  if (balance < 0.5 * 1e9) {
    console.error('\nWarning: Low balance. May need more SOL for transactions.');
  }

  // Get MXE account
  const mxeAccount = getMXEAccAddress(MXE_PROGRAM_ID);
  console.log('\nMXE Account:', mxeAccount.toBase58());

  // Verify MXE account exists
  const mxeInfo = await connection.getAccountInfo(mxeAccount);
  if (!mxeInfo) {
    console.error('\nError: MXE account does not exist. Run `arcium deploy` first.');
    process.exit(1);
  }

  console.log('\nInitializing computation definitions...\n');
  console.log('-'.repeat(60));

  // Process each circuit
  for (const circuitName of CIRCUITS) {
    const offset = getCompDefOffset(circuitName);
    const compDefAccount = getCompDefAccAddress(MXE_PROGRAM_ID, offset);

    console.log(`\nCircuit: ${circuitName}`);
    console.log(`  Offset: ${offset}`);
    console.log(`  CompDef PDA: ${compDefAccount.toBase58()}`);

    // Check if already initialized
    const exists = await compDefExists(connection, compDefAccount);
    if (exists) {
      console.log('  Status: Already initialized');
      continue;
    }

    console.log('  Status: Initializing...');

    try {
      // Build and send transaction
      const instruction = buildInitCompDefInstruction(
        keypair.publicKey,
        mxeAccount,
        compDefAccount,
        circuitName
      );

      const tx = new Transaction().add(instruction);
      tx.feePayer = keypair.publicKey;
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

      tx.sign(keypair);

      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });

      console.log(`  TX: ${sig}`);

      // Wait for confirmation
      await connection.confirmTransaction(sig, 'confirmed');
      console.log('  Status: Confirmed');
    } catch (error) {
      const err = error as Error;
      console.error(`  Error: ${err.message}`);

      // Check if it's already initialized (race condition)
      if (err.message.includes('already in use') || err.message.includes('0x0')) {
        console.log('  Status: Already initialized (concurrent)');
      } else {
        // Log more details for debugging
        if ('logs' in err) {
          console.error('  Logs:', (err as any).logs);
        }
      }
    }
  }

  console.log('\n' + '-'.repeat(60));
  console.log('\nNow uploading circuit bytecode...');
  console.log('This requires the .arcis files from the build directory.\n');

  // Upload circuit bytecode for each circuit
  for (const circuitName of CIRCUITS) {
    const arcisPath = path.join(__dirname, '..', 'build', `${circuitName}.arcis`);

    if (!fs.existsSync(arcisPath)) {
      console.log(`  ${circuitName}: Skipping (no .arcis file found)`);
      continue;
    }

    console.log(`  ${circuitName}: Uploading circuit bytecode...`);

    try {
      // Use the Arcium SDK uploadCircuit function
      const { uploadCircuit } = await import('@arcium-hq/client');
      const { AnchorProvider, Wallet } = await import('@coral-xyz/anchor');

      const wallet = new Wallet(keypair);
      const provider = new AnchorProvider(connection, wallet, {
        commitment: 'confirmed',
      });

      const rawCircuit = fs.readFileSync(arcisPath);

      const sigs = await uploadCircuit(
        provider,
        circuitName,
        MXE_PROGRAM_ID,
        rawCircuit,
        true, // logging
        100 // chunk size (smaller for devnet reliability)
      );

      console.log(`  ${circuitName}: Uploaded (${sigs.length} transactions)`);
    } catch (error) {
      const err = error as Error;
      console.error(`  ${circuitName}: Error - ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Done! Verify with:');
  console.log(`  arcium mxe-info ${MXE_PROGRAM_ID.toBase58()} -u devnet`);
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('\nFatal error:', error.message);
  if (error.logs) {
    console.error('Logs:', error.logs);
  }
  process.exit(1);
});
