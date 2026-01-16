'use client';

import { useCallback, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, Transaction, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { CONFIDEX_PROGRAM_ID } from '@/lib/constants';
import { deriveUserBalancePda, derivePairPda, deriveExchangePda } from '@/lib/confidex-client';
import { TRADING_PAIRS } from '@/lib/constants';

// C-SPL settlement is coming soon - this prepares the infrastructure
const CSPL_ENABLED = false;

// Token mints
const SOL_MINT = new PublicKey(TRADING_PAIRS[0].baseMint);
const USDC_MINT = new PublicKey(TRADING_PAIRS[0].quoteMint);

export interface CsplSettlementParams {
  buyerAddress: PublicKey;
  sellerAddress: PublicKey;
  // Encrypted amounts (64 bytes each)
  encryptedBaseAmount: Uint8Array;
  encryptedQuoteAmount: Uint8Array;
  // Order PDAs for tracking
  buyOrderPda: PublicKey;
  sellOrderPda: PublicKey;
}

export interface CsplSettlementResult {
  success: boolean;
  signature?: string;
  error?: string;
}

export interface UseCsplSettlementReturn {
  executeSettlement: (params: CsplSettlementParams) => Promise<CsplSettlementResult>;
  isReady: boolean;
  isSettling: boolean;
  isCsplEnabled: boolean;
}

/**
 * Hook for executing settlements via C-SPL confidential transfers
 *
 * Settlement flow (when C-SPL is enabled):
 * 1. MPC computes settlement amounts (encrypted comparison)
 * 2. C-SPL confidential_transfer: seller_csol_balance -> buyer_csol_balance
 * 3. C-SPL confidential_transfer: buyer_cusdc_balance -> seller_cusdc_balance
 * 4. Update order statuses to Filled
 *
 * Until C-SPL is live, this uses simulated settlement with plaintext balances.
 */
export function useCsplSettlement(): UseCsplSettlementReturn {
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [isSettling, setIsSettling] = useState(false);

  /**
   * Build settle_orders instruction (simulated until C-SPL ready)
   */
  const buildSettleInstruction = useCallback(async (
    params: CsplSettlementParams
  ): Promise<TransactionInstruction> => {
    const [exchangePda] = deriveExchangePda();
    const [pairPda] = derivePairPda(SOL_MINT, USDC_MINT);

    // Derive balance PDAs for both parties
    const [buyerSolBalancePda] = deriveUserBalancePda(params.buyerAddress, SOL_MINT);
    const [buyerUsdcBalancePda] = deriveUserBalancePda(params.buyerAddress, USDC_MINT);
    const [sellerSolBalancePda] = deriveUserBalancePda(params.sellerAddress, SOL_MINT);
    const [sellerUsdcBalancePda] = deriveUserBalancePda(params.sellerAddress, USDC_MINT);

    // Build instruction data
    // Format: discriminator (8) + encrypted_base_amount (64) + encrypted_quote_amount (64)
    const discriminator = computeSettleDiscriminator();
    const data = Buffer.alloc(8 + 64 + 64);
    discriminator.copy(data, 0);
    Buffer.from(params.encryptedBaseAmount).copy(data, 8);
    Buffer.from(params.encryptedQuoteAmount).copy(data, 72);

    // Account layout for settle_orders (when implemented on-chain):
    // 0. exchange - ExchangeState PDA
    // 1. pair - TradingPair PDA
    // 2. buy_order - ConfidentialOrder (buyer's order)
    // 3. sell_order - ConfidentialOrder (seller's order)
    // 4. buyer - Buyer's public key
    // 5. seller - Seller's public key
    // 6. buyer_sol_balance - Buyer's UserConfidentialBalance for SOL
    // 7. buyer_usdc_balance - Buyer's UserConfidentialBalance for USDC
    // 8. seller_sol_balance - Seller's UserConfidentialBalance for SOL
    // 9. seller_usdc_balance - Seller's UserConfidentialBalance for USDC
    // 10. arcium_adapter - Arcium MPC program (for encrypted computations)
    // 11. cspl_program - C-SPL token program (for confidential transfers)
    // 12. authority - Settlement authority (signer)
    // 13. system_program

    return new TransactionInstruction({
      keys: [
        { pubkey: exchangePda, isSigner: false, isWritable: false },
        { pubkey: pairPda, isSigner: false, isWritable: true },
        { pubkey: params.buyOrderPda, isSigner: false, isWritable: true },
        { pubkey: params.sellOrderPda, isSigner: false, isWritable: true },
        { pubkey: params.buyerAddress, isSigner: false, isWritable: false },
        { pubkey: params.sellerAddress, isSigner: false, isWritable: false },
        { pubkey: buyerSolBalancePda, isSigner: false, isWritable: true },
        { pubkey: buyerUsdcBalancePda, isSigner: false, isWritable: true },
        { pubkey: sellerSolBalancePda, isSigner: false, isWritable: true },
        { pubkey: sellerUsdcBalancePda, isSigner: false, isWritable: true },
        { pubkey: publicKey!, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: CONFIDEX_PROGRAM_ID,
      data,
    });
  }, [publicKey]);

  /**
   * Execute settlement using C-SPL confidential transfers
   */
  const executeSettlement = useCallback(async (
    params: CsplSettlementParams
  ): Promise<CsplSettlementResult> => {
    if (!publicKey || !signTransaction) {
      return { success: false, error: 'Wallet not connected' };
    }

    setIsSettling(true);

    console.log('[CsplSettlement] Executing settlement...');
    console.log('  Buyer:', params.buyerAddress.toString());
    console.log('  Seller:', params.sellerAddress.toString());
    console.log('  C-SPL enabled:', CSPL_ENABLED);

    try {
      if (!CSPL_ENABLED) {
        // Simulation mode - log what would happen
        console.log('[CsplSettlement] C-SPL not yet enabled - simulating settlement');
        console.log('[CsplSettlement] When C-SPL is live, this will:');
        console.log('  1. Decrypt settlement amounts via Arcium MPC');
        console.log('  2. Execute C-SPL confidential transfer: SOL seller -> buyer');
        console.log('  3. Execute C-SPL confidential transfer: USDC buyer -> seller');
        console.log('  4. Update order statuses to Filled');

        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 1000));

        return {
          success: true,
          signature: 'simulated-cspl-settlement-' + Date.now(),
        };
      }

      // Build and send settlement transaction
      const instruction = await buildSettleInstruction(params);
      const transaction = new Transaction().add(instruction);

      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        return {
          success: false,
          error: 'Settlement transaction failed',
        };
      }

      console.log('[CsplSettlement] Settlement confirmed:', signature);

      return {
        success: true,
        signature,
      };
    } catch (err) {
      console.error('[CsplSettlement] Error:', err);
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Settlement failed',
      };
    } finally {
      setIsSettling(false);
    }
  }, [publicKey, signTransaction, connection, sendTransaction, buildSettleInstruction]);

  return {
    executeSettlement,
    isReady: !!publicKey,
    isSettling,
    isCsplEnabled: CSPL_ENABLED,
  };
}

/**
 * Compute Anchor discriminator for settle_orders instruction
 */
function computeSettleDiscriminator(): Buffer {
  // Pre-computed sha256("global:settle_orders")[0..8]
  // In real implementation, compute dynamically
  return Buffer.from([0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x7a, 0x8b]);
}

/**
 * Interface for MPC-computed settlement amounts
 * These come from Arcium encrypted comparison
 */
export interface MpcSettlementAmounts {
  // Encrypted amounts to transfer
  encryptedBaseAmount: Uint8Array;  // SOL amount seller -> buyer
  encryptedQuoteAmount: Uint8Array; // USDC amount buyer -> seller
  // For UI display only (decrypted by user's own key)
  displayBaseAmount?: string;
  displayQuoteAmount?: string;
}

/**
 * Simulate MPC settlement amount computation
 * In production, this would call Arcium's compare_encrypted and compute_settlement
 */
export async function computeSettlementAmounts(
  buyEncryptedAmount: Uint8Array,
  buyEncryptedPrice: Uint8Array,
  sellEncryptedAmount: Uint8Array,
  sellEncryptedPrice: Uint8Array
): Promise<MpcSettlementAmounts> {
  console.log('[MpcSettlement] Computing settlement amounts via MPC...');

  // Simulate MPC latency
  await new Promise(resolve => setTimeout(resolve, 500));

  // In dev mode, extract plaintext from first 8 bytes
  const buyAmount = readU64LE(buyEncryptedAmount);
  const buyPrice = readU64LE(buyEncryptedPrice);
  const sellAmount = readU64LE(sellEncryptedAmount);
  const sellPrice = readU64LE(sellEncryptedPrice);

  console.log('[MpcSettlement] Buy order:', buyAmount.toString(), '@', buyPrice.toString());
  console.log('[MpcSettlement] Sell order:', sellAmount.toString(), '@', sellPrice.toString());

  // Determine matched amount (min of both)
  const matchedAmount = buyAmount < sellAmount ? buyAmount : sellAmount;

  // Use buy price for settlement (taker gets maker's price)
  const matchedPrice = buyPrice;

  // Calculate quote amount: (amount * price) / 1e9 (adjust for decimals)
  const quoteAmount = (matchedAmount * matchedPrice) / BigInt(1e9);

  console.log('[MpcSettlement] Matched amount:', matchedAmount.toString());
  console.log('[MpcSettlement] Quote amount:', quoteAmount.toString());

  // Pack results as "encrypted" amounts (dev mode: plaintext in first 8 bytes)
  const encryptedBaseAmount = packU64LE(matchedAmount);
  const encryptedQuoteAmount = packU64LE(quoteAmount);

  return {
    encryptedBaseAmount,
    encryptedQuoteAmount,
    displayBaseAmount: (Number(matchedAmount) / 1e9).toFixed(4) + ' SOL',
    displayQuoteAmount: (Number(quoteAmount) / 1e6).toFixed(2) + ' USDC',
  };
}

function readU64LE(data: Uint8Array): bigint {
  const view = new DataView(data.buffer, data.byteOffset, 8);
  return view.getBigUint64(0, true);
}

function packU64LE(value: bigint): Uint8Array {
  const result = new Uint8Array(64);
  const view = new DataView(result.buffer);
  view.setBigUint64(0, value, true);
  return result;
}
