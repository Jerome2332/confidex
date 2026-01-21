/**
 * Wrap SOL for Seller
 *
 * Wraps native SOL into confidential balance for settlement testing.
 * Run with: pnpm tsx scripts/wrap-sol-for-seller.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Constants
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');
const USER_BALANCE_SEED = Buffer.from('user_balance');

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
  console.log('============================================================');
  console.log('   Wrap SOL for Seller (Settlement Testing)');
  console.log('============================================================\n');

  // Load seller keypair (devnet.json)
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'devnet.json');
  let seller: Keypair;

  try {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    seller = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log(`Seller address: ${seller.publicKey.toString()}`);
  } catch (e) {
    console.error(`Could not read keypair from ${keypairPath}`);
    return;
  }

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check native SOL balance
  const nativeBalance = await connection.getBalance(seller.publicKey);
  console.log(`Native SOL balance: ${(nativeBalance / 1e9).toFixed(4)} SOL`);

  if (nativeBalance < 2 * 1e9) {
    console.error('Need at least 2 SOL to wrap');
    return;
  }

  // Amount to wrap: 2 SOL (enough for many settlements at 0.1 SOL each)
  const wrapAmount = BigInt(2_000_000_000); // 2 SOL
  console.log(`\nWrapping ${Number(wrapAmount) / 1e9} SOL into confidential balance...`);

  // Get PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);
  const [userBalancePda] = deriveUserBalancePda(seller.publicKey, WSOL_MINT);

  // Get user's WSOL ATA
  const userTokenAccount = await getAssociatedTokenAddress(WSOL_MINT, seller.publicKey);

  // Get vault (c_base_vault for SOL/USDC pair)
  const pairInfo = await connection.getAccountInfo(pairPda);
  if (!pairInfo) {
    console.error('Trading pair not found');
    return;
  }
  // TradingPair layout:
  // 8 (discriminator) + 32 (base_mint) + 32 (quote_mint) + 32 (c_base_mint) + 32 (c_quote_mint) = 136
  // c_base_vault is at offset 136
  const cBaseVaultOffset = 8 + 32 + 32 + 32 + 32; // 136
  const cBaseVault = new PublicKey(pairInfo.data.slice(cBaseVaultOffset, cBaseVaultOffset + 32));
  console.log(`C-Base vault: ${cBaseVault.toString()}`);
  const baseVault = cBaseVault;

  // Build transaction
  const tx = new Transaction();

  // Add compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));

  // Check if WSOL ATA exists
  const ataInfo = await connection.getAccountInfo(userTokenAccount);
  if (!ataInfo) {
    console.log('Creating WSOL ATA...');
    tx.add(
      createAssociatedTokenAccountInstruction(
        seller.publicKey,
        userTokenAccount,
        seller.publicKey,
        NATIVE_MINT
      )
    );
  }

  // Transfer native SOL to WSOL ATA
  tx.add(
    SystemProgram.transfer({
      fromPubkey: seller.publicKey,
      toPubkey: userTokenAccount,
      lamports: wrapAmount,
    })
  );

  // Sync native to update WSOL balance
  tx.add(createSyncNativeInstruction(userTokenAccount));

  // Build wrap instruction data
  const instructionData = Buffer.alloc(16);
  Buffer.from(WRAP_TOKENS_DISCRIMINATOR).copy(instructionData, 0);
  instructionData.writeBigUInt64LE(wrapAmount, 8);

  // Build wrap instruction
  tx.add({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: false },
      { pubkey: WSOL_MINT, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: baseVault, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  // Send transaction
  try {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = seller.publicKey;

    console.log('Sending wrap transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [seller], {
      commitment: 'confirmed',
    });

    console.log(`\n✅ Wrap successful!`);
    console.log(`   Signature: ${sig}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Check new confidential balance
    const balanceInfo = await connection.getAccountInfo(userBalancePda);
    if (balanceInfo) {
      // encrypted_balance is at offset 72 (8 disc + 32 owner + 32 mint)
      const balance = balanceInfo.data.readBigUInt64LE(72);
      console.log(`\n   New confidential SOL balance: ${Number(balance) / 1e9} SOL`);
    }

  } catch (e) {
    console.error('Wrap failed:', e);
  }
}

main().catch(console.error);
