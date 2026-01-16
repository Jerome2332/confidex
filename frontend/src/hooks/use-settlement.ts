'use client';

import { useCallback, useState } from 'react';
import { useShadowWire } from './use-shadowwire';
import { useWallet } from '@solana/wallet-adapter-react';

import { createLogger } from '@/lib/logger';

const log = createLogger('settlement');

export interface SettlementParams {
  buyerAddress: string;
  sellerAddress: string;
  baseAmount: number;  // SOL amount in token units
  quoteAmount: number; // USDC amount in token units
}

export interface SettlementResult {
  success: boolean;
  baseTransferSig?: string;
  quoteTransferSig?: string;
  error?: string;
}

export interface UseSettlementReturn {
  executeSettlement: (params: SettlementParams) => Promise<SettlementResult>;
  isSettlementReady: boolean;
  isSettling: boolean;
}

/**
 * Hook for executing order settlements via ShadowWire
 *
 * Settlement flow:
 * 1. Buyer sends USDC to seller (internal transfer - amount hidden)
 * 2. Seller sends SOL to buyer (internal transfer - amount hidden)
 *
 * Both transfers happen via ShadowWire's privacy-preserving transfer mechanism.
 */
export function useSettlement(): UseSettlementReturn {
  const { transfer, isReady } = useShadowWire();
  const { publicKey } = useWallet();
  const [isSettling, setIsSettling] = useState(false);

  const executeSettlement = useCallback(async (params: SettlementParams): Promise<SettlementResult> => {
    if (!isReady) {
      return { success: false, error: 'ShadowWire not ready' };
    }

    if (!publicKey) {
      return { success: false, error: 'Wallet not connected' };
    }

    const userAddress = publicKey.toBase58();
    setIsSettling(true);

    log.debug('Executing via ShadowWire...');
    log.debug('  Buyer:', { buyerAddress: params.buyerAddress });
    log.debug('  Seller:', { sellerAddress: params.sellerAddress });
    console.log('  Base (SOL):', params.baseAmount, 'seller -> buyer');
    console.log('  Quote (USDC):', params.quoteAmount, 'buyer -> seller');

    try {
      const result: SettlementResult = { success: true };

      // Determine which leg(s) we need to execute based on current user
      const isBuyer = userAddress === params.buyerAddress;
      const isSeller = userAddress === params.sellerAddress;

      if (!isBuyer && !isSeller) {
        return { success: false, error: 'User is not part of this trade' };
      }

      // If user is buyer: send USDC to seller
      if (isBuyer) {
        log.debug('Executing quote transfer (buyer -> seller USDC)');
        const quoteTransfer = await transfer({
          recipient: params.sellerAddress,
          amount: params.quoteAmount,
          token: 'USDC',
          type: 'internal', // Internal = amount hidden
        });

        if (!quoteTransfer.success) {
          return { success: false, error: 'Quote transfer failed' };
        }

        result.quoteTransferSig = quoteTransfer.tx_signature;
        log.debug('[Settlement] Quote transfer complete:', { tx_signature: quoteTransfer.tx_signature });
      }

      // If user is seller: send SOL to buyer
      if (isSeller) {
        log.debug('Executing base transfer (seller -> buyer SOL)');
        const baseTransfer = await transfer({
          recipient: params.buyerAddress,
          amount: params.baseAmount,
          token: 'SOL',
          type: 'internal', // Internal = amount hidden
        });

        if (!baseTransfer.success) {
          return { success: false, error: 'Base transfer failed' };
        }

        result.baseTransferSig = baseTransfer.tx_signature;
        log.debug('[Settlement] Base transfer complete:', { tx_signature: baseTransfer.tx_signature });
      }

      log.debug('Complete');
      return result;
    } catch (err) {
      log.error('Error', { error: err instanceof Error ? err.message : String(err) });
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Settlement failed',
      };
    } finally {
      setIsSettling(false);
    }
  }, [transfer, isReady, publicKey]);

  return {
    executeSettlement,
    isSettlementReady: isReady,
    isSettling,
  };
}

/**
 * Helper to calculate settlement amounts from encrypted order data
 * In a real implementation, this would involve decrypting the matched order amounts
 */
export function calculateSettlementAmounts(
  matchedAmount: bigint, // Amount in lamports
  matchedPrice: bigint,  // Price in USDC micro-units
  side: 'buy' | 'sell'
): { baseAmount: number; quoteAmount: number } {
  // Convert from lamports to SOL (9 decimals)
  const baseAmount = Number(matchedAmount) / 1e9;

  // Calculate USDC amount: amount * price
  // matchedAmount is in lamports (9 decimals)
  // matchedPrice is in micro-USDC (6 decimals)
  // Result needs to be in USDC (6 decimals then converted to float)
  const quoteAmountRaw = (matchedAmount * matchedPrice) / BigInt(1e9);
  const quoteAmount = Number(quoteAmountRaw) / 1e6;

  return { baseAmount, quoteAmount };
}
