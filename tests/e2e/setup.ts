/**
 * E2E Test Setup
 *
 * Provides test context setup, keypair management, and devnet configuration
 * for end-to-end testing of the Confidex order flow.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// CONFIGURATION
// =============================================================================

export const DEVNET_URL = process.env.E2E_RPC_URL || 'https://api.devnet.solana.com';
export const CONFIDEX_PROGRAM_ID = new PublicKey('63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB');
export const MXE_PROGRAM_ID = new PublicKey('4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi');
export const VERIFIER_PROGRAM_ID = new PublicKey('9op573D8GuuMAL2btvsnGVo2am2nMJZ4Cjt2srAkiG9W');

// Token mints (devnet)
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr');

// Timeouts
export const DEFAULT_TIMEOUT_MS = 30_000;
export const CONFIRMATION_TIMEOUT_MS = 60_000;

// =============================================================================
// TEST CONTEXT
// =============================================================================

export interface TestContext {
  connection: Connection;
  buyer: Keypair;
  seller: Keypair;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  pairPda: PublicKey;
  exchangePda: PublicKey;
  buyerBaseAta: PublicKey;
  buyerQuoteAta: PublicKey;
  sellerBaseAta: PublicKey;
  sellerQuoteAta: PublicKey;
}

/**
 * Setup test context with funded wallets and derived PDAs
 */
export async function setupTestContext(): Promise<TestContext> {
  const connection = new Connection(DEVNET_URL, 'confirmed');

  // Load or generate test keypairs
  const buyer = loadOrGenerateKeypair('e2e-buyer');
  const seller = loadOrGenerateKeypair('e2e-seller');

  console.log(`[E2E Setup] Buyer: ${buyer.publicKey.toBase58()}`);
  console.log(`[E2E Setup] Seller: ${seller.publicKey.toBase58()}`);

  // Ensure wallets have SOL
  await ensureFunded(connection, buyer.publicKey, 2 * LAMPORTS_PER_SOL);
  await ensureFunded(connection, seller.publicKey, 2 * LAMPORTS_PER_SOL);

  // Standard mints
  const baseMint = WSOL_MINT;
  const quoteMint = USDC_MINT;

  // Derive exchange PDA
  const [exchangePda] = PublicKey.findProgramAddressSync(
    [Buffer.from('exchange')],
    CONFIDEX_PROGRAM_ID
  );

  // Derive pair PDA
  const [pairPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('pair'), baseMint.toBuffer(), quoteMint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );

  // Derive ATAs
  const buyerBaseAta = await getAssociatedTokenAddress(baseMint, buyer.publicKey);
  const buyerQuoteAta = await getAssociatedTokenAddress(quoteMint, buyer.publicKey);
  const sellerBaseAta = await getAssociatedTokenAddress(baseMint, seller.publicKey);
  const sellerQuoteAta = await getAssociatedTokenAddress(quoteMint, seller.publicKey);

  return {
    connection,
    buyer,
    seller,
    baseMint,
    quoteMint,
    pairPda,
    exchangePda,
    buyerBaseAta,
    buyerQuoteAta,
    sellerBaseAta,
    sellerQuoteAta,
  };
}

// =============================================================================
// KEYPAIR MANAGEMENT
// =============================================================================

const KEYS_DIR = path.join(__dirname, 'keys');

/**
 * Load existing keypair or generate a new one
 */
function loadOrGenerateKeypair(name: string): Keypair {
  const keyPath = path.join(KEYS_DIR, `${name}.json`);

  if (fs.existsSync(keyPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(data));
    } catch (error) {
      console.warn(`[E2E Setup] Failed to load keypair ${name}, generating new one`);
    }
  }

  const keypair = Keypair.generate();
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, JSON.stringify(Array.from(keypair.secretKey)));
  console.log(`[E2E Setup] Generated new keypair: ${name} -> ${keypair.publicKey.toBase58()}`);
  return keypair;
}

/**
 * Load keypair from path (for admin operations)
 */
export function loadKeypairFromPath(keyPath: string): Keypair {
  const data = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

// =============================================================================
// FUNDING UTILITIES
// =============================================================================

/**
 * Ensure account has minimum SOL balance
 */
async function ensureFunded(
  connection: Connection,
  pubkey: PublicKey,
  minBalance: number
): Promise<void> {
  const balance = await connection.getBalance(pubkey);
  if (balance < minBalance) {
    const deficit = minBalance - balance;
    console.log(`[E2E Setup] Airdropping ${deficit / LAMPORTS_PER_SOL} SOL to ${pubkey.toBase58()}...`);

    try {
      const sig = await connection.requestAirdrop(pubkey, deficit);
      await connection.confirmTransaction(sig, 'confirmed');
      console.log(`[E2E Setup] Airdrop confirmed: ${sig}`);
    } catch (error) {
      // Airdrop might fail due to rate limits, check balance again
      const newBalance = await connection.getBalance(pubkey);
      if (newBalance < minBalance / 2) {
        throw new Error(`Failed to fund ${pubkey.toBase58()}: ${error}`);
      }
      console.warn(`[E2E Setup] Airdrop failed but balance is acceptable: ${newBalance / LAMPORTS_PER_SOL} SOL`);
    }
  } else {
    console.log(`[E2E Setup] ${pubkey.toBase58()} already funded: ${balance / LAMPORTS_PER_SOL} SOL`);
  }
}

/**
 * Ensure ATA exists for user
 */
export async function ensureAta(
  connection: Connection,
  payer: Keypair,
  mint: PublicKey,
  owner: PublicKey
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);

  const accountInfo = await connection.getAccountInfo(ata);
  if (!accountInfo) {
    console.log(`[E2E Setup] Creating ATA for ${owner.toBase58()} (mint: ${mint.toBase58()})`);
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(payer.publicKey, ata, owner, mint)
    );
    await sendAndConfirmTransaction(connection, tx, [payer]);
  }

  return ata;
}

// =============================================================================
// CLEANUP UTILITIES
// =============================================================================

/**
 * Cancel any pending orders from test accounts
 */
export async function cleanupTestOrders(ctx: TestContext): Promise<void> {
  console.log('[E2E Cleanup] Cleaning up test orders...');

  // In a real implementation, we would:
  // 1. Fetch all open orders for buyer/seller
  // 2. Cancel each one
  // For now, this is a placeholder

  console.log('[E2E Cleanup] Cleanup complete');
}

// =============================================================================
// BALANCE UTILITIES
// =============================================================================

/**
 * Get SOL balance
 */
export async function getSolBalance(
  connection: Connection,
  pubkey: PublicKey
): Promise<number> {
  const balance = await connection.getBalance(pubkey);
  return balance / LAMPORTS_PER_SOL;
}

/**
 * Get token balance
 */
export async function getTokenBalance(
  connection: Connection,
  ata: PublicKey
): Promise<bigint> {
  try {
    const accountInfo = await connection.getTokenAccountBalance(ata);
    return BigInt(accountInfo.value.amount);
  } catch {
    return 0n;
  }
}

// =============================================================================
// POLLING UTILITIES
// =============================================================================

export interface PollOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Poll until condition is met or timeout
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  predicate: (result: T) => boolean,
  options: PollOptions = {}
): Promise<T> {
  const { timeoutMs = 60_000, pollIntervalMs = 2_000 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await fn();
    if (result && predicate(result)) {
      return result;
    }
    await sleep(pollIntervalMs);
  }

  throw new Error(`Polling timed out after ${timeoutMs}ms`);
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =============================================================================
// PDA DERIVATION
// =============================================================================

/**
 * Derive order PDA
 */
export function deriveOrderPda(
  pair: PublicKey,
  maker: PublicKey,
  nonce: number
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('order'), pair.toBuffer(), maker.toBuffer(), Buffer.from([nonce])],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Derive user balance PDA
 */
export function deriveUserBalancePda(
  user: PublicKey,
  mint: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('user_balance'), user.toBuffer(), mint.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}

/**
 * Derive trader eligibility PDA
 */
export function deriveTraderEligibilityPda(trader: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('trader_eligibility'), trader.toBuffer()],
    CONFIDEX_PROGRAM_ID
  );
}
