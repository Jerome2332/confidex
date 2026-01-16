'use client';

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  Connection,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
} from '@solana/spl-token';
import { CONFIDEX_PROGRAM_ID, VERIFIER_PROGRAM_ID, GROTH16_PROOF_SIZE } from './constants';

// Anchor instruction discriminators (pre-computed sha256("global:<instruction_name>")[0..8])
const PLACE_ORDER_DISCRIMINATOR = new Uint8Array([0x33, 0xc2, 0x9b, 0xaf, 0x6d, 0x82, 0x60, 0x6a]);
const WRAP_TOKENS_DISCRIMINATOR = new Uint8Array([0xf4, 0x89, 0x39, 0xfb, 0xe8, 0xe0, 0x36, 0x0e]);
const UNWRAP_TOKENS_DISCRIMINATOR = new Uint8Array([0x11, 0x79, 0x03, 0xfa, 0x43, 0x69, 0xe8, 0x71]);

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');
const ORDER_SEED = Buffer.from('order');
const USER_BALANCE_SEED = Buffer.from('user_balance');

// Side enum (matching Anchor)
export enum Side {
  Buy = 0,
  Sell = 1,
}

// OrderType enum (matching Anchor)
export enum OrderType {
  Limit = 0,
  Market = 1,
}

/**
 * Derive Exchange PDA
 */
export function deriveExchangePda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([EXCHANGE_SEED], CONFIDEX_PROGRAM_ID);
}

/**
 * Derive Trading Pair PDA
 */
export function derivePairPda(
  baseMint: PublicKey,
  quoteMint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Derive Order PDA
 */
export function deriveOrderPda(
  maker: PublicKey,
  orderCount: bigint
): [PublicKey, number] {
  const orderCountBuf = Buffer.alloc(8);
  orderCountBuf.writeBigUInt64LE(orderCount);
  return PublicKey.findProgramAddressSync(
    [ORDER_SEED, maker.toBuffer(), orderCountBuf],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Derive User Confidential Balance PDA
 * Seeds: ["user_balance", user_pubkey, mint_address]
 */
export function deriveUserBalancePda(
  user: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_BALANCE_SEED, user.toBuffer(), mint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Serialize Side enum for Anchor
 */
function serializeSide(side: Side): Buffer {
  return Buffer.from([side]);
}

/**
 * Serialize OrderType enum for Anchor
 */
function serializeOrderType(orderType: OrderType): Buffer {
  return Buffer.from([orderType]);
}

/**
 * Build place_order instruction data in Anchor format
 */
export function buildPlaceOrderData(
  side: Side,
  orderType: OrderType,
  encryptedAmount: Uint8Array,
  encryptedPrice: Uint8Array,
  eligibilityProof: Uint8Array
): Buffer {
  // Anchor format: [discriminator(8), side(1), order_type(1), encrypted_amount(64), encrypted_price(64), eligibility_proof(388)]
  const data = Buffer.alloc(8 + 1 + 1 + 64 + 64 + GROTH16_PROOF_SIZE);
  let offset = 0;

  // Discriminator (8 bytes)
  Buffer.from(PLACE_ORDER_DISCRIMINATOR).copy(data, offset);
  offset += 8;

  // Side (1 byte enum)
  data[offset++] = side;

  // OrderType (1 byte enum)
  data[offset++] = orderType;

  // Encrypted amount (64 bytes)
  Buffer.from(encryptedAmount).copy(data, offset);
  offset += 64;

  // Encrypted price (64 bytes)
  Buffer.from(encryptedPrice).copy(data, offset);
  offset += 64;

  // Eligibility proof (388 bytes)
  const proofSlice = eligibilityProof.slice(0, GROTH16_PROOF_SIZE);
  Buffer.from(proofSlice).copy(data, offset);

  return data;
}

export interface PlaceOrderParams {
  connection: Connection;
  maker: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  eligibilityProof: Uint8Array;
}

/**
 * Fetch the current order count from ExchangeState
 */
export async function fetchOrderCount(
  connection: Connection
): Promise<bigint> {
  const [exchangePda] = deriveExchangePda();

  try {
    const accountInfo = await connection.getAccountInfo(exchangePda);
    if (!accountInfo) {
      console.log('[ConfidexClient] Exchange not initialized');
      return BigInt(0);
    }

    // ExchangeState layout:
    // 8 bytes discriminator
    // 32 bytes authority
    // 32 bytes fee_recipient
    // 2 bytes maker_fee_bps
    // 2 bytes taker_fee_bps
    // 1 byte paused
    // 32 bytes blacklist_root
    // 32 bytes arcium_cluster
    // 8 bytes pair_count
    // 8 bytes order_count <- offset 117
    // 1 byte bump

    const data = accountInfo.data;
    const orderCountOffset = 8 + 32 + 32 + 2 + 2 + 1 + 32 + 32 + 8;
    const orderCount = data.readBigUInt64LE(orderCountOffset);

    console.log('[ConfidexClient] Current order count:', orderCount.toString());
    return orderCount;
  } catch (error) {
    console.error('[ConfidexClient] Error fetching order count:', error);
    return BigInt(0);
  }
}

/**
 * Check if Exchange is initialized
 */
export async function isExchangeInitialized(
  connection: Connection
): Promise<boolean> {
  const [exchangePda] = deriveExchangePda();
  const accountInfo = await connection.getAccountInfo(exchangePda);
  return accountInfo !== null;
}

/**
 * Check if Trading Pair exists
 */
export async function isPairInitialized(
  connection: Connection,
  baseMint: PublicKey,
  quoteMint: PublicKey
): Promise<boolean> {
  const [pairPda] = derivePairPda(baseMint, quoteMint);
  const accountInfo = await connection.getAccountInfo(pairPda);
  return accountInfo !== null;
}

/**
 * Build place_order transaction
 */
export async function buildPlaceOrderTransaction(
  params: PlaceOrderParams
): Promise<Transaction> {
  const {
    connection,
    maker,
    baseMint,
    quoteMint,
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof,
  } = params;

  console.log('[ConfidexClient] Building place_order transaction...');

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);

  console.log('[ConfidexClient] Exchange PDA:', exchangePda.toString());
  console.log('[ConfidexClient] Pair PDA:', pairPda.toString());

  // Fetch current order count to derive order PDA
  const orderCount = await fetchOrderCount(connection);
  const [orderPda] = deriveOrderPda(maker, orderCount);

  console.log('[ConfidexClient] Order PDA:', orderPda.toString());
  console.log('[ConfidexClient] Order count:', orderCount.toString());

  // Build instruction data
  const instructionData = buildPlaceOrderData(
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof
  );

  console.log('[ConfidexClient] Instruction data length:', instructionData.length);

  // Build instruction with required accounts
  // PlaceOrder accounts (from place_order.rs):
  // 1. exchange (mut) - ExchangeState PDA
  // 2. pair (mut) - TradingPair PDA
  // 3. order (init, mut) - ConfidentialOrder PDA
  // 4. verifier_program - Sunspot ZK verifier
  // 5. maker (signer, mut)
  // 6. system_program
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: maker, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  // Build transaction
  const transaction = new Transaction().add(instruction);

  // Get recent blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = maker;

  console.log('[ConfidexClient] Transaction built successfully');

  return transaction;
}

/**
 * UserConfidentialBalance account layout (153 bytes total)
 */
export interface UserConfidentialBalance {
  owner: PublicKey;
  mint: PublicKey;
  encryptedBalance: Uint8Array; // 64 bytes
  totalDeposited: bigint;
  totalWithdrawn: bigint;
  bump: number;
}

/**
 * Parse UserConfidentialBalance from account data
 */
export function parseUserConfidentialBalance(
  data: Buffer
): UserConfidentialBalance {
  // Skip 8-byte discriminator
  let offset = 8;

  const owner = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const mint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const encryptedBalance = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const totalDeposited = data.readBigUInt64LE(offset);
  offset += 8;

  const totalWithdrawn = data.readBigUInt64LE(offset);
  offset += 8;

  const bump = data.readUInt8(offset);

  return {
    owner,
    mint,
    encryptedBalance,
    totalDeposited,
    totalWithdrawn,
    bump,
  };
}

/**
 * Get current balance from encrypted_balance field
 * Development mode: reads first 8 bytes as u64 LE
 */
export function getBalanceFromEncrypted(encryptedBalance: Uint8Array): bigint {
  const balanceBytes = encryptedBalance.slice(0, 8);
  const view = new DataView(balanceBytes.buffer, balanceBytes.byteOffset, 8);
  return view.getBigUint64(0, true); // little-endian
}

/**
 * Fetch user's confidential balance for a specific token
 */
export async function fetchUserBalance(
  connection: Connection,
  user: PublicKey,
  mint: PublicKey
): Promise<{ balance: bigint; account: UserConfidentialBalance | null }> {
  const [balancePda] = deriveUserBalancePda(user, mint);

  try {
    const accountInfo = await connection.getAccountInfo(balancePda);

    if (!accountInfo) {
      console.log('[ConfidexClient] No balance account found for', mint.toString());
      return { balance: BigInt(0), account: null };
    }

    const account = parseUserConfidentialBalance(accountInfo.data);
    const balance = getBalanceFromEncrypted(account.encryptedBalance);

    console.log('[ConfidexClient] Fetched balance:', balance.toString(), 'for mint:', mint.toString());

    return { balance, account };
  } catch (error) {
    console.error('[ConfidexClient] Error fetching user balance:', error);
    return { balance: BigInt(0), account: null };
  }
}

/**
 * TradingPair account layout (234 bytes total)
 */
export interface TradingPair {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  cBaseMint: PublicKey;
  cQuoteMint: PublicKey;
  cBaseVault: PublicKey;
  cQuoteVault: PublicKey;
  minOrderSize: bigint;
  tickSize: bigint;
  active: boolean;
  openOrderCount: bigint;
  index: bigint;
  bump: number;
}

/**
 * Parse TradingPair from account data
 */
export function parseTradingPair(data: Buffer): TradingPair {
  // Skip 8-byte discriminator
  let offset = 8;

  const baseMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const quoteMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cBaseMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cQuoteMint = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cBaseVault = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const cQuoteVault = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const minOrderSize = data.readBigUInt64LE(offset);
  offset += 8;

  const tickSize = data.readBigUInt64LE(offset);
  offset += 8;

  const active = data.readUInt8(offset) === 1;
  offset += 1;

  const openOrderCount = data.readBigUInt64LE(offset);
  offset += 8;

  const index = data.readBigUInt64LE(offset);
  offset += 8;

  const bump = data.readUInt8(offset);

  return {
    baseMint,
    quoteMint,
    cBaseMint,
    cQuoteMint,
    cBaseVault,
    cQuoteVault,
    minOrderSize,
    tickSize,
    active,
    openOrderCount,
    index,
    bump,
  };
}

/**
 * Fetch TradingPair account
 */
export async function fetchTradingPair(
  connection: Connection,
  baseMint: PublicKey,
  quoteMint: PublicKey
): Promise<TradingPair | null> {
  const [pairPda] = derivePairPda(baseMint, quoteMint);

  try {
    const accountInfo = await connection.getAccountInfo(pairPda);
    if (!accountInfo) {
      console.log('[ConfidexClient] Trading pair not found');
      return null;
    }

    const pair = parseTradingPair(accountInfo.data);
    console.log('[ConfidexClient] Fetched trading pair:', pairPda.toString());
    return pair;
  } catch (error) {
    console.error('[ConfidexClient] Error fetching trading pair:', error);
    return null;
  }
}

/**
 * Get the correct vault address for a token mint in a trading pair
 */
export function getVaultForMint(pair: TradingPair, mint: PublicKey): PublicKey | null {
  if (mint.equals(pair.baseMint)) {
    return pair.cBaseVault;
  } else if (mint.equals(pair.quoteMint)) {
    return pair.cQuoteVault;
  }
  return null;
}

export interface WrapTokensParams {
  connection: Connection;
  user: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
}

export interface WrapInstructionsResult {
  instructions: TransactionInstruction[];
  userTokenAccount: PublicKey;
}

/**
 * Build wrap instructions (without transaction wrapper)
 * This allows wrap instructions to be combined with other instructions
 */
export async function buildWrapInstructions(
  params: WrapTokensParams
): Promise<WrapInstructionsResult> {
  const { connection, user, baseMint, quoteMint, tokenMint, amount } = params;

  console.log('[ConfidexClient] Building wrap instructions...');
  console.log('  Token mint:', tokenMint.toString());
  console.log('  Amount:', amount.toString());

  // Fetch trading pair to get vault addresses
  const pair = await fetchTradingPair(connection, baseMint, quoteMint);
  if (!pair) {
    throw new Error('Trading pair not found');
  }

  // Get the correct vault for this token
  const vault = getVaultForMint(pair, tokenMint);
  if (!vault) {
    throw new Error('Token mint is not part of this trading pair');
  }

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);
  const [userBalancePda] = deriveUserBalancePda(user, tokenMint);

  // Get user's token account
  const userTokenAccount = await getAssociatedTokenAddress(tokenMint, user);

  const instructions: TransactionInstruction[] = [];

  // Check if this is native SOL (WSOL)
  const isNativeSol = tokenMint.equals(NATIVE_MINT);

  if (isNativeSol) {
    console.log('[ConfidexClient] Handling native SOL wrapping...');

    // Check if WSOL ATA exists
    const ataInfo = await connection.getAccountInfo(userTokenAccount);

    if (!ataInfo) {
      console.log('[ConfidexClient] Creating WSOL ATA...');
      instructions.push(
        createAssociatedTokenAccountInstruction(
          user,
          userTokenAccount,
          user,
          NATIVE_MINT
        )
      );
    }

    // Transfer native SOL to WSOL ATA
    console.log('[ConfidexClient] Adding SOL transfer to WSOL ATA...');
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: userTokenAccount,
        lamports: BigInt(amount),
      })
    );

    // Sync native to update WSOL balance
    console.log('[ConfidexClient] Adding sync native instruction...');
    instructions.push(createSyncNativeInstruction(userTokenAccount));
  }

  // Build wrap instruction data: discriminator (8) + amount (8)
  const instructionData = Buffer.alloc(16);
  Buffer.from(WRAP_TOKENS_DISCRIMINATOR).copy(instructionData, 0);
  instructionData.writeBigUInt64LE(amount, 8);

  // Build wrap instruction with accounts (matching wrap_tokens.rs)
  const wrapInstruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  instructions.push(wrapInstruction);

  console.log('[ConfidexClient] Wrap instructions built:', instructions.length);

  return { instructions, userTokenAccount };
}

/**
 * Build wrap_tokens transaction
 * Transfers SPL tokens to the pair vault and credits the user's confidential balance
 *
 * For native SOL (WSOL), this also handles:
 * 1. Creating the WSOL ATA if needed
 * 2. Transferring native SOL to the ATA
 * 3. Syncing native balance to WSOL tokens
 */
export async function buildWrapTransaction(
  params: WrapTokensParams
): Promise<Transaction> {
  const { connection, user, baseMint, quoteMint, tokenMint, amount } = params;

  console.log('[ConfidexClient] Building wrap_tokens transaction...');
  console.log('  Token mint:', tokenMint.toString());
  console.log('  Amount:', amount.toString());

  // Fetch trading pair to get vault addresses
  const pair = await fetchTradingPair(connection, baseMint, quoteMint);
  if (!pair) {
    throw new Error('Trading pair not found');
  }

  // Get the correct vault for this token
  const vault = getVaultForMint(pair, tokenMint);
  if (!vault) {
    throw new Error('Token mint is not part of this trading pair');
  }

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);
  const [userBalancePda] = deriveUserBalancePda(user, tokenMint);

  // Get user's token account
  const userTokenAccount = await getAssociatedTokenAddress(tokenMint, user);

  console.log('[ConfidexClient] Accounts:');
  console.log('  Exchange:', exchangePda.toString());
  console.log('  Pair:', pairPda.toString());
  console.log('  Token Mint:', tokenMint.toString());
  console.log('  User Token Account:', userTokenAccount.toString());
  console.log('  Vault:', vault.toString());
  console.log('  User Balance PDA:', userBalancePda.toString());

  // Build transaction
  const transaction = new Transaction();

  // Check if this is native SOL (WSOL)
  const isNativeSol = tokenMint.equals(NATIVE_MINT);

  if (isNativeSol) {
    console.log('[ConfidexClient] Handling native SOL wrapping...');

    // Check if WSOL ATA exists
    const ataInfo = await connection.getAccountInfo(userTokenAccount);

    if (!ataInfo) {
      console.log('[ConfidexClient] Creating WSOL ATA...');
      // Create WSOL ATA
      transaction.add(
        createAssociatedTokenAccountInstruction(
          user,
          userTokenAccount,
          user,
          NATIVE_MINT
        )
      );
    }

    // Transfer native SOL to WSOL ATA
    console.log('[ConfidexClient] Adding SOL transfer to WSOL ATA...');
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: userTokenAccount,
        lamports: BigInt(amount),
      })
    );

    // Sync native to update WSOL balance
    console.log('[ConfidexClient] Adding sync native instruction...');
    transaction.add(createSyncNativeInstruction(userTokenAccount));
  }

  // Build wrap instruction data: discriminator (8) + amount (8)
  const instructionData = Buffer.alloc(16);
  Buffer.from(WRAP_TOKENS_DISCRIMINATOR).copy(instructionData, 0);
  instructionData.writeBigUInt64LE(amount, 8);

  // Build wrap instruction with accounts (matching wrap_tokens.rs)
  const wrapInstruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  transaction.add(wrapInstruction);

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = user;

  console.log('[ConfidexClient] Wrap transaction built successfully');
  console.log('  Total instructions:', transaction.instructions.length);

  return transaction;
}

export interface UnwrapTokensParams {
  connection: Connection;
  user: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  tokenMint: PublicKey;
  amount: bigint;
}

/**
 * Build unwrap_tokens transaction
 * Withdraws SPL tokens from the pair vault and debits the user's confidential balance
 *
 * For native SOL (WSOL), this also handles:
 * 1. Receiving WSOL tokens to the ATA
 * 2. Closing the WSOL ATA to convert back to native SOL
 */
export async function buildUnwrapTransaction(
  params: UnwrapTokensParams
): Promise<Transaction> {
  const { connection, user, baseMint, quoteMint, tokenMint, amount } = params;

  console.log('[ConfidexClient] Building unwrap_tokens transaction...');
  console.log('  Token mint:', tokenMint.toString());
  console.log('  Amount:', amount.toString());

  // Fetch trading pair to get vault addresses
  const pair = await fetchTradingPair(connection, baseMint, quoteMint);
  if (!pair) {
    throw new Error('Trading pair not found');
  }

  // Get the correct vault for this token
  const vault = getVaultForMint(pair, tokenMint);
  if (!vault) {
    throw new Error('Token mint is not part of this trading pair');
  }

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);
  const [userBalancePda] = deriveUserBalancePda(user, tokenMint);

  // Get user's token account
  const userTokenAccount = await getAssociatedTokenAddress(tokenMint, user);

  // Check if this is native SOL (WSOL)
  const isNativeSol = tokenMint.equals(NATIVE_MINT);

  console.log('[ConfidexClient] Accounts:');
  console.log('  Exchange:', exchangePda.toString());
  console.log('  Pair:', pairPda.toString());
  console.log('  Token Mint:', tokenMint.toString());
  console.log('  User Token Account:', userTokenAccount.toString());
  console.log('  Vault:', vault.toString());
  console.log('  User Balance PDA:', userBalancePda.toString());
  console.log('  Is native SOL:', isNativeSol);

  // Build transaction
  const transaction = new Transaction();

  // For native SOL, ensure the WSOL ATA exists (it should from wrap, but check anyway)
  if (isNativeSol) {
    const ataInfo = await connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
      console.log('[ConfidexClient] Creating WSOL ATA for unwrap...');
      transaction.add(
        createAssociatedTokenAccountInstruction(
          user,
          userTokenAccount,
          user,
          NATIVE_MINT
        )
      );
    }
  }

  // Build instruction data: discriminator (8) + amount (8)
  const instructionData = Buffer.alloc(16);
  Buffer.from(UNWRAP_TOKENS_DISCRIMINATOR).copy(instructionData, 0);
  instructionData.writeBigUInt64LE(amount, 8);

  // Build instruction with accounts (matching unwrap_tokens.rs)
  // Note: unwrap needs pair_authority for signing vault transfers
  const unwrapInstruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: false },
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: false }, // pair_authority (same PDA)
      { pubkey: user, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  transaction.add(unwrapInstruction);

  // For native SOL, close the WSOL ATA to convert WSOL back to native SOL
  if (isNativeSol) {
    console.log('[ConfidexClient] Adding close account instruction to convert WSOL -> SOL');
    transaction.add(
      createCloseAccountInstruction(
        userTokenAccount, // account to close
        user,             // destination for rent + WSOL balance
        user              // authority
      )
    );
  }

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = user;

  console.log('[ConfidexClient] Unwrap transaction built successfully');
  console.log('  Total instructions:', transaction.instructions.length);

  return transaction;
}

// ============================================
// PERPETUALS
// ============================================

// Perp PDA seeds
const PERP_MARKET_SEED = Buffer.from('perp_market');
const POSITION_SEED = Buffer.from('position');
const FUNDING_SEED = Buffer.from('funding');

// Position side enum
export enum PositionSide {
  Long = 0,
  Short = 1,
}

/**
 * Derive PerpetualMarket PDA
 */
export function derivePerpMarketPda(underlyingMint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [PERP_MARKET_SEED, underlyingMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Derive FundingRateState PDA
 */
export function deriveFundingPda(perpMarket: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [FUNDING_SEED, perpMarket.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Derive ConfidentialPosition PDA
 */
export function derivePositionPda(
  trader: PublicKey,
  perpMarket: PublicKey,
  positionCount: bigint
): [PublicKey, number] {
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigUInt64LE(positionCount);
  return PublicKey.findProgramAddressSync(
    [POSITION_SEED, trader.toBuffer(), perpMarket.toBuffer(), countBuf],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Check if PerpetualMarket exists
 */
export async function isPerpMarketInitialized(
  connection: Connection,
  underlyingMint: PublicKey
): Promise<boolean> {
  const [marketPda] = derivePerpMarketPda(underlyingMint);
  const accountInfo = await connection.getAccountInfo(marketPda);
  return accountInfo !== null;
}

/**
 * Calculate liquidation price based on position parameters
 * For longs: liq_price = entry_price * (1 - 1/leverage + maintenance_margin)
 * For shorts: liq_price = entry_price * (1 + 1/leverage - maintenance_margin)
 */
export function calculateLiquidationPrice(
  side: PositionSide,
  entryPrice: number,
  leverage: number,
  maintenanceMarginBps: number = 500 // 5% default
): number {
  const maintenanceMargin = maintenanceMarginBps / 10000;

  if (side === PositionSide.Long) {
    return entryPrice * (1 - 1 / leverage + maintenanceMargin);
  } else {
    return entryPrice * (1 + 1 / leverage - maintenanceMargin);
  }
}

export interface AutoWrapAndPlaceOrderParams {
  connection: Connection;
  maker: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: Uint8Array;
  encryptedPrice: Uint8Array;
  eligibilityProof: Uint8Array;
  // Auto-wrap parameters
  wrapTokenMint: PublicKey;  // Which token to wrap (SOL or USDC)
  wrapAmount: bigint;        // How much to wrap (difference needed)
}

/**
 * Build a combined transaction that wraps tokens and places an order
 * This reduces user friction by combining what was 2 transactions into 1
 *
 * Transaction flow:
 * 1. [WSOL only] createAssociatedTokenAccountInstruction (if needed)
 * 2. [WSOL only] SystemProgram.transfer (native SOL → WSOL ATA)
 * 3. [WSOL only] createSyncNativeInstruction
 * 4. wrap_tokens instruction
 * 5. place_order instruction
 */
export async function buildAutoWrapAndPlaceOrderTransaction(
  params: AutoWrapAndPlaceOrderParams
): Promise<Transaction> {
  const {
    connection,
    maker,
    baseMint,
    quoteMint,
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof,
    wrapTokenMint,
    wrapAmount,
  } = params;

  console.log('[ConfidexClient] Building auto-wrap + place_order transaction...');
  console.log('  Side:', side === Side.Buy ? 'Buy' : 'Sell');
  console.log('  Wrap token:', wrapTokenMint.toString());
  console.log('  Wrap amount:', wrapAmount.toString());

  const transaction = new Transaction();

  // Step 1: Add wrap instructions
  const { instructions: wrapInstructions } = await buildWrapInstructions({
    connection,
    user: maker,
    baseMint,
    quoteMint,
    tokenMint: wrapTokenMint,
    amount: wrapAmount,
  });

  for (const ix of wrapInstructions) {
    transaction.add(ix);
  }

  console.log('[ConfidexClient] Added', wrapInstructions.length, 'wrap instructions');

  // Step 2: Build place_order instruction
  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);

  // Fetch current order count to derive order PDA
  const orderCount = await fetchOrderCount(connection);
  const [orderPda] = deriveOrderPda(maker, orderCount);

  console.log('[ConfidexClient] Order PDA:', orderPda.toString());
  console.log('[ConfidexClient] Order count:', orderCount.toString());

  // Build instruction data
  const instructionData = buildPlaceOrderData(
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof
  );

  // Build place_order instruction
  const placeOrderInstruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: maker, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  transaction.add(placeOrderInstruction);

  console.log('[ConfidexClient] Added place_order instruction');

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = maker;

  console.log('[ConfidexClient] Auto-wrap + place_order transaction built');
  console.log('  Total instructions:', transaction.instructions.length);

  // Estimate transaction size
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  console.log('  Estimated size:', serialized.length, 'bytes (max 1232)');

  return transaction;
}
