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
import {
  CONFIDEX_PROGRAM_ID,
  VERIFIER_PROGRAM_ID,
  GROTH16_PROOF_SIZE,
  MXE_PROGRAM_ID,
  MXE_CONFIG_PDA,
  MXE_AUTHORITY_PDA,
  LIGHT_PROTOCOL_ENABLED,
  REGULAR_TOKEN_ACCOUNT_RENT_LAMPORTS,
  COMPRESSED_ACCOUNT_COST_LAMPORTS,
} from './constants';
import { getCompressionRpcSafe, isCompressionAvailable } from './light-rpc';
import {
  deriveArciumAccounts,
  arciumAccountsToAccountMetas,
  generateComputationOffset,
} from './arcium-accounts';
import BN from 'bn.js';

import { createLogger } from '@/lib/logger';

const log = createLogger('api');

// Anchor instruction discriminators (pre-computed sha256("global:<instruction_name>")[0..8])
const PLACE_ORDER_DISCRIMINATOR = new Uint8Array([0x33, 0xc2, 0x9b, 0xaf, 0x6d, 0x82, 0x60, 0x6a]);
const WRAP_TOKENS_DISCRIMINATOR = new Uint8Array([0xf4, 0x89, 0x39, 0xfb, 0xe8, 0xe0, 0x36, 0x0e]);
const UNWRAP_TOKENS_DISCRIMINATOR = new Uint8Array([0x11, 0x79, 0x03, 0xfa, 0x43, 0x69, 0xe8, 0x71]);
const MATCH_ORDERS_DISCRIMINATOR = new Uint8Array([0x11, 0x01, 0xc9, 0x5d, 0x07, 0x33, 0xfb, 0x86]);
const CANCEL_ORDER_DISCRIMINATOR = new Uint8Array([0x5f, 0x81, 0xed, 0xf0, 0x08, 0x31, 0xdf, 0x84]);
// DEPRECATED: Legacy close_position (panics in V7)
// sha256("global:close_position")[0..8]
const CLOSE_POSITION_DISCRIMINATOR = new Uint8Array([0x7b, 0x86, 0x51, 0x00, 0x31, 0x44, 0x62, 0x62]);
// V7: Use initiate_close_position instead of deprecated close_position
// sha256("global:initiate_close_position")[0..8]
const INITIATE_CLOSE_POSITION_DISCRIMINATOR = new Uint8Array([0x68, 0x62, 0xdd, 0x8b, 0xc8, 0x61, 0x6c, 0x85]);

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
 * Returns the order_id as a hex string if found, null otherwise
 *
 * The Rust program outputs: "Order placed: [byte1, byte2, ...] (side: Buy/Sell)"
 * where the order_id is a 16-byte array in debug format
 */
export function parseOrderPlacedEvent(logs: string[]): string | null {
  for (const logLine of logs) {
    // Match the Rust debug format: "Order placed: [0, 1, 2, ...] (side: ...)"
    const match = logLine.match(/Order placed: \[([^\]]+)\]/);
    if (match) {
      try {
        // Parse the comma-separated byte values
        const bytes = match[1].split(',').map((b) => parseInt(b.trim(), 10));
        if (bytes.length === 16 && bytes.every((b) => !isNaN(b) && b >= 0 && b <= 255)) {
          // Convert to hex string for display/storage
          return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
        }
      } catch {
        // Continue searching if parsing fails
      }
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
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [PAIR_SEED, baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
  console.log('[derivePairPda] Derived PDA:', pda.toString(), 'using program:', CONFIDEX_PROGRAM_ID.toString());
  return [pda, bump];
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
 * V5 format: No plaintext fields - pure privacy
 */
export function buildPlaceOrderData(
  side: Side,
  orderType: OrderType,
  encryptedAmount: Uint8Array,
  encryptedPrice: Uint8Array,
  eligibilityProof: Uint8Array,
  ephemeralPubkey: Uint8Array
): Buffer {
  // V5 Anchor format: [discriminator(8), side(1), order_type(1), encrypted_amount(64), encrypted_price(64), eligibility_proof(324), ephemeral_pubkey(32)]
  // Total instruction data: 8 + 1 + 1 + 64 + 64 + 324 + 32 = 494 bytes
  const data = Buffer.alloc(8 + 1 + 1 + 64 + 64 + GROTH16_PROOF_SIZE + 32);
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
  offset += GROTH16_PROOF_SIZE;

  // Ephemeral X25519 public key (32 bytes) for production MPC decryption
  Buffer.from(ephemeralPubkey).copy(data, offset);

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
  // Production MPC: Full 32-byte ephemeral X25519 public key for Arcium decryption
  ephemeralPubkey: Uint8Array;
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
 * Result from building a place order transaction
 */
export interface PlaceOrderResult {
  transaction: Transaction;
  /** The order nonce (from order_count) used to derive the order PDA - needed for cancel operations */
  orderNonce: bigint;
}

/**
 * Build place_order transaction
 */
export async function buildPlaceOrderTransaction(
  params: PlaceOrderParams
): Promise<PlaceOrderResult> {
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
    ephemeralPubkey,
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

  // Build instruction data (V5 format - no plaintext fields)
  const instructionData = buildPlaceOrderData(
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof,
    ephemeralPubkey
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

  return { transaction, orderNonce: orderCount };
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

    // Ensure data is a proper Buffer (web3.js may return Buffer or Uint8Array)
    const dataBuffer = Buffer.from(accountInfo.data);
    const pair = parseTradingPair(dataBuffer);
    console.log('[fetchTradingPair] Fetched pair PDA:', pairPda.toString());
    console.log('[fetchTradingPair] Parsed baseMint:', pair.baseMint.toString());
    console.log('[fetchTradingPair] Parsed quoteMint:', pair.quoteMint.toString());
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
  // Console.log for production debugging
  console.log('[getVaultForMint] Checking mint:', mint.toString());
  console.log('[getVaultForMint] Pair baseMint:', pair.baseMint.toString());
  console.log('[getVaultForMint] Pair quoteMint:', pair.quoteMint.toString());

  const baseMatch = mint.equals(pair.baseMint);
  const quoteMatch = mint.equals(pair.quoteMint);
  console.log('[getVaultForMint] baseMatch:', baseMatch, 'quoteMatch:', quoteMatch);

  if (baseMatch) {
    console.log('[getVaultForMint] Matched baseMint, returning cBaseVault');
    return pair.cBaseVault;
  } else if (quoteMatch) {
    console.log('[getVaultForMint] Matched quoteMint, returning cQuoteVault');
    return pair.cQuoteVault;
  }
  console.error('[getVaultForMint] No match found!', {
    mint: mint.toString(),
    baseMint: pair.baseMint.toString(),
    quoteMint: pair.quoteMint.toString(),
  });
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
  console.log('[WrapInstructions] Building with params:', {
    baseMint: baseMint.toString(),
    quoteMint: quoteMint.toString(),
    tokenMint: tokenMint.toString(),
    amount: amount.toString(),
  });

  // Fetch trading pair to get vault addresses
  const pair = await fetchTradingPair(connection, baseMint, quoteMint);
  if (!pair) {
    throw new Error('Trading pair not found');
  }

  console.log('[WrapInstructions] Fetched on-chain pair:', {
    baseMint: pair.baseMint.toString(),
    quoteMint: pair.quoteMint.toString(),
  });

  // Get the correct vault for this token
  const vault = getVaultForMint(pair, tokenMint);
  if (!vault) {
    console.error('[WrapInstructions] Token mint mismatch!', {
      tokenMint: tokenMint.toString(),
      pairBaseMint: pair.baseMint.toString(),
      pairQuoteMint: pair.quoteMint.toString(),
    });
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
): Promise<{
  positionCount: bigint;
  oraclePriceFeed: PublicKey;
  collateralVault: PublicKey;
  feeRecipient: PublicKey;
  arciumCluster: PublicKey;
} | null> {
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

  // collateral_vault is right after oracle_price_feed (offset 179 + 32 = 211)
  const collateralVaultOffset = oracleOffset + 32;
  const collateralVault = new PublicKey(data.slice(collateralVaultOffset, collateralVaultOffset + 32));

  // fee_recipient offset = collateral_vault + insurance_fund(32) + insurance_fund_target(8)
  // = 211 + 32 + 32 + 8 = 283
  const feeRecipientOffset = collateralVaultOffset + 32 + 32 + 8;
  const feeRecipient = new PublicKey(data.slice(feeRecipientOffset, feeRecipientOffset + 32));

  // arcium_cluster offset = fee_recipient(32) + c_quote_mint(32) = 283 + 64 = 347
  const arciumClusterOffset = feeRecipientOffset + 32 + 32;
  const arciumCluster = new PublicKey(data.slice(arciumClusterOffset, arciumClusterOffset + 32));

  return { positionCount, oraclePriceFeed, collateralVault, feeRecipient, arciumCluster };
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
): Promise<{ transaction: Transaction; positionPda: PublicKey }> {
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

  return { transaction, positionPda };
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
  // Production MPC: Full 32-byte ephemeral X25519 public key for Arcium decryption
  ephemeralPubkey: Uint8Array;
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
): Promise<PlaceOrderResult> {
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
    ephemeralPubkey,
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

  // Build instruction data (V5 format - no plaintext fields)
  const instructionData = buildPlaceOrderData(
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    eligibilityProof,
    ephemeralPubkey
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

  return { transaction, orderNonce: orderCount };
}

// ============================================
// ORDER MATCHING (MPC)
// ============================================

/**
 * Order status enum (matching Anchor V2 - simplified for privacy)
 * Only Active/Inactive exposed on-chain
 */
export enum OrderStatus {
  Active = 0,    // Order is active and can be matched
  Inactive = 1,  // Order is no longer active (filled or cancelled)
  // Legacy aliases for backwards compatibility
  Open = 0,
  PartiallyFilled = 0,
  Filled = 1,
  Cancelled = 1,
  Matching = 0,
}

/**
 * ConfidentialOrder account layout (V5)
 * Size: 366 bytes (8 discriminator + 358 data)
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
export interface ConfidentialOrder {
  maker: PublicKey;
  pair: PublicKey;
  side: Side;
  orderType: OrderType;
  encryptedAmount: Uint8Array;  // 64 bytes
  encryptedPrice: Uint8Array;   // 64 bytes
  encryptedFilled: Uint8Array;  // 64 bytes
  status: OrderStatus;
  createdAtHour: bigint;        // Coarse timestamp (hour precision)
  orderId: Uint8Array;          // 16 bytes (hash-based)
  orderNonce: Uint8Array;       // 8 bytes (for PDA derivation)
  eligibilityProofVerified: boolean;
  pendingMatchRequest: Uint8Array; // 32 bytes
  isMatching: boolean;
  bump: number;
  ephemeralPubkey: Uint8Array;  // 32 bytes - X25519 for MPC decryption
}

/**
 * Parse ConfidentialOrder from account data (V5 format - 366 bytes)
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

  const createdAtHour = data.readBigInt64LE(offset);
  offset += 8;

  const orderId = new Uint8Array(data.subarray(offset, offset + 16));
  offset += 16;

  const orderNonce = new Uint8Array(data.subarray(offset, offset + 8));
  offset += 8;

  const eligibilityProofVerified = data.readUInt8(offset) === 1;
  offset += 1;

  const pendingMatchRequest = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  const isMatching = data.readUInt8(offset) === 1;
  offset += 1;

  const bump = data.readUInt8(offset);
  offset += 1;

  const ephemeralPubkey = new Uint8Array(data.subarray(offset, offset + 32));

  return {
    maker,
    pair,
    side,
    orderType,
    encryptedAmount,
    encryptedPrice,
    encryptedFilled,
    status,
    createdAtHour,
    orderId,
    orderNonce,
    eligibilityProofVerified,
    pendingMatchRequest,
    isMatching,
    bump,
    ephemeralPubkey,
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
        { dataSize: 334 }, // ConfidentialOrder account size (8 discriminator + 326 data)
        { memcmp: { offset: 8 + 32, bytes: pairPda.toBase58() } }, // pair field at offset 40
      ],
    });

    const orders: { pda: PublicKey; order: ConfidentialOrder }[] = [];
    for (const { pubkey, account } of accounts) {
      const order = parseConfidentialOrder(account.data);
      // Filter for active orders (V2 status: Active = 0)
      if (order.status === OrderStatus.Active) {
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
    baseMint: baseMint.toBase58(),
    quoteMint: quoteMint.toBase58(),
  });

  // Derive PDAs
  const [exchangePda] = deriveExchangePda();
  const [pairPda] = derivePairPda(baseMint, quoteMint);
  const [orderPda] = deriveOrderPda(maker, orderId);

  // User balance PDAs - required for refund on cancel
  const [userBaseBalancePda] = deriveUserBalancePda(maker, baseMint);
  const [userQuoteBalancePda] = deriveUserBalancePda(maker, quoteMint);

  log.debug('Cancel order PDAs', {
    exchange: exchangePda.toBase58(),
    pair: pairPda.toBase58(),
    order: orderPda.toBase58(),
    userBaseBalance: userBaseBalancePda.toBase58(),
    userQuoteBalance: userQuoteBalancePda.toBase58(),
  });

  // Build cancel instruction
  // Account order must match CancelOrder struct in cancel_order.rs:
  // 1. exchange (read)
  // 2. pair (write)
  // 3. order (write)
  // 4. user_base_balance (write) - for sell order refunds
  // 5. user_quote_balance (write) - for buy order refunds
  // 6. maker (signer)
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: exchangePda, isSigner: false, isWritable: false },
      { pubkey: pairPda, isSigner: false, isWritable: true },
      { pubkey: orderPda, isSigner: false, isWritable: true },
      { pubkey: userBaseBalancePda, isSigner: false, isWritable: true },
      { pubkey: userQuoteBalancePda, isSigner: false, isWritable: true },
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
  /** Position PDA - the account address of the position to close */
  positionPda: PublicKey;
  /** Encrypted close size (64 bytes) - ignored if fullClose is true */
  encryptedCloseSize: Uint8Array;
  /** Encrypted exit price (64 bytes) - should match oracle */
  encryptedExitPrice: Uint8Array;
  /** Whether to close the entire position */
  fullClose: boolean;
  /** Payout amount in USDC (for SPL token transfer fallback) */
  payoutAmount: bigint;
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
 * Build a transaction to close a LEGACY position with plaintext data
 *
 * This function is for hackathon-era positions that have plaintext values
 * stored in bytes 0-8 of encrypted fields. These positions cannot use the
 * MPC flow because bytes 16-48 (ciphertext region) are zeros.
 *
 * Use isLegacyPlaintextPosition() to check if a position needs this path.
 * New positions with proper V2 encryption should use buildInitiateClosePositionTransaction.
 *
 * @param params - Close position parameters
 * @returns Transaction to sign and send
 */
export async function buildLegacyClosePositionTransaction(
  params: ClosePositionParams
): Promise<Transaction> {
  const {
    connection,
    trader,
    perpMarketPda,
    positionPda,
    encryptedCloseSize,
    encryptedExitPrice,
    fullClose,
    payoutAmount,
    oraclePriceFeed,
    collateralVault,
    feeRecipient,
    arciumProgram,
  } = params;

  log.debug('Building close position transaction', {
    trader: trader.toBase58(),
    perpMarket: perpMarketPda.toBase58(),
    positionPda: positionPda.toBase58(),
    fullClose,
    payoutAmount: payoutAmount.toString(),
  });

  // Get trader's collateral token account (USDC ATA)
  const traderCollateralAccount = await getAssociatedTokenAddress(
    new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'), // Dummy USDC devnet
    trader
  );

  // Derive vault authority PDA: seeds = ["vault", perp_market]
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), perpMarketPda.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );

  log.debug('Close position PDAs', {
    perpMarket: perpMarketPda.toBase58(),
    position: positionPda.toBase58(),
    oracle: oraclePriceFeed.toBase58(),
    collateralVault: collateralVault.toBase58(),
    vaultAuthority: vaultAuthority.toBase58(),
  });

  // Build instruction data: discriminator + ClosePositionParams
  // ClosePositionParams: encrypted_close_size[64] + encrypted_exit_price[64] + full_close[1] + payout_amount[8]
  const instructionData = Buffer.alloc(8 + 64 + 64 + 1 + 8);
  Buffer.from(CLOSE_POSITION_DISCRIMINATOR).copy(instructionData, 0);
  Buffer.from(encryptedCloseSize).copy(instructionData, 8);
  Buffer.from(encryptedExitPrice).copy(instructionData, 72);
  instructionData.writeUInt8(fullClose ? 1 : 0, 136);
  instructionData.writeBigUInt64LE(payoutAmount, 137);

  // SPL Token program
  const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

  // Build close position instruction
  // Account order must match Rust struct: perp_market, position, oracle, trader_collateral_account,
  // collateral_vault, fee_recipient, vault_authority, trader, arcium_program, token_program
  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: perpMarketPda, isSigner: false, isWritable: true },
      { pubkey: positionPda, isSigner: false, isWritable: true },
      { pubkey: oraclePriceFeed, isSigner: false, isWritable: false },
      { pubkey: traderCollateralAccount, isSigner: false, isWritable: true },
      { pubkey: collateralVault, isSigner: false, isWritable: true },
      { pubkey: feeRecipient, isSigner: false, isWritable: true },
      { pubkey: vaultAuthority, isSigner: false, isWritable: false },
      { pubkey: trader, isSigner: true, isWritable: true },
      { pubkey: arciumProgram, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
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

// ============================================================================
// INITIATE CLOSE POSITION (V7 - Async MPC Flow)
// ============================================================================

/**
 * Parameters for initiating position close (V7 async MPC flow)
 *
 * Phase 1: User calls initiate_close_position
 * - Queues MPC computation for PnL calculation
 * - Sets pending_close = true on position
 * - Emits ClosePositionInitiated event
 *
 * Phase 2: Backend crank detects event, waits for MPC, calls close_position_callback
 * - Transfers payout to trader
 * - Marks position as Closed
 */
export interface InitiateClosePositionParams {
  connection: Connection;
  trader: PublicKey;
  perpMarketPda: PublicKey;
  /** Position PDA - the account address of the position to close */
  positionPda: PublicKey;
  /** Encrypted close size (64 bytes) - for partial closes. Ignored if fullClose is true */
  encryptedCloseSize: Uint8Array;
  /** Whether to close the entire position */
  fullClose: boolean;
  /** Oracle price feed account (e.g., Pyth SOL/USD) */
  oraclePriceFeed: PublicKey;
  /** MXE public key for encryption (from MXE config) */
  mxePubKey: Uint8Array;
  /** Nonce for MXE encryption (should be unique per computation) */
  nonce: bigint;
}

/**
 * Build a transaction to initiate closing a perpetual position (V7 async MPC flow)
 *
 * This is Phase 1 of the close position flow. After this transaction confirms:
 * 1. Position will have pending_close = true
 * 2. MPC computation for PnL is queued
 * 3. Backend crank will detect ClosePositionInitiated event
 * 4. When MPC completes, crank will call close_position_callback
 *
 * @param params - Initiate close position parameters
 * @returns Transaction to sign and send
 */
export async function buildInitiateClosePositionTransaction(
  params: InitiateClosePositionParams
): Promise<Transaction> {
  const {
    connection,
    trader,
    perpMarketPda,
    positionPda,
    encryptedCloseSize,
    fullClose,
    oraclePriceFeed,
    mxePubKey,
    nonce,
  } = params;

  log.debug('Building initiate_close_position transaction (V7 async MPC)', {
    trader: trader.toBase58(),
    perpMarket: perpMarketPda.toBase58(),
    position: positionPda.toBase58(),
    fullClose,
  });

  // Generate random computation offset for MXE
  const computationOffset = generateComputationOffset();

  // Derive all 11 MXE accounts for calculate_pnl circuit
  const mxeAccounts = deriveArciumAccounts(
    'calculate_pnl',
    computationOffset,
    MXE_PROGRAM_ID
  );

  log.debug('MXE accounts derived', {
    signPda: mxeAccounts.signPdaAccount.toBase58(),
    mxeAccount: mxeAccounts.mxeAccount.toBase58(),
    computationAccount: mxeAccounts.computationAccount.toBase58(),
    compDefAccount: mxeAccounts.compDefAccount.toBase58(),
  });

  // Build instruction data: discriminator + InitiateClosePositionParams
  // Layout: encrypted_close_size[64] + full_close[1] + computation_offset[8] + mxe_pub_key[32] + nonce[16]
  const instructionData = Buffer.alloc(8 + 64 + 1 + 8 + 32 + 16);
  Buffer.from(INITIATE_CLOSE_POSITION_DISCRIMINATOR).copy(instructionData, 0);
  Buffer.from(encryptedCloseSize).copy(instructionData, 8);
  instructionData.writeUInt8(fullClose ? 1 : 0, 72);
  // Write computation_offset as u64
  const offsetBuf = computationOffset.toArrayLike(Buffer, 'le', 8);
  offsetBuf.copy(instructionData, 73);
  // Write mxe_pub_key
  Buffer.from(mxePubKey).copy(instructionData, 81);
  // Write nonce as u128 (16 bytes)
  const nonceBuf = Buffer.alloc(16);
  nonceBuf.writeBigUInt64LE(nonce % BigInt(2 ** 64), 0);
  nonceBuf.writeBigUInt64LE(nonce >> BigInt(64), 8);
  nonceBuf.copy(instructionData, 113);

  // Build account keys - must match InitiateClosePosition struct in Rust
  // Order: perp_market, position, oracle, trader, 9 MXE accounts, system_program, arcium_program, mxe_program
  const keys: Array<{ pubkey: PublicKey; isSigner: boolean; isWritable: boolean }> = [
    { pubkey: perpMarketPda, isSigner: false, isWritable: true },
    { pubkey: positionPda, isSigner: false, isWritable: true },
    { pubkey: oraclePriceFeed, isSigner: false, isWritable: false },
    { pubkey: trader, isSigner: true, isWritable: true },
    // MXE CPI accounts (9 core accounts)
    { pubkey: mxeAccounts.signPdaAccount, isSigner: false, isWritable: true },
    { pubkey: mxeAccounts.mxeAccount, isSigner: false, isWritable: true },
    { pubkey: mxeAccounts.mempoolAccount, isSigner: false, isWritable: true },
    { pubkey: mxeAccounts.executingPool, isSigner: false, isWritable: true },
    { pubkey: mxeAccounts.computationAccount, isSigner: false, isWritable: true },
    { pubkey: mxeAccounts.compDefAccount, isSigner: false, isWritable: false },
    { pubkey: mxeAccounts.clusterAccount, isSigner: false, isWritable: true },
    { pubkey: mxeAccounts.poolAccount, isSigner: false, isWritable: true },
    { pubkey: mxeAccounts.clockAccount, isSigner: false, isWritable: true },
    // Programs (system_program must come BEFORE arcium_program and mxe_program)
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: mxeAccounts.arciumProgram, isSigner: false, isWritable: false },
    { pubkey: mxeAccounts.mxeProgram, isSigner: false, isWritable: false },
  ];

  const instruction = new TransactionInstruction({
    keys,
    programId: CONFIDEX_PROGRAM_ID,
    data: instructionData,
  });

  // Build transaction
  const transaction = new Transaction().add(instruction);
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = trader;

  log.debug('initiate_close_position transaction built successfully');

  return transaction;
}

/**
 * Wait for position close to complete (MPC callback processed)
 *
 * Polls the position account until pending_close becomes false,
 * indicating the MPC callback has been processed.
 *
 * @param connection - Solana connection
 * @param positionPda - Position PDA to monitor
 * @param maxAttempts - Maximum polling attempts (default: 60)
 * @param pollIntervalMs - Interval between polls in ms (default: 2000)
 * @returns True if close completed successfully, false if timed out
 */
export async function waitForClosePositionCompletion(
  connection: Connection,
  positionPda: PublicKey,
  maxAttempts: number = 60,
  pollIntervalMs: number = 2000
): Promise<boolean> {
  log.debug('Waiting for close position completion', {
    position: positionPda.toBase58(),
    maxAttempts,
    pollIntervalMs,
  });

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const position = await fetchPositionByPda(connection, positionPda);

      if (!position) {
        log.warn('Position not found during close completion wait');
        return false;
      }

      // Check if close completed (position closed or no longer pending)
      if (position.status === PositionStatusEnum.Closed) {
        log.debug('Position closed successfully');
        return true;
      }

      // Check pending_close flag (need to read raw bytes since interface doesn't have it)
      // For now, just check status
      if (position.status !== PositionStatusEnum.Open) {
        log.debug('Position no longer open', { status: position.status });
        return true;
      }
    } catch (err) {
      log.warn('Error checking position status', { error: err });
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }

  log.warn('Close position completion timed out', {
    position: positionPda.toBase58(),
    timeout: maxAttempts * pollIntervalMs,
  });
  return false;
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
 * ConfidentialPosition account layout (692 bytes total)
 * V7 with async MPC close position tracking fields
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
  // PDA seed (position_count used during creation)
  positionSeed: bigint;
  // V6 async MPC tracking fields
  pendingMpcRequest: Uint8Array;      // 32 bytes
  pendingMarginAmount: bigint;        // u64
  pendingMarginIsAdd: boolean;
  isLiquidatable: boolean;
  // V7 async close position tracking fields
  pendingClose: boolean;
  pendingCloseExitPrice: bigint;      // u64
  pendingCloseFull: boolean;
  pendingCloseSize: Uint8Array;       // 64 bytes
}

/**
 * Check if a position is a legacy hackathon-era position with plaintext data
 *
 * Legacy positions have:
 * - Plaintext values in bytes 0-8 of encrypted fields
 * - Zeros in bytes 16-48 (the ciphertext region of V2 format)
 *
 * V2 encrypted format is: [nonce(16) | ciphertext(32) | ephemeral_pubkey(16)]
 * The MPC extracts bytes 16-48 as ciphertext, so legacy positions with zeros
 * there will fail with "PlaintextU64(0) for parameter Ciphertext".
 *
 * @param position - The position account to check
 * @returns true if this is a legacy position that needs plaintext close path
 */
export function isLegacyPlaintextPosition(position: ConfidentialPositionAccount): boolean {
  // Check if bytes 16-48 (ciphertext region) are all zeros for size and entry_price
  const sizeCiphertextZeros = position.encryptedSize
    .slice(16, 48)
    .every((b) => b === 0);
  const priceCiphertextZeros = position.encryptedEntryPrice
    .slice(16, 48)
    .every((b) => b === 0);

  // Check if there's plaintext data in the first 8 bytes
  const hasPlaintextSize = readLittleEndianU64(position.encryptedSize.slice(0, 8)) > BigInt(0);
  const hasPlaintextPrice = readLittleEndianU64(position.encryptedEntryPrice.slice(0, 8)) > BigInt(0);

  // It's legacy if ciphertext regions are zeros but plaintext regions have data
  return (sizeCiphertextZeros || priceCiphertextZeros) && (hasPlaintextSize || hasPlaintextPrice);
}

/**
 * Helper to read a little-endian u64 from a Uint8Array
 */
function readLittleEndianU64(bytes: Uint8Array): bigint {
  let value = BigInt(0);
  for (let i = 0; i < 8; i++) {
    value |= BigInt(bytes[i]) << BigInt(i * 8);
  }
  return value;
}

/**
 * Parse ConfidentialPosition from on-chain account data
 * Layout matches programs/confidex_dex/src/state/position.rs
 * Total size: 692 bytes (8 discriminator + 684 data) - V7 with async close tracking
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
  offset += 1;

  // position_seed: u64 (8 bytes) - the position_count used in PDA creation
  const positionSeed = data.readBigUInt64LE(offset);
  offset += 8;

  // === V6 async MPC tracking fields ===

  // pending_mpc_request: [u8; 32]
  const pendingMpcRequest = new Uint8Array(data.subarray(offset, offset + 32));
  offset += 32;

  // pending_margin_amount: u64 (8 bytes)
  const pendingMarginAmount = data.readBigUInt64LE(offset);
  offset += 8;

  // pending_margin_is_add: bool (1 byte)
  const pendingMarginIsAdd = data.readUInt8(offset) === 1;
  offset += 1;

  // is_liquidatable: bool (1 byte)
  const isLiquidatable = data.readUInt8(offset) === 1;
  offset += 1;

  // === V7 async close position tracking fields ===

  // pending_close: bool (1 byte)
  const pendingClose = data.readUInt8(offset) === 1;
  offset += 1;

  // pending_close_exit_price: u64 (8 bytes)
  const pendingCloseExitPrice = data.readBigUInt64LE(offset);
  offset += 8;

  // pending_close_full: bool (1 byte)
  const pendingCloseFull = data.readUInt8(offset) === 1;
  offset += 1;

  // pending_close_size: [u8; 64]
  const pendingCloseSize = new Uint8Array(data.subarray(offset, offset + 64));

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
    positionSeed,
    // V6 fields
    pendingMpcRequest,
    pendingMarginAmount,
    pendingMarginIsAdd,
    isLiquidatable,
    // V7 fields
    pendingClose,
    pendingCloseExitPrice,
    pendingCloseFull,
    pendingCloseSize,
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
  // Note: On-chain account size is 692 bytes (8 discriminator + 684 data fields)
  // V7: Includes async MPC tracking and close position fields
  const POSITION_ACCOUNT_SIZE = 692;

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

// =============================================================================
// Light Protocol ZK Compression Functions
// =============================================================================

/**
 * Check if Light Protocol compression is available
 */
export function isLightProtocolAvailable(): boolean {
  return LIGHT_PROTOCOL_ENABLED && isCompressionAvailable();
}

/**
 * Get compressed token balance for a user
 * Returns the total balance across all compressed token accounts for the given mint
 */
export async function getCompressedBalance(
  owner: PublicKey,
  mint: PublicKey
): Promise<bigint> {
  if (!isLightProtocolAvailable()) {
    return BigInt(0);
  }

  try {
    const rpc = getCompressionRpcSafe();
    if (!rpc) {
      return BigInt(0);
    }

    const accounts = await rpc.getCompressedTokenAccountsByOwner(owner, { mint });

    // Sum all compressed balances
    const total = accounts.items.reduce((sum, acc) => {
      // BN.toString() converts to decimal string which BigInt accepts
      return sum + BigInt(acc.parsed.amount.toString());
    }, BigInt(0));

    log.debug('Fetched compressed balance', {
      owner: owner.toString(),
      mint: mint.toString(),
      accountCount: accounts.items.length,
      total: total.toString(),
    });

    return total;
  } catch (error) {
    log.warn('Failed to get compressed balance', {
      error: error instanceof Error ? error.message : String(error),
    });
    return BigInt(0);
  }
}

/**
 * Calculate rent savings from using Light Protocol compression
 */
export function calculateCompressionSavings(accountCount: number = 1): {
  regularCostLamports: bigint;
  compressedCostLamports: bigint;
  savingsLamports: bigint;
  savingsMultiplier: number;
  savingsSOL: number;
} {
  const regularCost = REGULAR_TOKEN_ACCOUNT_RENT_LAMPORTS * BigInt(accountCount);
  const compressedCost = COMPRESSED_ACCOUNT_COST_LAMPORTS * BigInt(accountCount);
  const savings = regularCost - compressedCost;
  const multiplier = Number(regularCost) / Number(compressedCost);

  return {
    regularCostLamports: regularCost,
    compressedCostLamports: compressedCost,
    savingsLamports: savings,
    savingsMultiplier: Math.round(multiplier),
    savingsSOL: Number(savings) / 1e9,
  };
}

export interface CompressedWrapParams extends WrapTokensParams {
  /** Whether to use Light Protocol compression (default: true if available) */
  useCompression?: boolean;
}

/**
 * Build wrap_tokens transaction with optional Light Protocol compression
 *
 * When compression is enabled:
 * 1. Standard wrap flow executes (tokens to vault, balance credited)
 * 2. Balance tracking uses Light Protocol compressed accounts (rent-free)
 *
 * Compression saves ~0.002 SOL per token account (400x cheaper)
 */
export async function buildCompressedWrapTransaction(
  params: CompressedWrapParams
): Promise<{
  transaction: Transaction;
  useCompression: boolean;
  rentSavings: ReturnType<typeof calculateCompressionSavings> | null;
}> {
  const { useCompression = isLightProtocolAvailable() } = params;

  // Build the standard wrap transaction
  const transaction = await buildWrapTransaction(params);

  // If compression is not requested or not available, return standard transaction
  if (!useCompression || !isLightProtocolAvailable()) {
    log.debug('Building standard wrap transaction (compression disabled or unavailable)');
    return {
      transaction,
      useCompression: false,
      rentSavings: null,
    };
  }

  // Note: Full compression integration would add compressed token instructions here
  // For hackathon demo, we track that compression is enabled and show savings
  // The actual compression happens via the LightProvider settlement layer

  const rentSavings = calculateCompressionSavings(1);

  log.debug('Building compressed wrap transaction', {
    useCompression: true,
    savingsSOL: rentSavings.savingsSOL,
    savingsMultiplier: rentSavings.savingsMultiplier,
  });

  return {
    transaction,
    useCompression: true,
    rentSavings,
  };
}

export interface CompressedUnwrapParams extends UnwrapTokensParams {
  /** Whether the source balance is compressed */
  isCompressed?: boolean;
}

/**
 * Build unwrap_tokens transaction that handles compressed balances
 *
 * When unwrapping compressed balances:
 * 1. Decompresses the required amount from Light Protocol
 * 2. Standard unwrap flow executes (vault to user, balance debited)
 */
export async function buildCompressedUnwrapTransaction(
  params: CompressedUnwrapParams
): Promise<{
  transaction: Transaction;
  wasCompressed: boolean;
}> {
  const { isCompressed = false } = params;

  // Build the standard unwrap transaction
  const transaction = await buildUnwrapTransaction(params);

  if (isCompressed && isLightProtocolAvailable()) {
    // Note: Full implementation would add decompression instructions here
    // For hackathon demo, we indicate the source was compressed
    log.debug('Building unwrap from compressed balance');
  }

  return {
    transaction,
    wasCompressed: isCompressed,
  };
}

/**
 * Get combined balance (regular + compressed) for a token
 * This is the total available balance for trading
 */
export async function getCombinedBalance(
  connection: Connection,
  owner: PublicKey,
  tokenMint: PublicKey
): Promise<{
  regular: bigint;
  compressed: bigint;
  total: bigint;
}> {
  // Fetch regular SPL token balance
  let regularBalance = BigInt(0);
  try {
    const tokenAccount = await getAssociatedTokenAddress(tokenMint, owner);
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    if (accountInfo) {
      // Parse token account to get balance (offset 64 for amount in SPL token layout)
      const data = accountInfo.data;
      if (data.length >= 72) {
        regularBalance = data.readBigUInt64LE(64);
      }
    }
  } catch {
    // Token account doesn't exist, balance is 0
  }

  // Fetch compressed balance
  const compressedBalance = await getCompressedBalance(owner, tokenMint);

  const total = regularBalance + compressedBalance;

  log.debug('Combined balance fetched', {
    owner: owner.toString(),
    mint: tokenMint.toString(),
    regular: regularBalance.toString(),
    compressed: compressedBalance.toString(),
    total: total.toString(),
  });

  return {
    regular: regularBalance,
    compressed: compressedBalance,
    total,
  };
}
