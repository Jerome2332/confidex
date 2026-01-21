'use client';

import { FC, useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { X, ArrowDown, ArrowUp, SpinnerGap, Lock, Wallet } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { buildWrapTransaction, buildUnwrapTransaction } from '@/lib/confidex-client';
import { TRADING_PAIRS } from '@/lib/constants';
import { useEncryptedBalance } from '@/hooks/use-encrypted-balance';
import { useTokenBalance } from '@/hooks/use-token-balance';

type ModalMode = 'wrap' | 'unwrap';
type TokenType = 'SOL' | 'USDC';

interface WrapUnwrapModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: ModalMode;
}

const SOL_MINT = new PublicKey(TRADING_PAIRS[0].baseMint);
const USDC_MINT = new PublicKey(TRADING_PAIRS[0].quoteMint);

export const WrapUnwrapModal: FC<WrapUnwrapModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'wrap',
}) => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction, connected } = useWallet();
  const { balances: wrappedBalances, refresh: refreshWrapped } = useEncryptedBalance();
  const { balances: tokenBalances, refresh: refreshToken } = useTokenBalance();

  const [mode, setMode] = useState<ModalMode>(initialMode);
  const [token, setToken] = useState<TokenType>('SOL');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
      setAmount('');
    }
  }, [isOpen, initialMode]);

  if (!isOpen) return null;

  const decimals = token === 'SOL' ? 9 : 6;
  const tokenMint = token === 'SOL' ? SOL_MINT : USDC_MINT;

  // Get balances based on mode
  const walletBalance = token === 'SOL' ? tokenBalances.sol : tokenBalances.usdc;
  const tradingBalance = token === 'SOL' ? wrappedBalances.sol : wrappedBalances.usdc;

  const walletBalanceDisplay = Number(walletBalance) / Math.pow(10, decimals);
  const tradingBalanceDisplay = Number(tradingBalance) / Math.pow(10, decimals);

  // Available balance for current operation
  const availableBalance = mode === 'wrap' ? walletBalance : tradingBalance;
  const availableBalanceDisplay = mode === 'wrap' ? walletBalanceDisplay : tradingBalanceDisplay;

  // Parse amount
  const amountValue = parseFloat(amount) || 0;
  const amountLamports = BigInt(Math.floor(amountValue * Math.pow(10, decimals)));

  // Validation
  const isValidAmount = amountValue > 0 && amountLamports <= availableBalance;
  const canSubmit = connected && isValidAmount && !isSubmitting;

  // Handle max button
  const handleMax = () => {
    // For SOL wrap, leave some for fees
    if (mode === 'wrap' && token === 'SOL') {
      const maxAmount = Math.max(0, walletBalanceDisplay - 0.01);
      setAmount(maxAmount.toFixed(4));
    } else {
      setAmount(availableBalanceDisplay.toFixed(token === 'SOL' ? 4 : 2));
    }
  };

  // Handle percentage buttons
  const handlePercentage = (percent: number) => {
    let targetBalance = availableBalanceDisplay;

    // For SOL wrap, reserve some for fees
    if (mode === 'wrap' && token === 'SOL') {
      targetBalance = Math.max(0, walletBalanceDisplay - 0.01);
    }

    const value = (targetBalance * percent) / 100;
    setAmount(value.toFixed(token === 'SOL' ? 4 : 2));
  };

  // Handle submit
  const handleSubmit = async () => {
    if (!publicKey || !canSubmit) return;

    setIsSubmitting(true);
    const toastId = toast.loading(
      mode === 'wrap'
        ? `Wrapping ${amountValue} ${token}...`
        : `Unwrapping ${amountValue} ${token}...`
    );

    try {
      let transaction;

      if (mode === 'wrap') {
        transaction = await buildWrapTransaction({
          connection,
          user: publicKey,
          baseMint: SOL_MINT,
          quoteMint: USDC_MINT,
          tokenMint,
          amount: amountLamports,
        });
      } else {
        transaction = await buildUnwrapTransaction({
          connection,
          user: publicKey,
          baseMint: SOL_MINT,
          quoteMint: USDC_MINT,
          tokenMint,
          amount: amountLamports,
        });
      }

      // Add compute budget
      transaction.instructions.unshift(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 })
      );

      // Get fresh blockhash
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      // Send transaction
      const signature = await sendTransaction(transaction, connection);

      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      toast.success(
        mode === 'wrap'
          ? `Successfully wrapped ${amountValue} ${token}`
          : `Successfully unwrapped ${amountValue} ${token}`,
        { id: toastId }
      );

      // Refresh balances
      await Promise.all([refreshWrapped(), refreshToken()]);

      // Reset and close
      setAmount('');
      onClose();

    } catch (error) {
      console.error(`${mode} error:`, error);
      toast.error(
        error instanceof Error ? error.message : `Failed to ${mode} tokens`,
        { id: toastId }
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-card border border-border rounded-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            {mode === 'wrap' ? (
              <ArrowDown size={20} className="text-primary" />
            ) : (
              <ArrowUp size={20} className="text-primary" />
            )}
            <h3 className="font-semibold">
              {mode === 'wrap' ? 'Wrap Tokens' : 'Unwrap Tokens'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="p-4 pb-0">
          <div className="flex bg-secondary rounded-lg p-1">
            <button
              onClick={() => setMode('wrap')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'wrap'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Wrap
            </button>
            <button
              onClick={() => setMode('unwrap')}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${
                mode === 'unwrap'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Unwrap
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Token Selector */}
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Token</label>
            <div className="flex gap-2">
              <button
                onClick={() => setToken('SOL')}
                className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors border ${
                  token === 'SOL'
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                }`}
              >
                SOL
              </button>
              <button
                onClick={() => setToken('USDC')}
                className={`flex-1 py-3 rounded-lg text-sm font-medium transition-colors border ${
                  token === 'USDC'
                    ? 'bg-primary/10 text-primary border-primary/30'
                    : 'bg-secondary text-foreground border-border hover:bg-secondary/80'
                }`}
              >
                USDC
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm text-muted-foreground">Amount</label>
              <button
                onClick={handleMax}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                Max
              </button>
            </div>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full px-4 py-3 pr-16 bg-secondary border border-border rounded-lg text-lg font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                {token}
              </span>
            </div>

            {/* Percentage buttons */}
            <div className="flex gap-2">
              {[25, 50, 75, 100].map((percent) => (
                <button
                  key={percent}
                  onClick={() => handlePercentage(percent)}
                  className="flex-1 py-1.5 text-xs bg-secondary hover:bg-secondary/80 border border-border rounded transition-colors"
                >
                  {percent}%
                </button>
              ))}
            </div>
          </div>

          {/* Balance Info */}
          <div className="space-y-2 p-3 bg-secondary/50 rounded-lg">
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Wallet size={14} />
                <span>Wallet Balance</span>
              </div>
              <span className="font-mono">
                {walletBalanceDisplay.toFixed(token === 'SOL' ? 4 : 2)} {token}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Lock size={14} />
                <span>Trading Balance</span>
              </div>
              <span className="font-mono">
                {tradingBalanceDisplay.toFixed(token === 'SOL' ? 4 : 2)} c{token}
              </span>
            </div>
          </div>

          {/* Info message */}
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <p className="text-xs text-muted-foreground">
              {mode === 'wrap' ? (
                <>
                  Wrapping moves tokens from your wallet to your trading balance.
                  Your trading balance is encrypted for private trading.
                </>
              ) : (
                <>
                  Unwrapping withdraws tokens from your trading balance back to your wallet.
                  {token === 'SOL' && ' WSOL will be converted to native SOL.'}
                </>
              )}
            </p>
          </div>

          {/* Validation error */}
          {amount && !isValidAmount && (
            <p className="text-xs text-destructive">
              {amountValue <= 0
                ? 'Enter an amount'
                : `Insufficient balance. Available: ${availableBalanceDisplay.toFixed(token === 'SOL' ? 4 : 2)} ${mode === 'wrap' ? token : `c${token}`}`
              }
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border bg-secondary/30">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`w-full py-3 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
              canSubmit
                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                : 'bg-secondary text-muted-foreground cursor-not-allowed'
            }`}
          >
            {isSubmitting ? (
              <>
                <SpinnerGap size={16} className="animate-spin" />
                {mode === 'wrap' ? 'Wrapping...' : 'Unwrapping...'}
              </>
            ) : (
              <>
                {mode === 'wrap' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
                {mode === 'wrap'
                  ? `Wrap ${amount || '0'} ${token}`
                  : `Unwrap ${amount || '0'} ${token}`
                }
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
