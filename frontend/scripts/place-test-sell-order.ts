/**
 * Place Test Sell Order
 *
 * Places a sell order to test production MPC matching.
 * Run with: pnpm tsx scripts/place-test-sell-order.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { RescueCipher, x25519 } from '@arcium-hq/client';

// Constants
const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
const MXE_PROGRAM_ID = new PublicKey('DoT4uChyp5TCtkDw4VkUSsmj3u3SFqYQzr2KafrCqYCM');
const VERIFIER_PROGRAM_ID = new PublicKey('9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// MXE X25519 public key from environment
const MXE_X25519_PUBKEY = '14706bf82ff9e9cebde9d7ad1cc35dc98ad11b08ac92b07ed0fe472333703960';

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');
const ORDER_SEED = Buffer.from('order');
const USER_BALANCE_SEED = Buffer.from('user_balance');

// Side enum
enum Side {
  Buy = 0,
  Sell = 1,
}

// OrderType enum
enum OrderType {
  Limit = 0,
  Market = 1,
}

const GROTH16_PROOF_SIZE = 324;

function computeDiscriminator(instructionName: string): Buffer {
  const hash = crypto.createHash('sha256')
    .update(`global:${instructionName}`)
    .digest();
  return Buffer.from(hash.subarray(0, 8));
}

const PLACE_ORDER_DISCRIMINATOR = computeDiscriminator('place_order');

function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], CONFIDEX_PROGRAM_ID);
}

function derivePairPda(baseMint: PublicKey, quoteMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

function deriveOrderPda(maker: PublicKey, orderCount: bigint): [PublicKey, number] {
  const orderCountBuf = Buffer.alloc(8);
  orderCountBuf.writeBigUInt64LE(orderCount);
  return PublicKey.findProgramAddressSync(
    [ORDER_SEED, maker.toBuffer(), orderCountBuf],
    CONFIDEX_PROGRAM_ID
  );
}

function deriveUserBalancePda(user: PublicKey, mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_BALANCE_SEED, user.toBuffer(), mint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

async function fetchOrderCount(connection: Connection): Promise<bigint> {
  const [exchangePda] = deriveExchangePda();
  const accountInfo = await connection.getAccountInfo(exchangePda);
  if (!accountInfo) {
    return BigInt(0);
  }
  // order_count is at offset 117
  const orderCountOffset = 8 + 32 + 32 + 2 + 2 + 1 + 32 + 32 + 8;
  return accountInfo.data.readBigUInt64LE(orderCountOffset);
}

/**
 * Serialize a BigInt to little-endian bytes
 */
function serializeLE(value: bigint, byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let v = value;
  for (let i = 0; i < byteLength; i++) {
    result[i] = Number(v & BigInt(0xff));
    v = v >> BigInt(8);
  }
  return result;
}

/**
 * Encrypt a value using Arcium's RescueCipher (V2 format)
 * Returns: [nonce (16) | ciphertext (32) | ephemeral_pubkey (16)] = 64 bytes
 */
function encryptValue(value: bigint, mxePublicKey: Uint8Array): { encrypted: Uint8Array; ephemeralPubkey: Uint8Array } {
  // Generate ephemeral X25519 keypair
  const ephemeralPrivateKey = x25519.utils.randomPrivateKey();
  const ephemeralPublicKey = x25519.getPublicKey(ephemeralPrivateKey);

  // Compute shared secret
  const sharedSecret = x25519.getSharedSecret(ephemeralPrivateKey, mxePublicKey);

  // Create cipher
  const cipher = new RescueCipher(sharedSecret);

  // Generate nonce (16 bytes Uint8Array)
  const nonce = new Uint8Array(16);
  const nonceBytes = crypto.randomBytes(16);
  for (let i = 0; i < 16; i++) {
    nonce[i] = nonceBytes[i];
  }

  // Encrypt the value - returns an array of bigint arrays
  const ciphertext = cipher.encrypt([value], nonce);

  // Build V2 format: [nonce (16) | ciphertext (32) | ephemeral_pubkey_prefix (16)]
  const encrypted = new Uint8Array(64);

  // Copy nonce (16 bytes)
  encrypted.set(nonce, 0);

  // Copy ciphertext (32 bytes)
  // ciphertext is an array like [[bigint]] - extract and serialize
  if (ciphertext.length > 0 && ciphertext[0] !== undefined) {
    const ctValue = ciphertext[0];
    if (Array.isArray(ctValue) && ctValue.length >= 32) {
      // It's already a byte array
      encrypted.set(new Uint8Array(ctValue.slice(0, 32) as number[]), 16);
    } else if (typeof ctValue === 'bigint') {
      // Serialize bigint to bytes
      const ctBytes = serializeLE(ctValue, 32);
      encrypted.set(ctBytes, 16);
    } else if (typeof ctValue === 'number') {
      // Fallback for single number
      const ctBytes = serializeLE(BigInt(ctValue), 32);
      encrypted.set(ctBytes, 16);
    } else if (typeof ctValue === 'string') {
      // Handle string representation
      const ctBytes = serializeLE(BigInt(ctValue), 32);
      encrypted.set(ctBytes, 16);
    }
  }

  // Copy first 16 bytes of ephemeral pubkey
  encrypted.set(ephemeralPublicKey.slice(0, 16), 48);

  return { encrypted, ephemeralPubkey: ephemeralPublicKey };
}

/**
 * Generate a dummy ZK proof (388 bytes of zeros)
 * Note: In production, this would be a real Groth16 proof from Sunspot
 */
function generateDummyProof(): Uint8Array {
  return new Uint8Array(GROTH16_PROOF_SIZE);
}

async function main() {
  console.log('============================================================');
  console.log('   Place Test SELL Order (MPC Matching Test)');
  console.log('============================================================\n');

  // Load keypair (devnet.json)
  const keypairPath = path.join(process.env.HOME || '~', '.config', 'solana', 'devnet.json');
  let seller: Keypair;

  try {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
    seller = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    console.log(`Seller address: ${seller.publicKey.toString()}`);
  } catch (e) {
    console.error(`Could not read keypair from ${keypairPath}`);
    return;
  }

  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');

  // Parse MXE public key
  const mxePublicKey = new Uint8Array(
    MXE_X25519_PUBKEY.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16))
  );
  console.log(`MXE X25519 key: ${MXE_X25519_PUBKEY.slice(0, 16)}...`);

  // Order parameters
  // Sell order: selling 0.1 SOL at price 150 USDC per SOL
  // (This should match with buy orders at price >= 150)
  const amount = BigInt(100_000_000); // 0.1 SOL in lamports
  const price = BigInt(150_000_000);  // $150 USDC (6 decimals)

  console.log(`\nOrder details:`);
  console.log(`  Side: SELL`);
  console.log(`  Amount: ${Number(amount) / 1e9} SOL`);
  console.log(`  Price: $${Number(price) / 1e6} USDC per SOL`);

  // Encrypt values
  console.log(`\nEncrypting order values...`);
  const { encrypted: encryptedAmount, ephemeralPubkey: ephemeralPubkeyAmount } = encryptValue(amount, mxePublicKey);
  const { encrypted: encryptedPrice, ephemeralPubkey: ephemeralPubkeyPrice } = encryptValue(price, mxePublicKey);

  // Use the ephemeral pubkey from price encryption (both should work)
  const ephemeralPubkey = ephemeralPubkeyPrice;

  console.log(`  Encrypted amount: ${Buffer.from(encryptedAmount.slice(0, 16)).toString('hex')}...`);
  console.log(`  Encrypted price: ${Buffer.from(encryptedPrice.slice(0, 16)).toString('hex')}...`);
  console.log(`  Ephemeral pubkey: ${Buffer.from(ephemeralPubkey.slice(0, 16)).toString('hex')}...`);

  // Generate eligibility proof (dummy for testing)
  const eligibilityProof = generateDummyProof();
  console.log(`  Eligibility proof: ${GROTH16_PROOF_SIZE} bytes (dummy)`);

  // Get current order count
  const orderCount = await fetchOrderCount(connection);
  console.log(`\nCurrent order count: ${orderCount}`);

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(WSOL_MINT, USDC_MINT);
  const [orderPda] = deriveOrderPda(seller.publicKey, orderCount);

  // Sell orders spend base token (SOL)
  const spendMint = WSOL_MINT;
  const [userBalancePda] = deriveUserBalancePda(seller.publicKey, spendMint);

  console.log(`  Exchange PDA: ${exchangePda.toString()}`);
  console.log(`  Pair PDA: ${pairPda.toString()}`);
  console.log(`  Order PDA: ${orderPda.toString()}`);
  console.log(`  User balance PDA: ${userBalancePda.toString()}`);

  // Check if user has confidential SOL balance
  const balanceInfo = await connection.getAccountInfo(userBalancePda);
  if (!balanceInfo) {
    console.error('\n❌ No confidential SOL balance found!');
    console.error('   Run `pnpm tsx scripts/wrap-sol-for-seller.ts` first to wrap SOL.');
    return;
  }

  // Build instruction data
  // V5 format: [discriminator(8), side(1), order_type(1), encrypted_amount(64), encrypted_price(64), eligibility_proof(324), ephemeral_pubkey(32)]
  const instructionData = Buffer.alloc(8 + 1 + 1 + 64 + 64 + GROTH16_PROOF_SIZE + 32);
  let offset = 0;

  // Discriminator
  Buffer.from(PLACE_ORDER_DISCRIMINATOR).copy(instructionData, offset);
  offset += 8;

  // Side (SELL = 1)
  instructionData[offset++] = Side.Sell;

  // OrderType (Limit = 0)
  instructionData[offset++] = OrderType.Limit;

  // Encrypted amount (64 bytes)
  Buffer.from(encryptedAmount).copy(instructionData, offset);
  offset += 64;

  // Encrypted price (64 bytes)
  Buffer.from(encryptedPrice).copy(instructionData, offset);
  offset += 64;

  // Eligibility proof (324 bytes)
  Buffer.from(eligibilityProof).copy(instructionData, offset);
  offset += GROTH16_PROOF_SIZE;

  // Ephemeral pubkey (32 bytes)
  Buffer.from(ephemeralPubkey).copy(instructionData, offset);

  console.log(`\nInstruction data: ${instructionData.length} bytes`);

  // Build transaction
  const tx = new Transaction();

  // Add compute budget
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }));

  // Add place_order instruction
  tx.add({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: seller.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  // Send transaction
  try {
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = seller.publicKey;

    console.log('\nSending place_order transaction...');
    const sig = await sendAndConfirmTransaction(connection, tx, [seller], {
      commitment: 'confirmed',
      skipPreflight: false,
    });

    console.log(`\n✅ SELL order placed successfully!`);
    console.log(`   Order ID: ${orderCount}`);
    console.log(`   Signature: ${sig}`);
    console.log(`   Explorer: https://explorer.solana.com/tx/${sig}?cluster=devnet`);
    console.log(`\n🔄 The crank service should now attempt MPC matching with existing buy orders.`);
    console.log(`   Watch backend logs for: "[MpcPoller] Real MPC result: prices_match=..."`);

  } catch (e: any) {
    console.error('\n❌ Place order failed:', e.message);
    if (e.logs) {
      console.error('Transaction logs:');
      e.logs.forEach((log: string) => console.error('  ', log));
    }
  }
}

main().catch(console.error);
