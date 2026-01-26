'use client';

import { FC, useState, useEffect, useMemo } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { TrendUp, TrendDown, Lock, ShieldCheck, Eye, EyeSlash, ArrowsClockwise, WarningCircle, SpinnerGap } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { useProof } from '@/hooks/use-proof';
import { useEncryption } from '@/hooks/use-encryption';
import { useOrderStore } from '@/stores/order-store';
import { TRADING_PAIRS, SOL_PERP_MARKET_PDA } from '@/lib/constants';

import { createLogger } from '@/lib/logger';

const log = createLogger('trading');
import {
  buildPlaceOrderTransaction,
  buildAutoWrapAndPlaceOrderTransaction,
  buildOpenPositionTransaction,
  buildVerifyEligibilityTransaction,
  checkTraderEligibility,
  isExchangeInitialized,
  isPairInitialized,
  isPerpMarketInitialized,
  Side as ProgramSide,
  OrderType as ProgramOrderType,
  PositionSide as ProgramPositionSide,
  calculateLiquidationPrice as calcLiqPrice,
} from '@/lib/confidex-client';
import { useEncryptedBalance } from '@/hooks/use-encrypted-balance';
import { useTokenBalance } from '@/hooks/use-token-balance';
import { useSettingsStore } from '@/stores/settings-store';
import { usePerpetualStore } from '@/stores/perpetuals-store';
import { OrderConfirmDialog } from './confirm-dialog';
import { LeverageSelector } from './leverage-selector';
import { FundingDisplay } from './funding-display';
import { TokenSelector, AVAILABLE_TOKENS } from './token-selector';
import { NATIVE_MINT } from '@solana/spl-token';
import { useSolPrice } from '@/hooks/use-pyth-price';
import { OrderProgress, useOrderProgress } from './order-progress';
import { WrapUnwrapModal } from './wrap-unwrap-modal';
import { SettlementSelector } from './settlement-selector';

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
  const [selectedToken, setSelectedToken] = useState('SOL');
  const [positionSide, setPositionSide] = useState<PositionSide>('long');
  const [orderType, setOrderType] = useState<OrderType>('limit');
  const [amount, setAmount] = useState('');
  const [price, setPrice] = useState('');
  const [collateral, setCollateral] = useState('');
  const [sizePercent, setSizePercent] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showWrapModal, setShowWrapModal] = useState(false);
  const [wrapModalMode, setWrapModalMode] = useState<'wrap' | 'unwrap'>('wrap');

  // Order progress tracking for visual feedback
  const { step: orderStep, setStep: setOrderStep, errorMessage: orderError, setError: setOrderError, reset: resetOrderProgress } = useOrderProgress();

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
    setBottomTab,
  } = usePerpetualStore();

  // Local leverage state synced with store
  const [leverage, setLeverage] = useState(defaultLeverage);

  // Use proof, encryption, and balance hooks
  const { isGenerating, proofReady, lastProof, generateProof } = useProof();
  const { isInitialized, initializeEncryption, encryptValue, getEphemeralPublicKey } = useEncryption();
  const { addOrder, setIsPlacingOrder } = useOrderStore();
  const { balances: wrappedBalances, isLoading: isLoadingBalances, refresh: refreshBalances, canAfford, isEncrypted } = useEncryptedBalance();
  const { balances: tokenBalances, refresh: refreshTokenBalances } = useTokenBalance();
  const { autoWrap, slippage, notifications, confirmTx, privacyMode, setPrivacyMode } = useSettingsStore();
  const { price: solPrice } = useSolPrice();

  // Show balances (inverse of privacy mode)
  const showBalances = !privacyMode;

  // Helper to get actual wrapped balance from on-chain account
  const getWrappedBalanceForDisplay = (account: typeof wrappedBalances.solAccount): bigint => {
    if (!account) return BigInt(0);
    const view = new DataView(
      account.encryptedBalance.buffer,
      account.encryptedBalance.byteOffset,
      8
    );
    return view.getBigUint64(0, true);
  };

  // Calculate available balance for display
  // Uses actual on-chain wrapped balance (not the fallback native balance)
  const availableBalance = useMemo(() => {
    if (side === 'buy') {
      // Buying SOL with USDC
      const wrapped = getWrappedBalanceForDisplay(wrappedBalances.usdcAccount);
      const total = wrapped + (autoWrap ? tokenBalances.usdc : BigInt(0));
      return Number(total) / 1e6;
    } else {
      // Selling SOL for USDC
      const wrapped = getWrappedBalanceForDisplay(wrappedBalances.solAccount);
      const total = wrapped + (autoWrap ? tokenBalances.sol : BigInt(0));
      return Number(total) / 1e9;
    }
  }, [side, wrappedBalances.solAccount, wrappedBalances.usdcAccount, tokenBalances, autoWrap]);

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
  // NOTE: wrappedBalances.sol/.usdc from useEncryptedBalance falls back to native balances when C-SPL is empty
  // We use solAccount/usdcAccount to detect if the wrapped balance account actually exists
  const getOrderRequirements = () => {
    if (!amount || parseFloat(amount) <= 0) {
      return { requiredAmount: BigInt(0), wrapNeeded: BigInt(0), canProceed: true, needsWrap: false };
    }

    const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));

    if (side === 'sell') {
      // Check if the wrapped balance account exists on-chain
      const hasWrappedAccount = wrappedBalances.solAccount !== null;
      // If account doesn't exist, wrapped balance is 0
      const currentWrapped = getWrappedBalanceForDisplay(wrappedBalances.solAccount);
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
        // Check if the wrapped balance account exists on-chain
        const hasWrappedAccount = wrappedBalances.usdcAccount !== null;
        // If account doesn't exist, wrapped balance is 0
        const currentWrapped = getWrappedBalanceForDisplay(wrappedBalances.usdcAccount);
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
    if (!connected || !publicKey || !solPrice || !sendTransaction) {
      toast.error('Please connect your wallet and wait for price feed');
      return;
    }

    setIsOpeningPosition(true);

    try {
      // Check if perp market is initialized on devnet
      const perpMarketReady = await isPerpMarketInitialized(connection, NATIVE_MINT);
      log.debug('Perp market initialized', { ready: perpMarketReady });

      // Check if trader already has verified eligibility on-chain
      const { isVerified: hasEligibility } = await checkTraderEligibility(connection, publicKey);

      if (!hasEligibility) {
        // Generate eligibility proof and verify on-chain first
        toast.info('Generating eligibility proof...', { id: 'proof-gen' });
        const proofResult = await generateProof();
        toast.success('Proof generated', { id: 'proof-gen' });

        // Build and send verify_eligibility transaction
        toast.info('Verifying eligibility on-chain...', { id: 'verify-elig' });
        const verifyTx = await buildVerifyEligibilityTransaction({
          connection,
          trader: publicKey,
          eligibilityProof: proofResult?.proof || new Uint8Array(324),
        });

        // Add compute budget (ZK proof verification requires ~175K CUs, plus account creation)
        verifyTx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }));

        const { blockhash: verifyBlockhash } = await connection.getLatestBlockhash('confirmed');
        verifyTx.recentBlockhash = verifyBlockhash;
        verifyTx.feePayer = publicKey;

        const verifySignature = await sendTransaction(verifyTx, connection, {
          skipPreflight: false,
          preflightCommitment: 'confirmed',
        });

        await connection.confirmTransaction({
          signature: verifySignature,
          blockhash: verifyBlockhash,
          lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight,
        }, 'confirmed');

        toast.success('Eligibility verified on-chain', { id: 'verify-elig' });
        log.info('Eligibility verified', { signature: verifySignature });
      } else {
        log.info('Trader already has verified eligibility on-chain');
      }

      // Initialize encryption if needed
      if (!isInitialized) {
        await initializeEncryption();
      }

      // Encrypt position values (V3: reduced to 2 encrypted fields)
      toast.info('Encrypting position data...', { id: 'encrypt' });
      const sizeLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const entryPriceMicros = BigInt(Math.floor(solPrice * 1e6));
      const collateralMicros = BigInt(Math.floor(parseFloat(amount) * solPrice * 1e6 / leverage));

      const encryptedSize = await encryptValue(sizeLamports);
      const encryptedEntryPrice = await encryptValue(entryPriceMicros);

      // V3: Generate random position nonce for hash-based ID (anti-correlation)
      const positionNonce = crypto.getRandomValues(new Uint8Array(8));

      toast.success('Position data encrypted', { id: 'encrypt' });

      // Calculate liquidation price for UI display
      const maintenanceMarginBps = 500; // 5%
      const programSide = positionSide === 'long' ? ProgramPositionSide.Long : ProgramPositionSide.Short;
      const liqPrice = calcLiqPrice(programSide, solPrice, leverage, maintenanceMarginBps);
      const displayLiqPrice = estimateLiquidationPrice(positionSide, solPrice, leverage, maintenanceMarginBps);

      let txSignature: string | null = null;

      if (perpMarketReady) {
        // Real on-chain position opening
        toast.info('Building transaction...', { id: 'position-open' });
        log.info('Perp market is live - opening real position', {
          size: amount,
          leverage,
          side: positionSide,
          liqPrice: liqPrice.toFixed(2),
        });

        // Get USDC mint from trading pairs
        const tradingPair = TRADING_PAIRS[0];
        const quoteMint = new PublicKey(tradingPair.quoteMint);

        // Build the open_position transaction (V3: two-instruction pattern - eligibility verified separately)
        const transaction = await buildOpenPositionTransaction({
          connection,
          trader: publicKey,
          underlyingMint: NATIVE_MINT, // SOL for SOL-PERP
          quoteMint,
          side: programSide,
          leverage,
          encryptedSize,
          encryptedEntryPrice,
          positionNonce,
          collateralAmount: collateralMicros,  // Plaintext USDC for SPL transfer (C-SPL fallback)
        });

        // Add compute budget for MPC verification
        transaction.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })
        );

        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        // Simulate transaction first to get detailed errors
        try {
          log.debug('Simulating transaction...');
          log.debug('Transaction accounts:', {
            accounts: transaction.instructions[0]?.keys.map((k, i) => `${i}: ${k.pubkey.toString()} (signer: ${k.isSigner}, writable: ${k.isWritable})`),
          });
          const simulation = await connection.simulateTransaction(transaction);
          log.debug('Simulation response:', {
            err: simulation.value.err,
            unitsConsumed: simulation.value.unitsConsumed,
            logsPreview: simulation.value.logs?.slice(0, 5),
          });
          if (simulation.value.err) {
            const errorLogs = simulation.value.logs?.join('\n') || 'No logs';
            log.error('Transaction simulation failed', {
              error: JSON.stringify(simulation.value.err),
              logs: errorLogs,
            });
            throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}\nLogs: ${errorLogs}`);
          }
          log.debug('Simulation passed', { unitsConsumed: simulation.value.unitsConsumed });
        } catch (simError) {
          if (simError instanceof Error && simError.message.startsWith('Simulation failed:')) {
            throw simError;
          }
          log.warn('Simulation check failed (continuing anyway)', { error: simError });
        }

        toast.info('Awaiting wallet approval...', { id: 'position-open' });

        // Log transaction details for debugging
        log.debug('Transaction ready to send', {
          feePayer: transaction.feePayer?.toString(),
          recentBlockhash: transaction.recentBlockhash,
          instructionCount: transaction.instructions.length,
          signatures: transaction.signatures.length,
        });

        // Send transaction
        try {
          log.debug('Calling sendTransaction...');
          txSignature = await sendTransaction(transaction, connection, {
            skipPreflight: true, // We already simulated
            preflightCommitment: 'confirmed',
          });
          log.debug('sendTransaction returned', { signature: txSignature });

          toast.info('Confirming transaction...', { id: 'position-open' });

          // Wait for confirmation
          const confirmation = await connection.confirmTransaction({
            signature: txSignature,
            blockhash,
            lastValidBlockHeight,
          }, 'confirmed');

          if (confirmation.value.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
          }

          log.info('Position opened on-chain', { signature: txSignature });
        } catch (txError) {
          // Log detailed error information
          const errorMessage = txError instanceof Error ? txError.message : String(txError);
          const errorName = txError instanceof Error ? txError.name : 'Unknown';
          log.error('Transaction send failed', {
            errorName,
            errorMessage,
            errorStack: txError instanceof Error ? txError.stack : undefined,
          });

          // Check for specific wallet errors
          if (errorMessage.includes('User rejected') || errorMessage.includes('rejected')) {
            toast.error('Transaction rejected by user', { id: 'position-open' });
            throw new Error('Transaction rejected');
          }

          // If tx fails, fall back to demo mode with error context
          log.warn('On-chain position failed, using demo mode', {
            error: errorMessage,
          });
          toast.info('On-chain tx failed - storing position locally', { id: 'position-open' });
        }
      } else {
        // Demo mode - perp market not deployed
        log.info('Perp market not initialized - using demo mode');
        toast.info('Demo mode: Opening position...', { id: 'position-open' });
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // Create position in store (for both real and demo modes)
      // V3: encryptedCollateral is now derived on-chain from collateralAmount
      // Create placeholder with plaintext amount in first 8 bytes (matches on-chain format)
      const encryptedCollateralPlaceholder = new Uint8Array(64);
      new DataView(encryptedCollateralPlaceholder.buffer).setBigUint64(0, collateralMicros, true);

      const positionId = `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newPosition = {
        id: positionId,
        positionId: positionId, // V2: Hash-based ID as hex string
        market: SOL_PERP_MARKET_PDA, // Use actual market PDA
        marketSymbol: 'SOL-PERP',
        trader: publicKey,
        side: positionSide as 'long' | 'short',
        leverage,
        encryptedSize,
        encryptedEntryPrice,
        encryptedCollateral: encryptedCollateralPlaceholder, // V3: placeholder with plaintext amount
        encryptedRealizedPnl: new Uint8Array(64),
        // V2: Encrypted liquidation thresholds (no longer public)
        encryptedLiqBelow: new Uint8Array(64),
        encryptedLiqAbove: new Uint8Array(64),
        // V2: Risk level determined by MPC batch liquidation check
        riskLevel: 'unknown' as const,
        thresholdVerified: txSignature !== null, // True if on-chain tx succeeded
        entryCumulativeFunding: BigInt(0),
        pendingFunding: BigInt(0),
        status: 'open' as const,
        createdAt: new Date(),
        lastUpdated: new Date(),
        partialCloseCount: 0,
        autoDeleveragePriority: 0,
      };

      // Add to store
      const { addPosition, positions: currentPositions } = usePerpetualStore.getState();
      log.info('Adding position to store', {
        positionId,
        side: positionSide,
        leverage,
        currentPositionCount: currentPositions.length,
      });
      addPosition(newPosition);

      // Verify position was added
      const { positions: updatedPositions } = usePerpetualStore.getState();
      log.info('Position added to store', {
        newPositionCount: updatedPositions.length,
        positionIds: updatedPositions.map(p => p.id),
      });
      console.log('[Position] Added to store:', {
        id: positionId,
        side: positionSide,
        leverage,
        totalPositions: updatedPositions.length,
      });

      // Auto-switch to Positions tab so user can see their new position
      setBottomTab('positions');

      if (notifications) {
        const statusText = txSignature ? '' : perpMarketReady ? ' (local)' : ' (demo)';
        toast.success(
          `${leverage}x ${positionSide.toUpperCase()} position opened${statusText}`,
          {
            id: 'position-open',
            duration: 5000,
            description: txSignature ? (
              <div className="flex flex-col gap-1">
                <span>Size: {amount} SOL @ ${solPrice.toFixed(2)}</span>
                <span>Est. Liq: ${displayLiqPrice.toFixed(2)}</span>
                <a
                  href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-primary hover:text-primary/80"
                >
                  View on Explorer
                </a>
              </div>
            ) : (
              `Size: ${amount} SOL @ $${solPrice.toFixed(2)} | Liq: $${displayLiqPrice.toFixed(2)}`
            ),
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
      log.error('Position open error', { error: error instanceof Error ? error.message : String(error) });
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
    resetOrderProgress();

    try {
      console.log('[Trading] Checking exchange initialization...');
      const exchangeReady = await isExchangeInitialized(connection);
      console.log('[Trading] Exchange initialized:', exchangeReady);

      if (!exchangeReady) {
        console.log('[Trading] Exchange not initialized - entering demo mode');
        toast.info('Demo mode: Simulating order flow...', { id: 'demo-mode' });
        await simulateDemoOrder();
        return;
      }

      const tradingPair = TRADING_PAIRS[0];
      const baseMint = new PublicKey(tradingPair.baseMint);
      const quoteMint = new PublicKey(tradingPair.quoteMint);

      console.log('[Trading] Checking pair initialization...', {
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
      });
      const pairReady = await isPairInitialized(connection, baseMint, quoteMint);
      console.log('[Trading] Pair initialized:', pairReady);

      if (!pairReady) {
        console.log('[Trading] Trading pair not initialized - entering demo mode');
        toast.info('Demo mode: Simulating order flow...', { id: 'demo-mode' });
        await simulateDemoOrder();
        return;
      }

      // Layer 1: ZK Proof Generation
      setOrderStep('generating-proof');
      toast.info('Generating eligibility proof...', { id: 'proof-gen' });
      const proofResult = await generateProof();
      setOrderStep('proof-ready');
      toast.success('Proof generated', { id: 'proof-gen' });

      if (!isInitialized) {
        await initializeEncryption();
      }

      // Layer 2: Encryption
      setOrderStep('encrypting');
      toast.info('Encrypting order...', { id: 'encrypt' });
      const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const priceLamports = orderType === 'limit'
        ? BigInt(Math.floor(parseFloat(price) * 1e6))
        : BigInt(0);

      const encryptedAmount = await encryptValue(amountLamports);
      const encryptedPrice = await encryptValue(priceLamports);

      // Get ephemeral public key for production MPC decryption
      const ephemeralPubkey = getEphemeralPublicKey();
      if (!ephemeralPubkey) {
        throw new Error('Ephemeral public key not available - encryption not initialized');
      }

      setOrderStep('encrypted');
      toast.success('Order encrypted', { id: 'encrypt' });

      const programSide = side === 'buy' ? ProgramSide.Buy : ProgramSide.Sell;
      const programOrderType = orderType === 'limit' ? ProgramOrderType.Limit : ProgramOrderType.Market;

      // Re-compute wrap requirements at submission time to avoid stale state
      // This ensures we always get the latest balance values
      const currentWrapReqs = getOrderRequirements();
      const shouldWrap = currentWrapReqs.needsWrap && currentWrapReqs.wrapNeeded > BigInt(0);

      console.log('[Trading] Wrap requirements:', {
        needsWrap: currentWrapReqs.needsWrap,
        wrapNeeded: currentWrapReqs.wrapNeeded.toString(),
        shouldWrap,
        wrappedSol: wrappedBalances.sol.toString(),
        wrappedUsdc: wrappedBalances.usdc.toString(),
        autoWrap,
      });

      let transaction;
      let orderNonce: bigint;

      if (shouldWrap) {
        toast.info('Wrapping tokens & placing order...', { id: 'tx-build' });
        const wrapTokenMint = side === 'sell'
          ? NATIVE_MINT
          : new PublicKey(TRADING_PAIRS[0].quoteMint);

        console.log('[Trading] Building auto-wrap transaction:', {
          side: side === 'sell' ? 'sell (SOL)' : 'buy (USDC)',
          wrapTokenMint: wrapTokenMint.toString(),
          baseMint: baseMint.toString(),
          quoteMint: quoteMint.toString(),
          TRADING_PAIRS_quoteMint: TRADING_PAIRS[0].quoteMint,
        });

        const result = await buildAutoWrapAndPlaceOrderTransaction({
          connection,
          maker: publicKey,
          baseMint,
          quoteMint,
          side: programSide,
          orderType: programOrderType,
          encryptedAmount,
          encryptedPrice,
          eligibilityProof: proofResult.proof,
          ephemeralPubkey,
          wrapTokenMint,
          wrapAmount: currentWrapReqs.wrapNeeded,
        });
        transaction = result.transaction;
        orderNonce = result.orderNonce;
      } else {
        toast.info('Building transaction...', { id: 'tx-build' });
        console.log('[Trading] Building place-order-only transaction (no wrap needed)');
        const result = await buildPlaceOrderTransaction({
          connection,
          maker: publicKey,
          baseMint,
          quoteMint,
          side: programSide,
          orderType: programOrderType,
          encryptedAmount,
          encryptedPrice,
          eligibilityProof: proofResult.proof,
          ephemeralPubkey,
        });
        transaction = result.transaction;
        orderNonce = result.orderNonce;
      }

      console.log('[Trading] Order nonce for PDA:', orderNonce.toString());

      // Add compute budget instructions for ZK proof verification
      // Groth16 verification requires ~500K compute units
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: 600_000,
      });
      const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: 50_000, // Priority fee for faster inclusion
      });

      // Prepend compute budget instructions
      transaction.instructions.unshift(priorityFeeIx);
      transaction.instructions.unshift(computeBudgetIx);

      toast.success('Transaction built', { id: 'tx-build' });

      // Simulate the transaction first to catch errors before sending
      console.log('[Trading] Simulating transaction...');
      try {
        const simulation = await connection.simulateTransaction(transaction);
        console.log('[Trading] Simulation result:', {
          err: simulation.value.err,
          logs: simulation.value.logs,
          unitsConsumed: simulation.value.unitsConsumed,
        });

        if (simulation.value.err) {
          console.error('[Trading] Simulation failed:', simulation.value.err);
          console.error('[Trading] Simulation logs:', simulation.value.logs);
          throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}\nLogs: ${simulation.value.logs?.join('\n')}`);
        }
      } catch (simError) {
        console.error('[Trading] Simulation error:', simError);
        if (simError instanceof Error && simError.message.includes('Simulation failed')) {
          throw simError;
        }
        // If simulation itself failed, log but continue (wallet might still succeed)
        console.warn('[Trading] Could not simulate, proceeding anyway...');
      }

      setOrderStep('submitting');
      toast.info('Sending transaction - please approve in wallet...', { id: 'tx-send' });

      const signature = await sendTransaction(transaction, connection);
      console.log('[Trading] Transaction sent:', signature);
      setOrderStep('confirming');
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

      // Order placed - now waiting for MPC matching
      setOrderStep('mpc-queued');

      log.info('Order placed successfully', { orderNonce: orderNonce.toString() });

      const orderId = Date.now();
      addOrder({
        id: orderId.toString(),
        orderNonce, // The nonce used to derive the order PDA - needed for cancel operations
        maker: publicKey,
        pair: 'SOL/USDC',
        baseMint: baseMint.toString(),
        quoteMint: quoteMint.toString(),
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
      console.error('[Trading] Order submission error:', error);

      // Extract more detailed error information
      let errorMessage = 'Failed to place order';
      if (error instanceof Error) {
        errorMessage = error.message;
        // Check for wallet-specific error details
        if ('logs' in error) {
          console.error('[Trading] Error logs:', (error as Error & { logs?: string[] }).logs);
        }
        if ('error' in error) {
          console.error('[Trading] Inner error:', (error as Error & { error?: unknown }).error);
        }
      }

      setOrderError(errorMessage);
      log.error('Error', { error: errorMessage });
      toast.error(errorMessage, { id: 'tx-send' });
    } finally {
      setIsSubmitting(false);
      setIsPlacingOrder(false);
    }
  };

  const simulateDemoOrder = async () => {
    try {
      console.log('[Trading] Starting demo order simulation...');
      console.log('[Trading] Order params:', { side, orderType, amount, price, slippage });

      toast.info('Generating eligibility proof...', { id: 'proof-gen' });
      console.log('[Trading] Generating eligibility proof...');
      const proofResult = await generateProof();
      console.log('[Trading] Proof generated:', {
        proofSize: proofResult.proof?.length || 0,
        blacklistRootPreview: Array.from(proofResult.blacklistRoot.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join('') + '...',
      });
      toast.success('Proof generated (simulated)', { id: 'proof-gen' });

      if (!isInitialized) {
        console.log('[Trading] Initializing encryption...');
        await initializeEncryption();
        console.log('[Trading] Encryption initialized');
      }

      toast.info('Encrypting order...', { id: 'encrypt' });
      const amountLamports = BigInt(Math.floor(parseFloat(amount) * 1e9));
      const priceLamports = orderType === 'limit'
        ? BigInt(Math.floor(parseFloat(price) * 1e6))
        : BigInt(0);

      console.log('[Trading] Encrypting values:', {
        amountLamports: amountLamports.toString(),
        priceLamports: priceLamports.toString(),
      });

      const encryptedAmount = await encryptValue(amountLamports);
      const encryptedPrice = await encryptValue(priceLamports);
      console.log('[Trading] Values encrypted:', {
        encryptedAmountSize: encryptedAmount.length,
        encryptedPriceSize: encryptedPrice.length,
      });
      toast.success('Order encrypted (simulated)', { id: 'encrypt' });

      console.log('[Trading] Simulating MPC matching delay (1s)...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const orderId = Date.now();
      const tradingPair = TRADING_PAIRS[0];
      console.log('[Trading] Creating order with ID:', orderId);
      addOrder({
        id: orderId.toString(),
        // No onChainOrderId for demo orders - they're not on-chain
        maker: publicKey!,
        pair: 'SOL/USDC',
        baseMint: tradingPair.baseMint,
        quoteMint: tradingPair.quoteMint,
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

      console.log('[Trading] Demo order complete:', {
        orderId,
        side,
        orderType,
        status: 'open',
        note: 'Exchange not yet initialized on devnet. Order stored locally.',
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
      console.error('[Trading] Demo order failed:', error);
      log.error('Demo error', { error: error instanceof Error ? error.message : String(error) });
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
    <div
      className={`flex flex-col h-full ${isSidebar ? 'bg-card' : 'bg-card border border-border rounded-lg'}`}
      role="form"
      aria-label={tradingMode === 'perps' ? 'Perpetuals trading form' : 'Spot trading form'}
    >
      {/* Order Form Section */}
      <div className="flex-1 flex flex-col">
        {/* Order Type Tabs */}
        <div className="flex border-b border-border shrink-0" role="tablist" aria-label="Order type selection">
        <button
          onClick={() => setOrderType('market')}
          role="tab"
          aria-selected={orderType === 'market'}
          aria-controls="order-form"
          id="market-tab"
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
          role="tab"
          aria-selected={orderType === 'limit'}
          aria-controls="order-form"
          id="limit-tab"
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
        <TokenSelector
          value={selectedToken}
          onChange={setSelectedToken}
          tokens={AVAILABLE_TOKENS}
        />
      </div>

      {/* Buy/Sell Toggle (Spot) or Long/Short Toggle (Perps) */}
      <div
        className="flex gap-1 px-3 py-3 shrink-0"
        role="group"
        aria-label={tradingMode === 'spot' ? 'Order side selection' : 'Position direction selection'}
      >
        {tradingMode === 'spot' ? (
          <>
            <button
              onClick={() => setSide('buy')}
              aria-pressed={side === 'buy'}
              aria-label="Buy order"
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${
                side === 'buy'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-white/50 hover:text-white border border-white/10'
              }`}
            >
              Buy
            </button>
            <button
              onClick={() => setSide('sell')}
              aria-pressed={side === 'sell'}
              aria-label="Sell order"
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors ${
                side === 'sell'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-white/5 text-white/50 hover:text-white border border-white/10'
              }`}
            >
              Sell
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => setPositionSide('long')}
              aria-pressed={positionSide === 'long'}
              aria-label="Open long position"
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors flex items-center justify-center gap-1.5 ${
                positionSide === 'long'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-white/5 text-white/50 hover:text-white border border-white/10'
              }`}
            >
              <TrendUp size={16} aria-hidden="true" />
              Long
            </button>
            <button
              onClick={() => setPositionSide('short')}
              aria-pressed={positionSide === 'short'}
              aria-label="Open short position"
              className={`flex-1 py-2 text-sm font-medium rounded transition-colors flex items-center justify-center gap-1.5 ${
                positionSide === 'short'
                  ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  : 'bg-white/5 text-white/50 hover:text-white border border-white/10'
              }`}
            >
              <TrendDown size={16} aria-hidden="true" />
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
      <div className="px-3 py-2 space-y-2 shrink-0" id="order-form" role="tabpanel" aria-labelledby={`${orderType}-tab`}>
        <label htmlFor="order-size" className="text-xs text-muted-foreground">Size</label>
        <div className="relative">
          <input
            type="number"
            id="order-size"
            data-testid="size-input"
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
            aria-label="Order size in SOL"
            aria-describedby="size-unit"
            className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm pr-16"
          />
          <span id="size-unit" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
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
            aria-label={`Order size percentage: ${sizePercent}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={sizePercent}
            className="flex-1 h-1 accent-primary cursor-pointer"
          />
          <span className="text-xs text-muted-foreground w-10 text-right" aria-hidden="true">{sizePercent}%</span>
        </div>

        {/* Percentage Presets */}
        <div className="flex gap-1" role="group" aria-label="Quick size percentage options">
          {PERCENTAGE_PRESETS.map(pct => (
            <button
              key={pct}
              onClick={() => handlePercentageClick(pct)}
              aria-pressed={sizePercent === pct}
              aria-label={`Set size to ${pct}% of available balance`}
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
          <label htmlFor="order-price" className="text-xs text-muted-foreground">Price</label>
          <div className="relative mt-1">
            <input
              type="number"
              id="order-price"
              data-testid="price-input"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              step="0.01"
              min="0"
              aria-label="Limit price in USDC"
              aria-describedby="price-unit"
              className="w-full bg-secondary border border-border rounded px-3 py-2 text-sm pr-16"
            />
            <span id="price-unit" className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              USDC
            </span>
          </div>
        </div>
      )}

      {/* Info Rows */}
      <div className="px-3 py-2 space-y-1.5 text-xs shrink-0" role="region" aria-label="Order details">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {tradingMode === 'perps' ? 'Position Value' : 'Order Value'}
          </span>
          <span className="font-mono" aria-live="polite">
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

      {/* Order Progress - 3-Layer Privacy Status */}
      {orderStep !== 'idle' && (
        <div className="mx-3 mb-2 shrink-0">
          <OrderProgress step={orderStep} errorMessage={orderError} variant="inline" />
        </div>
      )}

      {/* Auto-wrap notification */}
      {connected && needsWrap && canProceed && !isLoadingBalances && orderStep === 'idle' && (
        <div className="mx-3 mb-2 p-2 bg-blue-500/10 border border-blue-500/20 rounded text-xs flex items-center gap-2 text-blue-400 shrink-0">
          <ShieldCheck size={12} />
          <span>
            Will auto-wrap {side === 'sell'
              ? `${(Number(wrapNeeded) / 1e9).toFixed(4)} SOL`
              : `${(Number(wrapNeeded) / 1e6).toFixed(2)} USDC`
            }
          </span>
        </div>
      )}

      {/* Insufficient balance error */}
      {connected && insufficientBalanceError && (
        <div className="mx-3 mb-2 p-2 bg-rose-500/20 border border-rose-500/30 rounded text-xs flex items-center gap-2 text-rose-400/80 shrink-0">
          <WarningCircle size={12} />
          <span>{insufficientBalanceError}</span>
        </div>
      )}

      {/* Submit Button */}
      <div className="px-3 py-3 shrink-0">
        <button
          onClick={handleButtonClick}
          data-testid="submit-order-button"
          disabled={!connected || isSubmitting || isGenerating || !!insufficientBalanceError || hasZeroTotalBalance || isOpeningPosition}
          className={`w-full py-3 rounded font-semibold text-sm transition-colors flex items-center justify-center gap-2 ${
            tradingMode === 'perps'
              ? positionSide === 'long'
                ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30'
              : side === 'buy'
              ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
              : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isSubmitting || isGenerating || isOpeningPosition ? (
            <>
              <SpinnerGap size={16} className="animate-spin" />
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
              {positionSide === 'long' ? <TrendUp size={16} /> : <TrendDown size={16} />}
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
          {/* Wrap/Unwrap Buttons */}
          <div className="flex gap-2">
            <button
              onClick={() => {
                setWrapModalMode('wrap');
                setShowWrapModal(true);
              }}
              className="flex-1 py-2 text-center text-xs font-medium bg-primary/10 text-primary rounded hover:bg-primary/20 transition-colors"
            >
              Wrap
            </button>
            <button
              onClick={() => {
                setWrapModalMode('unwrap');
                setShowWrapModal(true);
              }}
              className="flex-1 py-2 text-center text-xs font-medium bg-secondary text-foreground rounded hover:bg-secondary/80 transition-colors border border-border"
            >
              Unwrap
            </button>
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
                <ArrowsClockwise size={12} className={isLoadingBalances ? 'animate-spin' : ''} />
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
                <Lock size={12} className="text-primary" />
                <span className="text-xs text-muted-foreground">Trading Balance</span>
              </div>
              <button
                onClick={() => setPrivacyMode(!privacyMode)}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showBalances ? <EyeSlash size={12} /> : <Eye size={12} />}
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
                Wrap tokens above to start trading privately
              </p>
            )}
          </div>

          {/* Settlement Method Selector */}
          <div className="pt-2 border-t border-border/50">
            <SettlementSelector variant="compact" />
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

      {/* Wrap/Unwrap Modal */}
      <WrapUnwrapModal
        isOpen={showWrapModal}
        onClose={() => setShowWrapModal(false)}
        initialMode={wrapModalMode}
      />
    </div>
  );
};
