/**
 * Wrap USDC for Buyer
 *
 * Wraps USDC into confidential balance for settlement testing.
 * Run with: pnpm tsx scripts/wrap-usdc-for-buyer.ts
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
  console.log('   Wrap USDC for Buyer (Settlement Testing)');
  console.log('============================================================\n');

  // Load buyer keypair (id.json - the main wallet)
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');
  let buyer: Keypair;

  try {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    buyer = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log(`Buyer address: ${buyer.publicKey.toString()}`);
  } catch (e) {
    console.error(`Could not read keypair from ${keypairPath}`);
    return;
  }

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check USDC token balance
  const userTokenAccount = await getAssociatedTokenAddress(USDC_MINT, buyer.publicKey);
  const tokenInfo = await connection.getTokenAccountBalance(userTokenAccount);
  const usdcBalance = Number(tokenInfo.value.amount);
  console.log(`USDC token balance: ${usdcBalance / 1e6} USDC`);

  if (usdcBalance < 200_000_000) { // 200 USDC minimum
    console.error('Need at least 200 USDC to wrap');
    return;
  }

  // Amount to wrap: 200 USDC (enough for many settlements at $145)
  const wrapAmount = BigInt(200_000_000); // 200 USDC (6 decimals)
  console.log(`\nWrapping ${Number(wrapAmount) / 1e6} USDC into confidential balance...`);

  // Get PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);
  const [userBalancePda] = deriveUserBalancePda(buyer.publicKey, USDC_MINT);

  // Get vault (c_quote_vault for USDC)
  const pairInfo = await connection.getAccountInfo(pairPda);
  if (!pairInfo) {
    console.error('Trading pair not found');
    return;
  }
  // TradingPair layout:
  // 8 (discriminator) + 32 (base_mint) + 32 (quote_mint) + 32 (c_base_mint) + 32 (c_quote_mint) + 32 (c_base_vault) = 168
  // c_quote_vault is at offset 168
  const cQuoteVaultOffset = 8 + 32 + 32 + 32 + 32 + 32; // 168
  const cQuoteVault = new PublicKey(pairInfo.data.slice(cQuoteVaultOffset, cQuoteVaultOffset + 32));
  console.log(`C-Quote vault: ${cQuoteVault.toString()}`);

  // Build transaction
  const tx = new Transaction();

  // Add compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }));

  // Build wrap instruction data
  const instructionData = Buffer.alloc(16);
  Buffer.from(WRAP_TOKENS_DISCRIMINATOR).copy(instructionData, 0);
  instructionData.writeBigUInt64LE(wrapAmount, 8);

  // Build wrap instruction
  tx.add({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: false },
      { pubkey: USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: cQuoteVault, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: buyer.publicKey, isSigner: true, isWritable: true },
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
    tx.feePayer = buyer.publicKey;

    console.log('Sending wrap transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [buyer], {
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
      console.log(`\n   New confidential USDC balance: ${Number(balance) / 1e6} USDC`);
    }

  } catch (e) {
    console.error('Wrap failed:', e);
  }
}

main().catch(console.error);
