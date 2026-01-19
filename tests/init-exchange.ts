/**
 * Initialize Confidex Exchange on Devnet
 *
 * Usage: npx ts-node scripts/init-exchange.ts
 *
 * This script:
 * 1. Initializes the exchange state PDA
 * 2. Creates the SOL/USDC trading pair
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Program ID (devnet)
const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');

// Token mints for SOL/USDC pair
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112'); // Wrapped SOL
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Dummy USDC devnet (for testing)

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');

// Fee settings
const MAKER_FEE_BPS = 10; // 0.10%
const TAKER_FEE_BPS = 30; // 0.30%

// Min order size and tick size
const MIN_ORDER_SIZE = 100_000_000; // 0.1 SOL in lamports
const TICK_SIZE = 10_000; // 0.01 USDC in micro-units

// Compute instruction discriminators
function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

const INITIALIZE_DISCRIMINATOR = computeDiscriminator('initialize');
const CREATE_PAIR_DISCRIMINATOR = computeDiscriminator('create_pair');

// Derive PDAs
function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], PROGRAM_ID);
}

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    PROGRAM_ID
  );
}

// Build initialize instruction
function buildInitializeInstruction(authority: PublicKey): TransactionInstruction {
  const [exchangePda] = deriveExchangePda();

  // Instruction data: discriminator(8) + maker_fee_bps(2) + taker_fee_bps(2)
  const data = Buffer.alloc(8 + 2 + 2);
  INITIALIZE_DISCRIMINATOR.copy(data, 0);
  data.writeUInt16LE(MAKER_FEE_BPS, 8);
  data.writeUInt16LE(TAKER_FEE_BPS, 10);

  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

// Build create_pair instruction
function buildCreatePairInstruction(
  authority: PublicKey,
  baseMint: PublicKey,
  quoteMint: PublicKey
): TransactionInstruction {
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);

  // Instruction data: discriminator(8) + min_order_size(8) + tick_size(8)
  const data = Buffer.alloc(8 + 8 + 8);
  CREATE_PAIR_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(BigInt(MIN_ORDER_SIZE), 8);
  data.writeBigUInt64LE(BigInt(TICK_SIZE), 16);

  return new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: baseMint, isSigner: false, isWritable: false },
      { pubkey: quoteMint, isSigner: false, isWritable: false },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

async function main() {
  console.log('=== Confidex Exchange Initialization ===\n');

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

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Balance:', balance / 1e9, 'SOL');

  if (balance < 0.1 * 1e9) {
    console.error('Error: Insufficient balance. Need at least 0.1 SOL');
    console.error('Run: solana airdrop 2 --url devnet');
    process.exit(1);
  }

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);

  console.log('\nDerived PDAs:');
  console.log('  Exchange PDA:', exchangePda.toString());
  console.log('  Pair PDA:', pairPda.toString());

  // Check if exchange already exists
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (exchangeAccount) {
    console.log('\n✓ Exchange already initialized');
  } else {
    console.log('\n→ Initializing exchange...');

    const initTx = new Transaction().add(buildInitializeInstruction(authority.publicKey));

    try {
      const sig = await sendAndConfirmTransaction(connection, initTx, [authority], {
        commitment: 'confirmed',
      });
      console.log('✓ Exchange initialized:', sig);
    } catch (error) {
      console.error('Error initializing exchange:', error);
      process.exit(1);
    }
  }

  // Check if pair already exists
  const pairAccount = await connection.getAccountInfo(pairPda);
  if (pairAccount) {
    console.log('✓ SOL/USDC pair already exists');
  } else {
    console.log('→ Creating SOL/USDC trading pair...');

    const pairTx = new Transaction().add(
      buildCreatePairInstruction(authority.publicKey, WSOL_MINT, USDC_MINT)
    );

    try {
      const sig = await sendAndConfirmTransaction(connection, pairTx, [authority], {
        commitment: 'confirmed',
      });
      console.log('✓ SOL/USDC pair created:', sig);
    } catch (error) {
      console.error('Error creating pair:', error);
      process.exit(1);
    }
  }

  console.log('\n=== Initialization Complete ===');
  console.log('\nProgram ID:', PROGRAM_ID.toString());
  console.log('Exchange PDA:', exchangePda.toString());
  console.log('SOL/USDC Pair PDA:', pairPda.toString());
}

main().catch(console.error);
