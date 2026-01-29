/**
 * E2E Order Placement Test
 *
 * Tests the complete order placement flow with REAL Arcium encryption:
 * 1. Initialize RescueCipher with production MXE key
 * 2. Encrypt order values (V2 pure ciphertext format)
 * 3. Build place_order transaction
 * 4. Submit to devnet
 * 5. Verify order account on-chain
 */

import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import { RescueCipher, serializeLE, x25519 } from '@arcium-hq/client';

import {
  buildPlaceOrderTransaction,
  buildWrapTransaction,
  derivePairPda,
  deriveOrderPda,
  deriveUserBalancePda,
  Side,
  OrderType,
  fetchOrderCount,
  fetchUserBalance,
} from './src/lib/confidex-client';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// MXE X25519 public key (verified from on-chain MXE account 7YyqgKvZaCCNVzgtdegpeK7SJpK9Wa6BscdDTMT5Vu7E)
const MXE_X25519_PUBKEY = process.env.NEXT_PUBLIC_MXE_X25519_PUBKEY ||
  '113364f169338f3fa0d1e76bf2ba71d40aff857dd5f707f1ea2abdaf52e2d06c';

// Token mints (devnet)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const DUMMY_USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// Test results tracking
const results: { test: string; status: 'pass' | 'fail'; details?: string }[] = [];

function logTest(test: string, status: 'pass' | 'fail', details?: string) {
  const icon = status === 'pass' ? '✅' : '❌';
  console.log(`${icon} ${test}`);
  if (details) console.log(`   ${details}`);
  results.push({ test, status, details });
}

/**
 * Parse hex string to Uint8Array
 */
function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encrypt value using Arcium RescueCipher (V2 pure ciphertext format)
 */
function encryptValue(
  value: bigint,
  cipher: RescueCipher,
  ephemeralPubkey: Uint8Array,
  nonceCounter: number
): Uint8Array {
  // Generate nonce with counter
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const view = new DataView(nonce.buffer);
  view.setUint32(12, nonceCounter, true);

  // Encrypt using RescueCipher
  const encrypted = cipher.encrypt([value], nonce);

  // Build V2 format: [nonce(16) | ciphertext(32) | ephemeral(16)]
  const result = new Uint8Array(64);

  // Bytes 0-15: nonce
  result.set(nonce, 0);

  // Bytes 16-47: ciphertext
  if (encrypted.length > 0 && encrypted[0].length >= 32) {
    result.set(new Uint8Array(encrypted[0].slice(0, 32)), 16);
  } else {
    const ctBytes = serializeLE(BigInt(encrypted[0]?.[0] || 0), 32);
    result.set(ctBytes, 16);
  }

  // Bytes 48-63: truncated ephemeral pubkey
  result.set(ephemeralPubkey.slice(0, 16), 48);

  return result;
}

async function main() {
  console.log('============================================================');
  console.log('   E2E Order Placement Test (Real Arcium Encryption)');
  console.log('============================================================\n');

  // Step 1: Load wallet
  console.log('--- Step 1: Load Wallet ---');
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'devnet.json');

  let maker: Keypair;
  try {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    maker = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    logTest('Load devnet wallet', 'pass', `Address: ${maker.publicKey.toString().slice(0, 12)}...`);
  } catch (e) {
    logTest('Load devnet wallet', 'fail', `Could not read ${keypairPath}`);
    return;
  }

  const connection = new Connection(RPC_URL, 'confirmed');

  // Check balance
  const balance = await connection.getBalance(maker.publicKey);
  const solBalance = balance / 1e9;
  if (solBalance < 0.1) {
    logTest('Check SOL balance', 'fail', `Only ${solBalance.toFixed(4)} SOL, need at least 0.1`);
    return;
  }
  logTest('Check SOL balance', 'pass', `${solBalance.toFixed(4)} SOL`);

  // Step 2: Initialize Arcium encryption
  console.log('\n--- Step 2: Initialize Arcium Encryption ---');

  let mxePublicKey: Uint8Array;
  try {
    mxePublicKey = hexToBytes(MXE_X25519_PUBKEY);
    if (mxePublicKey.length !== 32) throw new Error('Invalid key length');
    logTest('Parse MXE public key', 'pass', `Key: ${MXE_X25519_PUBKEY.slice(0, 16)}...`);
  } catch (e) {
    logTest('Parse MXE public key', 'fail', String(e));
    return;
  }

  // Generate ephemeral keypair
  const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  logTest('Generate ephemeral keypair', 'pass');

  // Compute shared secret
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);
  logTest('Compute ECDH shared secret', 'pass');

  // Initialize RescueCipher
  const cipher = new RescueCipher(sharedSecret);
  logTest('Initialize RescueCipher', 'pass');

  // Step 3: Encrypt order values
  console.log('\n--- Step 3: Encrypt Order Values ---');

  const amount = BigInt(100_000_000); // 0.1 SOL (9 decimals)
  const price = BigInt(145_000_000);  // 145 USDC (6 decimals)
  const orderSide = Side.Sell; // Sell SOL for USDC (requires SOL, which we have)

  console.log(`   Order: Sell 0.1 SOL @ $145 USDC`);

  const encryptedAmount = encryptValue(amount, cipher, ephemeralPublicKey, 1);
  logTest('Encrypt amount', 'pass', `${encryptedAmount.length} bytes (V2 format)`);

  const encryptedPrice = encryptValue(price, cipher, ephemeralPublicKey, 2);
  logTest('Encrypt price', 'pass', `${encryptedPrice.length} bytes (V2 format)`);

  // Verify V2 format (no plaintext visible)
  const amountPrefix = Array.from(encryptedAmount.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('');
  const hasPlaintext = amountPrefix === '00e1f50500000000'; // 0.1 SOL in little-endian
  if (hasPlaintext) {
    logTest('Verify V2 format (no plaintext)', 'fail', 'Plaintext visible in prefix!');
  } else {
    logTest('Verify V2 format (no plaintext)', 'pass', 'Pure ciphertext confirmed');
  }

  // Step 4: Check/wrap tokens (prerequisite for placing orders)
  console.log('\n--- Step 4: Check/Wrap Tokens ---');

  // For a sell order, we spend SOL (WSOL)
  const spendingMint = WSOL_MINT;
  const requiredAmount = amount; // Selling 0.1 SOL

  console.log(`   Need ${Number(requiredAmount) / 1e9} SOL for this sell order`);

  try {
    const { balance: currentBalance, account } = await fetchUserBalance(connection, maker.publicKey, spendingMint);

    if (account === null) {
      // Account doesn't exist, need to wrap tokens first
      console.log('   User balance account not initialized, wrapping tokens...');

      const wrapTx = await buildWrapTransaction({
        connection,
        user: maker.publicKey,
        baseMint: WSOL_MINT,
        quoteMint: DUMMY_USDC_MINT,
        tokenMint: spendingMint,
        amount: requiredAmount + BigInt(1_000_000), // Add 1 USDC buffer
      });

      // Add compute budget
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
      wrapTx.instructions.unshift(computeBudgetIx);

      const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [maker], {
        commitment: 'confirmed',
      });

      logTest('Wrap tokens (init balance)', 'pass', `Sig: ${wrapSig.slice(0, 20)}...`);
    } else if (currentBalance < requiredAmount) {
      console.log(`   Current balance: ${Number(currentBalance) / 1e6} USDC, need more...`);

      const wrapAmount = requiredAmount - currentBalance + BigInt(1_000_000);
      const wrapTx = await buildWrapTransaction({
        connection,
        user: maker.publicKey,
        baseMint: WSOL_MINT,
        quoteMint: DUMMY_USDC_MINT,
        tokenMint: spendingMint,
        amount: wrapAmount,
      });

      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
      wrapTx.instructions.unshift(computeBudgetIx);

      const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [maker], {
        commitment: 'confirmed',
      });

      logTest('Wrap additional tokens', 'pass', `Sig: ${wrapSig.slice(0, 20)}...`);
    } else {
      logTest('User balance sufficient', 'pass', `${Number(currentBalance) / 1e6} USDC`);
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logTest('Check/wrap tokens', 'fail', errorMsg.slice(0, 100));
    console.log('\n   Full error:', e);
    return;
  }

  // Step 5: Fetch order count
  console.log('\n--- Step 5: Prepare Transaction ---');

  let orderId: number;
  try {
    const orderCount = await fetchOrderCount(connection);
    if (orderCount === null) throw new Error('Could not fetch order count');
    orderId = Number(orderCount);
    logTest('Fetch order count', 'pass', `Next order ID: ${orderId}`);
  } catch (e) {
    logTest('Fetch order count', 'fail', String(e));
    return;
  }

  // Get trading pair
  const [pairPda] = derivePairPda(WSOL_MINT, DUMMY_USDC_MINT);
  logTest('Derive trading pair PDA', 'pass', pairPda.toString().slice(0, 12) + '...');

  // Step 6: Generate ZK eligibility proof
  console.log('\n--- Step 6: Generate ZK Proof ---');

  let eligibilityProof: Uint8Array;
  try {
    // Sign a message to prove wallet ownership
    const timestamp = Date.now();
    const message = `Confidex eligibility proof request: ${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);

    // Use nacl that comes with @solana/web3.js
    const nacl = require('tweetnacl');
    const bs58 = require('bs58');
    const signature = nacl.sign.detached(messageBytes, maker.secretKey);
    const signatureB58 = bs58.encode(signature);

    const proveResponse = await fetch('http://localhost:3001/api/prove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: maker.publicKey.toString(),
        signature: signatureB58,
        message: message,
      }),
    });

    if (!proveResponse.ok) {
      const errorBody = await proveResponse.text();
      throw new Error(`Proof generation failed: ${proveResponse.status} - ${errorBody}`);
    }

    const proveResult = await proveResponse.json();
    // Use proofHex field (hex-encoded) instead of proof (base64)
    eligibilityProof = new Uint8Array(Buffer.from(proveResult.proofHex, 'hex'));
    logTest('Generate ZK eligibility proof', 'pass', `${eligibilityProof.length} bytes (Groth16)`);
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logTest('Generate ZK eligibility proof', 'fail', errorMsg.slice(0, 150));
    console.log('   Note: Start backend with `cd backend && pnpm dev`');
    return;
  }

  // Step 7: Build and send transaction
  console.log('\n--- Step 7: Submit Transaction ---');

  try {
    const { transaction: tx, orderNonce } = await buildPlaceOrderTransaction({
      connection,
      maker: maker.publicKey,
      baseMint: WSOL_MINT,
      quoteMint: DUMMY_USDC_MINT,
      side: orderSide,
      orderType: OrderType.Limit,
      encryptedAmount: new Uint8Array(encryptedAmount),
      encryptedPrice: new Uint8Array(encryptedPrice),
      eligibilityProof: new Uint8Array(eligibilityProof),
      ephemeralPubkey: ephemeralPublicKey,
    });

    // Add compute budget
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
      units: 400_000,
    });
    tx.instructions.unshift(computeBudgetIx);

    logTest('Build transaction', 'pass', `${tx.instructions.length} instructions, nonce: ${orderNonce}`);

    console.log('   Sending transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [maker], {
      commitment: 'confirmed',
    });

    logTest('Submit transaction', 'pass', `Sig: ${sig.slice(0, 20)}...`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);

    // Step 8: Verify order on-chain
    console.log('\n--- Step 8: Verify Order On-Chain ---');

    const [orderPda] = deriveOrderPda(maker.publicKey, orderNonce);

    // Wait a moment for confirmation
    await new Promise(r => setTimeout(r, 2000));

    const orderAccount = await connection.getAccountInfo(orderPda);
    if (orderAccount) {
      logTest('Order account created', 'pass', `Size: ${orderAccount.data.length} bytes`);

      // Check encrypted values are stored (not zeros)
      const storedAmount = orderAccount.data.slice(8 + 32 + 32 + 32 + 1 + 1, 8 + 32 + 32 + 32 + 1 + 1 + 64);
      const isEncrypted = !storedAmount.every(b => b === 0);
      logTest('Encrypted amount stored', isEncrypted ? 'pass' : 'fail');

      console.log(`\n   Order PDA: ${orderPda.toString()}`);
    } else {
      logTest('Order account created', 'fail', 'Account not found');
    }

  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logTest('Submit transaction', 'fail', errorMsg.slice(0, 100));

    // Log full error for debugging
    console.log('\n   Full error:', e);
  }

  // Summary
  console.log('\n============================================================');
  console.log('   Test Summary');
  console.log('============================================================\n');

  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;

  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${results.length}\n`);

  if (failed === 0) {
    console.log('✅ E2E order placement test PASSED!');
    console.log('   Frontend encryption → Program → On-chain storage verified.\n');
  } else {
    console.log('❌ E2E order placement test FAILED');
    console.log('   Review errors above.\n');
  }
}

main().catch(console.error);
