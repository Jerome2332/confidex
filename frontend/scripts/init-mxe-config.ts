/**
 * Initialize our custom MXE config account
 *
 * This creates the mxe_config PDA that our arcium_mxe program uses
 * to track computation requests.
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

// Our deployed MXE program
const MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');

// Arcium cluster 456 PDA (we'll need to derive this)
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');
const CLUSTER_OFFSET = 456;

// Initialize instruction discriminator: sha256("global:initialize")[0..8]
// Computed as: anchor.BN.sha256("global:initialize").slice(0, 8)
const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

async function main() {
  const rpcUrl = process.env.HELIUS_RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Load wallet
  const walletPath = process.env.WALLET_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
  const walletJson = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const wallet = Keypair.fromSecretKey(Uint8Array.from(walletJson));

  console.log('Wallet:', wallet.publicKey.toBase58());
  console.log('MXE Program:', MXE_PROGRAM_ID.toBase58());

  // Derive PDAs
  const [mxeConfigPda, configBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe_config')],
    MXE_PROGRAM_ID
  );

  const [mxeAuthorityPda, authorityBump] = PublicKey.findProgramAddressSync(
    [Buffer.from('mxe_authority')],
    MXE_PROGRAM_ID
  );

  // Derive cluster ID from Arcium program
  // Cluster PDA: ["Cluster", offset.to_le_bytes()] under Arcium program
  const offsetBuf = Buffer.alloc(2);
  offsetBuf.writeUInt16LE(CLUSTER_OFFSET);
  const [clusterPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('Cluster'), offsetBuf],
    ARCIUM_PROGRAM_ID
  );

  console.log('MXE Config PDA:', mxeConfigPda.toBase58());
  console.log('MXE Authority PDA:', mxeAuthorityPda.toBase58());
  console.log('Cluster PDA:', clusterPda.toBase58());

  // Check if already initialized
  const existingConfig = await connection.getAccountInfo(mxeConfigPda);
  if (existingConfig) {
    console.log('MXE Config already initialized!');
    console.log('Size:', existingConfig.data.length);
    return;
  }

  // Build instruction data
  // Format: discriminator + cluster_id(32) + cluster_offset(2)
  const data = Buffer.alloc(8 + 32 + 2);
  INITIALIZE_DISCRIMINATOR.copy(data, 0);
  clusterPda.toBuffer().copy(data, 8);
  data.writeUInt16LE(CLUSTER_OFFSET, 8 + 32);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: mxeConfigPda, isSigner: false, isWritable: true },
      { pubkey: mxeAuthorityPda, isSigner: false, isWritable: false },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: MXE_PROGRAM_ID,
    data,
  });

  const transaction = new Transaction().add(instruction);
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = wallet.publicKey;

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [wallet],
      { commitment: 'confirmed' }
    );
    console.log('MXE Config initialized successfully!');
    console.log('Signature:', signature);
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
