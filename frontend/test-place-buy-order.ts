/**
 * Place a Buy Order to Match Existing Sell Order
 *
 * This places a buy order at $145 to match the sell order created by test-e2e-order.ts
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
import * as os from 'os';
import { RescueCipher, serializeLE, x25519 } from '@arcium-hq/client';

import {
  buildPlaceOrderTransaction,
  buildWrapTransaction,
  derivePairPda,
  deriveOrderPda,
  Side,
  OrderType,
  fetchOrderCount,
  fetchUserBalance,
} from './src/lib/confidex-client';

// Configuration
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';

// Production MXE public key
const MXE_X25519_PUBKEY = process.env.NEXT_PUBLIC_MXE_X25519_PUBKEY ||
  '14706bf82ff9e9cebde9d7ad1cc35dc98ad11b08ac92b07ed0fe472333703960';

// Token mints (devnet)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const DUMMY_USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x/, '');
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function encryptValue(
  value: bigint,
  cipher: RescueCipher,
  ephemeralPubkey: Uint8Array,
  nonceCounter: number
): Uint8Array {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const view = new DataView(nonce.buffer);
  view.setUint32(12, nonceCounter, true);

  const encrypted = cipher.encrypt([value], nonce);
  const result = new Uint8Array(64);

  result.set(nonce, 0);
  if (encrypted.length > 0 && encrypted[0].length >= 32) {
    result.set(new Uint8Array(encrypted[0].slice(0, 32)), 16);
  } else {
    const ctBytes = serializeLE(BigInt(encrypted[0]?.[0] || 0), 32);
    result.set(ctBytes, 16);
  }
  result.set(ephemeralPubkey.slice(0, 16), 48);

  return result;
}

async function main() {
  console.log('============================================================');
  console.log('   Place Buy Order (to match existing sell order)');
  console.log('============================================================\n');

  // Load DIFFERENT wallet (id.json instead of devnet.json)
  const keypairPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const maker = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  console.log('Buyer wallet:', maker.publicKey.toString());

  const connection = new Connection(RPC_URL, 'confirmed');

  const balance = await connection.getBalance(maker.publicKey);
  console.log('SOL balance:', (balance / 1e9).toFixed(4), 'SOL\n');

  if (balance < 0.1 * 1e9) {
    console.log('❌ Insufficient SOL balance');
    return;
  }

  // Initialize encryption
  const mxePublicKey = hexToBytes(MXE_X25519_PUBKEY);
  const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);
  const cipher = new RescueCipher(sharedSecret);

  console.log('✅ Encryption initialized');

  // Buy order: 0.1 SOL @ $145 (matches the sell order)
  const amount = BigInt(100_000_000); // 0.1 SOL
  const price = BigInt(145_000_000);  // $145 USDC
  const orderSide = Side.Buy;

  console.log(`   Order: Buy 0.1 SOL @ $145 USDC\n`);

  const encryptedAmount = encryptValue(amount, cipher, ephemeralPublicKey, 1);
  const encryptedPrice = encryptValue(price, cipher, ephemeralPublicKey, 2);

  console.log('✅ Values encrypted (V2 format)');

  // For a buy order, we need USDC balance
  // First check if user has USDC token account
  const spendingMint = DUMMY_USDC_MINT;
  const requiredAmount = (price * amount) / BigInt(1_000_000_000); // ~14.5 USDC

  console.log(`   Need ${Number(requiredAmount) / 1e6} USDC for buy order`);

  // Check USDC balance
  const { balance: usdcBalance, account } = await fetchUserBalance(
    connection,
    maker.publicKey,
    spendingMint
  );

  if (account === null || usdcBalance < requiredAmount) {
    console.log('\n⚠️  Buyer needs USDC to place buy order');
    console.log('   For a complete E2E test, fund the buyer with USDC first.');
    console.log('   Alternatively, test with the buyer placing a SELL order too.\n');

    // For now, let's just place another sell order from this wallet to test matching works
    console.log('   Placing SELL order from buyer wallet to test MPC matching...\n');

    // Wrap SOL first for sell order
    const solBalance = await fetchUserBalance(connection, maker.publicKey, WSOL_MINT);

    if (solBalance.account === null) {
      console.log('   Wrapping 0.11 SOL...');
      const wrapTx = await buildWrapTransaction({
        connection,
        user: maker.publicKey,
        baseMint: WSOL_MINT,
        quoteMint: DUMMY_USDC_MINT,
        tokenMint: WSOL_MINT,
        amount: BigInt(110_000_000), // 0.11 SOL
      });

      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 });
      wrapTx.instructions.unshift(computeBudgetIx);

      const wrapSig = await sendAndConfirmTransaction(connection, wrapTx, [maker], {
        commitment: 'confirmed',
      });
      console.log('   ✅ Wrapped SOL:', wrapSig.slice(0, 20) + '...');
    }

    // Place sell order at DIFFERENT price to test no-match scenario
    const sellPrice = BigInt(150_000_000); // $150 (higher than $145 buy)
    const encryptedSellPrice = encryptValue(sellPrice, cipher, ephemeralPublicKey, 3);

    console.log('\n   Placing SELL order @ $150 (should NOT match $145 buy)...');

    // Generate ZK proof
    const nacl = require('tweetnacl');
    const bs58 = require('bs58');
    const timestamp = Date.now();
    const message = `Confidex eligibility proof request: ${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);
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
      console.log('❌ Proof generation failed');
      return;
    }

    const proveResult = await proveResponse.json();
    const eligibilityProof = new Uint8Array(Buffer.from(proveResult.proofHex, 'hex'));
    console.log('   ✅ ZK proof generated');

    const tx = await buildPlaceOrderTransaction({
      connection,
      maker: maker.publicKey,
      baseMint: WSOL_MINT,
      quoteMint: DUMMY_USDC_MINT,
      side: Side.Sell,
      orderType: OrderType.Limit,
      encryptedAmount: new Uint8Array(encryptedAmount),
      encryptedPrice: new Uint8Array(encryptedSellPrice),
      eligibilityProof: new Uint8Array(eligibilityProof),
      ephemeralPubkey: ephemeralPublicKey,
    });

    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
    tx.instructions.unshift(computeBudgetIx);

    console.log('   Submitting transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [maker], {
      commitment: 'confirmed',
    });

    console.log('\n✅ Sell order placed!');
    console.log('   Signature:', sig);
    console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    console.log('\n   Now wait for crank to attempt matching...');
    console.log('   The MPC should return "no match" since $150 sell > $145 buy\n');

    return;
  }

  // If we have USDC, place the buy order
  console.log(`   USDC balance: ${Number(usdcBalance) / 1e6} USDC - sufficient!\n`);

  // Generate ZK proof
  const nacl = require('tweetnacl');
  const bs58 = require('bs58');
  const timestamp = Date.now();
  const message = `Confidex eligibility proof request: ${timestamp}`;
  const messageBytes = new TextEncoder().encode(message);
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
    console.log('❌ Proof generation failed');
    return;
  }

  const proveResult = await proveResponse.json();
  const eligibilityProof = new Uint8Array(Buffer.from(proveResult.proofHex, 'hex'));
  console.log('✅ ZK proof generated');

  const tx = await buildPlaceOrderTransaction({
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

  const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 });
  tx.instructions.unshift(computeBudgetIx);

  console.log('Submitting transaction...');
  const sig = await sendAndConfirmTransaction(connection, tx, [maker], {
    commitment: 'confirmed',
  });

  console.log('\n✅ Buy order placed!');
  console.log('   Signature:', sig);
  console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  console.log('\n   Crank will now attempt to match with existing sell order...');
  console.log('   Watch the crank logs for MPC matching activity.\n');
}

main().catch(console.error);
