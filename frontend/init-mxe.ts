/**
 * ⚠️ DEPRECATED: Use `arcium deploy` CLI instead of this script
 *
 * Per Arcium team guidance (Jan 20, 2026):
 * "Please use `arcium deploy` to do so - you should ideally never call it yourself."
 *
 * RECOMMENDED APPROACH:
 * arcium deploy --cluster-offset 456 --keypair-path ./keys/deployer.json --rpc-url https://api.devnet.solana.com
 *
 * This script is kept for reference and status checking only.
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

// Configuration
const ARCIUM_MXE_PROGRAM_ID = new PublicKey('CB7P5zmhJHXzGQqU9544VWdJvficPwtJJJ3GXdqAMrPE');
const RPC_URL = 'https://api.devnet.solana.com';

// Arcium devnet cluster configuration
// NOTE: Cluster 123 does NOT exist on devnet (Jan 2026)
// Valid clusters: 456, 789 (both run v0.5.1)
// Recovery set size on cluster 456: 4 nodes
// Reference: https://docs.arcium.com/developers/deployment
const CLUSTER_OFFSET = 456;

// PDA seeds (matching initialize.rs)
const MXE_CONFIG_SEED = Buffer.from('mxe_config');
const MXE_AUTHORITY_SEED = Buffer.from('mxe_authority');

function deriveMxeConfigPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MXE_CONFIG_SEED], ARCIUM_MXE_PROGRAM_ID);
}

function deriveMxeAuthorityPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([MXE_AUTHORITY_SEED], ARCIUM_MXE_PROGRAM_ID);
}

// Generate a deterministic cluster ID for devnet testing
// In production, this would come from the Arcium registry
function getDevnetClusterId(): PublicKey {
  const seed = Buffer.from(`arcium-devnet-cluster-${CLUSTER_OFFSET}`);
  const hash = crypto.createHash('sha256').update(seed).digest();
  return new PublicKey(hash);
}

async function main() {
  // Load keypair
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'devnet.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Authority:', authority.publicKey.toString());

  const connection = new Connection(RPC_URL, 'confirmed');

  // Check if already initialized
  const [configPda, configBump] = deriveMxeConfigPda();
  const [authorityPda, authorityBump] = deriveMxeAuthorityPda();

  console.log('MXE Config PDA:', configPda.toString());
  console.log('MXE Authority PDA:', authorityPda.toString());

  const existingConfig = await connection.getAccountInfo(configPda);
  if (existingConfig) {
    console.log('\nMXE Config already exists!');
    console.log('Account data length:', existingConfig.data.length, 'bytes');
    console.log('Owner:', existingConfig.owner.toString());

    // Parse existing config
    const data = existingConfig.data;
    let offset = 8; // skip discriminator

    const configAuthority = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const clusterId = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const clusterOffset = data.readUInt16LE(offset);
    offset += 2;

    const arciumProgram = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const computationCount = data.readBigUInt64LE(offset);
    offset += 8;

    const completedCount = data.readBigUInt64LE(offset);

    console.log('\n=== Existing MXE Config ===');
    console.log('Authority:', configAuthority.toString());
    console.log('Cluster ID:', clusterId.toString());
    console.log('Cluster Offset:', clusterOffset);
    console.log('Arcium Program:', arciumProgram.toString());
    console.log('Computation Count:', computationCount.toString());
    console.log('Completed Count:', completedCount.toString());

    return;
  }

  // Get cluster ID
  const clusterId = getDevnetClusterId();
  console.log('\nCluster ID (devnet):', clusterId.toString());
  console.log('Cluster Offset:', CLUSTER_OFFSET);

  // Build initialize instruction
  // Discriminator: sha256("global:initialize")[0..8]
  const discriminator = crypto.createHash('sha256')
    .update('global:initialize')
    .digest()
    .subarray(0, 8);

  // Instruction data: discriminator + cluster_id (32) + cluster_offset (2)
  const instructionData = Buffer.alloc(8 + 32 + 2);
  discriminator.copy(instructionData, 0);
  clusterId.toBuffer().copy(instructionData, 8);
  instructionData.writeUInt16LE(CLUSTER_OFFSET, 40);

  const initializeIx = new TransactionInstruction({
    keys: [
      { pubkey: configPda, isSigner: false, isWritable: true },
      { pubkey: authorityPda, isSigner: false, isWritable: false },
      { pubkey: authority.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: ARCIUM_MXE_PROGRAM_ID,
    data: instructionData,
  });

  const tx = new Transaction().add(initializeIx);

  console.log('\nSending transaction to initialize MXE...');

  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [authority]);
    console.log('Transaction confirmed:', sig);
    console.log(`https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  } catch (error) {
    console.error('Failed to initialize MXE:', error);
    throw error;
  }

  console.log('\n=== MXE Initialization Complete ===');
  console.log('Config PDA:', configPda.toString());
  console.log('Authority PDA:', authorityPda.toString());
  console.log('Cluster ID:', clusterId.toString());
  console.log('Cluster Offset:', CLUSTER_OFFSET);
}

main().catch(console.error);
