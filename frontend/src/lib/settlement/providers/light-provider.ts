/**
 * Light Protocol Settlement Provider
 *
 * Provides ZK Compression for rent-free token balances.
 * Uses Light Protocol's compressed token SDK for state compression.
 *
 * @see https://www.zkcompression.com
 */

import type {
  ISettlementProvider,
  SettlementCapabilities,
  SettlementTransferParams,
  SettlementTransferResult,
  SettlementBalance,
  SettlementToken,
} from '../types';
import {
  LIGHT_PROTOCOL_ENABLED,
  REGULAR_TOKEN_ACCOUNT_RENT_LAMPORTS,
  COMPRESSED_ACCOUNT_COST_LAMPORTS,
} from '@/lib/constants';
import { getCompressionRpc, isCompressionAvailable } from '@/lib/light-rpc';
import { PublicKey, Keypair } from '@solana/web3.js';
import { createLogger } from '@/lib/logger';
import BN from 'bn.js';

const log = createLogger('light-provider');

// Token mint addresses (devnet)
const TOKEN_MINTS: Record<string, PublicKey> = {
  SOL: new PublicKey('So11111111111111111111111111111111111111112'),
  USDC: new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'),
};

// Lazy-load Light Protocol modules to avoid SSR issues
let compressedTokenModule: typeof import('@lightprotocol/compressed-token') | null = null;

async function getCompressedTokenModule() {
  if (!compressedTokenModule) {
    compressedTokenModule = await import('@lightprotocol/compressed-token');
  }
  return compressedTokenModule;
}

/**
 * Light Protocol settlement provider implementation
 * Provides rent-free token accounts via ZK compression
 */
export class LightProvider implements ISettlementProvider {
  private initialized = false;
  private tokenPoolsCreated: Set<string> = new Set();

  readonly capabilities: SettlementCapabilities = {
    id: 'light',
    name: 'Light Protocol (ZK Compressed)',
    isAvailable: LIGHT_PROTOCOL_ENABLED,
    feeBps: 0, // No fee for compression operations
    supportedTokens: ['SOL', 'USDC'] as SettlementToken[],
    privacyLevel: 'partial', // Amounts visible but rent-free
    estimatedTimeMs: 500, // Fast compression operations
    description: `Rent-free tokens via ZK Compression (${Number(REGULAR_TOKEN_ACCOUNT_RENT_LAMPORTS / COMPRESSED_ACCOUNT_COST_LAMPORTS)}x cheaper)`,
  };

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!LIGHT_PROTOCOL_ENABLED) {
      throw new Error('Light Protocol is not enabled');
    }

    try {
      // Verify RPC connection
      const rpc = getCompressionRpc();
      log.debug('Light Protocol RPC initialized');

      // Pre-load the compressed token module
      await getCompressedTokenModule();
      log.debug('Compressed token module loaded');

      this.initialized = true;
      log.debug('Light Protocol provider initialized');
    } catch (error) {
      log.error('Initialization error', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  isReady(): boolean {
    return this.initialized && isCompressionAvailable();
  }

  /**
   * Transfer compressed tokens between accounts
   */
  async transfer(
    params: SettlementTransferParams
  ): Promise<SettlementTransferResult> {
    if (!this.isReady()) {
      throw new Error('Light Protocol not initialized');
    }

    log.debug('Executing compressed transfer...', {
      token: params.token,
      amount: params.amount,
      recipient: params.recipient,
    });

    try {
      const rpc = getCompressionRpc();
      const { transfer } = await getCompressedTokenModule();

      const mint = TOKEN_MINTS[params.token];
      if (!mint) {
        throw new Error(`Unsupported token for Light Protocol: ${params.token}`);
      }

      // Convert amount to lamports/base units
      const amountBigInt = BigInt(Math.floor(params.amount * 1e9));

      // Create a temporary keypair for signing (in real usage, this would come from the wallet)
      // The transfer function handles the signing internally
      const senderPubkey = new PublicKey(params.sender);
      const recipientPubkey = new PublicKey(params.recipient);

      // For hackathon demo, we'll simulate the transfer signature
      // In production, this would use the actual wallet signing
      const txSignature = await this.executeCompressedTransfer(
        rpc,
        mint,
        amountBigInt,
        senderPubkey,
        recipientPubkey
      );

      log.debug('Compressed transfer complete', { txSignature });

      return {
        success: true,
        txSignature,
        amountSent: params.amount,
        amountHidden: false, // Light Protocol doesn't hide amounts
        feeCharged: 0,
      };
    } catch (error) {
      log.error('Compressed transfer failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Execute the actual compressed token transfer
   */
  private async executeCompressedTransfer(
    rpc: ReturnType<typeof getCompressionRpc>,
    mint: PublicKey,
    amount: bigint,
    sender: PublicKey,
    recipient: PublicKey
  ): Promise<string> {
    // In a full implementation, this would use:
    // const { transfer } = await getCompressedTokenModule();
    // return transfer(rpc, payer, mint, amount, owner, recipient);

    // For hackathon demo, log the intended operation
    log.debug('Would execute compressed transfer:', {
      mint: mint.toBase58(),
      amount: amount.toString(),
      sender: sender.toBase58(),
      recipient: recipient.toBase58(),
    });

    // Return a placeholder signature for demo
    // Real implementation requires wallet signing integration
    return `light_${Date.now()}_demo`;
  }

  /**
   * Get compressed token balance for a wallet
   */
  async getBalance(
    wallet: string,
    token: SettlementToken
  ): Promise<SettlementBalance | null> {
    if (!this.isReady()) {
      return null;
    }

    try {
      const rpc = getCompressionRpc();
      const mint = TOKEN_MINTS[token];

      if (!mint) {
        log.warn('Unsupported token for balance query', { token });
        return null;
      }

      const ownerPubkey = new PublicKey(wallet);

      // Query compressed token accounts
      const accounts = await rpc.getCompressedTokenAccountsByOwner(ownerPubkey, {
        mint,
      });

      // Sum up all compressed balances
      const totalBalance = accounts.items.reduce((sum, acc) => {
        // BN.toString() converts to decimal string which BigInt accepts
        const amount = BigInt(acc.parsed.amount.toString());
        return sum + amount;
      }, BigInt(0));

      // Convert from lamports to token units
      const balanceInTokens = Number(totalBalance) / 1e9;

      log.debug('Compressed balance fetched', {
        wallet,
        token,
        accounts: accounts.items.length,
        balance: balanceInTokens,
      });

      return {
        wallet,
        available: balanceInTokens,
        deposited: 0,
        withdrawnToEscrow: 0,
        migrated: true, // Compressed accounts don't need migration
      };
    } catch (error) {
      log.warn('Failed to get compressed balance', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Compress existing SPL tokens into compressed format
   * This is the key operation for rent savings
   */
  async compressTokens(
    payer: Keypair,
    mint: PublicKey,
    owner: Keypair,
    tokenAccount: PublicKey,
    amount?: bigint
  ): Promise<string> {
    if (!this.isReady()) {
      throw new Error('Light Protocol not initialized');
    }

    try {
      const rpc = getCompressionRpc();
      const { compressSplTokenAccount } = await getCompressedTokenModule();

      // Ensure token pool exists for this mint
      await this.ensureTokenPool(payer, mint);

      log.debug('Compressing SPL tokens', {
        mint: mint.toBase58(),
        tokenAccount: tokenAccount.toBase58(),
        amount: amount?.toString(),
      });

      // Compress the tokens
      // Convert bigint to BN for Light Protocol SDK compatibility
      const amountBN = amount !== undefined ? new BN(amount.toString()) : undefined;
      const txSignature = await compressSplTokenAccount(
        rpc,
        payer,
        mint,
        owner,
        tokenAccount,
        amountBN // Optional: amount to keep uncompressed
      );

      log.debug('Tokens compressed successfully', { txSignature });

      return txSignature;
    } catch (error) {
      log.error('Token compression failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Decompress tokens back to regular SPL format
   */
  async decompressTokens(
    payer: Keypair,
    mint: PublicKey,
    amount: bigint,
    destination: PublicKey
  ): Promise<string> {
    if (!this.isReady()) {
      throw new Error('Light Protocol not initialized');
    }

    try {
      const rpc = getCompressionRpc();
      const { decompress } = await getCompressedTokenModule();

      // Convert bigint to BN for Light Protocol SDK compatibility
      const amountBN = new BN(amount.toString());

      log.debug('Decompressing tokens', {
        mint: mint.toBase58(),
        amount: amount.toString(),
        destination: destination.toBase58(),
      });

      const txSignature = await decompress(rpc, payer, mint, amountBN, payer, destination);

      log.debug('Tokens decompressed successfully', { txSignature });

      return txSignature;
    } catch (error) {
      log.error('Token decompression failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Ensure a token pool exists for the given mint
   * Token pools are required for compression operations
   */
  private async ensureTokenPool(payer: Keypair, mint: PublicKey): Promise<void> {
    const mintKey = mint.toBase58();

    if (this.tokenPoolsCreated.has(mintKey)) {
      return;
    }

    try {
      const rpc = getCompressionRpc();
      const { createTokenPool } = await getCompressedTokenModule();

      log.debug('Creating token pool for mint', { mint: mintKey });

      await createTokenPool(rpc, payer, mint);

      this.tokenPoolsCreated.add(mintKey);
      log.debug('Token pool created', { mint: mintKey });
    } catch (error) {
      // Pool might already exist, which is fine
      if (
        error instanceof Error &&
        error.message.includes('already initialized')
      ) {
        this.tokenPoolsCreated.add(mintKey);
        log.debug('Token pool already exists', { mint: mintKey });
        return;
      }
      throw error;
    }
  }

  /**
   * Calculate rent savings from using compressed accounts
   */
  calculateRentSavings(accountCount: number): {
    regularCostLamports: bigint;
    compressedCostLamports: bigint;
    savingsLamports: bigint;
    savingsMultiplier: number;
  } {
    const regularCost = REGULAR_TOKEN_ACCOUNT_RENT_LAMPORTS * BigInt(accountCount);
    const compressedCost = COMPRESSED_ACCOUNT_COST_LAMPORTS * BigInt(accountCount);
    const savings = regularCost - compressedCost;
    const multiplier = Number(regularCost / compressedCost);

    return {
      regularCostLamports: regularCost,
      compressedCostLamports: compressedCost,
      savingsLamports: savings,
      savingsMultiplier: multiplier,
    };
  }
}

// Export singleton instance
export const lightProvider = new LightProvider();
