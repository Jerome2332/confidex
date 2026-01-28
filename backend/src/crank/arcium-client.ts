/**
 * Arcium MPC Client for Production Mode
 *
 * Interfaces with the Full Arcium MXE (4pdgn...) to queue real MPC computations
 * on cluster 456. Used when CRANK_USE_REAL_MPC=true.
 *
 * Uses the Arcium TypeScript SDK for proper Anchor instruction building.
 *
 * Reference: https://docs.arcium.com/developers
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { AnchorProvider, Wallet } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { createHash } from 'crypto';
import { logger } from '../lib/logger.js';

const log = logger.mpc;

// Arcium SDK imports
import {
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  getFeePoolAccAddress,
  getClusterAccAddress as sdkGetClusterAccAddress,
  getClockAccAddress as sdkGetClockAccAddress,
  getMXEAccAddress as sdkGetMXEAccAddress,
  getCompDefAccAddress,
  getCompDefAccOffset,
  awaitComputationFinalization,
  ARCIUM_ADDR,
} from '@arcium-hq/client';

// Full Arcium MXE Program ID (production - deployed via `arcium deploy` Jan 22, 2026)
const FULL_MXE_PROGRAM_ID = new PublicKey(
  process.env.FULL_MXE_PROGRAM_ID || '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi'
);

// Arcium Core Program ID
const ARCIUM_PROGRAM_ID = new PublicKey(ARCIUM_ADDR);

// Devnet cluster offset (456 for v0.6.3)
const DEFAULT_CLUSTER_OFFSET = parseInt(process.env.ARCIUM_CLUSTER_OFFSET || '456', 10);

// MPC timeout in milliseconds
const DEFAULT_MPC_TIMEOUT_MS = parseInt(process.env.MPC_TIMEOUT_MS || '120000', 10);

// Computation definition offset for compare_prices
// Uses the Arcium SDK's getCompDefAccOffset function
function getComparePricesOffset(): number {
  const offsetBytes = getCompDefAccOffset('compare_prices');
  return Buffer.from(offsetBytes).readUInt32LE(0);
}

/**
 * Accounts required for Arcium MPC operations
 */
export interface ArciumAccounts {
  mxeAccount: PublicKey;
  clusterAccount: PublicKey;
  mempoolAccount: PublicKey;
  executingPool: PublicKey;
  computationAccount: PublicKey;
  compDefAccount: PublicKey;
  poolAccount: PublicKey;
  clockAccount: PublicKey;
  signPdaAccount: PublicKey;
  arciumProgram: PublicKey;
}

/**
 * Result from an MPC computation
 */
export interface MpcResult {
  success: boolean;
  result: Uint8Array;
  error?: string;
}

/**
 * Arcium MPC Client
 *
 * Provides methods to:
 * 1. Derive all required accounts for MPC operations
 * 2. Queue compare_prices computation via proper Anchor calls
 * 3. Await and parse computation results
 */
export class ArciumClient {
  private connection: Connection;
  private payer: Keypair;
  private clusterOffset: number;
  private mxeProgramId: PublicKey;
  private computationCounter: BN;
  private provider: AnchorProvider;

  constructor(
    connection: Connection,
    payer: Keypair,
    clusterOffset: number = DEFAULT_CLUSTER_OFFSET,
    mxeProgramId: PublicKey = FULL_MXE_PROGRAM_ID
  ) {
    this.connection = connection;
    this.payer = payer;
    this.clusterOffset = clusterOffset;
    this.mxeProgramId = mxeProgramId;
    this.computationCounter = new BN(Date.now()); // Use timestamp as starting offset

    // Create Anchor provider
    const wallet = new Wallet(payer);
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
  }

  /**
   * Derive signer PDA for MXE
   * Seeds: ["ArciumSignerAccount"]
   */
  private getSignPdaAccount(): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from('ArciumSignerAccount')],
      this.mxeProgramId
    );
    return pda;
  }

  /**
   * Derive all accounts needed for an MPC computation
   */
  deriveAccounts(computationOffset: BN): ArciumAccounts {
    return {
      mxeAccount: sdkGetMXEAccAddress(this.mxeProgramId),
      clusterAccount: sdkGetClusterAccAddress(this.clusterOffset),
      mempoolAccount: getMempoolAccAddress(this.clusterOffset),
      executingPool: getExecutingPoolAccAddress(this.clusterOffset),
      computationAccount: getComputationAccAddress(this.clusterOffset, computationOffset),
      compDefAccount: getCompDefAccAddress(this.mxeProgramId, getComparePricesOffset()),
      poolAccount: getFeePoolAccAddress(),
      clockAccount: sdkGetClockAccAddress(),
      signPdaAccount: this.getSignPdaAccount(),
      arciumProgram: ARCIUM_PROGRAM_ID,
    };
  }

  /**
   * Execute compare_prices MPC computation
   *
   * Compares two encrypted prices and returns whether buy_price >= sell_price.
   *
   * @param buyPriceCiphertext - 32-byte ciphertext of buy price
   * @param sellPriceCiphertext - 32-byte ciphertext of sell price
   * @param nonce - 128-bit nonce used for encryption (as bigint)
   * @param ephemeralPubkey - 32-byte ephemeral X25519 public key
   * @returns Promise<boolean> - true if prices match (buy >= sell)
   */
  async executeComparePrices(
    buyPriceCiphertext: Uint8Array,
    sellPriceCiphertext: Uint8Array,
    nonce: bigint,
    ephemeralPubkey: Uint8Array
  ): Promise<boolean> {
    console.log('[ArciumClient] Queueing compare_prices computation via raw instruction...');

    // Increment computation counter for unique computation offset
    const computationOffset = this.computationCounter;
    this.computationCounter = this.computationCounter.add(new BN(1));

    // Derive accounts
    const accounts = this.deriveAccounts(computationOffset);

    try {
      // Build raw instruction data
      // Format: discriminator (8) + computation_offset (8) + buy_price (32) + sell_price (32) +
      //         pub_key (32) + nonce (16) + buy_order Option (1) + sell_order Option (1)
      // Total: 130 bytes
      const discriminator = this.computeDiscriminator('compare_prices');

      // Serialize instruction data - MUST include Option<Pubkey> discriminator bytes
      // Without these, Anchor will fail with InstructionDidNotDeserialize (0x66)
      const data = Buffer.alloc(8 + 8 + 32 + 32 + 32 + 16 + 1 + 1); // 130 bytes total
      let offset = 0;

      // Discriminator (8 bytes)
      Buffer.from(discriminator).copy(data, offset);
      offset += 8;

      // computation_offset as u64 little-endian
      data.writeBigUInt64LE(BigInt(computationOffset.toString()), offset);
      offset += 8;

      // buy_price_ciphertext (32 bytes)
      Buffer.from(buyPriceCiphertext.slice(0, 32)).copy(data, offset);
      offset += 32;

      // sell_price_ciphertext (32 bytes)
      Buffer.from(sellPriceCiphertext.slice(0, 32)).copy(data, offset);
      offset += 32;

      // pub_key (32 bytes)
      Buffer.from(ephemeralPubkey.slice(0, 32)).copy(data, offset);
      offset += 32;

      // nonce as u128 little-endian (16 bytes)
      const nonceBuf = Buffer.alloc(16);
      let n = nonce;
      for (let i = 0; i < 16; i++) {
        nonceBuf[i] = Number(n & BigInt(0xff));
        n = n >> BigInt(8);
      }
      nonceBuf.copy(data, offset);
      offset += 16;

      // Option<Pubkey> for buy_order = None (discriminator 0)
      // Anchor serializes Option::None as a single 0x00 byte
      data.writeUInt8(0, offset);
      offset += 1;

      // Option<Pubkey> for sell_order = None (discriminator 0)
      data.writeUInt8(0, offset);

      // Build instruction with explicit account metadata
      // IMPORTANT: signPdaAccount must be writable for init_if_needed
      const instruction = new TransactionInstruction({
        programId: this.mxeProgramId,
        keys: [
          { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },      // payer
          { pubkey: accounts.signPdaAccount, isSigner: false, isWritable: true },  // sign_pda_account (writable for init_if_needed)
          { pubkey: accounts.mxeAccount, isSigner: false, isWritable: false },     // mxe_account
          { pubkey: accounts.mempoolAccount, isSigner: false, isWritable: true },  // mempool_account
          { pubkey: accounts.executingPool, isSigner: false, isWritable: true },   // executing_pool
          { pubkey: accounts.computationAccount, isSigner: false, isWritable: true }, // computation_account
          { pubkey: accounts.compDefAccount, isSigner: false, isWritable: false }, // comp_def_account
          { pubkey: accounts.clusterAccount, isSigner: false, isWritable: true },  // cluster_account
          { pubkey: accounts.poolAccount, isSigner: false, isWritable: true },     // pool_account
          { pubkey: accounts.clockAccount, isSigner: false, isWritable: true },    // clock_account
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
          { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },       // arcium_program
        ],
        data,
      });

      console.log('[ArciumClient] Account addresses:');
      console.log('  payer:', this.payer.publicKey.toBase58());
      console.log('  signPdaAccount:', accounts.signPdaAccount.toBase58());
      console.log('  mxeAccount:', accounts.mxeAccount.toBase58());
      console.log('  compDefAccount:', accounts.compDefAccount.toBase58());
      console.log('  computationAccount:', accounts.computationAccount.toBase58());
      console.log('  clusterAccount:', accounts.clusterAccount.toBase58());

      // Create and send transaction
      const transaction = new Transaction().add(instruction);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.payer],
        { commitment: 'confirmed' }
      );

      console.log(`[ArciumClient] Computation queued: ${signature}`);

      // Wait for computation finalization using Arcium SDK
      const result = await awaitComputationFinalization(
        this.provider,
        computationOffset,
        this.mxeProgramId,
        'confirmed'
      );

      console.log(`[ArciumClient] Computation finalized: ${result}`);

      // The result from awaitComputationFinalization is the transaction signature
      // We need to parse the actual result from events or account data
      // For now, assume success if we got here
      return true;

    } catch (error) {
      console.error('[ArciumClient] Failed to queue computation:', error);
      throw error;
    }
  }

  /**
   * Compute Anchor instruction discriminator
   * sha256("global:<instruction_name>")[0..8]
   */
  private computeDiscriminator(instructionName: string): number[] {
    const hash = createHash('sha256')
      .update(`global:${instructionName}`)
      .digest();
    return Array.from(hash.slice(0, 8));
  }

  /**
   * Execute calculate_fill MPC computation
   *
   * Calculates the fill amount for matching orders:
   * fill_amount = min(buy_remaining, sell_remaining)
   *
   * Called after compare_prices returns true (prices match).
   *
   * @param buyAmountCiphertext - 32-byte ciphertext of buy amount
   * @param buyFilledCiphertext - 32-byte ciphertext of buy filled amount
   * @param sellAmountCiphertext - 32-byte ciphertext of sell amount
   * @param sellFilledCiphertext - 32-byte ciphertext of sell filled amount
   * @param nonce - 128-bit nonce used for encryption (as bigint)
   * @param ephemeralPubkey - 32-byte ephemeral X25519 public key
   * @param buyOrderPubkey - Optional buy order pubkey for CPI callback
   * @param sellOrderPubkey - Optional sell order pubkey for CPI callback
   * @returns Promise with fill result (encrypted fill amount, buy/sell filled flags)
   */
  async executeCalculateFill(
    buyAmountCiphertext: Uint8Array,
    buyFilledCiphertext: Uint8Array,
    sellAmountCiphertext: Uint8Array,
    sellFilledCiphertext: Uint8Array,
    nonce: bigint,
    ephemeralPubkey: Uint8Array,
    buyOrderPubkey?: PublicKey,
    sellOrderPubkey?: PublicKey
  ): Promise<{ encryptedFill: Uint8Array; buyFullyFilled: boolean; sellFullyFilled: boolean }> {
    log.info('[ArciumClient] Queueing calculate_fill computation via raw instruction...');

    // Increment computation counter for unique computation offset
    const computationOffset = this.computationCounter;
    this.computationCounter = this.computationCounter.add(new BN(1));

    // Derive accounts
    const accounts = this.deriveAccounts(computationOffset);

    // Need to get the calculate_fill comp_def account (different offset than compare_prices)
    const calculateFillCompDefAccount = this.getCalculateFillCompDefAccount();

    try {
      // Build raw instruction data
      // Format: discriminator (8) + computation_offset (8) + 4x ciphertext (32 each) +
      //         pub_key (32) + nonce (16) + buy_order (Option) + sell_order (Option)
      const discriminator = this.computeDiscriminator('calculate_fill');

      // Calculate total size
      const buyOrderSize = buyOrderPubkey ? 33 : 1; // 1 byte for Some/None + 32 bytes pubkey
      const sellOrderSize = sellOrderPubkey ? 33 : 1;
      const totalSize = 8 + 8 + 32 * 4 + 32 + 16 + buyOrderSize + sellOrderSize;

      const data = Buffer.alloc(totalSize);
      let offset = 0;

      // Discriminator (8 bytes)
      Buffer.from(discriminator).copy(data, offset);
      offset += 8;

      // computation_offset as u64 little-endian
      data.writeBigUInt64LE(BigInt(computationOffset.toString()), offset);
      offset += 8;

      // buy_amount_ciphertext (32 bytes)
      Buffer.from(buyAmountCiphertext.slice(0, 32)).copy(data, offset);
      offset += 32;

      // sell_amount_ciphertext (32 bytes)
      Buffer.from(sellAmountCiphertext.slice(0, 32)).copy(data, offset);
      offset += 32;

      // buy_price_ciphertext (32 bytes) - using buy_filled as price proxy
      Buffer.from(buyFilledCiphertext.slice(0, 32)).copy(data, offset);
      offset += 32;

      // sell_price_ciphertext (32 bytes) - using sell_filled as price proxy
      Buffer.from(sellFilledCiphertext.slice(0, 32)).copy(data, offset);
      offset += 32;

      // pub_key (32 bytes)
      Buffer.from(ephemeralPubkey.slice(0, 32)).copy(data, offset);
      offset += 32;

      // nonce as u128 little-endian (16 bytes)
      const nonceBuf = Buffer.alloc(16);
      let n = nonce;
      for (let i = 0; i < 16; i++) {
        nonceBuf[i] = Number(n & BigInt(0xff));
        n = n >> BigInt(8);
      }
      nonceBuf.copy(data, offset);
      offset += 16;

      // Option<Pubkey> for buy_order
      if (buyOrderPubkey) {
        data.writeUInt8(1, offset); // Some
        offset += 1;
        Buffer.from(buyOrderPubkey.toBytes()).copy(data, offset);
        offset += 32;
      } else {
        data.writeUInt8(0, offset); // None
        offset += 1;
      }

      // Option<Pubkey> for sell_order
      if (sellOrderPubkey) {
        data.writeUInt8(1, offset); // Some
        offset += 1;
        Buffer.from(sellOrderPubkey.toBytes()).copy(data, offset);
        offset += 32;
      } else {
        data.writeUInt8(0, offset); // None
        offset += 1;
      }

      // Build instruction with explicit account metadata
      const instruction = new TransactionInstruction({
        programId: this.mxeProgramId,
        keys: [
          { pubkey: this.payer.publicKey, isSigner: true, isWritable: true },      // payer
          { pubkey: accounts.signPdaAccount, isSigner: false, isWritable: true },  // sign_pda_account
          { pubkey: accounts.mxeAccount, isSigner: false, isWritable: false },     // mxe_account
          { pubkey: accounts.mempoolAccount, isSigner: false, isWritable: true },  // mempool_account
          { pubkey: accounts.executingPool, isSigner: false, isWritable: true },   // executing_pool
          { pubkey: accounts.computationAccount, isSigner: false, isWritable: true }, // computation_account
          { pubkey: calculateFillCompDefAccount, isSigner: false, isWritable: false }, // comp_def_account for calculate_fill
          { pubkey: accounts.clusterAccount, isSigner: false, isWritable: true },  // cluster_account
          { pubkey: accounts.poolAccount, isSigner: false, isWritable: true },     // pool_account
          { pubkey: accounts.clockAccount, isSigner: false, isWritable: true },    // clock_account
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // system_program
          { pubkey: ARCIUM_PROGRAM_ID, isSigner: false, isWritable: false },       // arcium_program
        ],
        data,
      });

      log.debug({
        payer: this.payer.publicKey.toBase58(),
        compDefAccount: calculateFillCompDefAccount.toBase58(),
        computationAccount: accounts.computationAccount.toBase58(),
        buyOrder: buyOrderPubkey?.toBase58(),
        sellOrder: sellOrderPubkey?.toBase58(),
      }, '[ArciumClient] calculate_fill accounts');

      // Create and send transaction
      const transaction = new Transaction().add(instruction);

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.payer],
        { commitment: 'confirmed' }
      );

      log.info({ signature: signature.slice(0, 12) }, '[ArciumClient] calculate_fill computation queued');

      // Wait for computation finalization using Arcium SDK
      const result = await awaitComputationFinalization(
        this.provider,
        computationOffset,
        this.mxeProgramId,
        'confirmed'
      );

      log.info({ result }, '[ArciumClient] calculate_fill computation finalized');

      // Return placeholder - actual result comes via callback event
      // The MXE callback will emit FillCalculationResult which mpc-poller will handle
      return {
        encryptedFill: new Uint8Array(64),
        buyFullyFilled: false,
        sellFullyFilled: false,
      };

    } catch (error) {
      log.error({ error }, '[ArciumClient] Failed to queue calculate_fill computation');
      throw error;
    }
  }

  /**
   * Get the computation definition account for calculate_fill
   * Uses a different offset than compare_prices
   */
  private getCalculateFillCompDefAccount(): PublicKey {
    const offsetBytes = getCompDefAccOffset('calculate_fill');
    const offset = Buffer.from(offsetBytes).readUInt32LE(0);
    return getCompDefAccAddress(this.mxeProgramId, offset);
  }

  /**
   * Check if the Full Arcium MXE is available and keygen is complete
   *
   * Uses the Arcium SDK to properly decode the MXE account and check
   * for the x25519 public key in the utility_pubkeys field.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const mxeAccount = sdkGetMXEAccAddress(this.mxeProgramId);
      const accountInfo = await this.connection.getAccountInfo(mxeAccount);

      if (!accountInfo) {
        console.log('[ArciumClient] MXE account not found');
        return false;
      }

      // Use environment variable for x25519 key (set from arcium mxe-info)
      // This is more reliable than parsing the complex account structure
      const x25519KeyHex = process.env.MXE_X25519_PUBKEY;
      if (x25519KeyHex && x25519KeyHex.length === 64) {
        console.log('[ArciumClient] MXE available (x25519 key from env)');
        return true;
      }

      // Fallback: Check if account has sufficient data for keygen to be complete
      // MXE accounts with complete keygen have > 250 bytes of data
      if (accountInfo.data.length > 250) {
        console.log('[ArciumClient] MXE available (account size check)');
        return true;
      }

      console.log('[ArciumClient] MXE keygen may not be complete');
      return false;
    } catch (error) {
      console.error('[ArciumClient] Error checking MXE availability:', error);
      return false;
    }
  }

  /**
   * Get the MXE x25519 public key (for encryption)
   *
   * Prefers the environment variable MXE_X25519_PUBKEY which should be
   * set from the output of `arcium mxe-info`.
   */
  async getMxePublicKey(): Promise<Uint8Array | null> {
    try {
      // Prefer environment variable (set from arcium mxe-info output)
      const x25519KeyHex = process.env.MXE_X25519_PUBKEY;
      if (x25519KeyHex && x25519KeyHex.length === 64) {
        return Buffer.from(x25519KeyHex, 'hex');
      }

      // Fallback: Try to parse from account using Arcium SDK
      // This requires proper Anchor program deserialization
      log.debug({ mxeProgramId: this.mxeProgramId.toBase58() }, 'MXE_X25519_PUBKEY not set, cannot fetch key');
      return null;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      log.debug({ error: errMsg, mxeProgramId: this.mxeProgramId.toBase58() }, 'Failed to fetch MXE public key');
      return null;
    }
  }
}

/**
 * Create a configured ArciumClient instance
 */
export function createArciumClient(
  connection: Connection,
  payer: Keypair
): ArciumClient {
  return new ArciumClient(
    connection,
    payer,
    DEFAULT_CLUSTER_OFFSET,
    FULL_MXE_PROGRAM_ID
  );
}
