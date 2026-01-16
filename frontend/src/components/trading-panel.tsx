'use client';

import { FC, useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Lock, Loader2, Shield, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PublicKey } from '@solana/web3.js';
import { useProof } from '@/hooks/use-proof';
import { useEncryption } from '@/hooks/use-encryption';
import { useOrderStore } from '@/stores/order-store';
import { TRADING_PAIRS } from '@/lib/constants';
import {
  buildPlaceOrderTransaction,
  buildAutoWrapAndPlaceOrderTransaction,
  isExchangeInitialized,
  isPairInitialized,
  Side as ProgramSide,
  OrderType as ProgramOrderType,
} from '@/lib/confidex-client';
import { useEncryptedBalance } from '@/hooks/use-encrypted-balance';
import { useTokenBalance } from '@/hooks/use-token-balance';
import { NATIVE_MINT } from '@solana/spl-token';
import Link from 'next/link';

type OrderSide = 'buy' | 'sell';
type OrderType = 'limit' | 'market';

export const TradingPanel: FC = () => {
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction, signMessage } = useWallet();
  const [side, setSide] = useState<OrderSide>('buy');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Use proof, encryption, and balance hooks
  const { isGenerating, proofReady, lastProof, generateProof } = useProof();
  const { isInitialized, initializeEncryption, encryptValue } = useEncryption();
  const { addOrder, setIsPlacingOrder } = useOrderStore();
  const { balances: wrappedBalances, isLoading: isLoadingBalances, refresh: refreshBalances, canAfford, isEncrypted } = useEncryptedBalance();
  const { balances: tokenBalances, refresh: refreshTokenBalances } = useTokenBalance();

  // Calculate required amount and wrap needs
  const getOrderRequirements = () => {
    if (!amount || parseFloat(amount) <= 0) {
      return { requiredAmount: BigInt(0), wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
    }

    const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));

    if (side === 'sell') {
      // Selling SOL: need wrapped SOL
      const currentWrapped = wrappedBalances.sol;
      const availableUnwrapped = tokenBalances.sol;

      if (currentWrapped >= amountLamports) {
        // Have enough wrapped, no wrap needed
        return { requiredAmount: amountLamports, wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
      }

      const wrapNeeded = amountLamports - currentWrapped;
      const totalAvailable = currentWrapped + availableUnwrapped;

      if (totalAvailable >= amountLamports) {
        // Can wrap the difference
        return { requiredAmount: amountLamports, wrapNeeded, canProceed: true, needsWrap: true };
      }

      // Truly insufficient
      return { requiredAmount: amountLamports, wrapNeeded, canProceed: false, needsWrap: false };
    } else {
      // Buying SOL: need wrapped USDC (amount * price)
      if (orderType === 'limit' && price && parseFloat(price) > 0) {
        const totalUsdcNeeded = BigInt(Math.floor(parseFloat(amount) * parseFloat(price) * 1e6));
        const currentWrapped = wrappedBalances.usdc;
        const availableUnwrapped = tokenBalances.usdc;

        if (currentWrapped >= totalUsdcNeeded) {
          // Have enough wrapped, no wrap needed
          return { requiredAmount: totalUsdcNeeded, wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
        }

        const wrapNeeded = totalUsdcNeeded - currentWrapped;
        const totalAvailable = currentWrapped + availableUnwrapped;

        if (totalAvailable >= totalUsdcNeeded) {
          // Can wrap the difference
          return { requiredAmount: totalUsdcNeeded, wrapNeeded, canProceed: true, needsWrap: true };
        }

        // Truly insufficient
        return { requiredAmount: totalUsdcNeeded, wrapNeeded, canProceed: false, needsWrap: false };
      }

      // Market order or no price yet - allow proceed
      return { requiredAmount: BigInt(0), wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
    }
  };

  const { requiredAmount, wrapNeeded, canProceed, needsWrap } = getOrderRequirements();

  // Check if user has truly insufficient balance (can't even wrap to cover it)
  const getInsufficientBalanceError = (): string | null => {
    if (!amount || parseFloat(amount) <= 0) return null;
    if (canProceed) return null;

    if (side === 'sell') {
      const totalAvailable = wrappedBalances.sol + tokenBalances.sol;
      const needed = parseFloat(amount);
      const have = Number(totalAvailable) / 1e9;
      return `Insufficient SOL. Have: ${have.toFixed(4)}, Need: ${needed.toFixed(4)}`;
    } else {
      if (orderType === 'limit' && price && parseFloat(price) > 0) {
        const totalAvailable = wrappedBalances.usdc + tokenBalances.usdc;
        const needed = parseFloat(amount) * parseFloat(price);
        const have = Number(totalAvailable) / 1e6;
        return `Insufficient USDC. Have: ${have.toFixed(2)}, Need: ${needed.toFixed(2)}`;
      }
    }

    return null;
  };

  const insufficientBalanceError = getInsufficientBalanceError();
  const hasZeroBalance = wrappedBalances.sol === BigInt(0) && wrappedBalances.usdc === BigInt(0);
  const hasZeroTotalBalance = hasZeroBalance && tokenBalances.sol === BigInt(0) && tokenBalances.usdc === BigInt(0);

  // Initialize encryption on wallet connect
  useEffect(() => {
    if (connected && publicKey && !isInitialized) {
      console.log('[TradingPanel] Wallet connected, initializing encryption...');
      initializeEncryption().catch(console.error);
    }
  }, [connected, publicKey, isInitialized, initializeEncryption]);

  const handleSubmit = async () => {
    console.log('[TradingPanel] handleSubmit called');
    console.log('[TradingPanel] State:', { connected, publicKey: publicKey?.toString(), amount, price, orderType });

    if (!connected || !publicKey) {
      console.log('[TradingPanel] Wallet not connected');
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || (orderType === 'limit' && !price)) {
      console.log('[TradingPanel] Missing fields');
      toast.error('Please fill in all fields');
      return;
    }

    // Check for truly insufficient balance (can't proceed even with auto-wrap)
    if (insufficientBalanceError) {
      console.log('[TradingPanel] Insufficient balance:', insufficientBalanceError);
      toast.error(insufficientBalanceError);
      return;
    }

    if (!signMessage) {
      console.log('[TradingPanel] signMessage not available');
      toast.error('Wallet does not support message signing');
      return;
    }

    setIsSubmitting(true);
    setIsPlacingOrder(true);

    try {
      // Step 0: Check if exchange and pair are initialized
      console.log('[TradingPanel] Step 0: Checking program state...');

      const exchangeReady = await isExchangeInitialized(connection);
      if (!exchangeReady) {
        console.log('[TradingPanel] Exchange not initialized');
        toast.error('Exchange not initialized on devnet. Please contact admin.', { duration: 5000 });

        // For demo purposes, show a simulated success flow
        toast.info('Demo mode: Simulating order flow...', { id: 'demo-mode' });
        await simulateDemoOrder();
        return;
      }

      const tradingPair = TRADING_PAIRS[0];
      const baseMint = new PublicKey(tradingPair.baseMint);
      const quoteMint = new PublicKey(tradingPair.quoteMint);

      const pairReady = await isPairInitialized(connection, baseMint, quoteMint);
      if (!pairReady) {
        console.log('[TradingPanel] Trading pair not initialized');
        toast.error('SOL/USDC pair not initialized on devnet. Please contact admin.', { duration: 5000 });

        // For demo purposes, show a simulated success flow
        toast.info('Demo mode: Simulating order flow...', { id: 'demo-mode' });
        await simulateDemoOrder();
        return;
      }

      // Step 1: Generate ZK eligibility proof
      console.log('[TradingPanel] Step 1: Generating ZK proof...');
      toast.info('Generating eligibility proof...', { id: 'proof-gen' });

      const proofResult = await generateProof();
      console.log('[TradingPanel] Proof generated:', {
        proofLength: proofResult.proof.length,
        rootLength: proofResult.blacklistRoot.length,
      });
      toast.success('Proof generated', { id: 'proof-gen' });

      // Step 2: Initialize encryption if needed
      if (!isInitialized) {
        console.log('[TradingPanel] Step 2: Initializing encryption...');
        await initializeEncryption();
      }

      // Step 3: Encrypt order parameters
      console.log('[TradingPanel] Step 3: Encrypting order parameters...');
      toast.info('Encrypting order...', { id: 'encrypt' });

      const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const priceLamports = orderType === 'limit'
        ? BigInt(Math.floor(parseFloat(price) * 1e6))
        : BigInt(0);

      const encryptedAmount = await encryptValue(amountLamports);
      const encryptedPrice = await encryptValue(priceLamports);

      console.log('[TradingPanel] Encrypted values:', {
        encryptedAmountLength: encryptedAmount.length,
        encryptedPriceLength: encryptedPrice.length,
      });
      toast.success('Order encrypted', { id: 'encrypt' });

      // Step 4: Build transaction using Anchor-compatible client
      console.log('[TradingPanel] Step 4: Building transaction...');

      const programSide = side === 'buy' ? ProgramSide.Buy : ProgramSide.Sell;
      const programOrderType = orderType === 'limit' ? ProgramOrderType.Limit : ProgramOrderType.Market;

      let transaction;

      if (needsWrap && wrapNeeded > BigInt(0)) {
        // Auto-wrap flow: combine wrap + place_order in one transaction
        console.log('[TradingPanel] Auto-wrap needed, wrapping', wrapNeeded.toString());
        toast.info('Wrapping tokens & placing order...', { id: 'tx-build' });

        const wrapTokenMint = side === 'sell'
          ? NATIVE_MINT
          : new PublicKey(TRADING_PAIRS[0].quoteMint);

        transaction = await buildAutoWrapAndPlaceOrderTransaction({
          connection,
          maker: publicKey,
          baseMint,
          quoteMint,
          side: programSide,
          orderType: programOrderType,
          encryptedAmount,
          encryptedPrice,
          eligibilityProof: proofResult.proof,
          wrapTokenMint,
          wrapAmount: wrapNeeded,
        });

        console.log('[TradingPanel] Auto-wrap transaction built:', {
          blockhash: transaction.recentBlockhash?.slice(0, 16) + '...',
          instructionCount: transaction.instructions.length,
        });
      } else {
        // Standard flow: just place_order
        toast.info('Building transaction...', { id: 'tx-build' });

        transaction = await buildPlaceOrderTransaction({
          connection,
          maker: publicKey,
          baseMint,
          quoteMint,
          side: programSide,
          orderType: programOrderType,
          encryptedAmount,
          encryptedPrice,
          eligibilityProof: proofResult.proof,
        });

        console.log('[TradingPanel] Transaction built:', {
          blockhash: transaction.recentBlockhash?.slice(0, 16) + '...',
          instructionCount: transaction.instructions.length,
        });
      }

      toast.success('Transaction built', { id: 'tx-build' });

      // Step 5: Send transaction
      console.log('[TradingPanel] Step 5: Sending transaction...');
      toast.info('Sending transaction - please approve in wallet...', { id: 'tx-send' });

      const signature = await sendTransaction(transaction, connection);
      console.log('[TradingPanel] Transaction sent:', signature);

      toast.info('Confirming transaction...', { id: 'tx-send' });

      // Wait for confirmation
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      if (confirmation.value.err) {
        console.error('[TradingPanel] Transaction failed:', confirmation.value.err);
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      console.log('[TradingPanel] Transaction confirmed:', confirmation);

      // Step 6: Add to order store
      const orderId = Date.now();
      addOrder({
        id: orderId.toString(),
        maker: publicKey,
        pair: 'SOL/USDC',
        side,
        type: orderType,
        encryptedAmount,
        encryptedPrice,
        encryptedFilled: new Uint8Array(64),
        status: 'open',
        createdAt: new Date(),
        filledPercent: 0,
      });

      toast.success(
        `${side.toUpperCase()} order placed successfully`,
        {
          id: 'tx-send',
          description: (
            <a
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              View on Explorer
            </a>
          ),
        }
      );

      console.log('[TradingPanel] Order placed successfully!');

      // Refresh balances after successful order (especially important for auto-wrap)
      refreshBalances();
      refreshTokenBalances();

      // Reset form
      setAmount('');
      setPrice('');

    } catch (error) {
      console.error('[TradingPanel] Error:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to place order',
        { id: 'tx-send' }
      );
    } finally {
      setIsSubmitting(false);
      setIsPlacingOrder(false);
    }
  };

  // Demo mode simulation for when exchange is not initialized
  const simulateDemoOrder = async () => {
    try {
      // Step 1: Generate ZK eligibility proof
      console.log('[TradingPanel] Demo Step 1: Generating ZK proof...');
      toast.info('Generating eligibility proof...', { id: 'proof-gen' });

      const proofResult = await generateProof();
      console.log('[TradingPanel] Demo proof generated:', {
        proofLength: proofResult.proof.length,
      });
      toast.success('Proof generated (simulated)', { id: 'proof-gen' });

      // Step 2: Initialize encryption
      if (!isInitialized) {
        await initializeEncryption();
      }

      // Step 3: Encrypt order
      console.log('[TradingPanel] Demo Step 2: Encrypting order...');
      toast.info('Encrypting order...', { id: 'encrypt' });

      const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const priceLamports = orderType === 'limit'
        ? BigInt(Math.floor(parseFloat(price) * 1e6))
        : BigInt(0);

      const encryptedAmount = await encryptValue(amountLamports);
      const encryptedPrice = await encryptValue(priceLamports);

      toast.success('Order encrypted (simulated)', { id: 'encrypt' });

      // Simulate network delay
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Add to local order store (demo)
      const orderId = Date.now();
      addOrder({
        id: orderId.toString(),
        maker: publicKey!,
        pair: 'SOL/USDC',
        side,
        type: orderType,
        encryptedAmount,
        encryptedPrice,
        encryptedFilled: new Uint8Array(64),
        status: 'open',
        createdAt: new Date(),
        filledPercent: 0,
      });

      toast.success(
        `Demo: ${side.toUpperCase()} order simulated`,
        {
          id: 'demo-mode',
          description: 'Exchange not yet initialized on devnet. Order stored locally.',
        }
      );

      // Reset form
      setAmount('');
      setPrice('');

    } catch (error) {
      console.error('[TradingPanel] Demo error:', error);
      toast.error('Demo simulation failed', { id: 'demo-mode' });
    } finally {
      setIsSubmitting(false);
      setIsPlacingOrder(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold">Place Order</h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          <span>Encrypted</span>
        </div>
      </div>

      {/* Pair Selector */}
      <div className="mb-6">
        <label className="text-sm text-muted-foreground mb-2 block">
          Trading Pair
        </label>
        <select className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground">
          <option value="SOL/USDC">SOL / USDC</option>
          <option value="BONK/USDC" disabled>BONK / USDC (coming soon)</option>
        </select>
      </div>

      {/* Side Tabs */}
      <div className="flex mb-6">
        <button
          onClick={() => setSide('buy')}
          className={`flex-1 py-3 text-center font-medium rounded-l-lg transition-colors ${
            side === 'buy'
              ? 'bg-green-500/20 text-green-400 border border-green-500/50'
              : 'bg-secondary text-muted-foreground border border-border'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`flex-1 py-3 text-center font-medium rounded-r-lg transition-colors ${
            side === 'sell'
              ? 'bg-red-500/20 text-red-400 border border-red-500/50'
              : 'bg-secondary text-muted-foreground border border-border'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Order Type */}
      <div className="flex gap-4 mb-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="orderType"
            checked={orderType === 'limit'}
            onChange={() => setOrderType('limit')}
            className="text-primary"
          />
          <span className="text-sm">Limit</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="radio"
            name="orderType"
            checked={orderType === 'market'}
            onChange={() => setOrderType('market')}
            className="text-primary"
          />
          <span className="text-sm">Market</span>
        </label>
      </div>

      {/* Amount Input */}
      <div className="mb-4">
        <label className="text-sm text-muted-foreground mb-2 block">
          Amount (SOL)
        </label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            step="0.01"
            min="0"
            className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground"
          />
          <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        </div>
      </div>

      {/* Price Input (Limit only) */}
      {orderType === 'limit' && (
        <div className="mb-6">
          <label className="text-sm text-muted-foreground mb-2 block">
            Price (USDC)
          </label>
          <div className="relative">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full bg-secondary border border-border rounded-lg px-4 py-3 text-foreground placeholder:text-muted-foreground"
            />
            <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
        </div>
      )}

      {/* Proof Status */}
      {isGenerating && (
        <div className="mb-4 p-3 bg-secondary rounded-lg">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="text-sm">Generating ZK proof...</span>
          </div>
        </div>
      )}

      {proofReady && !isGenerating && (
        <div className="mb-4 p-3 bg-secondary rounded-lg">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <span className="text-sm text-primary">Proof ready</span>
          </div>
        </div>
      )}

      {/* Encryption Status */}
      {connected && (
        <div className="mb-4 text-xs text-muted-foreground">
          Encryption: {isInitialized ? '✓ Ready' : 'Initializing...'}
        </div>
      )}

      {/* Zero Total Balance Warning - truly no funds at all */}
      {connected && hasZeroTotalBalance && !isLoadingBalances && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
            <AlertCircle className="h-4 w-4" />
            <span>No tokens available. Deposit funds to start trading.</span>
          </div>
        </div>
      )}

      {/* Auto-wrap Notice - has unwrapped tokens that will be auto-wrapped */}
      {connected && needsWrap && canProceed && !isLoadingBalances && (
        <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <Shield className="h-4 w-4" />
            <span>
              Will auto-wrap {side === 'sell'
                ? `${(Number(wrapNeeded) / 1e9).toFixed(4)} SOL`
                : `${(Number(wrapNeeded) / 1e6).toFixed(2)} USDC`
              } with your order
            </span>
          </div>
        </div>
      )}

      {/* Insufficient Balance Warning - can't proceed even with auto-wrap */}
      {connected && insufficientBalanceError && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-4 w-4" />
            <span>{insufficientBalanceError}</span>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={!connected || isSubmitting || isGenerating || !!insufficientBalanceError || hasZeroTotalBalance}
        className={`w-full py-4 rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 ${
          side === 'buy'
            ? 'bg-green-500 hover:bg-green-600 text-white'
            : 'bg-red-500 hover:bg-red-600 text-white'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        {isSubmitting || isGenerating ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            {isGenerating ? 'Generating Proof...' : 'Processing...'}
          </>
        ) : !connected ? (
          'Connect Wallet'
        ) : hasZeroTotalBalance ? (
          'No Funds Available'
        ) : insufficientBalanceError ? (
          'Insufficient Balance'
        ) : needsWrap ? (
          `Wrap & ${side === 'buy' ? 'Buy' : 'Sell'} SOL`
        ) : (
          `${side === 'buy' ? 'Buy' : 'Sell'} SOL`
        )}
      </button>

      {/* Privacy Notice */}
      <div className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
        <p>
          Your order amount and price are encrypted using Arcium MPC.
          Only matching orders can reveal if prices cross.
          {isEncrypted && (
            <span className="text-primary ml-1">(C-SPL enabled)</span>
          )}
        </p>
      </div>
    </div>
  );
};
