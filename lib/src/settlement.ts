/**
 * Settlement utilities for Confidex
 *
 * Supports multiple settlement methods:
 * - ShadowWire: Bulletproof-based private transfers
 * - C-SPL: Arcium confidential tokens (when available)
 */

import {
  PublicKey,
  Connection,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token';

// ShadowWire fee (1%)
export const SHADOWWIRE_FEE_BPS = 100;

// Well-known token mints for settlement routing
export const KNOWN_MINTS = {
  // Wrapped SOL
  SOL: 'So11111111111111111111111111111111111111112',
  // USDC
  USDC_DEVNET: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
  USDC_MAINNET: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  // USDT
  USDT_MAINNET: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
} as const;

/**
 * Get the ShadowWire token symbol from a mint address
 */
export function tokenFromMint(mint: string | PublicKey): ShadowWireToken | null {
  const mintStr = typeof mint === 'string' ? mint : mint.toBase58();

  // Check each known mint
  if (mintStr === KNOWN_MINTS.SOL) return 'SOL';
  if (mintStr === KNOWN_MINTS.USDC_DEVNET || mintStr === KNOWN_MINTS.USDC_MAINNET) return 'USDC';
  if (mintStr === KNOWN_MINTS.USDT_MAINNET) return 'USDT';

  // Not a known mint
  return null;
}

/**
 * Check if a mint is supported by ShadowWire
 */
export function isMintSupportedByShadowWire(mint: string | PublicKey): boolean {
  return tokenFromMint(mint) !== null;
}

// Settlement method enum matching on-chain
export enum SettlementMethod {
  ShadowWire = 0,
  CSPL = 1,
  StandardSPL = 2,
}

// Supported ShadowWire tokens
export const SHADOWWIRE_TOKENS = [
  'SOL', 'USDC', 'USDT', 'BONK', 'WIF', 'POPCAT', 'RADR',
  'ORE', 'GRASS', 'RAY', 'JUP', 'PYTH', 'JTO', 'RENDER',
  'HNT', 'MOBILE', 'IOT'
] as const;

export type ShadowWireToken = typeof SHADOWWIRE_TOKENS[number];

// Transfer type for ShadowWire
export enum TransferType {
  Internal = 'internal', // Both parties use ShadowWire, amount hidden
  External = 'external', // Recipient can be any wallet, amount visible
}

export interface ShadowWireTransferParams {
  sender: string;
  recipient: string;
  amount: number;
  token: ShadowWireToken;
  type: TransferType;
  customProof?: Uint8Array;
}

export interface ShadowWireBalance {
  token: ShadowWireToken;
  balance: number;
  pendingDeposits: number;
  pendingWithdrawals: number;
}

/**
 * ShadowWire client for private transfers
 *
 * In production, this wraps the @radr/shadowwire SDK.
 * For development, it provides simulated functionality.
 */
export class ShadowWireClient {
  private debug: boolean;

  constructor(options?: { debug?: boolean }) {
    this.debug = options?.debug ?? false;
  }

  /**
   * Execute a private transfer via ShadowWire
   */
  async transfer(params: ShadowWireTransferParams & {
    wallet: { signMessage: (msg: Uint8Array) => Promise<Uint8Array> };
  }): Promise<{ success: boolean; txId?: string; error?: string }> {
    if (this.debug) {
      console.log('ShadowWire transfer:', params);
    }

    // Validate token is supported
    if (!SHADOWWIRE_TOKENS.includes(params.token)) {
      return { success: false, error: `Unsupported token: ${params.token}` };
    }

    // Calculate fee
    const fee = params.amount * SHADOWWIRE_FEE_BPS / 10000;
    const netAmount = params.amount - fee;

    if (this.debug) {
      console.log(`  Gross: ${params.amount}, Fee: ${fee}, Net: ${netAmount}`);
    }

    // In production:
    // const { ShadowWireClient } = await import('@radr/shadowwire');
    // const client = new ShadowWireClient({ debug: this.debug });
    // return client.transfer(params);

    // Development simulation
    return {
      success: true,
      txId: `sim_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };
  }

  /**
   * Deposit tokens into ShadowWire
   */
  async deposit(params: {
    wallet: string;
    amount: number;
    token: ShadowWireToken;
  }): Promise<{ success: boolean; txId?: string; error?: string }> {
    if (this.debug) {
      console.log('ShadowWire deposit:', params);
    }

    // In production:
    // const { ShadowWireClient } = await import('@radr/shadowwire');
    // const client = new ShadowWireClient();
    // return client.deposit(params);

    return {
      success: true,
      txId: `sim_deposit_${Date.now()}`,
    };
  }

  /**
   * Withdraw tokens from ShadowWire
   */
  async withdraw(params: {
    wallet: string;
    amount: number;
    token: ShadowWireToken;
  }): Promise<{ success: boolean; txId?: string; error?: string }> {
    if (this.debug) {
      console.log('ShadowWire withdraw:', params);
    }

    return {
      success: true,
      txId: `sim_withdraw_${Date.now()}`,
    };
  }

  /**
   * Get ShadowWire balance for a wallet
   */
  async getBalance(wallet: string, token: ShadowWireToken): Promise<ShadowWireBalance> {
    if (this.debug) {
      console.log('ShadowWire getBalance:', wallet, token);
    }

    // In production, query ShadowWire API
    return {
      token,
      balance: 0,
      pendingDeposits: 0,
      pendingWithdrawals: 0,
    };
  }
}

/**
 * Check if a token is supported by ShadowWire
 */
export function isShadowWireSupported(token: string): token is ShadowWireToken {
  return SHADOWWIRE_TOKENS.includes(token as ShadowWireToken);
}

/**
 * Calculate net amount after ShadowWire fee
 */
export function calculateNetAmount(grossAmount: number): number {
  const fee = grossAmount * SHADOWWIRE_FEE_BPS / 10000;
  return grossAmount - fee;
}

/**
 * Calculate gross amount needed to receive a specific net amount
 */
export function calculateGrossAmount(netAmount: number): number {
  return Math.ceil(netAmount * 10000 / (10000 - SHADOWWIRE_FEE_BPS));
}

/**
 * Select the best settlement method for a trade
 */
export function selectSettlementMethod(
  baseMint: PublicKey,
  quoteMint: PublicKey,
  preferPrivate: boolean = true
): SettlementMethod {
  // Check if both mints are supported by ShadowWire
  const baseSupported = isMintSupportedByShadowWire(baseMint);
  const quoteSupported = isMintSupportedByShadowWire(quoteMint);

  if (preferPrivate && baseSupported && quoteSupported) {
    // Both tokens supported - use ShadowWire for privacy
    return SettlementMethod.ShadowWire;
  }

  // Fall back to standard SPL
  return SettlementMethod.StandardSPL;
}

/**
 * Execute settlement for a matched trade
 */
export async function executeSettlement(params: {
  buyer: PublicKey;
  seller: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseAmount: bigint;
  quoteAmount: bigint;
  method: SettlementMethod;
  connection: Connection;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
}): Promise<{ success: boolean; baseTxId?: string; quoteTxId?: string; error?: string }> {
  const { method, baseAmount, quoteAmount, buyer, seller } = params;

  switch (method) {
    case SettlementMethod.ShadowWire: {
      const client = new ShadowWireClient({ debug: true });

      // Map mints to ShadowWire tokens
      const baseToken = tokenFromMint(params.baseMint);
      const quoteToken = tokenFromMint(params.quoteMint);

      if (!baseToken || !quoteToken) {
        // Fallback to SPL if token not supported
        return executeSettlement({ ...params, method: SettlementMethod.StandardSPL });
      }

      // Transfer base tokens: Seller -> Buyer
      const baseResult = await client.transfer({
        sender: seller.toBase58(),
        recipient: buyer.toBase58(),
        amount: Number(baseAmount),
        token: baseToken,
        type: TransferType.Internal,
        wallet: { signMessage: params.signMessage },
      });

      if (!baseResult.success) {
        return { success: false, error: `Base transfer failed: ${baseResult.error}` };
      }

      // Transfer quote tokens: Buyer -> Seller
      const quoteResult = await client.transfer({
        sender: buyer.toBase58(),
        recipient: seller.toBase58(),
        amount: Number(quoteAmount),
        token: quoteToken,
        type: TransferType.Internal,
        wallet: { signMessage: params.signMessage },
      });

      if (!quoteResult.success) {
        return { success: false, error: `Quote transfer failed: ${quoteResult.error}` };
      }

      return {
        success: true,
        baseTxId: baseResult.txId,
        quoteTxId: quoteResult.txId,
      };
    }

    case SettlementMethod.CSPL:
      // C-SPL not yet available - fallback to ShadowWire or SPL
      console.warn('C-SPL settlement requested but not available, falling back to ShadowWire');
      return executeSettlement({ ...params, method: SettlementMethod.ShadowWire });

    case SettlementMethod.StandardSPL: {
      // Standard SPL transfer (no privacy, but always available)
      const instructions: TransactionInstruction[] = [];

      // Base transfer: Seller -> Buyer
      const sellerBaseAta = getAssociatedTokenAddressSync(params.baseMint, seller);
      const buyerBaseAta = getAssociatedTokenAddressSync(params.baseMint, buyer);

      // Check if buyer's base ATA exists
      const buyerBaseAtaInfo = await params.connection.getAccountInfo(buyerBaseAta);
      if (!buyerBaseAtaInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            seller, // payer
            buyerBaseAta,
            buyer,
            params.baseMint
          )
        );
      }

      instructions.push(
        createTransferInstruction(
          sellerBaseAta,
          buyerBaseAta,
          seller,
          baseAmount
        )
      );

      // Quote transfer: Buyer -> Seller
      const buyerQuoteAta = getAssociatedTokenAddressSync(params.quoteMint, buyer);
      const sellerQuoteAta = getAssociatedTokenAddressSync(params.quoteMint, seller);

      // Check if seller's quote ATA exists
      const sellerQuoteAtaInfo = await params.connection.getAccountInfo(sellerQuoteAta);
      if (!sellerQuoteAtaInfo) {
        instructions.push(
          createAssociatedTokenAccountInstruction(
            buyer, // payer
            sellerQuoteAta,
            seller,
            params.quoteMint
          )
        );
      }

      instructions.push(
        createTransferInstruction(
          buyerQuoteAta,
          sellerQuoteAta,
          buyer,
          quoteAmount
        )
      );

      // Return instructions for the caller to build and sign transaction
      // Note: In production, this would be handled differently (e.g., return tx to sign)
      return {
        success: true,
        baseTxId: `spl_pending_${Date.now()}`,
        quoteTxId: `spl_pending_${Date.now()}`,
        // @ts-expect-error - extend return type for SPL case
        instructions,
      };
    }

    default:
      return { success: false, error: 'Unknown settlement method' };
  }
}
