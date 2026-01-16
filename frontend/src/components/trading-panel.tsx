'use client';

import { FC, useState, useEffect, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { Lock, Loader2, Shield, AlertCircle, Eye, EyeOff, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
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
import { useSettingsStore } from '@/stores/settings-store';
import { usePerpetualStore } from '@/stores/perpetuals-store';
import { OrderConfirmDialog } from './confirm-dialog';
import { LeverageSelector } from './leverage-selector';
import { FundingDisplay } from './funding-display';
import { NATIVE_MINT } from '@solana/spl-token';
import Link from 'next/link';
import { useSolPrice } from '@/hooks/use-pyth-price';

type OrderSide = 'buy' | 'sell';
type PositionSide = 'long' | 'short';
type OrderType = 'limit' | 'market';

type TradingMode = 'spot' | 'perps';

interface TradingPanelProps {
  variant?: 'default' | 'sidebar';
  showAccountSection?: boolean;
  mode?: TradingMode;
}

const PERCENTAGE_PRESETS = [25, 50, 75, 100];

export const TradingPanel: FC<TradingPanelProps> = ({ variant = 'default', showAccountSection = true, mode = 'spot' }) => {
  const isSidebar = variant === 'sidebar';
  const { connection } = useConnection();
  const { connected, publicKey, sendTransaction, signMessage } = useWallet();
  const [side, setSide] = useState<OrderSide>('buy');
  const [positionSide, setPositionSide] = useState<PositionSide>('long');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [collateral, setCollateral] = useState('');
  const [sizePercent, setSizePercent] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  // Use the mode prop instead of store tradingMode
  const tradingMode = mode;

  // Perpetuals store
  const {
    currentInput,
    setCurrentInput,
    defaultLeverage,
    maxLeverage,
    fundingRates,
    selectedMarket,
    isOpeningPosition,
    setIsOpeningPosition,
    estimateLiquidationPrice,
  } = usePerpetualStore();

  // Local leverage state synced with store
  const [leverage, setLeverage] = useState(defaultLeverage);

  // Use proof, encryption, and balance hooks
  const { isGenerating, proofReady, lastProof, generateProof } = useProof();
  const { isInitialized, initializeEncryption, encryptValue } = useEncryption();
  const { addOrder, setIsPlacingOrder } = useOrderStore();
  const { balances: wrappedBalances, isLoading: isLoadingBalances, refresh: refreshBalances, canAfford, isEncrypted } = useEncryptedBalance();
  const { balances: tokenBalances, refresh: refreshTokenBalances } = useTokenBalance();
  const { autoWrap, slippage, notifications, confirmTx, privacyMode, setPrivacyMode } = useSettingsStore();
  const { price: solPrice } = useSolPrice();

  // Show balances (inverse of privacy mode)
  const showBalances = !privacyMode;

  // Calculate available balance for display
  const availableBalance = useMemo(() => {
    if (side === 'buy') {
      // Buying SOL with USDC
      const total = wrappedBalances.usdc + (autoWrap ? tokenBalances.usdc : BigInt(0));
      return Number(total) / 1e6;
    } else {
      // Selling SOL for USDC
      const total = wrappedBalances.sol + (autoWrap ? tokenBalances.sol : BigInt(0));
      return Number(total) / 1e9;
    }
  }, [side, wrappedBalances, tokenBalances, autoWrap]);

  // Calculate order value
  const orderValue = useMemo(() => {
    if (!amount || parseFloat(amount) <= 0) return null;
    const amountNum = parseFloat(amount);
    if (orderType === 'market' && solPrice) {
      return amountNum * solPrice;
    }
    if (orderType === 'limit' && price && parseFloat(price) > 0) {
      return amountNum * parseFloat(price);
    }
    return null;
  }, [amount, price, orderType, solPrice]);

  // Handle percentage preset click
  const handlePercentageClick = (percent: number) => {
    setSizePercent(percent);
    if (availableBalance > 0) {
      if (side === 'buy') {
        // Calculate SOL amount based on USDC balance and current price
        const usdcToUse = availableBalance * (percent / 100);
        const priceToUse = orderType === 'limit' && price ? parseFloat(price) : (solPrice || 100);
        if (priceToUse > 0) {
          const solAmount = usdcToUse / priceToUse;
          setAmount(solAmount.toFixed(4));
        }
      } else {
        // Direct SOL percentage
        const solAmount = availableBalance * (percent / 100);
        setAmount(solAmount.toFixed(4));
      }
    }
  };

  // Handle slider change
  const handleSliderChange = (value: number) => {
    setSizePercent(value);
    if (availableBalance > 0) {
      if (side === 'buy') {
        const usdcToUse = availableBalance * (value / 100);
        const priceToUse = orderType === 'limit' && price ? parseFloat(price) : (solPrice || 100);
        if (priceToUse > 0) {
          const solAmount = usdcToUse / priceToUse;
          setAmount(solAmount.toFixed(4));
        }
      } else {
        const solAmount = availableBalance * (value / 100);
        setAmount(solAmount.toFixed(4));
      }
    }
  };

  // Calculate required amount and wrap needs
  const getOrderRequirements = () => {
    if (!amount || parseFloat(amount) <= 0) {
      return { requiredAmount: BigInt(0), wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
    }

    const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));

    if (side === 'sell') {
      const currentWrapped = wrappedBalances.sol;
      const availableUnwrapped = tokenBalances.sol;

      if (currentWrapped >= amountLamports) {
        return { requiredAmount: amountLamports, wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
      }

      const wrapNeeded = amountLamports - currentWrapped;
      const totalAvailable = currentWrapped + availableUnwrapped;

      if (totalAvailable >= amountLamports && autoWrap) {
        return { requiredAmount: amountLamports, wrapNeeded, canProceed: true, needsWrap: true };
      }

      return { requiredAmount: amountLamports, wrapNeeded, canProceed: false, needsWrap: false };
    } else {
      if (orderType === 'limit' && price && parseFloat(price) > 0) {
        const totalUsdcNeeded = BigInt(Math.floor(parseFloat(amount) * parseFloat(price) * 1e6));
        const currentWrapped = wrappedBalances.usdc;
        const availableUnwrapped = tokenBalances.usdc;

        if (currentWrapped >= totalUsdcNeeded) {
          return { requiredAmount: totalUsdcNeeded, wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
        }

        const wrapNeeded = totalUsdcNeeded - currentWrapped;
        const totalAvailable = currentWrapped + availableUnwrapped;

        if (totalAvailable >= totalUsdcNeeded && autoWrap) {
          return { requiredAmount: totalUsdcNeeded, wrapNeeded, canProceed: true, needsWrap: true };
        }

        return { requiredAmount: totalUsdcNeeded, wrapNeeded, canProceed: false, needsWrap: false };
      }

      return { requiredAmount: BigInt(0), wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
    }
  };

  const { requiredAmount, wrapNeeded, canProceed, needsWrap } = getOrderRequirements();

  // Check if user has truly insufficient balance
  const getInsufficientBalanceError = (): string | null => {
    if (!amount || parseFloat(amount) <= 0) return null;
    if (canProceed) return null;

    if (side === 'sell') {
      const wrappedHave = Number(wrappedBalances.sol) / 1e9;
      const totalAvailable = wrappedBalances.sol + tokenBalances.sol;
      const needed = parseFloat(amount);
      const have = Number(totalAvailable) / 1e9;

      if (totalAvailable >= BigInt(Math.floor(needed * 1e9)) && !autoWrap) {
        return `Insufficient wrapped SOL. Have: ${wrappedHave.toFixed(4)} wrapped. Enable auto-wrap or wrap tokens first.`;
      }

      return `Insufficient SOL. Have: ${have.toFixed(4)}, Need: ${needed.toFixed(4)}`;
    } else {
      if (orderType === 'limit' && price && parseFloat(price) > 0) {
        const wrappedHave = Number(wrappedBalances.usdc) / 1e6;
        const totalAvailable = wrappedBalances.usdc + tokenBalances.usdc;
        const needed = parseFloat(amount) * parseFloat(price);
        const have = Number(totalAvailable) / 1e6;

        if (totalAvailable >= BigInt(Math.floor(needed * 1e6)) && !autoWrap) {
          return `Insufficient wrapped USDC. Have: ${wrappedHave.toFixed(2)} wrapped. Enable auto-wrap or wrap tokens first.`;
        }

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
      initializeEncryption().catch(console.error);
    }
  }, [connected, publicKey, isInitialized, initializeEncryption]);

  // Handle button click
  const handleButtonClick = () => {
    if (!connected || !publicKey) {
      toast.error('Please connect your wallet');
      return;
    }

    // For perps, only require amount
    if (tradingMode === 'perps') {
      if (!amount || parseFloat(amount) <= 0) {
        toast.error('Please enter a position size');
        return;
      }
      handleOpenPosition();
      return;
    }

    // Spot order validation
    if (!amount || (orderType === 'limit' && !price)) {
      toast.error('Please fill in all fields');
      return;
    }

    if (insufficientBalanceError) {
      toast.error(insufficientBalanceError);
      return;
    }

    if (confirmTx) {
      setShowConfirmDialog(true);
    } else {
      handleSubmit();
    }
  };

  // Handle opening a perpetual position
  const handleOpenPosition = async () => {
    if (!connected || !publicKey || !solPrice) {
      toast.error('Please connect your wallet and wait for price feed');
      return;
    }

    setIsOpeningPosition(true);

    try {
      // Generate eligibility proof
      toast.info('Generating eligibility proof...', { id: 'proof-gen' });
      const proofResult = await generateProof();
      toast.success('Proof generated', { id: 'proof-gen' });

      // Initialize encryption if needed
      if (!isInitialized) {
        await initializeEncryption();
      }

      // Encrypt position values
      toast.info('Encrypting position data...', { id: 'encrypt' });
      const sizeLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const entryPriceMicros = BigInt(Math.floor(solPrice * 1e6));
      const collateralMicros = BigInt(Math.floor(parseFloat(amount) * solPrice * 1e6 / leverage));

      const encryptedSize = await encryptValue(sizeLamports);
      const encryptedEntryPrice = await encryptValue(entryPriceMicros);
      const encryptedCollateral = await encryptValue(collateralMicros);
      toast.success('Position data encrypted', { id: 'encrypt' });

      // Calculate liquidation threshold (public)
      const maintenanceMarginBps = 500; // 5%
      const liqPrice = estimateLiquidationPrice(positionSide, solPrice, leverage, maintenanceMarginBps);
      const liqPriceThreshold = BigInt(Math.floor(liqPrice * 1e6));

      // Simulate position creation (demo mode since perp market not deployed)
      toast.info('Opening position...', { id: 'position-open' });
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Create position in store
      const positionId = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newPosition = {
        id: positionId,
        positionId: Date.now(),
        market: publicKey, // Placeholder
        marketSymbol: 'SOL-PERP',
        trader: publicKey,
        side: positionSide as 'long' | 'short',
        leverage,
        encryptedSize,
        encryptedEntryPrice,
        encryptedCollateral,
        encryptedRealizedPnl: new Uint8Array(64),
        liquidatableBelowPrice: positionSide === 'long' ? liqPrice : 0,
        liquidatableAbovePrice: positionSide === 'short' ? liqPrice : Number.MAX_SAFE_INTEGER,
        thresholdVerified: true, // Mock
        entryCumulativeFunding: BigInt(0),
        pendingFunding: BigInt(0),
        status: 'open' as const,
        createdAt: new Date(),
        lastUpdated: new Date(),
        partialCloseCount: 0,
        autoDeleveragePriority: 0,
      };

      // Add to store
      const { addPosition } = usePerpetualStore.getState();
      addPosition(newPosition);

      if (notifications) {
        toast.success(
          `${leverage}x ${positionSide.toUpperCase()} position opened`,
          {
            id: 'position-open',
            description: `Size: ${amount} SOL @ $${solPrice.toFixed(2)} | Liq: $${liqPrice.toFixed(2)}`,
          }
        );
      } else {
        toast.dismiss('position-open');
      }

      // Reset form
      setAmount('');
      setCollateral('');
      setSizePercent(0);

    } catch (error) {
      console.error('[TradingPanel] Position open error:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to open position',
        { id: 'position-open' }
      );
    } finally {
      setIsOpeningPosition(false);
    }
  };

  const handleSubmit = async () => {
    if (!connected || !publicKey) {
      toast.error('Please connect your wallet');
      return;
    }

    if (!amount || (orderType === 'limit' && !price)) {
      toast.error('Please fill in all fields');
      return;
    }

    if (insufficientBalanceError) {
      toast.error(insufficientBalanceError);
      return;
    }

    if (!signMessage) {
      toast.error('Wallet does not support message signing');
      return;
    }

    setIsSubmitting(true);
    setIsPlacingOrder(true);

    try {
      const exchangeReady = await isExchangeInitialized(connection);
      if (!exchangeReady) {
        toast.info('Demo mode: Simulating order flow...', { id: 'demo-mode' });
        await simulateDemoOrder();
        return;
      }

      const tradingPair = TRADING_PAIRS[0];
      const baseMint = new PublicKey(tradingPair.baseMint);
      const quoteMint = new PublicKey(tradingPair.quoteMint);

      const pairReady = await isPairInitialized(connection, baseMint, quoteMint);
      if (!pairReady) {
        toast.info('Demo mode: Simulating order flow...', { id: 'demo-mode' });
        await simulateDemoOrder();
        return;
      }

      toast.info('Generating eligibility proof...', { id: 'proof-gen' });
      const proofResult = await generateProof();
      toast.success('Proof generated', { id: 'proof-gen' });

      if (!isInitialized) {
        await initializeEncryption();
      }

      toast.info('Encrypting order...', { id: 'encrypt' });
      const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const priceLamports = orderType === 'limit'
        ? BigInt(Math.floor(parseFloat(price) * 1e6))
        : BigInt(0);

      const encryptedAmount = await encryptValue(amountLamports);
      const encryptedPrice = await encryptValue(priceLamports);
      toast.success('Order encrypted', { id: 'encrypt' });

      const programSide = side === 'buy' ? ProgramSide.Buy : ProgramSide.Sell;
      const programOrderType = orderType === 'limit' ? ProgramOrderType.Limit : ProgramOrderType.Market;

      let transaction;

      if (needsWrap && wrapNeeded > BigInt(0)) {
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
      } else {
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
      }

      toast.success('Transaction built', { id: 'tx-build' });
      toast.info('Sending transaction - please approve in wallet...', { id: 'tx-send' });

      const signature = await sendTransaction(transaction, connection);
      toast.info('Confirming transaction...', { id: 'tx-send' });

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

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
        slippage,
      });

      if (notifications) {
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
      } else {
        toast.dismiss('tx-send');
      }

      refreshBalances();
      refreshTokenBalances();
      setAmount('');
      setPrice('');
      setSizePercent(0);

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

  const simulateDemoOrder = async () => {
    try {
      toast.info('Generating eligibility proof...', { id: 'proof-gen' });
      const proofResult = await generateProof();
      toast.success('Proof generated (simulated)', { id: 'proof-gen' });

      if (!isInitialized) {
        await initializeEncryption();
      }

      toast.info('Encrypting order...', { id: 'encrypt' });
      const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const priceLamports = orderType === 'limit'
        ? BigInt(Math.floor(parseFloat(price) * 1e6))
        : BigInt(0);

      const encryptedAmount = await encryptValue(amountLamports);
      const encryptedPrice = await encryptValue(priceLamports);
      toast.success('Order encrypted (simulated)', { id: 'encrypt' });

      await new Promise(resolve => setTimeout(resolve, 1000));

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
        slippage,
      });

      if (notifications) {
        toast.success(
          `Demo: ${side.toUpperCase()} order simulated`,
          {
            id: 'demo-mode',
            description: 'Exchange not yet initialized on devnet. Order stored locally.',
          }
        );
      } else {
        toast.dismiss('demo-mode');
      }

      setAmount('');
      setPrice('');
      setSizePercent(0);

    } catch (error) {
      console.error('[TradingPanel] Demo error:', error);
      toast.error('Demo simulation failed', { id: 'demo-mode' });
    } finally {
      setIsSubmitting(false);
      setIsPlacingOrder(false);
    }
  };

  // Format balance display
  const formatUsdBalance = (value: number) => {
    if (solPrice && side === 'sell') {
      return `$${(value * solPrice).toFixed(2)}`;
    }
    return `$${value.toFixed(2)}`;
  };

  // Calculate estimated liquidation price for perpetuals
  const estimatedLiqPrice = useMemo(() => {
    if (tradingMode !== 'perps' || !solPrice || !collateral || !amount) return null;
    const collateralNum = parseFloat(collateral);
    const sizeNum = parseFloat(amount);
    if (isNaN(collateralNum) || isNaN(sizeNum) || sizeNum <= 0) return null;

    // Simple liquidation price estimation
    // For longs: liq_price = entry_price * (1 - initial_margin/leverage + maintenance_margin)
    // For shorts: liq_price = entry_price * (1 + initial_margin/leverage - maintenance_margin)
    const entryPrice = solPrice;
    const maintenanceMarginBps = 500; // 5% maintenance margin

    return estimateLiquidationPrice(positionSide, entryPrice, leverage, maintenanceMarginBps);
  }, [tradingMode, solPrice, collateral, amount, leverage, positionSide, estimateLiquidationPrice]);

  // Get current funding rate for display
  const currentFundingInfo = fundingRates.get(selectedMarket);

  return (
    <div className={`flex flex-col h-full ${isSidebar ? 'bg-card' : 'bg-card border border-border rounded-lg'}`}>
      {/* Order Form Section */}
      <div className="flex-1 flex flex-col">
        {/* Order Type Tabs */}
        <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => setOrderType('market')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            orderType === 'market'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Market
        </button>
        <button
          onClick={() => setOrderType('limit')}
          className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
            orderType === 'limit'
              ? 'text-foreground border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Limit
        </button>
      </div>

      {/* Token Selector */}
      <div className="px-3 py-2 border-b border-border/50 shrink-0">
        <select
          className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-sm"
          defaultValue="SOL"
        >
          <option value="SOL">SOL</option>
        </select>
      </div>

      {/* Buy/Sell Toggle (Spot) or Long/Short Toggle (Perps) */}
      <div className="flex gap-1 px-3 py-3 shrink-0">
        {tradingMode === 'spot' ? (
          <>
            <button
              onClick={() => setSide('buy')}
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${
                side === 'buy'
                  ? 'bg-green-500 text-white'
                  : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setSide('sell')}
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${
                side === 'sell'
                  ? 'bg-red-500 text-white'
                  : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              Sell
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setPositionSide('long')}
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors flex items-center justify-center gap-1.5 ${
                positionSide === 'long'
                  ? 'bg-green-500 text-white'
                  : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              <TrendingUp className="h-4 w-4" />
              Long
            </button>
            <button
              onClick={() => setPositionSide('short')}
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors flex items-center justify-center gap-1.5 ${
                positionSide === 'short'
                  ? 'bg-red-500 text-white'
                  : 'bg-secondary text-muted-foreground hover:text-foreground border border-border'
              }`}
            >
              <TrendingDown className="h-4 w-4" />
              Short
            </button>
          </>
        )}
      </div>

      {/* Leverage Selector (Perps only) */}
      {tradingMode === 'perps' && (
        <div className="px-3 py-2 border-b border-border/50 shrink-0">
          <LeverageSelector
            value={leverage}
            onChange={setLeverage}
            maxLeverage={maxLeverage}
            showWarning={true}
          />
        </div>
      )}

      {/* Available to Trade */}
      <div className="px-3 py-1 text-xs text-muted-foreground shrink-0">
        Available to Trade:{' '}
        <span className="text-foreground font-mono">
          {showBalances ? (
            side === 'buy'
              ? `${availableBalance.toFixed(2)} USDC`
              : `${availableBalance.toFixed(4)} SOL`
          ) : (
            '••••••'
          )}
        </span>
      </div>

      {/* Size Input */}
      <div className="px-3 py-2 space-y-2 shrink-0">
        <label className="text-xs text-muted-foreground">Size</label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              // Update percentage when manually typing
              if (availableBalance > 0 && e.target.value) {
                const newPercent = Math.min(100, Math.max(0, (parseFloat(e.target.value) / availableBalance) * 100));
                setSizePercent(Math.round(newPercent));
              }
            }}
            placeholder="0.00"
            step="0.01"
            min="0"
            className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm pr-16"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            SOL
          </span>
        </div>

        {/* Percentage Slider */}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="100"
            value={sizePercent}
            onChange={(e) => handleSliderChange(parseInt(e.target.value))}
            className="flex-1 h-1 accent-primary cursor-pointer"
          />
          <span className="text-xs text-muted-foreground w-10 text-right">{sizePercent}%</span>
        </div>

        {/* Percentage Presets */}
        <div className="flex gap-1">
          {PERCENTAGE_PRESETS.map(pct => (
            <button
              key={pct}
              onClick={() => handlePercentageClick(pct)}
              className={`flex-1 text-xs py-1 rounded border transition-colors ${
                sizePercent === pct
                  ? 'bg-primary/20 border-primary text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/50'
              }`}
            >
              {pct}%
            </button>
          ))}
        </div>
      </div>

      {/* Price Input (Limit only) */}
      {orderType === 'limit' && (
        <div className="px-3 py-2 shrink-0">
          <label className="text-xs text-muted-foreground">Price</label>
          <div className="relative mt-1">
            <input
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm pr-16"
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              USDC
            </span>
          </div>
        </div>
      )}

      {/* Info Rows */}
      <div className="px-3 py-2 space-y-1.5 text-xs shrink-0">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {tradingMode === 'perps' ? 'Position Value' : 'Order Value'}
          </span>
          <span className="font-mono">
            {orderValue !== null ? `$${orderValue.toFixed(2)}` : 'N/A'}
          </span>
        </div>

        {tradingMode === 'perps' ? (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Leverage</span>
              <span className="font-mono">{leverage}x</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Est. Liq. Price</span>
              <span className={`font-mono ${estimatedLiqPrice && solPrice && Math.abs(estimatedLiqPrice - solPrice) / solPrice < 0.1 ? 'text-red-400' : ''}`}>
                {estimatedLiqPrice !== null ? `$${estimatedLiqPrice.toFixed(2)}` : 'N/A'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fees</span>
              <span className="font-mono">0.07% / 0.04%</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Slippage</span>
              <span className="font-mono">Est: 0% / Max: {slippage}%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Fees</span>
              <span className="font-mono">0.07% / 0.04%</span>
            </div>
          </>
        )}
      </div>

      {/* Funding Rate Display (Perps only) */}
      {tradingMode === 'perps' && (
        <div className="px-3 py-2 shrink-0">
          <FundingDisplay
            fundingInfo={currentFundingInfo}
            variant="compact"
            showCountdown={true}
          />
        </div>
      )}

      {/* Status Messages */}
      {isGenerating && (
        <div className="mx-3 mb-2 p-2 bg-secondary rounded text-xs flex items-center gap-2 shrink-0">
          <Loader2 className="h-3 w-3 animate-spin text-primary" />
          <span>Generating ZK proof...</span>
        </div>
      )}

      {proofReady && !isGenerating && (
        <div className="mx-3 mb-2 p-2 bg-secondary rounded text-xs flex items-center gap-2 shrink-0">
          <Shield className="h-3 w-3 text-primary" />
          <span className="text-primary">Proof ready</span>
        </div>
      )}

      {connected && needsWrap && canProceed && !isLoadingBalances && (
        <div className="mx-3 mb-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded text-xs flex items-center gap-2 text-blue-400 shrink-0">
          <Shield className="h-3 w-3" />
          <span>
            Will auto-wrap {side === 'sell'
              ? `${(Number(wrapNeeded) / 1e9).toFixed(4)} SOL`
              : `${(Number(wrapNeeded) / 1e6).toFixed(2)} USDC`
            }
          </span>
        </div>
      )}

      {connected && insufficientBalanceError && (
        <div className="mx-3 mb-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs flex items-center gap-2 text-red-400 shrink-0">
          <AlertCircle className="h-3 w-3" />
          <span>{insufficientBalanceError}</span>
        </div>
      )}

      {/* Submit Button */}
      <div className="px-3 py-3 shrink-0">
        <button
          onClick={handleButtonClick}
          disabled={!connected || isSubmitting || isGenerating || !!insufficientBalanceError || hasZeroTotalBalance || isOpeningPosition}
          className={`w-full py-3 rounded font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
            tradingMode === 'perps'
              ? positionSide === 'long'
                ? 'bg-green-500 hover:bg-green-600 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white'
              : side === 'buy'
              ? 'bg-green-500 hover:bg-green-600 text-white'
              : 'bg-red-500 hover:bg-red-600 text-white'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isSubmitting || isGenerating || isOpeningPosition ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {isGenerating ? 'Generating Proof...' : isOpeningPosition ? 'Opening Position...' : 'Processing...'}
            </>
          ) : !connected ? (
            'Connect Wallet'
          ) : hasZeroTotalBalance ? (
            'No Funds Available'
          ) : insufficientBalanceError ? (
            'Insufficient Balance'
          ) : tradingMode === 'perps' ? (
            <>
              {positionSide === 'long' ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              Open {leverage}x {positionSide === 'long' ? 'Long' : 'Short'}
            </>
          ) : needsWrap ? (
            `Wrap & ${side === 'buy' ? 'Buy' : 'Sell'} SOL`
          ) : (
            `${side === 'buy' ? 'Buy' : 'Sell'} SOL`
          )}
        </button>
      </div>
      </div>

      {/* Account Section - pushed to bottom */}
      {showAccountSection && (
        <div className="border-t border-border p-3 space-y-3 shrink-0 mt-auto">
          {/* Deposit/Withdraw Buttons */}
          <div className="flex gap-2">
            <Link
              href="/wrap"
              className="flex-1 py-2 text-center text-xs font-medium bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
            >
              Deposit
            </Link>
            <Link
              href="/wrap?tab=unwrap"
              className="flex-1 py-2 text-center text-xs font-medium bg-secondary text-foreground rounded hover:bg-secondary/80 transition-colors border border-border"
            >
              Withdraw
            </Link>
          </div>

          {/* Wallet Balance (Regular SPL tokens) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Wallet Balance</span>
              <button
                onClick={() => { refreshBalances(); refreshTokenBalances(); }}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                disabled={isLoadingBalances}
              >
                <RefreshCw className={`h-3 w-3 ${isLoadingBalances ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <div className="text-sm font-semibold font-mono">
              {isLoadingBalances ? (
                <span className="text-muted-foreground animate-pulse">Loading...</span>
              ) : showBalances ? (
                `$${((Number(tokenBalances.sol) / 1e9 * (solPrice || 0)) + (Number(tokenBalances.usdc) / 1e6)).toFixed(2)}`
              ) : (
                '••••••'
              )}
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span className="font-mono">
                {showBalances ? `${tokenBalances.solUiAmount} SOL` : '•••• SOL'}
              </span>
              <span className="font-mono">
                {showBalances ? `${tokenBalances.usdcUiAmount} USDC` : '•••• USDC'}
              </span>
            </div>
          </div>

          {/* Trading Balance (Wrapped C-SPL tokens) */}
          <div className="space-y-1.5 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Lock className="h-3 w-3 text-primary" />
                <span className="text-xs text-muted-foreground">Trading Balance</span>
              </div>
              <button
                onClick={() => setPrivacyMode(!privacyMode)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showBalances ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
            </div>
            <div className="text-sm font-semibold font-mono">
              {isLoadingBalances ? (
                <span className="text-muted-foreground animate-pulse">Loading...</span>
              ) : showBalances ? (
                `$${((Number(wrappedBalances.sol) / 1e9 * (solPrice || 0)) + (Number(wrappedBalances.usdc) / 1e6)).toFixed(2)}`
              ) : (
                '••••••'
              )}
            </div>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span className="font-mono">
                {showBalances ? `${(Number(wrappedBalances.sol) / 1e9).toFixed(4)} cSOL` : '•••• cSOL'}
              </span>
              <span className="font-mono">
                {showBalances ? `${(Number(wrappedBalances.usdc) / 1e6).toFixed(2)} cUSDC` : '•••• cUSDC'}
              </span>
            </div>
            {Number(wrappedBalances.sol) === 0 && Number(wrappedBalances.usdc) === 0 && connected && (
              <p className="text-[10px] text-muted-foreground/70 mt-1">
                Deposit funds above to start trading privately
              </p>
            )}
          </div>

          {/* Encryption Status */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/50">
            <span className="text-[10px]">Privacy: {isEncrypted ? 'Encrypted' : 'Standard'}</span>
            {isEncrypted && <span className="text-[10px] text-primary">C-SPL Active</span>}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <OrderConfirmDialog
        isOpen={showConfirmDialog}
        onClose={() => setShowConfirmDialog(false)}
        onConfirm={handleSubmit}
        side={side}
        amount={amount}
        price={price}
        orderType={orderType}
        needsWrap={needsWrap}
        wrapAmount={needsWrap ? (
          side === 'sell'
            ? `${(Number(wrapNeeded) / 1e9).toFixed(4)} SOL`
            : `${(Number(wrapNeeded) / 1e6).toFixed(2)} USDC`
        ) : undefined}
      />
    </div>
  );
};
