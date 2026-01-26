/**
 * ⚠️ DEPRECATED: Use `arcium deploy` CLI instead of this script
 *
 * Per Arcium team guidance (Arihant Bansal, Jan 20, 2026):
 * "Why are you calling initMxe yourself? Please use `arcium deploy` to do so
 *  - you should ideally never call it yourself."
 *
 * RECOMMENDED APPROACH:
 * ```bash
 * arcium deploy --cluster-offset 456 --keypair-path ./keys/deployer.json --rpc-url https://api.devnet.solana.com
 * ```
 *
 * This script is kept for:
 * 1. Checking MXE status (does NOT call initMxe if already initialized)
 * 2. Reference/debugging purposes
 * 3. Fetching the x25519 public key after `arcium deploy` completes
 *
 * Recovery set size on devnet cluster 456: 4 nodes
 * Reference: https://docs.arcium.com/developers/deployment
 *
 * Usage (status check only):
 *   CLUSTER_OFFSET=456 npx tsx scripts/init-arcium-mxe.ts
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import * as fs from 'fs';
import * as path from 'path';

// Import Arcium SDK functions
import {
  initMxePart1,
  initMxePart2,
  getMXEAccAddress,
  getMXEPublicKey,
  awaitComputationFinalization,
  getClusterAccAddress,
  ARCIUM_ADDR,
} from '@arcium-hq/client';

// Configuration
const MXE_PROGRAM_ID = new PublicKey(
  process.env.MXE_PROGRAM_ID || '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi'
);
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
// Cluster 123: v0.5.4 (available)
// Cluster 456: v0.6.3 (recommended)
// Recovery set size: 4 nodes (required for devnet)
// Reference: https://docs.arcium.com/developers/deployment
const CLUSTER_OFFSET = parseInt(process.env.CLUSTER_OFFSET || '456', 10);

// Keypair path
const KEYPAIR_PATH =
  process.env.KEYPAIR_PATH ||
  path.join(process.env.HOME || '~', '.config', 'solana', 'devnet.json');

async function loadKeypair(): Promise<Keypair> {
  const keypairData = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(keypairData));
}

async function checkExistingMxeAccount(
  provider: AnchorProvider
): Promise<{ exists: boolean; hasKeys: boolean; x25519Key: Uint8Array | null }> {
  const mxeAccAddress = getMXEAccAddress(MXE_PROGRAM_ID);
  console.log('\n=== Checking Existing MXE Account ===');
  console.log('MXE Account PDA:', mxeAccAddress.toBase58());

  try {
    const accountInfo = await provider.connection.getAccountInfo(mxeAccAddress);

    if (!accountInfo) {
      console.log('Status: Account does not exist (needs initialization)');
      return { exists: false, hasKeys: false, x25519Key: null };
    }

    console.log('Status: Account exists');
    console.log('Owner:', accountInfo.owner.toBase58());
    console.log('Size:', accountInfo.data.length, 'bytes');

    // Try to fetch the x25519 public key
    const x25519Key = await getMXEPublicKey(provider, MXE_PROGRAM_ID);

    if (x25519Key && !x25519Key.every((b) => b === 0)) {
      console.log('x25519 Key: SET');
      console.log(
        '  Value:',
        Buffer.from(x25519Key).toString('hex').slice(0, 32) + '...'
      );
      return { exists: true, hasKeys: true, x25519Key };
    } else {
      console.log('x25519 Key: NOT SET (keygen pending)');
      return { exists: true, hasKeys: false, x25519Key: null };
    }
  } catch (error) {
    console.log('Status: Error checking account -', (error as Error).message);
    return { exists: false, hasKeys: false, x25519Key: null };
  }
}

async function checkClusterExists(provider: AnchorProvider): Promise<boolean> {
  const clusterAddress = getClusterAccAddress(CLUSTER_OFFSET);
  console.log('\n=== Checking Cluster ===');
  console.log('Cluster Offset:', CLUSTER_OFFSET);
  console.log('Cluster PDA:', clusterAddress.toBase58());

  const accountInfo = await provider.connection.getAccountInfo(clusterAddress);

  if (!accountInfo) {
    console.log('Status: Cluster does NOT exist');
    console.log(
      'Note: You may need to use a different cluster offset (try 456 or 789)'
    );
    return false;
  }

  console.log('Status: Cluster exists');
  console.log('Size:', accountInfo.data.length, 'bytes');
  return true;
}

async function initializeMxe(provider: AnchorProvider): Promise<void> {
  console.log('\n=== Initializing MXE Part 1 ===');
  console.log('This creates the mxeAccount PDA under the Arcium program...');

  try {
    const sig1 = await initMxePart1(provider, MXE_PROGRAM_ID);
    console.log('Part 1 TX:', sig1);
    console.log(`Explorer: https://explorer.solana.com/tx/${sig1}?cluster=devnet`);

    // Wait for confirmation
    await provider.connection.confirmTransaction(sig1, 'confirmed');
    console.log('Part 1 confirmed!');
  } catch (error) {
    const errorMsg = (error as Error).message;
    if (errorMsg.includes('already in use') || errorMsg.includes('0x0')) {
      console.log('Part 1 already completed (account exists)');
    } else {
      throw error;
    }
  }

  console.log('\n=== Initializing MXE Part 2 ===');
  console.log('⚠️  WARNING: Use `arcium deploy` CLI instead of manual initMxe calls!');
  console.log('This associates MXE with cluster and queues keygen...');

  // Recovery peers configuration
  // Per Arcium team (Jan 20, 2026): Recovery set on devnet cluster 456 is size 4
  // Reference: https://docs.arcium.com/developers/deployment
  //
  // IMPORTANT: The recovery set size MUST match the cluster configuration
  // Cluster 456: 4 nodes
  const CLUSTER_456_RECOVERY_SIZE = 4;
  const recoverySize = parseInt(process.env.RECOVERY_SET_SIZE || String(CLUSTER_456_RECOVERY_SIZE), 10);

  console.log('Recovery set size:', recoverySize, '(cluster 456 default: 4)');

  // Create recovery peers array with sequential node IDs
  const recoveryPeers: number[] = Array.from({ length: recoverySize }, (_, i) => i);

  console.log('Recovery peers:', recoveryPeers);

  // Computation offsets - these should be unique for this MXE
  // Using timestamp-based offsets to ensure uniqueness
  // Note: Arcium SDK expects BN (from bn.js), not native BigInt
  const BN = require('bn.js');
  const timestamp = Date.now();
  const keygenOffset = new BN(timestamp);
  const keyRecoveryInitOffset = new BN(timestamp + 1);

  console.log('Keygen Offset:', keygenOffset.toString());
  console.log('Key Recovery Init Offset:', keyRecoveryInitOffset.toString());

  try {
    const sig2 = await initMxePart2(
      provider,
      CLUSTER_OFFSET,
      MXE_PROGRAM_ID,
      recoveryPeers,
      keygenOffset,
      keyRecoveryInitOffset,
      provider.publicKey // MXE authority
    );
    console.log('Part 2 TX:', sig2);
    console.log(`Explorer: https://explorer.solana.com/tx/${sig2}?cluster=devnet`);

    // Wait for confirmation
    await provider.connection.confirmTransaction(sig2, 'confirmed');
    console.log('Part 2 confirmed!');
  } catch (error) {
    const errorMsg = (error as Error).message;
    if (errorMsg.includes('already') || errorMsg.includes('0x0')) {
      console.log('Part 2 may already be completed');
    } else {
      console.error('Part 2 failed:', errorMsg);
      throw error;
    }
  }
}

async function waitForKeygen(provider: AnchorProvider): Promise<Uint8Array | null> {
  console.log('\n=== Waiting for Keygen Completion ===');
  console.log('This may take a few minutes as Arcium nodes perform MPC keygen...');
  console.log('(Press Ctrl+C to skip waiting - you can check later)');

  const maxWaitTime = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 10 * 1000; // 10 seconds
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitTime) {
    try {
      const x25519Key = await getMXEPublicKey(provider, MXE_PROGRAM_ID);

      if (x25519Key && !x25519Key.every((b) => b === 0)) {
        console.log('\n✓ Keygen complete!');
        console.log('x25519 Public Key:', Buffer.from(x25519Key).toString('hex'));
        return x25519Key;
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      process.stdout.write(`\rWaiting... ${elapsed}s elapsed`);
    } catch {
      // Ignore errors during polling
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  console.log('\n⚠ Keygen not complete within timeout');
  console.log('The MPC keygen is queued but may take longer.');
  console.log('Run this script again later to check status.');
  return null;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║         Arcium MXE Status Check for Confidex               ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('⚠️  RECOMMENDED: Use `arcium deploy` CLI instead of this script');
  console.log('   arcium deploy --cluster-offset 456 --keypair-path <path> --rpc-url <url>');
  console.log('');
  console.log('   This script is for STATUS CHECKING and key retrieval only.');
  console.log('   Reference: https://docs.arcium.com/developers/deployment');
  console.log('');

  console.log('\n=== Configuration ===');
  console.log('MXE Program ID:', MXE_PROGRAM_ID.toBase58());
  console.log('Arcium Program:', ARCIUM_ADDR);
  console.log('RPC URL:', RPC_URL);
  console.log('Cluster Offset:', CLUSTER_OFFSET);
  console.log('Keypair Path:', KEYPAIR_PATH);

  // Load keypair and create provider
  const keypair = await loadKeypair();
  console.log('Authority:', keypair.publicKey.toBase58());

  const connection = new Connection(RPC_URL, 'confirmed');
  const wallet = new Wallet(keypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  // Check balance
  const balance = await connection.getBalance(keypair.publicKey);
  console.log('Balance:', (balance / 1e9).toFixed(4), 'SOL');

  if (balance < 0.1 * 1e9) {
    console.error('\n⚠ Warning: Low balance. You may need more SOL for transactions.');
  }

  // Check if cluster exists
  const clusterExists = await checkClusterExists(provider);
  if (!clusterExists) {
    console.error('\n❌ Cannot proceed: Cluster does not exist on devnet.');
    console.log('Try a different cluster offset: CLUSTER_OFFSET=456 npx tsx scripts/init-arcium-mxe.ts');
    process.exit(1);
  }

  // Check existing MXE account status
  const { exists, hasKeys, x25519Key } = await checkExistingMxeAccount(provider);

  if (hasKeys && x25519Key) {
    console.log('\n✓ MXE is fully initialized with x25519 key!');
    console.log('\nTo use this key, add to frontend/.env.local:');
    console.log(`NEXT_PUBLIC_MXE_X25519_PUBKEY=${Buffer.from(x25519Key).toString('hex')}`);
    return;
  }

  if (!exists) {
    // Need to run full initialization
    await initializeMxe(provider);
  } else {
    console.log('\nMXE account exists but keygen not complete.');
    console.log('Keygen may still be in progress...');
  }

  // Wait for keygen to complete
  const finalKey = await waitForKeygen(provider);

  if (finalKey) {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('✓ SUCCESS: MXE initialized with x25519 public key!');
    console.log('════════════════════════════════════════════════════════════');
    console.log('\nAdd this to frontend/.env.local:');
    console.log(`NEXT_PUBLIC_MXE_X25519_PUBKEY=${Buffer.from(finalKey).toString('hex')}`);
    console.log('\nThen restart the frontend for production encryption.');
  } else {
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('⚠ MXE initialization started but keygen pending');
    console.log('════════════════════════════════════════════════════════════');
    console.log('\nRun this script again later to check if keygen completed:');
    console.log('  npx tsx scripts/init-arcium-mxe.ts');
  }
}

main().catch((error) => {
  console.error('\n❌ Error:', error.message);
  if (error.logs) {
    console.error('Logs:', error.logs);
  }
  process.exit(1);
});
