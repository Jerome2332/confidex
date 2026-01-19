/**
 * Initialize trading pair vaults on devnet
 *
 * Creates token accounts for the base (WSOL) and quote (USDC) tokens
 * owned by the pair PDA authority, then updates the trading pair.
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
  createInitializeAccountInstruction,
  getMinimumBalanceForRentExemptAccount,
  ACCOUNT_SIZE,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

// Configuration
const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const RPC_URL = 'https://api.devnet.solana.com';

// Token mints
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], PROGRAM_ID);
}

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    PROGRAM_ID
  );
}

async function main() {
  // Load keypair - use id.json which is the exchange authority
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Authority:', authority.publicKey.toString());

  const connection = new Connection(RPC_URL, 'confirmed');

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);

  console.log('Exchange PDA:', exchangePda.toString());
  console.log('Pair PDA:', pairPda.toString());

  // Create vault keypairs (these will be regular token accounts)
  const baseVault = Keypair.generate();
  const quoteVault = Keypair.generate();

  console.log('Base Vault (WSOL):', baseVault.publicKey.toString());
  console.log('Quote Vault (USDC):', quoteVault.publicKey.toString());

  // Get rent exemption
  const rentExemption = await getMinimumBalanceForRentExemptAccount(connection);
  console.log('Rent exemption per account:', rentExemption);

  // Build transaction to create vault accounts
  const tx = new Transaction();

  // Create base vault (WSOL)
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: baseVault.publicKey,
      lamports: rentExemption,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      baseVault.publicKey,
      WSOL_MINT,
      pairPda, // Owner is the pair PDA (so it can transfer out)
      TOKEN_PROGRAM_ID
    )
  );

  // Create quote vault (USDC)
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: quoteVault.publicKey,
      lamports: rentExemption,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      quoteVault.publicKey,
      USDC_MINT,
      pairPda, // Owner is the pair PDA
      TOKEN_PROGRAM_ID
    )
  );

  console.log('\nSending transaction to create vaults...');

  try {
    const sig = await sendAndConfirmTransaction(
      connection,
      tx,
      [authority, baseVault, quoteVault]
    );
    console.log('Transaction confirmed:', sig);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  } catch (error) {
    console.error('Failed to create vaults:', error);
    throw error;
  }

  // Now update the trading pair with the vault addresses
  console.log('\n=== Vault Addresses ===');
  console.log('Base Vault (WSOL):', baseVault.publicKey.toString());
  console.log('Quote Vault (USDC):', quoteVault.publicKey.toString());

  // Build set_pair_vaults instruction
  // Discriminator: sha256("global:set_pair_vaults")[0..8]
  const discriminator = crypto.createHash('sha256')
    .update('global:set_pair_vaults')
    .digest()
    .subarray(0, 8);

  const setPairVaultsIx = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: baseVault.publicKey, isSigner: false, isWritable: false },
      { pubkey: quoteVault.publicKey, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: discriminator,
  });

  const tx2 = new Transaction().add(setPairVaultsIx);

  console.log('\nSending transaction to update pair vaults...');

  try {
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [authority]);
    console.log('Transaction confirmed:', sig2);
    console.log(`https://explorer.solana.com/tx/${sig2}?cluster=devnet`);
  } catch (error) {
    console.error('Failed to update pair vaults:', error);
    throw error;
  }

  console.log('\n=== Setup Complete ===');
  console.log('Vaults have been created and linked to the trading pair.');
}

main().catch(console.error);
