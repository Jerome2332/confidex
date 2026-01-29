/**
 * Test MPC Compare Prices
 *
 * Directly queues a compare_prices computation to Arcium cluster 456
 * to test end-to-end MPC execution with the newly uploaded circuits.
 *
 * Usage: cd frontend && npx tsx scripts/test-mpc-compare-prices.ts
 */

import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getMXEAccAddress, getClusterAccAddress, getMempoolAccAddress, getExecutingPoolAccAddress, getComputationAccAddress, getCompDefAccAddress, getCompDefAccOffset, getFeePoolAccAddress, getClockAccAddress, RescueCipher, x25519 } from '@arcium-hq/client';
import BN from 'bn.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');
const ARCIUM_PROGRAM_ID = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');
// MXE X25519 public key (verified from on-chain MXE account 7YyqgKvZaCCNVzgtdegpeK7SJpK9Wa6BscdDTMT5Vu7E)
const MXE_X25519_PUBKEY = '113364f169338f3fa0d1e76bf2ba71d40aff857dd5f707f1ea2abdaf52e2d06c';

function computeDiscriminator(name: string): Buffer {
  const hash = crypto.createHash('sha256').update('global:' + name).digest();
  return Buffer.from(hash.subarray(0, 8));
}

async function main() {
  console.log('='.repeat(60));
  console.log('   Test MPC Compare Prices (Circuit Accessibility Test)');
  console.log('='.repeat(60));
  console.log('');

  // Load payer
  const homedir = process.env.HOME || '';
  const keypairPath = path.join(homedir, '.config/solana/id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const payer = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Payer:', payer.publicKey.toBase58());

  // Create test values - buy price > sell price, should match
  const buyPrice = BigInt(160 * 1e6); // $160
  const sellPrice = BigInt(150 * 1e6); // $150

  // Generate encryption keys
  const privateKey = x25519.utils.randomSecretKey();
  const publicKey = x25519.getPublicKey(privateKey);
  const mxePublicKey = Buffer.from(MXE_X25519_PUBKEY, 'hex');
  const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  // Encrypt prices
  const nonce = crypto.randomBytes(16);
  const buyPriceEnc = cipher.encrypt([buyPrice], nonce)[0];
  const sellPriceEnc = cipher.encrypt([sellPrice], nonce)[0];

  console.log('');
  console.log('Test parameters:');
  console.log('  Buy price:  $160 (should win)');
  console.log('  Sell price: $150');
  console.log('  Expected:   prices_match = true');
  console.log('');

  // Derive all required accounts
  const clusterOffset = 456;
  const computationOffsetBigInt = BigInt(Date.now());
  const computationOffsetBN = new BN(computationOffsetBigInt.toString());

  const mxeAccount = getMXEAccAddress(MXE_PROGRAM_ID);
  const clusterAccount = getClusterAccAddress(clusterOffset);
  const mempoolAccount = getMempoolAccAddress(clusterOffset);
  const executingPool = getExecutingPoolAccAddress(clusterOffset);
  const computationAccount = getComputationAccAddress(clusterOffset, computationOffsetBN);
  const compDefOffset = Buffer.from(getCompDefAccOffset('compare_prices')).readUInt32LE(0);
  const compDefAccount = getCompDefAccAddress(MXE_PROGRAM_ID, compDefOffset);
  const poolAccount = getFeePoolAccAddress();
  const clockAccount = getClockAccAddress();

  // Sign PDA - seed is "ArciumSignerAccount" (not "ArciumSignerPDA")
  const SIGN_PDA_SEED = Buffer.from('ArciumSignerAccount');
  const [signPdaAccount] = PublicKey.findProgramAddressSync([SIGN_PDA_SEED], MXE_PROGRAM_ID);

  console.log('Accounts:');
  console.log('  MXE:', mxeAccount.toBase58());
  console.log('  Cluster (456):', clusterAccount.toBase58());
  console.log('  CompDef:', compDefAccount.toBase58());
  console.log('  Computation:', computationAccount.toBase58());
  console.log('');

  // Build compare_prices instruction
  // Format: discriminator (8) + computation_offset (8) + buy_price (32) + sell_price (32) + pubkey (32) + nonce (16) + buy_order Option (1) + sell_order Option (1)
  const discriminator = computeDiscriminator('compare_prices');
  const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 1 + 1); // 130 bytes
  let offset = 0;

  Buffer.from(discriminator).copy(data, offset); offset += 8;
  data.writeBigUInt64LE(computationOffsetBigInt, offset); offset += 8;
  Buffer.from(buyPriceEnc).copy(data, offset); offset += 32;
  Buffer.from(sellPriceEnc).copy(data, offset); offset += 32;
  Buffer.from(publicKey).copy(data, offset); offset += 32;
  // Nonce as u128 little-endian
  for (let i = 0; i < 16; i++) {
    data[offset + i] = nonce[i];
  }
  offset += 16;
  // Option<Pubkey> for buy_order = None (discriminator 0)
  data[offset] = 0; offset += 1;
  // Option<Pubkey> for sell_order = None (discriminator 0)
  data[offset] = 0;

  const ix = new TransactionInstruction({
    programId: MXE_PROGRAM_ID,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: signPdaAccount, isSigner: false, isWritable: true },
      { pubkey: mxeAccount, isSigner: false, isWritable: false },
      { pubkey: mempoolAccount, isSigner: false, isWritable: true },
      { pubkey: executingPool, isSigner: false, isWritable: true },
      { pubkey: computationAccount, isSigner: false, isWritable: true },
      { pubkey: compDefAccount, isSigner: false, isWritable: false },
      { pubkey: clusterAccount, isSigner: false, isWritable: true },
      { pubkey: poolAccount, isSigner: false, isWritable: true },
      { pubkey: clockAccount, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });

  // Send transaction
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ix
  );

  console.log('Sending compare_prices transaction...');
  try {
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
    console.log('');
    console.log('✅ compare_prices queued successfully!');
    console.log('   Signature:', sig);
    console.log('   Explorer: https://explorer.solana.com/tx/' + sig + '?cluster=devnet');
    console.log('');
    console.log('Now wait ~30-60s for MPC to execute...');
    console.log('');
    console.log('To monitor:');
    console.log('  arcium mempool 456 -u devnet');
    console.log('  arcium execpool 456 -u devnet');
    console.log('');
    console.log('Expected: Callback fires with PriceCompareResult event (prices_match=true)');
  } catch (err: any) {
    console.error('');
    console.error('❌ Transaction failed:', err.message);
    if (err.logs) {
      console.error('');
      console.error('Logs:');
      err.logs.forEach((log: string) => console.error('  ', log));
    }
    process.exit(1);
  }
}

main().catch(console.error);
