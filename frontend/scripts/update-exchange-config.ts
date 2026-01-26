/**
 * Update ExchangeState Configuration
 *
 * Updates the MXE program ID and Arcium cluster account on the ExchangeState.
 *
 * Usage:
 *   cd frontend && npx tsx scripts/update-exchange-config.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getClusterAccAddress } from '@arcium-hq/client';
import * as fs from 'fs';
import * as os from 'os';
import { createHash } from 'crypto';

// Configuration
const PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const KEYPAIR_PATH = process.env.KEYPAIR_PATH || `${os.homedir()}/.config/solana/devnet.json`;

// Values to set
// New MXE with completed DKG (deployed 2025-01-22)
const NEW_MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');
const CLUSTER_OFFSET = 456;

// Instruction discriminator: sha256("global:update_program_ids")[0..8]
function getDiscriminator(name: string): Buffer {
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// Borsh serialize Option<Pubkey>
function serializeOptionPubkey(pubkey: PublicKey | null): Buffer {
  if (pubkey === null) {
    return Buffer.from([0]); // None
  }
  return Buffer.concat([Buffer.from([1]), pubkey.toBuffer()]); // Some(pubkey)
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Update ExchangeState Configuration');
  console.log('='.repeat(60));
  console.log();

  // Load keypair
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  console.log('Authority:', authority.publicKey.toBase58());

  const connection = new Connection(RPC_URL, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(authority.publicKey);
  console.log('Balance:', (balance / 1e9).toFixed(4), 'SOL');

  // Derive exchange PDA
  const [exchangePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    PROGRAM_ID
  );
  console.log('\nExchange PDA:', exchangePda.toBase58());

  // Get current state
  const accountInfo = await connection.getAccountInfo(exchangePda);
  if (!accountInfo) {
    console.error('ERROR: Exchange account not found');
    process.exit(1);
  }

  // Read current values
  const data = accountInfo.data;
  const currentAuthority = new PublicKey(data.slice(8, 40));
  const currentArciumCluster = new PublicKey(data.slice(109, 141));
  const currentMxeProgramId = new PublicKey(data.slice(190, 222));

  console.log('\nCurrent Configuration:');
  console.log('  Authority:', currentAuthority.toBase58());
  console.log('  Arcium Cluster:', currentArciumCluster.toBase58());
  console.log('  MXE Program ID:', currentMxeProgramId.toBase58());

  // Verify authority matches
  if (!currentAuthority.equals(authority.publicKey)) {
    console.error('\nERROR: Authority mismatch! You are not the exchange authority.');
    console.error('  Expected:', currentAuthority.toBase58());
    console.error('  Got:', authority.publicKey.toBase58());
    process.exit(1);
  }

  // Calculate new cluster account
  const newClusterAccount = getClusterAccAddress(CLUSTER_OFFSET);

  console.log('\nNew Configuration:');
  console.log('  MXE Program ID:', NEW_MXE_PROGRAM_ID.toBase58());
  console.log('  Arcium Cluster:', newClusterAccount.toBase58(), `(offset ${CLUSTER_OFFSET})`);

  // Build instruction data
  // Format: discriminator (8) + UpdateProgramIdsParams (Borsh serialized)
  // UpdateProgramIdsParams {
  //   arcium_program_id: Option<Pubkey>,   // None (keep current)
  //   mxe_program_id: Option<Pubkey>,      // Some(NEW_MXE_PROGRAM_ID)
  //   verifier_program_id: Option<Pubkey>, // None (keep current)
  //   arcium_cluster: Option<Pubkey>,      // Some(newClusterAccount)
  // }

  const discriminator = getDiscriminator('update_program_ids');

  const instructionData = Buffer.concat([
    discriminator,
    serializeOptionPubkey(null),              // arcium_program_id: None
    serializeOptionPubkey(NEW_MXE_PROGRAM_ID), // mxe_program_id: Some
    serializeOptionPubkey(null),              // verifier_program_id: None
    serializeOptionPubkey(newClusterAccount), // arcium_cluster: Some
  ]);

  console.log('\nInstruction data length:', instructionData.length, 'bytes');

  // Build instruction
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: authority.publicKey, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: instructionData,
  });

  // Build and send transaction
  console.log('\nSending transaction...');

  const transaction = new Transaction().add(instruction);
  transaction.feePayer = authority.publicKey;

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authority],
      { commitment: 'confirmed' }
    );

    console.log('\nTransaction successful!');
    console.log('Signature:', signature);

    // Verify the update
    console.log('\nVerifying update...');
    const updatedAccountInfo = await connection.getAccountInfo(exchangePda);
    if (updatedAccountInfo) {
      const updatedData = updatedAccountInfo.data;
      const updatedArciumCluster = new PublicKey(updatedData.slice(109, 141));
      const updatedMxeProgramId = new PublicKey(updatedData.slice(190, 222));

      console.log('\nUpdated Configuration:');
      console.log('  Arcium Cluster:', updatedArciumCluster.toBase58());
      console.log('  MXE Program ID:', updatedMxeProgramId.toBase58());

      if (updatedMxeProgramId.equals(NEW_MXE_PROGRAM_ID) && updatedArciumCluster.equals(newClusterAccount)) {
        console.log('\n✓ Configuration updated successfully!');
      } else {
        console.log('\n⚠ Configuration may not have been updated correctly');
      }
    }
  } catch (error) {
    console.error('\nTransaction failed:', error);
    if (error instanceof Error && 'logs' in error) {
      console.error('Logs:', (error as any).logs);
    }
    process.exit(1);
  }
}

main().catch(console.error);
