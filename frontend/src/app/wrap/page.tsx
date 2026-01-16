'use client';

import { useState, useEffect } from 'react';
import { Header } from '@/components/header';
import { WalletButton } from '@/components/wallet-button';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import {
  ArrowDownUp,
  Lock,
  Unlock,
  Loader2,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Github,
  BookOpen,
} from 'lucide-react';
import { useTokenBalance } from '@/hooks/use-token-balance';
import { useEncryptedBalance, ENCRYPTION_VERSION } from '@/hooks/use-encrypted-balance';
import { buildWrapTransaction, buildUnwrapTransaction } from '@/lib/confidex-client';
import { TRADING_PAIRS } from '@/lib/constants';

type TabType = 'wrap' | 'unwrap';

const SOL_MINT = new PublicKey(TRADING_PAIRS[0].baseMint);
const USDC_MINT = new PublicKey(TRADING_PAIRS[0].quoteMint);

export default function WrapPage() {
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { balances: tokenBalances, refresh: refreshTokenBalances } = useTokenBalance();
  const { balances: wrappedBalances, refresh: refreshWrappedBalances, isEncrypted } = useEncryptedBalance();

  const [activeTab, setActiveTab] = useState<TabType>('wrap');
  const [selectedToken, setSelectedToken] = useState('SOL');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [txStatus, setTxStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [txMessage, setTxMessage] = useState('');
  const [txSignature, setTxSignature] = useState<string | null>(null);

  // Check URL params for tab
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab');
    if (tab === 'unwrap') {
      setActiveTab('unwrap');
    }
  }, []);

  const getTokenDecimals = (symbol: string): number => {
    return symbol === 'SOL' ? 9 : 6;
  };

  const getTokenMint = (symbol: string): PublicKey => {
    return symbol === 'SOL' ? SOL_MINT : USDC_MINT;
  };

  // Calculate max amounts based on active tab
  const getMaxAmount = (): string => {
    if (activeTab === 'wrap') {
      // Wrapping: use regular token balance
      return selectedToken === 'SOL' ? tokenBalances.solUiAmount : tokenBalances.usdcUiAmount;
    } else {
      // Unwrapping: use wrapped (confidential) balance
      return selectedToken === 'SOL' ? wrappedBalances.solUiAmount : wrappedBalances.usdcUiAmount;
    }
  };

  const handleWrap = async () => {
    if (!amount || !publicKey) return;

    setIsProcessing(true);
    setTxStatus('idle');
    setTxSignature(null);

    try {
      const decimals = getTokenDecimals(selectedToken);
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));

      console.log('[WrapPage] Wrapping tokens:', {
        token: selectedToken,
        amount: amountRaw.toString(),
      });

      const transaction = await buildWrapTransaction({
        connection,
        user: publicKey,
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        tokenMint: getTokenMint(selectedToken),
        amount: amountRaw,
      });

      const signature = await sendTransaction(transaction, connection);
      console.log('[WrapPage] Transaction sent:', signature);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error('Transaction failed');
      }

      console.log('[WrapPage] Transaction confirmed');

      setTxStatus('success');
      setTxMessage(`Successfully wrapped ${amount} ${selectedToken} to c${selectedToken}`);
      setTxSignature(signature);
      setAmount('');

      // Refresh balances
      await Promise.all([refreshTokenBalances(), refreshWrappedBalances()]);
    } catch (error) {
      console.error('[WrapPage] Wrap failed:', error);
      setTxStatus('error');
      setTxMessage(error instanceof Error ? error.message : 'Transaction failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUnwrap = async () => {
    if (!amount || !publicKey) return;

    setIsProcessing(true);
    setTxStatus('idle');
    setTxSignature(null);

    try {
      const decimals = getTokenDecimals(selectedToken);
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));

      console.log('[WrapPage] Unwrapping tokens:', {
        token: `c${selectedToken}`,
        amount: amountRaw.toString(),
      });

      const transaction = await buildUnwrapTransaction({
        connection,
        user: publicKey,
        baseMint: SOL_MINT,
        quoteMint: USDC_MINT,
        tokenMint: getTokenMint(selectedToken),
        amount: amountRaw,
      });

      const signature = await sendTransaction(transaction, connection);
      console.log('[WrapPage] Transaction sent:', signature);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error('Transaction failed');
      }

      console.log('[WrapPage] Transaction confirmed');

      setTxStatus('success');
      setTxMessage(`Successfully unwrapped ${amount} c${selectedToken} to ${selectedToken}`);
      setTxSignature(signature);
      setAmount('');

      // Refresh balances
      await Promise.all([refreshTokenBalances(), refreshWrappedBalances()]);
    } catch (error) {
      console.error('[WrapPage] Unwrap failed:', error);
      setTxStatus('error');
      setTxMessage(error instanceof Error ? error.message : 'Transaction failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = () => {
    if (activeTab === 'wrap') {
      handleWrap();
    } else {
      handleUnwrap();
    }
  };

  const setMaxAmount = () => {
    const max = getMaxAmount();
    // For SOL, leave some for fees
    if (selectedToken === 'SOL' && activeTab === 'wrap') {
      const maxNum = parseFloat(max);
      const adjusted = Math.max(0, maxNum - 0.01).toFixed(4);
      setAmount(adjusted);
    } else {
      setAmount(max);
    }
  };

  const maxAmount = parseFloat(getMaxAmount()) || 0;
  const inputAmount = parseFloat(amount) || 0;
  const isValidAmount = inputAmount > 0 && inputAmount <= maxAmount;

  return (
    <main className="min-h-screen">
      <Header />

      <div className="container mx-auto px-4 py-8 max-w-lg">
        {/* Info Card */}
        <div className="mb-8 p-4 bg-primary/5 border border-primary/20 rounded-lg">
          <h2 className="font-semibold mb-2 flex items-center gap-2">
            <Lock className="h-4 w-4" />
            About Confidential Tokens
          </h2>
          <p className="text-sm text-muted-foreground">
            Wrap your tokens to make them confidential. Confidential tokens (c-tokens)
            have their balances encrypted, allowing you to trade privately on Confidex.
            Only you can reveal your true balance.
          </p>
        </div>

        {/* Main Card */}
        <div className="border border-border rounded-lg overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setActiveTab('wrap')}
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                activeTab === 'wrap'
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Lock className="h-4 w-4" />
                Wrap
              </div>
            </button>
            <button
              onClick={() => setActiveTab('unwrap')}
              className={`flex-1 py-3 px-4 text-sm font-medium transition-colors ${
                activeTab === 'unwrap'
                  ? 'bg-primary/10 text-primary border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Unlock className="h-4 w-4" />
                Unwrap
              </div>
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {!connected ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground mb-4">
                  Connect your wallet to wrap/unwrap tokens
                </p>
                <WalletButton />
              </div>
            ) : (
              <div className="space-y-6">
                {/* Token Selection */}
                <div>
                  <label className="block text-sm font-medium mb-2">Token</label>
                  <select
                    value={selectedToken}
                    onChange={(e) => {
                      setSelectedToken(e.target.value);
                      setAmount('');
                    }}
                    className="w-full p-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="SOL">
                      {activeTab === 'wrap' ? 'SOL' : 'cSOL'}
                    </option>
                    <option value="USDC">
                      {activeTab === 'wrap' ? 'USDC' : 'cUSDC'}
                    </option>
                  </select>
                </div>

                {/* Balances */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">
                      Regular Balance
                    </div>
                    <div className="font-mono font-medium">
                      {selectedToken === 'SOL'
                        ? `${tokenBalances.solUiAmount} SOL`
                        : `${tokenBalances.usdcUiAmount} USDC`}
                    </div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">
                      Confidential Balance
                    </div>
                    <div className="font-mono font-medium">
                      {selectedToken === 'SOL'
                        ? `${wrappedBalances.solUiAmount} cSOL`
                        : `${wrappedBalances.usdcUiAmount} cUSDC`}
                    </div>
                  </div>
                </div>

                {/* Amount Input */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-medium">Amount</label>
                    <button
                      onClick={setMaxAmount}
                      className="text-xs text-primary hover:underline"
                    >
                      MAX
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      step="any"
                      min="0"
                      className="w-full p-3 pr-20 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {activeTab === 'wrap' ? selectedToken : `c${selectedToken}`}
                    </span>
                  </div>
                  {amount && !isValidAmount && (
                    <p className="text-xs text-destructive mt-1">
                      {inputAmount > maxAmount
                        ? 'Insufficient balance'
                        : 'Enter a valid amount'}
                    </p>
                  )}
                </div>

                {/* Conversion Preview */}
                {amount && isValidAmount && (
                  <div className="flex items-center justify-center gap-3 py-4">
                    <div className="text-center">
                      <div className="text-lg font-mono">{amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {activeTab === 'wrap' ? selectedToken : `c${selectedToken}`}
                      </div>
                    </div>
                    <ArrowDownUp className="h-5 w-5 text-muted-foreground" />
                    <div className="text-center">
                      <div className="text-lg font-mono">{amount}</div>
                      <div className="text-xs text-muted-foreground">
                        {activeTab === 'wrap' ? `c${selectedToken}` : selectedToken}
                      </div>
                    </div>
                  </div>
                )}

                {/* Status Messages */}
                {txStatus === 'success' && (
                  <div className="p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-sm text-green-500">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 flex-shrink-0" />
                      {txMessage}
                    </div>
                    {txSignature && (
                      <a
                        href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 mt-2 text-xs hover:underline"
                      >
                        View on Explorer
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                )}

                {txStatus === 'error' && (
                  <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-sm text-red-500">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                    {txMessage}
                  </div>
                )}

                {/* Submit Button */}
                <button
                  onClick={handleSubmit}
                  disabled={!isValidAmount || isProcessing}
                  className="w-full p-4 rounded-lg bg-primary text-primary-foreground font-medium transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isProcessing ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {activeTab === 'wrap' ? 'Wrapping...' : 'Unwrapping...'}
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      {activeTab === 'wrap' ? (
                        <>
                          <Lock className="h-4 w-4" />
                          Wrap to c{selectedToken}
                        </>
                      ) : (
                        <>
                          <Unlock className="h-4 w-4" />
                          Unwrap to {selectedToken}
                        </>
                      )}
                    </span>
                  )}
                </button>

                {/* Fee Notice */}
                <p className="text-xs text-center text-muted-foreground">
                  Network fee: ~0.000005 SOL
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Quick Stats */}
        {connected && (
          <div className="mt-8 grid grid-cols-2 gap-4">
            <div className="p-4 bg-card border border-border rounded-lg">
              <div className="text-xs text-muted-foreground mb-1">Total Wrapped</div>
              <div className="text-lg font-mono font-semibold">
                {wrappedBalances.solUiAmount} <span className="text-muted-foreground text-sm">cSOL</span>
              </div>
              <div className="text-lg font-mono font-semibold">
                {wrappedBalances.usdcUiAmount} <span className="text-muted-foreground text-sm">cUSDC</span>
              </div>
            </div>
            <div className="p-4 bg-card border border-border rounded-lg">
              <div className="text-xs text-muted-foreground mb-1">Available to Wrap</div>
              <div className="text-lg font-mono font-semibold">
                {tokenBalances.solUiAmount} <span className="text-muted-foreground text-sm">SOL</span>
              </div>
              <div className="text-lg font-mono font-semibold">
                {tokenBalances.usdcUiAmount} <span className="text-muted-foreground text-sm">USDC</span>
              </div>
            </div>
          </div>
        )}

        {/* Additional Info */}
        <div className="mt-8 space-y-4">
          <h3 className="font-semibold">How it works</h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                1
              </div>
              <div>
                <strong className="text-foreground">Wrap:</strong> Deposit your tokens into the
                confidential vault. You receive c-tokens with an encrypted balance.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                2
              </div>
              <div>
                <strong className="text-foreground">Trade:</strong> Use c-tokens to place
                private orders on Confidex. Order amounts and prices remain encrypted.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">
                3
              </div>
              <div>
                <strong className="text-foreground">Unwrap:</strong> Convert c-tokens back to
                regular tokens when you want to withdraw or use them elsewhere.
              </div>
            </div>
          </div>
        </div>

        {/* Privacy Benefits */}
        <div className="mt-8 p-4 bg-secondary/30 border border-border rounded-lg">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Lock className="h-4 w-4 text-primary" />
            Privacy Benefits
          </h3>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
              <span>Balance amounts are encrypted on-chain</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
              <span>Only you can reveal your true balance</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
              <span>Trading activity stays private from observers</span>
            </li>
            <li className="flex items-start gap-2">
              <CheckCircle className="h-4 w-4 text-green-500 flex-shrink-0 mt-0.5" />
              <span>Compliant with ZK eligibility proofs</span>
            </li>
          </ul>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-6 mt-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <span>Built for Solana Privacy Hack 2026</span>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  <Github className="h-4 w-4" />
                </a>
                <a
                  href="https://docs.arcium.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors"
                >
                  <BookOpen className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Powered by</span>
              <span className="bg-secondary px-2 py-0.5 rounded">Arcium MPC</span>
              <span className="bg-secondary px-2 py-0.5 rounded">Noir ZK</span>
              <span className="bg-secondary px-2 py-0.5 rounded">ShadowWire</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
