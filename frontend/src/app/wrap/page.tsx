'use client';

import { useState } from 'react';
import Link from 'next/link';
import { WalletButton } from '@/components/wallet-button';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useEncryption } from '@/hooks/use-encryption';
import {
  Shield,
  ArrowLeft,
  ArrowDownUp,
  Lock,
  Unlock,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';

type TabType = 'wrap' | 'unwrap';

interface TokenBalance {
  symbol: string;
  regular: number;
  confidential: number;
  decimals: number;
}

export default function WrapPage() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { isInitialized, initializeEncryption, encryptValue } = useEncryption();

  const [activeTab, setActiveTab] = useState<TabType>('wrap');
  const [selectedToken, setSelectedToken] = useState('SOL');
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [txStatus, setTxStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [txMessage, setTxMessage] = useState('');

  // Mock balances (would fetch from chain in production)
  const balances: TokenBalance[] = [
    { symbol: 'SOL', regular: 5.25, confidential: 2.0, decimals: 9 },
    { symbol: 'USDC', regular: 1250.0, confidential: 500.0, decimals: 6 },
  ];

  const selectedBalance = balances.find((b) => b.symbol === selectedToken);
  const maxAmount = activeTab === 'wrap'
    ? selectedBalance?.regular || 0
    : selectedBalance?.confidential || 0;

  const handleWrap = async () => {
    if (!amount || !publicKey) return;

    setIsProcessing(true);
    setTxStatus('idle');

    try {
      // Initialize encryption if needed
      if (!isInitialized) {
        await initializeEncryption();
      }

      // Convert amount to lamports/smallest unit
      const decimals = selectedBalance?.decimals || 9;
      const amountRaw = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals)));

      // Encrypt the amount
      const encryptedAmount = await encryptValue(amountRaw);

      console.log('Wrapping tokens:', {
        token: selectedToken,
        amount: amountRaw.toString(),
        encryptedSize: encryptedAmount.length,
      });

      // Simulate transaction delay
      await new Promise((resolve) => setTimeout(resolve, 2000));

      setTxStatus('success');
      setTxMessage(`Successfully wrapped ${amount} ${selectedToken} to c${selectedToken}`);
      setAmount('');
    } catch (error) {
      console.error('Wrap failed:', error);
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

    try {
      console.log('Unwrapping tokens:', {
        token: `c${selectedToken}`,
        amount,
      });

      // Simulate transaction delay
      await new Promise((resolve) => setTimeout(resolve, 2000));

      setTxStatus('success');
      setTxMessage(`Successfully unwrapped ${amount} c${selectedToken} to ${selectedToken}`);
      setAmount('');
    } catch (error) {
      console.error('Unwrap failed:', error);
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
    setAmount(maxAmount.toString());
  };

  return (
    <main className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-2">
              <Shield className="h-8 w-8 text-primary" />
              <span className="text-2xl font-bold">Confidex</span>
              <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">
                Wrap
              </span>
            </div>
          </div>
          <WalletButton />
        </div>
      </header>

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
                    onChange={(e) => setSelectedToken(e.target.value)}
                    className="w-full p-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    {balances.map((token) => (
                      <option key={token.symbol} value={token.symbol}>
                        {activeTab === 'wrap' ? token.symbol : `c${token.symbol}`}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Balances */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">
                      {activeTab === 'wrap' ? 'Regular Balance' : 'Confidential Balance'}
                    </div>
                    <div className="font-mono font-medium">
                      {activeTab === 'wrap'
                        ? `${selectedBalance?.regular.toFixed(4)} ${selectedToken}`
                        : `${selectedBalance?.confidential.toFixed(4)} c${selectedToken}`}
                    </div>
                  </div>
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <div className="text-xs text-muted-foreground mb-1">
                      {activeTab === 'wrap' ? 'Confidential Balance' : 'Regular Balance'}
                    </div>
                    <div className="font-mono font-medium">
                      {activeTab === 'wrap'
                        ? `${selectedBalance?.confidential.toFixed(4)} c${selectedToken}`
                        : `${selectedBalance?.regular.toFixed(4)} ${selectedToken}`}
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
                      className="w-full p-3 pr-20 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {activeTab === 'wrap' ? selectedToken : `c${selectedToken}`}
                    </span>
                  </div>
                </div>

                {/* Conversion Preview */}
                {amount && (
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
                  <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-sm text-green-500">
                    <CheckCircle className="h-4 w-4 flex-shrink-0" />
                    {txMessage}
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
                  disabled={!amount || parseFloat(amount) <= 0 || parseFloat(amount) > maxAmount || isProcessing}
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

        {/* Additional Info */}
        <div className="mt-8 space-y-4">
          <h3 className="font-semibold">How it works</h3>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">
                1
              </div>
              <div>
                <strong className="text-foreground">Wrap:</strong> Deposit your tokens into the
                confidential vault. You receive c-tokens with an encrypted balance.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">
                2
              </div>
              <div>
                <strong className="text-foreground">Trade:</strong> Use c-tokens to place
                private orders on Confidex. Order amounts and prices remain encrypted.
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs">
                3
              </div>
              <div>
                <strong className="text-foreground">Unwrap:</strong> Convert c-tokens back to
                regular tokens when you want to withdraw or use them elsewhere.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Confidential tokens powered by Arcium encryption</p>
        </div>
      </footer>
    </main>
  );
}
