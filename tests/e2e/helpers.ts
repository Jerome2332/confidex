/**
 * E2E Test Helpers
 *
 * Provides helper functions for order creation, encryption, proof generation,
 * and order matching verification.
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
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import * as crypto from 'crypto';
import {
  CONFIDEX_PROGRAM_ID,
  MXE_PROGRAM_ID,
  VERIFIER_PROGRAM_ID,
  TestContext,
  PollOptions,
  pollUntil,
} from './setup';

// =============================================================================
// ORDER TYPES
// =============================================================================

export type Side = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'Active' | 'Matching' | 'PartiallyFilled' | 'Filled' | 'Cancelled';

export interface OrderAccount {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  status: OrderStatus;
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  encryptedFilled: Uint8Array;
  ephemeralPubkey: Uint8Array;
  createdAt: number;
}

export interface EncryptedOrderValues {
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  ephemeralPubkey: Uint8Array;
}

// =============================================================================
// ENCRYPTION
// =============================================================================

/**
 * Encrypt order values using mock encryption for E2E tests
 *
 * In production, this uses RescueCipher with MXE public key.
 * For E2E tests, we use a deterministic mock that produces valid 64-byte blobs.
 */
export async function encryptOrderValues(params: {
  amount: bigint;
  price: bigint;
}): Promise<EncryptedOrderValues> {
  const { amount, price } = params;

  // Generate ephemeral keypair
  const ephemeralKey = crypto.randomBytes(32);

  // Create 64-byte encrypted blobs (V2 format: nonce|ciphertext|ephemeral)
  const encryptedAmount = createEncryptedBlob(amount, ephemeralKey);
  const encryptedPrice = createEncryptedBlob(price, ephemeralKey);

  return {
    encryptedAmount,
    encryptedPrice,
    ephemeralPubkey: ephemeralKey.slice(0, 32),
  };
}

/**
 * Create a 64-byte encrypted blob for a value
 */
function createEncryptedBlob(value: bigint, key: Buffer): Uint8Array {
  const blob = new Uint8Array(64);

  // Nonce (16 bytes) - random
  const nonce = crypto.randomBytes(16);
  blob.set(nonce, 0);

  // Ciphertext (32 bytes) - value XORed with key-derived mask
  const valueBuf = Buffer.alloc(32);
  valueBuf.writeBigUInt64LE(value, 0);
  const mask = crypto.createHash('sha256').update(key).update(nonce).digest();
  for (let i = 0; i < 32; i++) {
    blob[16 + i] = valueBuf[i] ^ mask[i];
  }

  // Ephemeral pubkey hint (16 bytes)
  blob.set(key.slice(0, 16), 48);

  return blob;
}

// =============================================================================
// ZK PROOF GENERATION
// =============================================================================

/**
 * Generate eligibility proof for a user
 *
 * In production, this generates a real Groth16 proof via Sunspot.
 * For E2E tests against devnet with ZK verification disabled, we use a mock.
 */
export async function generateEligibilityProof(userPubkey: PublicKey): Promise<Uint8Array> {
  // Production proof size is 388 bytes
  // For E2E tests, generate a deterministic mock proof
  const proof = new Uint8Array(388);

  // Set some deterministic values based on user pubkey
  const hash = crypto.createHash('sha256').update(userPubkey.toBuffer()).digest();
  proof.set(hash, 0);
  proof.set(hash, 32);

  // Fill remaining with deterministic pattern
  for (let i = 64; i < 388; i++) {
    proof[i] = (hash[i % 32] + i) % 256;
  }

  return proof;
}

/**
 * Generate real eligibility proof (requires backend)
 */
export async function generateRealEligibilityProof(
  userPubkey: PublicKey,
  backendUrl: string
): Promise<Uint8Array> {
  const response = await fetch(`${backendUrl}/api/prove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      address: userPubkey.toBase58(),
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate proof: ${response.statusText}`);
  }

  const data = await response.json();
  return new Uint8Array(Buffer.from(data.proof, 'base64'));
}

// =============================================================================
// INSTRUCTION BUILDERS
// =============================================================================

export interface PlaceOrderParams {
  programId: PublicKey;
  pairPda: PublicKey;
  exchangePda: PublicKey;
  userPubkey: PublicKey;
  orderPubkey: PublicKey;
  side: Side;
  orderType?: OrderType;
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  ephemeralPubkey: Uint8Array;
  proof: Uint8Array;
}

/**
 * Create place order instruction
 */
export function createPlaceOrderInstruction(params: PlaceOrderParams): TransactionInstruction {
  const {
    programId,
    pairPda,
    exchangePda,
    userPubkey,
    orderPubkey,
    side,
    orderType = 'limit',
    encryptedAmount,
    encryptedPrice,
    ephemeralPubkey,
    proof,
  } = params;

  // Derive trader eligibility PDA
  const [traderEligibilityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('trader_eligibility'), userPubkey.toBuffer()],
    programId
  );

  // Build instruction data
  // Discriminator (8 bytes) + side (1) + order_type (1) + encrypted_amount (64) + encrypted_price (64) + ephemeral (32) + proof (388)
  const discriminator = Buffer.from([0x33, 0xc2, 0x9b, 0xaf, 0x6d, 0x82, 0x60, 0x6a]); // place_order
  const sideValue = side === 'buy' ? 0 : 1;
  const orderTypeValue = orderType === 'limit' ? 0 : 1;

  const data = Buffer.concat([
    discriminator,
    Buffer.from([sideValue, orderTypeValue]),
    Buffer.from(encryptedAmount),
    Buffer.from(encryptedPrice),
    Buffer.from(ephemeralPubkey),
    Buffer.from(proof),
  ]);

  const keys = [
    { pubkey: exchangePda, isSigner: false, isWritable: false },
    { pubkey: pairPda, isSigner: false, isWritable: true },
    { pubkey: orderPubkey, isSigner: true, isWritable: true },
    { pubkey: userPubkey, isSigner: true, isWritable: true },
    { pubkey: traderEligibilityPda, isSigner: false, isWritable: true },
    { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys,
    data,
  });
}

export interface CancelOrderParams {
  programId: PublicKey;
  orderPda: PublicKey;
  userPubkey: PublicKey;
}

/**
 * Create cancel order instruction
 */
export function createCancelOrderInstruction(params: CancelOrderParams): TransactionInstruction {
  const { programId, orderPda, userPubkey } = params;

  // Discriminator for cancel_order
  const discriminator = Buffer.from([0x5f, 0x81, 0xed, 0xf0, 0x08, 0x31, 0xdf, 0x84]);

  const keys = [
    { pubkey: orderPda, isSigner: false, isWritable: true },
    { pubkey: userPubkey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({
    programId,
    keys,
    data: discriminator,
  });
}

// =============================================================================
// ORDER ACCOUNT PARSING
// =============================================================================

/**
 * Get and parse order account data
 */
export async function getOrderAccount(
  connection: Connection,
  orderPubkey: PublicKey
): Promise<OrderAccount | null> {
  const accountInfo = await connection.getAccountInfo(orderPubkey);
  if (!accountInfo) {
    return null;
  }

  return parseOrderAccount(accountInfo.data);
}

/**
 * Parse order account from raw data - V5 format (366 bytes)
 *
 * V5 Order Layout:
 *   0-7:    discriminator (8)
 *   8-39:   maker (32)
 *   40-71:  pair (32)
 *   72:     side (1)
 *   73:     order_type (1)
 *   74-137: encrypted_amount (64)
 *   138-201: encrypted_price (64)
 *   202-265: encrypted_filled (64)
 *   266:    status (1)
 *   267-274: created_at_hour (8)
 *   275-290: order_id (16)
 *   291-298: order_nonce (8)
 *   299:    eligibility_proof_verified (1)
 *   300-331: pending_match_request (32)
 *   332:    is_matching (1)
 *   333:    bump (1)
 *   334-365: ephemeral_pubkey (32)
 */
function parseOrderAccount(data: Buffer): OrderAccount {
  // Skip discriminator (8 bytes)
  let offset = 8;

  // Maker (32 bytes) - offset 8
  const maker = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // Pair (32 bytes) - offset 40
  const pair = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;

  // Side (1 byte) - offset 72
  const sideValue = data[offset];
  const side: Side = sideValue === 0 ? 'buy' : 'sell';
  offset += 1;

  // Order type (1 byte) - offset 73
  const orderTypeValue = data[offset];
  const orderType: OrderType = orderTypeValue === 0 ? 'limit' : 'market';
  offset += 1;

  // Encrypted amount (64 bytes) - offset 74
  const encryptedAmount = new Uint8Array(data.slice(offset, offset + 64));
  offset += 64;

  // Encrypted price (64 bytes) - offset 138
  const encryptedPrice = new Uint8Array(data.slice(offset, offset + 64));
  offset += 64;

  // Encrypted filled (64 bytes) - offset 202
  const encryptedFilled = new Uint8Array(data.slice(offset, offset + 64));
  offset += 64;

  // Status (1 byte) - offset 266
  const statusValue = data[offset];
  const statusMap: Record<number, OrderStatus> = {
    0: 'Active',
    1: 'Matching',
    2: 'PartiallyFilled',
    3: 'Filled',
    4: 'Cancelled',
  };
  const status = statusMap[statusValue] || 'Active';
  offset += 1;

  // Created at hour (8 bytes, i64) - offset 267
  const createdAt = Number(data.readBigInt64LE(offset));
  offset += 8;

  // Skip order_id (16), order_nonce (8), eligibility_proof_verified (1),
  // pending_match_request (32), is_matching (1), bump (1)
  offset += 16 + 8 + 1 + 32 + 1 + 1;

  // Ephemeral pubkey (32 bytes) - offset 334
  const ephemeralPubkey = new Uint8Array(data.slice(offset, offset + 32));

  return {
    maker,
    pair,
    side,
    orderType,
    status,
    encryptedAmount,
    encryptedPrice,
    encryptedFilled,
    ephemeralPubkey,
    createdAt,
  };
}

// =============================================================================
// ORDER MATCHING
// =============================================================================

export interface MatchResult {
  matched: boolean;
  mpcCallbackReceived: boolean;
  buyOrderStatus: OrderStatus;
  sellOrderStatus: OrderStatus;
  matchSignature?: string;
}

/**
 * Wait for orders to be matched by the crank
 */
export async function waitForOrderMatch(
  connection: Connection,
  buyOrderPda: PublicKey,
  sellOrderPda: PublicKey,
  options: PollOptions = {}
): Promise<MatchResult> {
  const { timeoutMs = 60_000, pollIntervalMs = 2_000 } = options;

  console.log(`[E2E Match] Waiting for orders to match...`);
  console.log(`[E2E Match] Buy order: ${buyOrderPda.toBase58()}`);
  console.log(`[E2E Match] Sell order: ${sellOrderPda.toBase58()}`);

  const startTime = Date.now();
  let buyOrder: OrderAccount | null = null;
  let sellOrder: OrderAccount | null = null;
  let mpcCallbackReceived = false;

  while (Date.now() - startTime < timeoutMs) {
    buyOrder = await getOrderAccount(connection, buyOrderPda);
    sellOrder = await getOrderAccount(connection, sellOrderPda);

    if (!buyOrder || !sellOrder) {
      throw new Error('Order account not found');
    }

    // Check if either order is in Matching state (MPC in progress)
    if (buyOrder.status === 'Matching' || sellOrder.status === 'Matching') {
      console.log(`[E2E Match] MPC matching in progress...`);
      mpcCallbackReceived = true;
    }

    // Check if orders are filled
    const buyFilled = buyOrder.status === 'Filled' || buyOrder.status === 'PartiallyFilled';
    const sellFilled = sellOrder.status === 'Filled' || sellOrder.status === 'PartiallyFilled';

    if (buyFilled && sellFilled) {
      console.log(`[E2E Match] Orders matched successfully!`);
      return {
        matched: true,
        mpcCallbackReceived,
        buyOrderStatus: buyOrder.status,
        sellOrderStatus: sellOrder.status,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  console.log(`[E2E Match] Timeout waiting for match`);
  return {
    matched: false,
    mpcCallbackReceived,
    buyOrderStatus: buyOrder?.status || 'Active',
    sellOrderStatus: sellOrder?.status || 'Active',
  };
}

// =============================================================================
// BALANCE HELPERS
// =============================================================================

/**
 * Get user's token balance from on-chain account
 */
export async function getUserBalance(
  ctx: TestContext,
  user: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  try {
    const accountInfo = await ctx.connection.getTokenAccountBalance(
      await getAtaAddress(user, mint)
    );
    return BigInt(accountInfo.value.amount);
  } catch {
    return 0n;
  }
}

/**
 * Get ATA address (sync version)
 */
async function getAtaAddress(owner: PublicKey, mint: PublicKey): Promise<PublicKey> {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID
  );
  return ata;
}

// =============================================================================
// TEST ORDER HELPERS
// =============================================================================

/**
 * Place a test order and return the order PDA
 */
export async function placeTestOrder(
  ctx: TestContext,
  user: Keypair,
  side: Side,
  price: bigint,
  amount: bigint = 100_000_000n // 0.1 SOL default
): Promise<PublicKey> {
  console.log(`[E2E Order] Placing ${side} order at price ${price} for amount ${amount}`);

  // Generate proof and encrypt values
  const proof = await generateEligibilityProof(user.publicKey);
  const { encryptedAmount, encryptedPrice, ephemeralPubkey } = await encryptOrderValues({
    amount,
    price,
  });

  // Create order keypair
  const orderKeypair = Keypair.generate();

  // Build transaction
  const tx = new Transaction();
  tx.add(
    createPlaceOrderInstruction({
      programId: CONFIDEX_PROGRAM_ID,
      pairPda: ctx.pairPda,
      exchangePda: ctx.exchangePda,
      userPubkey: user.publicKey,
      orderPubkey: orderKeypair.publicKey,
      side,
      encryptedAmount,
      encryptedPrice,
      ephemeralPubkey,
      proof,
    })
  );

  // Send transaction
  const signature = await sendAndConfirmTransaction(
    ctx.connection,
    tx,
    [user, orderKeypair],
    { commitment: 'confirmed' }
  );

  console.log(`[E2E Order] Order placed: ${orderKeypair.publicKey.toBase58()}`);
  console.log(`[E2E Order] Signature: ${signature}`);

  return orderKeypair.publicKey;
}

/**
 * Cancel an order
 */
export async function cancelOrder(
  ctx: TestContext,
  user: Keypair,
  orderPda: PublicKey
): Promise<string> {
  const tx = new Transaction();
  tx.add(
    createCancelOrderInstruction({
      programId: CONFIDEX_PROGRAM_ID,
      orderPda,
      userPubkey: user.publicKey,
    })
  );

  const signature = await sendAndConfirmTransaction(ctx.connection, tx, [user], {
    commitment: 'confirmed',
  });

  console.log(`[E2E Order] Order cancelled: ${orderPda.toBase58()}`);
  return signature;
}
