/**
 * Re-initialize MXE Computation Definitions
 *
 * This script attempts to re-initialize the computation definitions to trigger
 * the cluster to fetch and complete them.
 *
 * Usage: npx tsx scripts/reinit-comp-defs.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  SystemProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import {
  getMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  ARCIUM_ADDR,
} from '@arcium-hq/client';

const MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');
const ARCIUM_PROGRAM = new PublicKey(ARCIUM_ADDR);

// Compute discriminator for instruction
function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Check Computation Definition Status');
  console.log('='.repeat(60));

  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  console.log(`\nRPC: ${rpcUrl}`);

  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, 'utf-8')))
  );
  console.log(`Wallet: ${walletKeypair.publicKey.toBase58()}`);

  const circuits = [
    'compare_prices',
    'calculate_fill',
    'verify_position_params',
    'check_liquidation',
    'batch_liquidation_check',
    'calculate_pnl',
    'calculate_funding',
    'add_encrypted',
    'sub_encrypted',
    'mul_encrypted',
  ];

  console.log('\n--- Computation Definition Status ---\n');

  const mxeAccount = getMXEAccAddress(MXE_PROGRAM_ID);
  console.log(`MXE Account: ${mxeAccount.toBase58()}`);

  for (const circuit of circuits) {
    const offset = Buffer.from(getCompDefAccOffset(circuit)).readUInt32LE(0);
    const compDefAccount = getCompDefAccAddress(MXE_PROGRAM_ID, offset);
    const info = await connection.getAccountInfo(compDefAccount);

    if (info) {
      const completed = info.data[8] === 1;
      console.log(`${circuit.padEnd(25)} ${compDefAccount.toBase58().slice(0, 8)}... ${completed ? '✅ COMPLETED' : '❌ NOT COMPLETED'}`);
    } else {
      console.log(`${circuit.padEnd(25)} NOT FOUND`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`
The computation definitions were initialized on 2026-01-20 but are still not
"completed" by the Arcium cluster. This means the Arx nodes haven't fetched
and verified the circuit files from GitHub Releases.

This is a cluster-side issue. Possible solutions:

1. Contact Arcium team on Discord to investigate
   - MXE Program ID: 4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi
   - Cluster: 456

2. Check if the circuit URLs are accessible from the cluster's perspective
   - URL pattern: https://github.com/Jerome2332/confidex/releases/download/v0.1.0-circuits/{circuit}.arcis

3. Consider re-deploying the MXE to a fresh program ID

Note: The sign_pda_account cannot be initialized until at least one
computation definition is completed, because the compare_prices instruction
(which would create the sign_pda_account via init_if_needed) requires a
completed computation definition.
`);
}

main().catch(console.error);
