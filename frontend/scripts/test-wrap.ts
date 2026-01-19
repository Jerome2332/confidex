/**
 * Test wrap transaction simulation with native SOL handling
 * Run with: pnpm tsx scripts/test-wrap.ts
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
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as crypto from 'crypto';

// Constants
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Dummy USDC devnet

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');
const USER_BALANCE_SEED = Buffer.from('user_balance');

// Anchor discriminator
function computeDiscriminator(instructionName: string): Buffer {
  const hash = crypto.createHash('sha256')
    .update(`global:${instructionName}`)
    .digest();
  return Buffer.from(hash.subarray(0, 8));
}

const WRAP_TOKENS_DISCRIMINATOR = computeDiscriminator('wrap_tokens');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], CONFIDEX_PROGRAM_ID);
}

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

function deriveUserBalancePda(user: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_BALANCE_SEED, user.toBuffer(), mint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

async function main() {
  // Load keypair (using the authority since that has SOL)
  const keypairPath = process.env.HOME + '/.config/solana/id.json';
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const user = Keypair.fromSecretKey(new Uint8Array(keypairData));

  console.log('User:', user.publicKey.toString());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Get PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);
  const [userBalancePda] = deriveUserBalancePda(user.publicKey, WSOL_MINT);

  // Get user's WSOL ATA
  const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, user.publicKey);

  // Base vault (from set-vaults.ts)
  const vault = new PublicKey('2ukvmBieVqPEcCvSByxagNKePZ4dZUsBY9KfaFkHQiER');

  console.log('Exchange PDA:', exchangePda.toString());
  console.log('Pair PDA:', pairPda.toString());
  console.log('User Balance PDA:', userBalancePda.toString());
  console.log('User Token Account:', userTokenAccount.toString());
  console.log('Vault:', vault.toString());

  const amount = BigInt(1_000_000_000); // 1 SOL in lamports
  console.log('\nAmount:', amount.toString(), 'lamports (1 SOL)');

  // Build transaction with native SOL handling
  const tx = new Transaction();

  // Check if WSOL ATA exists
  const ataInfo = await connection.getAccountInfo(userTokenAccount);
  console.log('User WSOL ATA exists:', ataInfo !== null);

  if (!ataInfo) {
    console.log('Adding: Create WSOL ATA instruction');
    tx.add(
      createAssociatedTokenAccountInstruction(
        user.publicKey,
        userTokenAccount,
        user.publicKey,
        NATIVE_MINT
      )
    );
  }

  // Transfer native SOL to WSOL ATA
  console.log('Adding: SOL transfer to WSOL ATA');
  tx.add(
    SystemProgram.transfer({
      fromPubkey: user.publicKey,
      toPubkey: userTokenAccount,
      lamports: amount,
    })
  );

  // Sync native to update WSOL balance
  console.log('Adding: Sync native instruction');
  tx.add(createSyncNativeInstruction(userTokenAccount));

  // Build wrap instruction data
  const instructionData = Buffer.alloc(16);
  Buffer.from(WRAP_TOKENS_DISCRIMINATOR).copy(instructionData, 0);
  instructionData.writeBigUInt64LE(amount, 8);

  // Build wrap instruction
  console.log('Adding: Wrap tokens instruction');
  const wrapIx = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  tx.add(wrapIx);

  tx.feePayer = user.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  console.log('\nTotal instructions:', tx.instructions.length);
  console.log('Simulating transaction...');

  try {
    const simulation = await connection.simulateTransaction(tx);
    console.log('\nSimulation result:');
    console.log('  Error:', simulation.value.err);
    console.log('  Logs:');
    simulation.value.logs?.forEach(log => console.log('   ', log));

    if (!simulation.value.err) {
      console.log('\n✅ Simulation passed! Sending transaction...');
      const sig = await sendAndConfirmTransaction(connection, tx, [user]);
      console.log('✅ Transaction confirmed:', sig);
      console.log(`   https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

main().catch(console.error);
