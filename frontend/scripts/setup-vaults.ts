/**
 * Setup vault token accounts for the SOL/USDC trading pair
 * Run with: npx ts-node scripts/setup-vaults.ts
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
import * as crypto from 'crypto';

// Constants
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Dummy USDC devnet

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');

// Anchor discriminator for set_pair_vaults
function computeDiscriminator(instructionName: string): Buffer {
  const hash = crypto.createHash('sha256')
    .update(`global:${instructionName}`)
    .digest();
  return Buffer.from(hash.subarray(0, 8));
}

const SET_PAIR_VAULTS_DISCRIMINATOR = computeDiscriminator('set_pair_vaults');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], CONFIDEX_PROGRAM_ID);
}

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

async function main() {
  // Load keypair
  const keypairPath = process.env.HOME + '/.config/solana/devnet.json';
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(new Uint8Array(keypairData));

  console.log('Payer:', payer.publicKey.toString());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Get PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda, pairBump] = derivePairPda(WSOL_MINT, USDC_MINT);

  console.log('Exchange PDA:', exchangePda.toString());
  console.log('Pair PDA:', pairPda.toString());

  // Create new keypairs for vault accounts
  const baseVault = Keypair.generate();
  const quoteVault = Keypair.generate();

  console.log('Base Vault (WSOL):', baseVault.publicKey.toString());
  console.log('Quote Vault (USDC):', quoteVault.publicKey.toString());

  // Get minimum rent for token accounts
  const rentExempt = await getMinimumBalanceForRentExemptAccount(connection);
  console.log('Rent exempt per account:', rentExempt / 1e9, 'SOL');

  // Build transaction to create and initialize vault accounts
  // The vaults need to be owned by the Pair PDA (so the program can sign transfers)
  const tx = new Transaction();

  // Create base vault (WSOL) account
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: baseVault.publicKey,
      lamports: rentExempt,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      baseVault.publicKey,
      WSOL_MINT,
      pairPda, // Owner is the Pair PDA
      TOKEN_PROGRAM_ID
    )
  );

  // Create quote vault (USDC) account
  tx.add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: quoteVault.publicKey,
      lamports: rentExempt,
      space: ACCOUNT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      quoteVault.publicKey,
      USDC_MINT,
      pairPda, // Owner is the Pair PDA
      TOKEN_PROGRAM_ID
    )
  );

  console.log('\nCreating vault token accounts...');

  try {
    const sig1 = await sendAndConfirmTransaction(connection, tx, [payer, baseVault, quoteVault]);
    console.log('Vault accounts created:', sig1);
  } catch (err) {
    console.error('Error creating vault accounts:', err);
    process.exit(1);
  }

  // Now call set_pair_vaults to update the pair with the vault addresses
  console.log('\nCalling set_pair_vaults...');

  // Build set_pair_vaults instruction
  // Accounts: exchange, pair (mut), base_vault, quote_vault, authority (signer)
  const setPairVaultsIx = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: baseVault.publicKey, isSigner: false, isWritable: false },
      { pubkey: quoteVault.publicKey, isSigner: false, isWritable: false },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: SET_PAIR_VAULTS_DISCRIMINATOR,
  });

  const tx2 = new Transaction().add(setPairVaultsIx);

  try {
    const sig2 = await sendAndConfirmTransaction(connection, tx2, [payer]);
    console.log('set_pair_vaults called:', sig2);
  } catch (err) {
    console.error('Error calling set_pair_vaults:', err);
    process.exit(1);
  }

  console.log('\n✅ Vault setup complete!');
  console.log('Base Vault (WSOL):', baseVault.publicKey.toString());
  console.log('Quote Vault (USDC):', quoteVault.publicKey.toString());

  // Verify by fetching pair data
  console.log('\nVerifying pair data...');
  const pairAccount = await connection.getAccountInfo(pairPda);
  if (pairAccount) {
    // Skip 8-byte discriminator, read vault addresses at offsets
    // Offset for c_base_vault: 8 + 32*4 = 136
    // Offset for c_quote_vault: 136 + 32 = 168
    const baseVaultFromChain = new PublicKey(pairAccount.data.subarray(136, 168));
    const quoteVaultFromChain = new PublicKey(pairAccount.data.subarray(168, 200));
    console.log('On-chain base vault:', baseVaultFromChain.toString());
    console.log('On-chain quote vault:', quoteVaultFromChain.toString());
  }
}

main().catch(console.error);
