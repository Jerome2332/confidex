/**
 * Call set_pair_vaults with existing vault accounts
 * Run with: pnpm tsx scripts/set-vaults.ts
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
import * as crypto from 'crypto';

// Constants
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Dummy USDC devnet

// Existing vault accounts (created in previous run)
const BASE_VAULT = new PublicKey('2ukvmBieVqPEcCvSByxagNKePZ4dZUsBY9KfaFkHQiER');
const QUOTE_VAULT = new PublicKey('8wVuW5SWtPv4kuCppo2UxniriXHMaRKhiQ3aEFSoo1nJ');

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
  // Load the AUTHORITY keypair (the one that initialized the exchange)
  // The exchange was initialized by 3At42GGyP1aQuTmtr1YuDBzmwfnS2br6W5cLrdWGLVbm
  const authorityPath = process.env.HOME + '/.config/solana/id.json';
  const authorityData = JSON.parse(fs.readFileSync(authorityPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(new Uint8Array(authorityData));

  console.log('Authority:', authority.publicKey.toString());

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Check authority balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Authority balance:', balance / 1e9, 'SOL');

  if (balance < 10000000) {
    console.log('⚠️ Authority needs SOL for transaction fee. Transferring from devnet wallet...');

    // Load devnet payer to fund the authority
    const payerPath = process.env.HOME + '/.config/solana/devnet.json';
    const payerData = JSON.parse(fs.readFileSync(payerPath, 'utf-8'));
    const payer = Keypair.fromSecretKey(new Uint8Array(payerData));

    const { SystemProgram } = await import('@solana/web3.js');
    const transferTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: authority.publicKey,
        lamports: 50000000, // 0.05 SOL
      })
    );

    const sig = await sendAndConfirmTransaction(connection, transferTx, [payer]);
    console.log('Funded authority:', sig);
  }

  // Get PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);

  console.log('Exchange PDA:', exchangePda.toString());
  console.log('Pair PDA:', pairPda.toString());
  console.log('Base Vault:', BASE_VAULT.toString());
  console.log('Quote Vault:', QUOTE_VAULT.toString());

  // Build set_pair_vaults instruction
  const setPairVaultsIx = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: BASE_VAULT, isSigner: false, isWritable: false },
      { pubkey: QUOTE_VAULT, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: SET_PAIR_VAULTS_DISCRIMINATOR,
  });

  const tx = new Transaction().add(setPairVaultsIx);

  console.log('\nCalling set_pair_vaults...');

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log('✅ set_pair_vaults called:', sig);
  } catch (err) {
    console.error('Error calling set_pair_vaults:', err);
    process.exit(1);
  }

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

    if (baseVaultFromChain.equals(BASE_VAULT) && quoteVaultFromChain.equals(QUOTE_VAULT)) {
      console.log('\n✅ Vaults configured correctly!');
    } else {
      console.log('\n❌ Vault mismatch!');
    }
  }
}

main().catch(console.error);
