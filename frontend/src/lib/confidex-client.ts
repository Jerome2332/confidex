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
import { CONFIDEX_PROGRAM_ID, VERIFIER_PROGRAM_ID, GROTH16_PROOF_SIZE, MXE_PROGRAM_ID, MXE_CONFIG_PDA, MXE_AUTHORITY_PDA } from './constants';

import { createLogger } from '@/lib/logger';

const log = createLogger('api');

// Anchor instruction discriminators (pre-computed sha256("global:<instruction_name>")[0..8])
const PLACE_ORDER_DISCRIMINATOR = new Uint8Array([0x33, 0xc2, 0x9b, 0xaf, 0x6d, 0x82, 0x60, 0x6a]);
const WRAP_TOKENS_DISCRIMINATOR = new Uint8Array([0xf4, 0x89, 0x39, 0xfb, 0xe8, 0xe0, 0x36, 0x0e]);
const UNWRAP_TOKENS_DISCRIMINATOR = new Uint8Array([0x11, 0x79, 0x03, 0xfa, 0x43, 0x69, 0xe8, 0x71]);
const MATCH_ORDERS_DISCRIMINATOR = new Uint8Array([0x11, 0x01, 0xc9, 0x5d, 0x07, 0x33, 0xfb, 0x86]);
const CANCEL_ORDER_DISCRIMINATOR = new Uint8Array([0x5f, 0x81, 0xed, 0xf0, 0x08, 0x31, 0xdf, 0x84]);
const CLOSE_POSITION_DISCRIMINATOR = new Uint8Array([0x7b, 0x86, 0x51, 0x0b, 0x11, 0x73, 0x61, 0x39]);

// PDA seeds
const EXCHANGE_SEED = Buffer.from('exchange');
const PAIR_SEED = Buffer.from('pair');
const ORDER_SEED = Buffer.from('order');
const USER_BALANCE_SEED = Buffer.from('user_balance');
const TRADER_ELIGIBILITY_SEED = Buffer.from('trader_eligibility');
const MPC_REQUEST_SEED = Buffer.from('mpc_request');
const COMPUTATION_SEED = Buffer.from('computation');
const MXE_CONFIG_SEED_BUF = Buffer.from('mxe_config');

// Event discriminators (Anchor event discriminator = sha256("event:<EventName>")[0..8])
// OrderPlaced event discriminator
const ORDER_PLACED_EVENT_DISCRIMINATOR = 'OrderPlaced';

/**
 * Parse OrderPlaced event from transaction logs
 * Returns the order_id if found, null otherwise
 */
export function parseOrderPlacedEvent(logs: string[]): bigint | null {
  // Look for the order placed log message: "Order placed: <id> (side: ...)"
  for (const logLine of logs) {
    const match = logLine.match(/Order placed: (\d+)/);
    if (match) {
      return BigInt(match[1]);
    }
  }
  return null;
}

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
 * Derive Trader Eligibility PDA
 * Seeds: ["trader_eligibility", trader_pubkey]
 */
export function deriveTraderEligibilityPda(trader: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TRADER_ELIGIBILITY_SEED, trader.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
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
  // Anchor format: [discriminator(8), side(1), order_type(1), encrypted_amount(64), encrypted_price(64), eligibility_proof(324)]
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
      log.debug('Exchange not initialized');
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

    log.debug('[ConfidexClient] Current order count:', { toString: orderCount.toString() });
    return orderCount;
  } catch (error) {
    log.error('Error fetching order count', { error: error instanceof Error ? error.message : String(error) });
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

  log.debug('Building place_order transaction...');

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);

  log.debug('[ConfidexClient] Exchange PDA:', { toString: exchangePda.toString() });
  log.debug('[ConfidexClient] Pair PDA:', { toString: pairPda.toString() });

  // Fetch current order count to derive order PDA
  const orderCount = await fetchOrderCount(connection);
  const [orderPda] = deriveOrderPda(maker, orderCount);

  log.debug('[ConfidexClient] Order PDA:', { toString: orderPda.toString() });
  log.debug('[ConfidexClient] Order count:', { toString: orderCount.toString() });

  // Build instruction data
  const instructionData = buildPlaceOrderData(
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof
  );

  log.debug('[ConfidexClient] Instruction data length:', { length: instructionData.length });

  // Determine which token mint the user is spending
  // Buy orders spend quote (USDC), sell orders spend base (SOL)
  const spendMint = side === Side.Buy ? quoteMint : baseMint;
  const [userBalancePda] = deriveUserBalancePda(maker, spendMint);

  log.debug('[ConfidexClient] User balance PDA:', { toString: userBalancePda.toString() });
  log.debug('[ConfidexClient] Spending mint:', { toString: spendMint.toString() });

  // Build instruction with required accounts
  // PlaceOrder accounts (from place_order.rs):
  // 1. exchange (mut) - ExchangeState PDA
  // 2. pair (mut) - TradingPair PDA
  // 3. order (init, mut) - ConfidentialOrder PDA
  // 4. user_balance (mut) - User's confidential balance for the token being spent
  // 5. verifier_program - Sunspot ZK verifier
  // 6. maker (signer, mut)
  // 7. system_program
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
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

  log.debug('Transaction built successfully');

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
      log.debug('[ConfidexClient] No balance account found for', { toString: mint.toString() });
      return { balance: BigInt(0), account: null };
    }

    const account = parseUserConfidentialBalance(accountInfo.data);
    const balance = getBalanceFromEncrypted(account.encryptedBalance);

    console.log('[ConfidexClient] Fetched balance:', balance.toString(), 'for mint:', mint.toString());

    return { balance, account };
  } catch (error) {
    log.error('Error fetching user balance', { error: error instanceof Error ? error.message : String(error) });
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
      log.debug('Trading pair not found');
      return null;
    }

    const pair = parseTradingPair(accountInfo.data);
    log.debug('[ConfidexClient] Fetched trading pair:', { toString: pairPda.toString() });
    return pair;
  } catch (error) {
    log.error('Error fetching trading pair', { error: error instanceof Error ? error.message : String(error) });
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

  log.debug('Building wrap instructions...');
  log.debug('  Token mint:', { toString: tokenMint.toString() });
  log.debug('  Amount:', { toString: amount.toString() });

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
    log.debug('Handling native SOL wrapping...');

    // Check if WSOL ATA exists
    const ataInfo = await connection.getAccountInfo(userTokenAccount);

    if (!ataInfo) {
      log.debug('Creating WSOL ATA...');
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
    log.debug('Adding SOL transfer to WSOL ATA...');
    instructions.push(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: userTokenAccount,
        lamports: BigInt(amount),
      })
    );

    // Sync native to update WSOL balance
    log.debug('Adding sync native instruction...');
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

  log.debug('[ConfidexClient] Wrap instructions built:', { length: instructions.length });

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

  log.debug('Building wrap_tokens transaction...');
  log.debug('  Token mint:', { toString: tokenMint.toString() });
  log.debug('  Amount:', { toString: amount.toString() });

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

  log.debug('Accounts:');
  log.debug('  Exchange:', { toString: exchangePda.toString() });
  log.debug('  Pair:', { toString: pairPda.toString() });
  log.debug('  Token Mint:', { toString: tokenMint.toString() });
  log.debug('  User Token Account:', { toString: userTokenAccount.toString() });
  log.debug('  Vault:', { toString: vault.toString() });
  log.debug('  User Balance PDA:', { toString: userBalancePda.toString() });

  // Build transaction
  const transaction = new Transaction();

  // Check if this is native SOL (WSOL)
  const isNativeSol = tokenMint.equals(NATIVE_MINT);

  if (isNativeSol) {
    log.debug('Handling native SOL wrapping...');

    // Check if WSOL ATA exists
    const ataInfo = await connection.getAccountInfo(userTokenAccount);

    if (!ataInfo) {
      log.debug('Creating WSOL ATA...');
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
    log.debug('Adding SOL transfer to WSOL ATA...');
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: user,
        toPubkey: userTokenAccount,
        lamports: BigInt(amount),
      })
    );

    // Sync native to update WSOL balance
    log.debug('Adding sync native instruction...');
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

  log.debug('Wrap transaction built successfully');
  log.debug('  Total instructions:', { length: transaction.instructions.length });

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

  log.debug('Building unwrap_tokens transaction...');
  log.debug('  Token mint:', { toString: tokenMint.toString() });
  log.debug('  Amount:', { toString: amount.toString() });

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

  log.debug('Accounts:');
  log.debug('  Exchange:', { toString: exchangePda.toString() });
  log.debug('  Pair:', { toString: pairPda.toString() });
  log.debug('  Token Mint:', { toString: tokenMint.toString() });
  log.debug('  User Token Account:', { toString: userTokenAccount.toString() });
  log.debug('  Vault:', { toString: vault.toString() });
  log.debug('  User Balance PDA:', { toString: userBalancePda.toString() });
  log.debug('  Is native SOL:', { isNativeSol: isNativeSol });

  // Build transaction
  const transaction = new Transaction();

  // For native SOL, ensure the WSOL ATA exists (it should from wrap, but check anyway)
  if (isNativeSol) {
    const ataInfo = await connection.getAccountInfo(userTokenAccount);
    if (!ataInfo) {
      log.debug('Creating WSOL ATA for unwrap...');
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
    log.debug('Adding close account instruction to convert WSOL -> SOL');
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

  log.debug('Unwrap transaction built successfully');
  log.debug('  Total instructions:', { length: transaction.instructions.length });

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

// Discriminator for open_position instruction (sha256("global:open_position")[0..8])
const OPEN_POSITION_DISCRIMINATOR = new Uint8Array([0x87, 0x80, 0x2f, 0x4d, 0x0f, 0x98, 0xf0, 0x31]);

// Discriminator for verify_eligibility instruction (sha256("global:verify_eligibility")[0..8])
const VERIFY_ELIGIBILITY_DISCRIMINATOR = new Uint8Array([0xa5, 0x0a, 0x92, 0xdd, 0x07, 0xf4, 0xef, 0x14]);

/**
 * Parameters for verify_eligibility instruction
 */
export interface VerifyEligibilityParams {
  connection: Connection;
  trader: PublicKey;
  eligibilityProof: Uint8Array;  // 324 bytes - Groth16 ZK proof
}

/**
 * Build verify_eligibility transaction
 * This must be called BEFORE open_position to verify ZK proof of blacklist non-membership
 *
 * Account order (from verify_eligibility.rs):
 * 1. exchange (read) - contains blacklist root
 * 2. eligibility (init_if_needed, mut) - stores verification result
 * 3. verifier_program (read) - Sunspot ZK verifier
 * 4. trader (signer, mut) - pays for account creation
 * 5. system_program (read)
 */
export async function buildVerifyEligibilityTransaction(
  params: VerifyEligibilityParams
): Promise<Transaction> {
  const { connection, trader, eligibilityProof } = params;

  log.debug('Building verify_eligibility transaction...');
  log.debug('  Trader:', { trader: trader.toString() });
  log.debug('  Proof size:', { size: eligibilityProof.length });

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [eligibilityPda] = deriveTraderEligibilityPda(trader);

  log.debug('PDAs derived:', {
    exchange: exchangePda.toString(),
    eligibility: eligibilityPda.toString(),
  });

  // Build instruction data
  // Layout: discriminator(8) + eligibility_proof(324)
  const dataSize = 8 + 324;
  const instructionData = Buffer.alloc(dataSize);
  let offset = 0;

  // Discriminator
  Buffer.from(VERIFY_ELIGIBILITY_DISCRIMINATOR).copy(instructionData, offset);
  offset += 8;

  // Eligibility proof (324 bytes for Groth16)
  const proofPadded = Buffer.alloc(324);
  Buffer.from(eligibilityProof.slice(0, Math.min(324, eligibilityProof.length))).copy(proofPadded);
  proofPadded.copy(instructionData, offset);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: eligibilityPda, isSigner: false, isWritable: true },
      { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: trader, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  const transaction = new Transaction();
  transaction.add(instruction);

  log.debug('Verify eligibility transaction built', { accounts: 5 });

  return transaction;
}

/**
 * Check if trader has valid eligibility on-chain
 */
export async function checkTraderEligibility(
  connection: Connection,
  trader: PublicKey
): Promise<{ isVerified: boolean; eligibilityPda: PublicKey }> {
  const [eligibilityPda] = deriveTraderEligibilityPda(trader);
  const accountInfo = await connection.getAccountInfo(eligibilityPda);

  if (!accountInfo) {
    return { isVerified: false, eligibilityPda };
  }

  // Parse TraderEligibility account
  // Layout: discriminator(8) + trader(32) + is_verified(1) + verified_blacklist_root(32) + ...
  const isVerified = accountInfo.data[8 + 32] === 1;

  return { isVerified, eligibilityPda };
}

export interface OpenPositionParams {
  connection: Connection;
  trader: PublicKey;
  underlyingMint: PublicKey;  // SOL mint for SOL-PERP
  quoteMint: PublicKey;       // USDC mint
  side: PositionSide;
  leverage: number;
  encryptedSize: Uint8Array;           // 64 bytes - encrypted position size
  encryptedEntryPrice: Uint8Array;     // 64 bytes - encrypted entry price
  positionNonce: Uint8Array;           // 8 bytes - nonce for hash-based position ID
  collateralAmount: bigint;            // Plaintext collateral for SPL transfer (USDC with 6 decimals)
                                       // NOTE: Temporary fallback until C-SPL SDK available
  // REMOVED in V3 (two-instruction pattern):
  // - encryptedCollateral: derived from collateralAmount on-chain
  // - encryptedLiqThreshold: computed by MPC from entry_price + leverage
  // - eligibilityProof: verified separately via verify_eligibility instruction
}

/**
 * Fetch perpetual market data from on-chain account
 */
export async function fetchPerpMarketData(
  connection: Connection,
  underlyingMint: PublicKey
): Promise<{ positionCount: bigint; oraclePriceFeed: PublicKey; collateralVault: PublicKey; arciumCluster: PublicKey } | null> {
  const [marketPda] = derivePerpMarketPda(underlyingMint);
  const accountInfo = await connection.getAccountInfo(marketPda);

  if (!accountInfo) {
    return null;
  }

  // Parse the PerpetualMarket account data
  // Layout (after 8-byte discriminator):
  // underlying_mint: 32, quote_mint: 32, max_leverage: 1, maintenance_margin_bps: 2,
  // initial_margin_bps: 2, taker_fee_bps: 2, maker_fee_bps: 2, liquidation_fee_bps: 2,
  // min_position_size: 8, tick_size: 8, max_open_interest: 8, total_long_oi: 8, total_short_oi: 8,
  // position_count: 8, index: 8, last_funding_time: 8, cumulative_funding_long: 16, cumulative_funding_short: 16,
  // oracle_price_feed: 32, collateral_vault: 32, insurance_fund: 32, insurance_fund_target: 8,
  // fee_recipient: 32, c_quote_mint: 32, arcium_cluster: 32, active: 1, bump: 1
  const data = accountInfo.data;

  // Skip discriminator (8) + underlying_mint(32) + quote_mint(32) + max_leverage(1) +
  // maintenance_margin_bps(2) + initial_margin_bps(2) + taker_fee_bps(2) + maker_fee_bps(2) +
  // liquidation_fee_bps(2) + min_position_size(8) + tick_size(8) + max_open_interest(8) +
  // total_long_oi(8) + total_short_oi(8) = 123 bytes offset to position_count
  const positionCountOffset = 8 + 32 + 32 + 1 + 2 + 2 + 2 + 2 + 2 + 8 + 8 + 8 + 8 + 8;
  const positionCount = data.readBigUInt64LE(positionCountOffset);

  // oracle_price_feed offset = position_count(8) + index(8) + last_funding_time(8) +
  // cumulative_funding_long(16) + cumulative_funding_short(16) = 56 more bytes
  const oracleOffset = positionCountOffset + 8 + 8 + 8 + 16 + 16;
  const oraclePriceFeed = new PublicKey(data.slice(oracleOffset, oracleOffset + 32));

  // collateral_vault is right after oracle_price_feed
  const collateralVault = new PublicKey(data.slice(oracleOffset + 32, oracleOffset + 64));

  // arcium_cluster offset = collateral_vault(32) + insurance_fund(32) + insurance_fund_target(8) +
  // fee_recipient(32) + c_quote_mint(32) = 136 more bytes
  const arciumClusterOffset = oracleOffset + 32 + 32 + 32 + 8 + 32 + 32;
  const arciumCluster = new PublicKey(data.slice(arciumClusterOffset, arciumClusterOffset + 32));

  return { positionCount, oraclePriceFeed, collateralVault, arciumCluster };
}

/**
 * Build open_position transaction for perpetuals
 *
 * V3 Account order (from perp_open_position.rs - two-instruction pattern):
 * 1. exchange (read) - for blacklist root validation
 * 2. eligibility (read) - trader's ZK eligibility (must be verified via verify_eligibility first)
 * 3. perp_market (mut)
 * 4. funding_state (read)
 * 5. position (init, mut)
 * 6. oracle (read)
 * 7. trader_collateral_account (mut) - trader's USDC ATA
 * 8. collateral_vault (mut) - market's collateral vault
 * 9. trader (signer, mut)
 * 10. arcium_program (read)
 * 11. token_program (read) - SPL Token program for collateral transfer
 * 12. system_program (read)
 *
 * NOTE: ZK eligibility proof is verified separately via verify_eligibility instruction.
 * The trader must have a valid TraderEligibility account before calling open_position.
 */
export async function buildOpenPositionTransaction(
  params: OpenPositionParams
): Promise<Transaction> {
  const {
    connection,
    trader,
    underlyingMint,
    quoteMint,
    side,
    leverage,
    encryptedSize,
    encryptedEntryPrice,
    positionNonce,
    collateralAmount,
  } = params;

  log.debug('Building open_position transaction (V3 - two-instruction pattern)...');
  log.debug('  Trader:', { trader: trader.toString() });
  log.debug('  Quote mint (USDC):', { quoteMint: quoteMint.toString() });
  log.debug('  Side:', { side: side === PositionSide.Long ? 'Long' : 'Short' });
  log.debug('  Leverage:', { leverage });
  log.debug('  Collateral amount (USDC micros):', { collateralAmount: collateralAmount.toString() });

  // Fetch market data to get position count and oracle
  const marketData = await fetchPerpMarketData(connection, underlyingMint);
  if (!marketData) {
    throw new Error('Perpetual market not initialized');
  }

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [eligibilityPda] = deriveTraderEligibilityPda(trader);
  const [perpMarketPda] = derivePerpMarketPda(underlyingMint);
  const [fundingStatePda] = deriveFundingPda(perpMarketPda);
  const [positionPda] = derivePositionPda(trader, perpMarketPda, marketData.positionCount);

  // Check if trader has verified eligibility
  const eligibilityInfo = await connection.getAccountInfo(eligibilityPda);
  if (!eligibilityInfo) {
    throw new Error(
      `Trader eligibility not verified. Please call verify_eligibility first with a valid ZK proof. ` +
      `Eligibility PDA: ${eligibilityPda.toString()}`
    );
  }

  // Get trader's collateral ATA (USDC)
  const traderCollateralAta = await getAssociatedTokenAddress(quoteMint, trader);

  // Check if trader has the USDC ATA and sufficient balance
  const traderAtaInfo = await connection.getAccountInfo(traderCollateralAta);
  if (!traderAtaInfo) {
    throw new Error(
      `No USDC token account found at ${traderCollateralAta.toString()}. ` +
      `Please get devnet USDC from a faucet first. ` +
      `Required: ${Number(collateralAmount) / 1e6} USDC for collateral.`
    );
  }

  // Check token balance
  try {
    const tokenBalance = await connection.getTokenAccountBalance(traderCollateralAta);
    const balanceMicros = BigInt(tokenBalance.value.amount);
    log.debug('Trader USDC balance:', {
      ata: traderCollateralAta.toString(),
      balance: tokenBalance.value.uiAmountString,
      required: (Number(collateralAmount) / 1e6).toFixed(2),
    });

    if (balanceMicros < collateralAmount) {
      throw new Error(
        `Insufficient USDC balance. Have: ${tokenBalance.value.uiAmountString} USDC, ` +
        `Need: ${(Number(collateralAmount) / 1e6).toFixed(2)} USDC for collateral.`
      );
    }
  } catch (balanceError) {
    if (balanceError instanceof Error && balanceError.message.includes('Insufficient')) {
      throw balanceError;
    }
    log.warn('Could not verify token balance', { error: balanceError });
  }

  log.debug('PDAs derived:', {
    exchange: exchangePda.toString(),
    eligibility: eligibilityPda.toString(),
    perpMarket: perpMarketPda.toString(),
    fundingState: fundingStatePda.toString(),
    position: positionPda.toString(),
    oracle: marketData.oraclePriceFeed.toString(),
  });

  // Build instruction data
  // V3 Layout: discriminator(8) + side(1) + leverage(1) + collateral_amount(8) + position_nonce(8) +
  //            encrypted_size(64) + encrypted_entry_price(64)
  // Total: 8 + 1 + 1 + 8 + 8 + 64 + 64 = 154 bytes
  const dataSize = 8 + 1 + 1 + 8 + 8 + 64 + 64;
  const instructionData = Buffer.alloc(dataSize);
  let offset = 0;

  // Discriminator
  Buffer.from(OPEN_POSITION_DISCRIMINATOR).copy(instructionData, offset);
  offset += 8;

  // Side (u8 enum: Long=0, Short=1)
  instructionData.writeUInt8(side, offset);
  offset += 1;

  // Leverage (u8)
  instructionData.writeUInt8(leverage, offset);
  offset += 1;

  // Collateral amount (u64) - plaintext for SPL transfer fallback
  instructionData.writeBigUInt64LE(collateralAmount, offset);
  offset += 8;

  // Position nonce (8 bytes) - for hash-based position ID (anti-correlation)
  Buffer.from(positionNonce).copy(instructionData, offset);
  offset += 8;

  // Encrypted size (64 bytes)
  Buffer.from(encryptedSize).copy(instructionData, offset);
  offset += 64;

  // Encrypted entry price (64 bytes)
  Buffer.from(encryptedEntryPrice).copy(instructionData, offset);

  // Arcium program ID for MPC verification
  const arciumProgramId = new PublicKey('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ');

  // SPL Token program for collateral transfer
  const tokenProgramId = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: eligibilityPda, isSigner: false, isWritable: false },
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: fundingStatePda, isSigner: false, isWritable: false },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: marketData.oraclePriceFeed, isSigner: false, isWritable: false },
      { pubkey: traderCollateralAta, isSigner: false, isWritable: true },
      { pubkey: marketData.collateralVault, isSigner: false, isWritable: true },
      { pubkey: trader, isSigner: true, isWritable: true },
      { pubkey: arciumProgramId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  const transaction = new Transaction();
  transaction.add(instruction);

  log.debug('Open position transaction built (V3)', { accounts: 12 });

  return transaction;
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

  log.debug('Building auto-wrap + place_order transaction...');
  console.log('  Side:', side === Side.Buy ? 'Buy' : 'Sell');
  log.debug('  Wrap token:', { toString: wrapTokenMint.toString() });
  log.debug('  Wrap amount:', { toString: wrapAmount.toString() });

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

  // Determine which token mint the user is spending
  // Buy orders spend quote (USDC), sell orders spend base (SOL)
  const spendMint = side === Side.Buy ? quoteMint : baseMint;
  const [userBalancePda] = deriveUserBalancePda(maker, spendMint);

  log.debug('[ConfidexClient] Order PDA:', { toString: orderPda.toString() });
  log.debug('[ConfidexClient] Order count:', { toString: orderCount.toString() });
  log.debug('[ConfidexClient] User balance PDA:', { toString: userBalancePda.toString() });
  log.debug('[ConfidexClient] Spending mint:', { toString: spendMint.toString() });

  // Build instruction data
  const instructionData = buildPlaceOrderData(
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof
  );

  // Build place_order instruction with accounts (matching place_order.rs):
  // 1. exchange (mut) - ExchangeState PDA
  // 2. pair (mut) - TradingPair PDA
  // 3. order (init, mut) - ConfidentialOrder PDA
  // 4. user_balance (mut) - User's confidential balance for the token being spent
  // 5. verifier_program - Sunspot ZK verifier
  // 6. maker (signer, mut)
  // 7. system_program
  const placeOrderInstruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: true },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: userBalancePda, isSigner: false, isWritable: true },
      { pubkey: VERIFIER_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: maker, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  transaction.add(placeOrderInstruction);

  log.debug('Added place_order instruction');

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = maker;

  log.debug('Auto-wrap + place_order transaction built');
  log.debug('  Total instructions:', { length: transaction.instructions.length });

  // Estimate transaction size
  const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  console.log('  Estimated size:', serialized.length, 'bytes (max 1232)');

  return transaction;
}

// ============================================
// ORDER MATCHING (MPC)
// ============================================

/**
 * Order status enum (matching Anchor)
 */
export enum OrderStatus {
  Open = 0,
  PartiallyFilled = 1,
  Filled = 2,
  Cancelled = 3,
  Matching = 4,
}

/**
 * ConfidentialOrder account layout
 */
export interface ConfidentialOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: Uint8Array; // 64 bytes
  encryptedPrice: Uint8Array;  // 64 bytes
  encryptedFilled: Uint8Array; // 64 bytes
  status: OrderStatus;
  createdAt: bigint;
  orderId: bigint;
  eligibilityProofVerified: boolean;
  pendingMatchRequest: Uint8Array; // 32 bytes
  bump: number;
}

/**
 * Parse ConfidentialOrder from account data
 */
export function parseConfidentialOrder(data: Buffer): ConfidentialOrder {
  // Skip 8-byte discriminator
  let offset = 8;

  const maker = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const pair = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  const side = data.readUInt8(offset) as Side;
  offset += 1;

  const orderType = data.readUInt8(offset) as OrderType;
  offset += 1;

  const encryptedAmount = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedPrice = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const encryptedFilled = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  const status = data.readUInt8(offset) as OrderStatus;
  offset += 1;

  const createdAt = data.readBigInt64LE(offset);
  offset += 8;

  const orderId = data.readBigUInt64LE(offset);
  offset += 8;

  const eligibilityProofVerified = data.readUInt8(offset) === 1;
  offset += 1;

  const pendingMatchRequest = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  const bump = data.readUInt8(offset);

  return {
    maker,
    pair,
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    encryptedFilled,
    status,
    createdAt,
    orderId,
    eligibilityProofVerified,
    pendingMatchRequest,
    bump,
  };
}

/**
 * Fetch a ConfidentialOrder by its PDA
 */
export async function fetchOrder(
  connection: Connection,
  orderPda: PublicKey
): Promise<ConfidentialOrder | null> {
  try {
    const accountInfo = await connection.getAccountInfo(orderPda);
    if (!accountInfo) {
      log.debug('Order not found:', { toString: orderPda.toString() });
      return null;
    }
    return parseConfidentialOrder(accountInfo.data);
  } catch (error) {
    log.error('Error fetching order', { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

/**
 * Fetch all open orders for a trading pair
 */
export async function fetchOpenOrdersForPair(
  connection: Connection,
  pairPda: PublicKey
): Promise<{ pda: PublicKey; order: ConfidentialOrder }[]> {
  try {
    const accounts = await connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
      filters: [
        { dataSize: 317 }, // ConfidentialOrder account size
        { memcmp: { offset: 8 + 32, bytes: pairPda.toBase58() } }, // pair field at offset 40
      ],
    });

    const orders: { pda: PublicKey; order: ConfidentialOrder }[] = [];
    for (const { pubkey, account } of accounts) {
      const order = parseConfidentialOrder(account.data);
      // Filter for open/partially filled orders
      if (order.status === OrderStatus.Open || order.status === OrderStatus.PartiallyFilled) {
        orders.push({ pda: pubkey, order });
      }
    }

    log.debug('Found open orders:', { count: orders.length });
    return orders;
  } catch (error) {
    log.error('Error fetching open orders', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Derive MPC Computation Request PDA
 * Seeds: ["computation", computation_count.to_le_bytes()]
 * The computation_count must be fetched from MxeConfig
 */
export function deriveComputationRequestPda(
  computationCount: bigint
): [PublicKey, number] {
  const countBuf = Buffer.alloc(8);
  countBuf.writeBigUInt64LE(computationCount);
  return PublicKey.findProgramAddressSync(
    [COMPUTATION_SEED, countBuf],
    MXE_PROGRAM_ID
  );
}

/**
 * Fetch MXE Config and return the current computation count
 */
export async function fetchMxeComputationCount(
  connection: Connection
): Promise<bigint> {
  const mxeConfigPda = new PublicKey(MXE_CONFIG_PDA);
  const accountInfo = await connection.getAccountInfo(mxeConfigPda);

  if (!accountInfo) {
    throw new Error('MXE Config not found - MXE not initialized');
  }

  // Parse computation_count from MxeConfig
  // Layout: discriminator(8) + authority(32) + cluster_id(32) + cluster_offset(2) + arcium_program(32) + computation_count(8)
  const offset = 8 + 32 + 32 + 2 + 32; // = 106
  const computationCount = accountInfo.data.readBigUInt64LE(offset);

  log.debug('MXE computation count:', { count: computationCount.toString() });
  return computationCount;
}

export interface MatchOrdersParams {
  connection: Connection;
  crank: PublicKey;
  buyOrderPda: PublicKey;
  sellOrderPda: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  useAsyncMpc?: boolean; // Whether to use async MPC flow (default: true)
}

/**
 * Build match_orders transaction
 *
 * This transaction matches a buy order with a sell order. In async MPC mode,
 * it queues the price comparison computation and the orders transition to "Matching" status.
 *
 * Accounts (from match_orders.rs):
 * 1. exchange - ExchangeState PDA
 * 2. pair (mut) - TradingPair PDA
 * 3. buy_order (mut) - Buy ConfidentialOrder PDA
 * 4. sell_order (mut) - Sell ConfidentialOrder PDA
 * 5. arcium_program - Arcium MXE program
 * 6. mxe_config (mut, optional) - MXE config for async MPC
 * 7. mpc_request (mut, optional) - MPC request account for async MPC
 * 8. system_program
 * 9. crank (signer, mut) - Anyone can crank
 */
export async function buildMatchOrdersTransaction(
  params: MatchOrdersParams
): Promise<Transaction> {
  const {
    connection,
    crank,
    buyOrderPda,
    sellOrderPda,
    baseMint,
    quoteMint,
    useAsyncMpc = true,
  } = params;

  log.debug('Building match_orders transaction...');
  log.debug('  Buy order:', { toString: buyOrderPda.toString() });
  log.debug('  Sell order:', { toString: sellOrderPda.toString() });
  log.debug('  Async MPC:', { useAsyncMpc });

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);

  // Prepare accounts - order must match Anchor struct exactly:
  // 1. exchange, 2. pair, 3. buy_order, 4. sell_order, 5. arcium_program
  // 6. mxe_config (optional), 7. mpc_request (optional), 8. system_program, 9. crank
  const accounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [
    { pubkey: exchangePda, isSigner: false, isWritable: false },
    { pubkey: pairPda, isSigner: false, isWritable: true },
    { pubkey: buyOrderPda, isSigner: false, isWritable: true },
    { pubkey: sellOrderPda, isSigner: false, isWritable: true },
    { pubkey: MXE_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Add MXE accounts for async MPC flow, or placeholders for sync flow
  // Anchor's Option<AccountInfo> requires accounts at fixed positions - we use program ID as None placeholder
  if (useAsyncMpc) {
    const mxeConfigPda = new PublicKey(MXE_CONFIG_PDA);

    // Fetch current computation count to derive the correct request PDA
    const computationCount = await fetchMxeComputationCount(connection);
    const [computationRequestPda] = deriveComputationRequestPda(computationCount);

    accounts.push({ pubkey: mxeConfigPda, isSigner: false, isWritable: true });
    accounts.push({ pubkey: computationRequestPda, isSigner: false, isWritable: true });

    log.debug('  MXE Config:', { toString: mxeConfigPda.toString() });
    log.debug('  Computation Request PDA:', { toString: computationRequestPda.toString() });
    log.debug('  Computation count:', { count: computationCount.toString() });
  } else {
    // For sync flow, pass program ID as None placeholder for optional accounts
    // Anchor interprets program_id pubkey as None for Option<AccountInfo>
    accounts.push({ pubkey: CONFIDEX_PROGRAM_ID, isSigner: false, isWritable: false }); // mxe_config = None
    accounts.push({ pubkey: CONFIDEX_PROGRAM_ID, isSigner: false, isWritable: false }); // mpc_request = None
    log.debug('  Sync MPC flow - optional accounts set to None (program ID placeholder)');
  }

  accounts.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });
  accounts.push({ pubkey: crank, isSigner: true, isWritable: true });

  // Build instruction (no additional data beyond discriminator)
  const instruction = new TransactionInstruction({
    keys: accounts,
    programId: CONFIDEX_PROGRAM_ID,
    data: Buffer.from(MATCH_ORDERS_DISCRIMINATOR),
  });

  const transaction = new Transaction().add(instruction);

  // Get recent blockhash
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = crank;

  log.debug('Match transaction built successfully');

  return transaction;
}

/**
 * Find matchable order pairs
 * Returns buy/sell order pairs that could potentially match
 */
export async function findMatchableOrders(
  connection: Connection,
  baseMint: PublicKey,
  quoteMint: PublicKey
): Promise<{ buyOrder: { pda: PublicKey; order: ConfidentialOrder }; sellOrder: { pda: PublicKey; order: ConfidentialOrder } }[]> {
  const [pairPda] = derivePairPda(baseMint, quoteMint);
  const openOrders = await fetchOpenOrdersForPair(connection, pairPda);

  const buyOrders = openOrders.filter(o => o.order.side === Side.Buy && o.order.eligibilityProofVerified);
  const sellOrders = openOrders.filter(o => o.order.side === Side.Sell && o.order.eligibilityProofVerified);

  const matchable: { buyOrder: { pda: PublicKey; order: ConfidentialOrder }; sellOrder: { pda: PublicKey; order: ConfidentialOrder } }[] = [];

  // In a real system, we'd do encrypted price comparison via MPC
  // For now, we just return all buy/sell pairs as potential matches
  // The on-chain match_orders will verify via MPC
  for (const buy of buyOrders) {
    for (const sell of sellOrders) {
      // Don't match orders from the same maker
      if (!buy.order.maker.equals(sell.order.maker)) {
        matchable.push({ buyOrder: buy, sellOrder: sell });
      }
    }
  }

  log.debug('Found matchable pairs:', { count: matchable.length });
  return matchable;
}

/**
 * Get the plaintext value from an encrypted field (development mode only)
 * In production, this would not be possible without the decryption key
 */
export function getPlaintextFromEncrypted(encrypted: Uint8Array): bigint {
  const bytes = encrypted.slice(0, 8);
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  return view.getBigUint64(0, true);
}

// ============================================================================
// CANCEL ORDER
// ============================================================================

export interface CancelOrderParams {
  connection: Connection;
  maker: PublicKey;
  orderId: bigint;
  baseMint: PublicKey;
  quoteMint: PublicKey;
}

/**
 * Build a transaction to cancel an open order
 *
 * @param params - Cancel order parameters
 * @returns Transaction to sign and send
 */
export async function buildCancelOrderTransaction(
  params: CancelOrderParams
): Promise<Transaction> {
  const { connection, maker, orderId, baseMint, quoteMint } = params;

  log.debug('Building cancel order transaction', {
    maker: maker.toBase58(),
    orderId: orderId.toString(),
  });

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);
  const [orderPda] = deriveOrderPda(maker, orderId);

  log.debug('Cancel order PDAs', {
    exchange: exchangePda.toBase58(),
    pair: pairPda.toBase58(),
    order: orderPda.toBase58(),
  });

  // Build cancel instruction (no additional data needed beyond discriminator)
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: maker, isSigner: true, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: Buffer.from(CANCEL_ORDER_DISCRIMINATOR),
  });

  // Build transaction
  const transaction = new Transaction().add(instruction);
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = maker;

  log.debug('Cancel order transaction built successfully');

  return transaction;
}

// ============================================================================
// CLOSE POSITION FUNCTIONS
// ============================================================================

/**
 * Parameters for closing a perpetual position
 */
export interface ClosePositionParams {
  connection: Connection;
  trader: PublicKey;
  perpMarketPda: PublicKey;
  positionId: bigint;
  underlyingMint: PublicKey;
  /** Encrypted close size (64 bytes) - ignored if fullClose is true */
  encryptedCloseSize: Uint8Array;
  /** Encrypted exit price (64 bytes) - should match oracle */
  encryptedExitPrice: Uint8Array;
  /** Whether to close the entire position */
  fullClose: boolean;
  /** Oracle price feed account (e.g., Pyth SOL/USD) */
  oraclePriceFeed: PublicKey;
  /** Collateral vault PDA */
  collateralVault: PublicKey;
  /** Fee recipient account */
  feeRecipient: PublicKey;
  /** Arcium program for MPC calculations */
  arciumProgram: PublicKey;
}

/**
 * Build a transaction to close a perpetual position
 *
 * @param params - Close position parameters
 * @returns Transaction to sign and send
 */
export async function buildClosePositionTransaction(
  params: ClosePositionParams
): Promise<Transaction> {
  const {
    connection,
    trader,
    perpMarketPda,
    positionId,
    encryptedCloseSize,
    encryptedExitPrice,
    fullClose,
    oraclePriceFeed,
    collateralVault,
    feeRecipient,
    arciumProgram,
  } = params;

  log.debug('Building close position transaction', {
    trader: trader.toBase58(),
    perpMarket: perpMarketPda.toBase58(),
    positionId: positionId.toString(),
    fullClose,
  });

  // Derive position PDA
  const [positionPda] = derivePositionPda(trader, perpMarketPda, positionId);

  // Get trader's collateral token account (USDC ATA)
  const traderCollateralAccount = await getAssociatedTokenAddress(
    new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'), // Dummy USDC devnet
    trader
  );

  log.debug('Close position PDAs', {
    perpMarket: perpMarketPda.toBase58(),
    position: positionPda.toBase58(),
    oracle: oraclePriceFeed.toBase58(),
    collateralVault: collateralVault.toBase58(),
  });

  // Build instruction data: discriminator + ClosePositionParams
  // ClosePositionParams: encrypted_close_size[64] + encrypted_exit_price[64] + full_close[1]
  const instructionData = Buffer.alloc(8 + 64 + 64 + 1);
  Buffer.from(CLOSE_POSITION_DISCRIMINATOR).copy(instructionData, 0);
  Buffer.from(encryptedCloseSize).copy(instructionData, 8);
  Buffer.from(encryptedExitPrice).copy(instructionData, 72);
  instructionData.writeUInt8(fullClose ? 1 : 0, 136);

  // Build close position instruction
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: oraclePriceFeed, isSigner: false, isWritable: false },
      { pubkey: traderCollateralAccount, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: feeRecipient, isSigner: false, isWritable: true },
      { pubkey: trader, isSigner: true, isWritable: true },
      { pubkey: arciumProgram, isSigner: false, isWritable: false },
    ],
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  // Build transaction
  const transaction = new Transaction().add(instruction);
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = trader;

  log.debug('Close position transaction built successfully');

  return transaction;
}

/**
 * Create encrypted values for close position
 * Uses hybrid encryption format: [plaintext(8) | nonce(8) | ciphertext(32) | ephemeral_pubkey(16)]
 */
export function createHybridEncryptedValue(value: bigint): Uint8Array {
  const encrypted = new Uint8Array(64);
  // Write plaintext value in first 8 bytes (for oracle validation)
  const valueBuf = Buffer.alloc(8);
  valueBuf.writeBigUInt64LE(value);
  encrypted.set(valueBuf, 0);
  // Rest is zeros for now (would be filled by Arcium encryption in production)
  return encrypted;
}

// ============================================================================
// POSITION FETCHING (V2 - Full Privacy Model)
// ============================================================================

/**
 * Position status enum (matching on-chain Rust enum)
 */
export enum PositionStatusEnum {
  Open = 0,
  Closed = 1,
  Liquidated = 2,
  AutoDeleveraged = 3,
  PendingLiquidationCheck = 4,
}

/**
 * ConfidentialPosition account layout (561 bytes total)
 * V2 with encrypted liquidation thresholds
 */
export interface ConfidentialPositionAccount {
  trader: PublicKey;
  market: PublicKey;
  positionId: Uint8Array;       // 16 bytes - hash-based ID
  createdAtHour: bigint;        // Hour-precision timestamp
  lastUpdatedHour: bigint;      // Hour-precision timestamp
  side: PositionSide;           // Long=0, Short=1
  leverage: number;
  // Encrypted core data (256 bytes)
  encryptedSize: Uint8Array;          // 64 bytes
  encryptedEntryPrice: Uint8Array;    // 64 bytes
  encryptedCollateral: Uint8Array;    // 64 bytes
  encryptedRealizedPnl: Uint8Array;   // 64 bytes
  // Encrypted liquidation thresholds (128 bytes)
  encryptedLiqBelow: Uint8Array;      // 64 bytes
  encryptedLiqAbove: Uint8Array;      // 64 bytes
  thresholdCommitment: Uint8Array;    // 32 bytes
  lastThresholdUpdateHour: bigint;
  thresholdVerified: boolean;
  // Funding
  entryCumulativeFunding: bigint;     // i128 stored as 16 bytes
  // Status
  status: PositionStatusEnum;
  eligibilityProofVerified: boolean;
  partialCloseCount: number;
  // Auto-deleverage
  autoDeleveragePriority: bigint;
  // Margin management
  lastMarginAddHour: bigint;
  marginAddCount: number;
  bump: number;
}

/**
 * Parse ConfidentialPosition from on-chain account data
 * Layout matches programs/confidex_dex/src/state/position.rs
 * Total size: 561 bytes (8 discriminator + 553 data)
 */
export function parseConfidentialPosition(data: Buffer): ConfidentialPositionAccount {
  // Skip 8-byte Anchor discriminator
  let offset = 8;

  // trader: Pubkey (32 bytes)
  const trader = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // market: Pubkey (32 bytes)
  const market = new PublicKey(data.subarray(offset, offset + 32));
  offset += 32;

  // position_id: [u8; 16] - hash-based ID
  const positionId = new Uint8Array(data.subarray(offset, offset + 16));
  offset += 16;

  // created_at_hour: i64 (8 bytes)
  const createdAtHour = data.readBigInt64LE(offset);
  offset += 8;

  // last_updated_hour: i64 (8 bytes)
  const lastUpdatedHour = data.readBigInt64LE(offset);
  offset += 8;

  // side: u8 enum (1 byte)
  const side = data.readUInt8(offset) as PositionSide;
  offset += 1;

  // leverage: u8 (1 byte)
  const leverage = data.readUInt8(offset);
  offset += 1;

  // encrypted_size: [u8; 64]
  const encryptedSize = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  // encrypted_entry_price: [u8; 64]
  const encryptedEntryPrice = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  // encrypted_collateral: [u8; 64]
  const encryptedCollateral = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  // encrypted_realized_pnl: [u8; 64]
  const encryptedRealizedPnl = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  // encrypted_liq_below: [u8; 64]
  const encryptedLiqBelow = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  // encrypted_liq_above: [u8; 64]
  const encryptedLiqAbove = new Uint8Array(data.subarray(offset, offset + 64));
  offset += 64;

  // threshold_commitment: [u8; 32]
  const thresholdCommitment = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  // last_threshold_update_hour: i64 (8 bytes)
  const lastThresholdUpdateHour = data.readBigInt64LE(offset);
  offset += 8;

  // threshold_verified: bool (1 byte)
  const thresholdVerified = data.readUInt8(offset) === 1;
  offset += 1;

  // entry_cumulative_funding: i128 (16 bytes)
  // Read as two i64s and combine (low then high)
  const fundingLow = data.readBigInt64LE(offset);
  offset += 8;
  const fundingHigh = data.readBigInt64LE(offset);
  offset += 8;
  const entryCumulativeFunding = fundingLow + (fundingHigh << BigInt(64));

  // status: u8 enum (1 byte)
  const status = data.readUInt8(offset) as PositionStatusEnum;
  offset += 1;

  // eligibility_proof_verified: bool (1 byte)
  const eligibilityProofVerified = data.readUInt8(offset) === 1;
  offset += 1;

  // partial_close_count: u8 (1 byte)
  const partialCloseCount = data.readUInt8(offset);
  offset += 1;

  // auto_deleverage_priority: u64 (8 bytes)
  const autoDeleveragePriority = data.readBigUInt64LE(offset);
  offset += 8;

  // last_margin_add_hour: i64 (8 bytes)
  const lastMarginAddHour = data.readBigInt64LE(offset);
  offset += 8;

  // margin_add_count: u8 (1 byte)
  const marginAddCount = data.readUInt8(offset);
  offset += 1;

  // bump: u8 (1 byte)
  const bump = data.readUInt8(offset);

  return {
    trader,
    market,
    positionId,
    createdAtHour,
    lastUpdatedHour,
    side,
    leverage,
    encryptedSize,
    encryptedEntryPrice,
    encryptedCollateral,
    encryptedRealizedPnl,
    encryptedLiqBelow,
    encryptedLiqAbove,
    thresholdCommitment,
    lastThresholdUpdateHour,
    thresholdVerified,
    entryCumulativeFunding,
    status,
    eligibilityProofVerified,
    partialCloseCount,
    autoDeleveragePriority,
    lastMarginAddHour,
    marginAddCount,
    bump,
  };
}

/**
 * Fetch all positions for a trader from on-chain
 * Uses getProgramAccounts with filters for the trader pubkey
 *
 * @param connection - Solana connection
 * @param trader - Trader's public key
 * @returns Array of positions with their PDAs
 */
export async function fetchUserPositions(
  connection: Connection,
  trader: PublicKey
): Promise<{ pda: PublicKey; position: ConfidentialPositionAccount }[]> {
  // Note: On-chain account size is 568 bytes (includes Anchor padding)
  // This differs from the calculated 561 bytes in position.rs due to alignment
  const POSITION_ACCOUNT_SIZE = 568;

  try {
    log.debug('Fetching user positions for', { trader: trader.toString() });

    // Use getProgramAccounts with filters:
    // 1. dataSize: 561 bytes (ConfidentialPosition account size)
    // 2. memcmp: trader pubkey at offset 8 (after discriminator)
    const accounts = await connection.getProgramAccounts(CONFIDEX_PROGRAM_ID, {
      filters: [
        { dataSize: POSITION_ACCOUNT_SIZE },
        { memcmp: { offset: 8, bytes: trader.toBase58() } },
      ],
    });

    const positions: { pda: PublicKey; position: ConfidentialPositionAccount }[] = [];

    for (const { pubkey, account } of accounts) {
      try {
        const position = parseConfidentialPosition(account.data);
        positions.push({ pda: pubkey, position });
        log.debug('Parsed position:', {
          pda: pubkey.toString(),
          side: position.side === PositionSide.Long ? 'Long' : 'Short',
          leverage: position.leverage,
          status: PositionStatusEnum[position.status],
        });
      } catch (parseError) {
        log.error('Failed to parse position account', {
          pda: pubkey.toString(),
          error: parseError instanceof Error ? parseError.message : String(parseError),
        });
      }
    }

    log.debug('Fetched positions:', { count: positions.length });
    return positions;
  } catch (error) {
    log.error('Error fetching user positions', {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Fetch open positions only (excludes closed/liquidated)
 */
export async function fetchOpenPositions(
  connection: Connection,
  trader: PublicKey
): Promise<{ pda: PublicKey; position: ConfidentialPositionAccount }[]> {
  const allPositions = await fetchUserPositions(connection, trader);
  return allPositions.filter(
    ({ position }) => position.status === PositionStatusEnum.Open
  );
}

/**
 * Fetch a single position by PDA
 */
export async function fetchPositionByPda(
  connection: Connection,
  positionPda: PublicKey
): Promise<ConfidentialPositionAccount | null> {
  try {
    const accountInfo = await connection.getAccountInfo(positionPda);
    if (!accountInfo) {
      log.debug('Position not found:', { pda: positionPda.toString() });
      return null;
    }
    return parseConfidentialPosition(accountInfo.data);
  } catch (error) {
    log.error('Error fetching position', {
      pda: positionPda.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Convert hex position ID to display string
 */
export function positionIdToString(positionId: Uint8Array): string {
  return Array.from(positionId)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
