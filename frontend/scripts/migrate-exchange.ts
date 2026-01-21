/**
 * Script to migrate the Exchange account from V4 (158 bytes) to V5 (262 bytes)
 * Run: cd frontend && npx tsx scripts/migrate-exchange.ts
 */

import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Keypair,
} from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const RPC_URL = process.env.HELIUS_RPC_URL || 'https://api.devnet.solana.com';

// Anchor discriminator for migrate_exchange instruction
// sha256("global:migrate_exchange")[0..8]
const MIGRATE_EXCHANGE_DISCRIMINATOR = Buffer.from([
  0x9e, 0x9e, 0x45, 0x90, 0x0d, 0xe7, 0x26, 0xd7  // This is a placeholder - need to compute actual hash
]);

async function main() {
  console.log('='.repeat(60));
  console.log('  Exchange Account Migration (V4 → V5)');
  console.log('='.repeat(60));

  // Load the authority keypair (id.json - the original exchange initializer)
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

  // Check current exchange account size
  const exchangeAccount = await connection.getAccountInfo(exchangePda);
  if (!exchangeAccount) {
    console.error('Exchange account not found!');
    process.exit(1);
  }
  console.log(`Current size: ${exchangeAccount.data.length} bytes`);

  if (exchangeAccount.data.length === 254) {
    console.log('Exchange already migrated to V5 (254 bytes). No action needed.');

    // Read the program IDs to verify
    const arciumProgramId = new PublicKey(exchangeAccount.data.slice(158, 190));
    const mxeProgramId = new PublicKey(exchangeAccount.data.slice(190, 222));
    const verifierProgramId = new PublicKey(exchangeAccount.data.slice(222, 254));

    console.log('\nV5 fields:');
    console.log(`  arcium_program_id: ${arciumProgramId.toBase58()}`);
    console.log(`  mxe_program_id: ${mxeProgramId.toBase58()}`);
    console.log(`  verifier_program_id: ${verifierProgramId.toBase58()}`);

    process.exit(0);
  }

  if (exchangeAccount.data.length !== 158) {
    console.error(`Unexpected account size: ${exchangeAccount.data.length}. Expected 158 (V4).`);
    process.exit(1);
  }

  // Verify authority matches
  const storedAuthority = new PublicKey(exchangeAccount.data.slice(8, 40));
  console.log(`Stored authority: ${storedAuthority.toBase58()}`);

  if (!storedAuthority.equals(authority.publicKey)) {
    console.error('Authority mismatch! Your wallet is not the exchange authority.');
    console.error(`Expected: ${storedAuthority.toBase58()}`);
    console.error(`Got: ${authority.publicKey.toBase58()}`);
    process.exit(1);
  }

  // Compute the instruction discriminator
  // Anchor uses sha256("global:<instruction_name>")[0..8]
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha256')
    .update(Buffer.from('global:migrate_exchange'))
    .digest();
  const discriminator = hash.slice(0, 8);
  console.log(`Discriminator: ${discriminator.toString('hex')}`);

  // Build the migrate_exchange instruction
  const instruction = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: discriminator,
  });

  // Build and send the transaction
  console.log('\nSending migration transaction...');
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

  // Verify the migration
  const updatedAccount = await connection.getAccountInfo(exchangePda);
  if (!updatedAccount) {
    console.error('Failed to fetch updated account!');
    process.exit(1);
  }

  console.log(`\nNew size: ${updatedAccount.data.length} bytes`);

  // V5 size is 254 bytes (8 discriminator + 246 data)
  if (updatedAccount.data.length === 254) {
    console.log('✓ Migration successful! Exchange account is now V5 format (254 bytes).');

    // Read the new program IDs
    const arciumProgramId = new PublicKey(updatedAccount.data.slice(158, 190));
    const mxeProgramId = new PublicKey(updatedAccount.data.slice(190, 222));
    const verifierProgramId = new PublicKey(updatedAccount.data.slice(222, 254));

    console.log('\nNew V5 fields:');
    console.log(`  arcium_program_id: ${arciumProgramId.toBase58()}`);
    console.log(`  mxe_program_id: ${mxeProgramId.toBase58()}`);
    console.log(`  verifier_program_id: ${verifierProgramId.toBase58()}`);
  } else {
    console.error(`Migration failed! Account size is ${updatedAccount.data.length} bytes (expected 254).`);
    process.exit(1);
  }
}

main().catch(console.error);
