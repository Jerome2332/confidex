'use client';

import { useState } from 'react';
import Link from 'next/link';
import { WalletButton } from '@/components/wallet-button';
import { usePredictions } from '@/hooks/use-predictions';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Shield,
  TrendingUp,
  TrendingDown,
  Clock,
  Loader2,
  ArrowLeft,
  CheckCircle,
  XCircle,
} from 'lucide-react';

export default function PredictPage() {
  const { connected } = useWallet();
  const {
    markets,
    selectedMarket,
    positions,
    isLoadingMarkets,
    selectMarket,
    buyTokens,
    calculateWinnings,
    isTransacting,
    lastError,
  } = usePredictions();

  const [selectedOutcome, setSelectedOutcome] = useState<'YES' | 'NO'>('YES');
  const [amount, setAmount] = useState('');

  const potentialWinnings = amount
    ? calculateWinnings(parseFloat(amount), selectedOutcome)
    : 0;

  const handleBuy = async () => {
    if (!amount || !selectedMarket) return;

    const maxPrice = selectedOutcome === 'YES'
      ? selectedMarket.yesToken.price * 1.05
      : selectedMarket.noToken.price * 1.05;

    try {
      await buyTokens(selectedOutcome, parseFloat(amount), maxPrice);
      setAmount('');
    } catch (error) {
      console.error('Buy failed:', error);
    }
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
                Predict
              </span>
            </div>
          </div>
          <WalletButton />
        </div>
      </header>

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Markets List */}
          <div className="lg:col-span-2">
            <h2 className="text-xl font-semibold mb-4">Prediction Markets</h2>

            {isLoadingMarkets ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : markets.length === 0 ? (
              <div className="border border-border rounded-lg p-8 text-center">
                <p className="text-muted-foreground mb-4">No active markets</p>
                <p className="text-sm text-muted-foreground">
                  Markets will appear here once they are created via the PNP protocol.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {markets.map((market) => (
                  <div
                    key={market.id.toBase58()}
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      selectedMarket?.id.equals(market.id)
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => selectMarket(market.id)}
                  >
                    <h3 className="font-medium mb-2">{market.question}</h3>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <TrendingUp className="h-4 w-4 text-green-500" />
                          <span className="text-green-500">
                            YES {(market.yesToken.price * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <TrendingDown className="h-4 w-4 text-red-500" />
                          <span className="text-red-500">
                            NO {(market.noToken.price * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-4 w-4" />
                        <span>
                          Ends {market.endTime.toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Demo Markets */}
            {markets.length === 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-medium mb-4 text-muted-foreground">
                  Example Markets (Demo)
                </h3>
                <div className="space-y-4 opacity-60">
                  <div className="border border-border rounded-lg p-4">
                    <h3 className="font-medium mb-2">
                      Will SOL reach $200 by end of Q1 2026?
                    </h3>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-green-500">YES 62.5%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        <span className="text-red-500">NO 37.5%</span>
                      </div>
                    </div>
                  </div>
                  <div className="border border-border rounded-lg p-4">
                    <h3 className="font-medium mb-2">
                      Will Arcium C-SPL launch on mainnet by February 2026?
                    </h3>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4 text-green-500" />
                        <span className="text-green-500">YES 78.3%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingDown className="h-4 w-4 text-red-500" />
                        <span className="text-red-500">NO 21.7%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Trading Panel */}
          <div className="lg:col-span-1">
            <div className="border border-border rounded-lg p-6 sticky top-4">
              <h2 className="text-lg font-semibold mb-4">Trade</h2>

              {!connected ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    Connect your wallet to trade
                  </p>
                  <WalletButton />
                </div>
              ) : !selectedMarket ? (
                <div className="text-center py-8 text-muted-foreground">
                  Select a market to trade
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Market Question */}
                  <div className="p-3 bg-secondary/50 rounded-lg">
                    <p className="text-sm font-medium">{selectedMarket.question}</p>
                  </div>

                  {/* Outcome Selection */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`p-3 rounded-lg border-2 transition-colors ${
                        selectedOutcome === 'YES'
                          ? 'border-green-500 bg-green-500/10'
                          : 'border-border hover:border-green-500/50'
                      }`}
                      onClick={() => setSelectedOutcome('YES')}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle className="h-5 w-5 text-green-500" />
                        <span className="font-medium">YES</span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {(selectedMarket.yesToken.price * 100).toFixed(1)}%
                      </div>
                    </button>
                    <button
                      className={`p-3 rounded-lg border-2 transition-colors ${
                        selectedOutcome === 'NO'
                          ? 'border-red-500 bg-red-500/10'
                          : 'border-border hover:border-red-500/50'
                      }`}
                      onClick={() => setSelectedOutcome('NO')}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <XCircle className="h-5 w-5 text-red-500" />
                        <span className="font-medium">NO</span>
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {(selectedMarket.noToken.price * 100).toFixed(1)}%
                      </div>
                    </button>
                  </div>

                  {/* Amount Input */}
                  <div>
                    <label className="block text-sm text-muted-foreground mb-1">
                      Amount (USDC)
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full p-3 rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>

                  {/* Potential Winnings */}
                  {amount && (
                    <div className="p-3 bg-secondary/50 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Potential winnings:</span>
                        <span className="font-medium text-green-500">
                          {potentialWinnings.toFixed(2)} USDC
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-muted-foreground">Return:</span>
                        <span className="font-medium">
                          {((potentialWinnings / parseFloat(amount) - 1) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Error Display */}
                  {lastError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-sm text-red-500">
                      {lastError}
                    </div>
                  )}

                  {/* Buy Button */}
                  <button
                    onClick={handleBuy}
                    disabled={!amount || isTransacting}
                    className={`w-full p-3 rounded-lg font-medium transition-colors ${
                      selectedOutcome === 'YES'
                        ? 'bg-green-500 hover:bg-green-600 text-white'
                        : 'bg-red-500 hover:bg-red-600 text-white'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    {isTransacting ? (
                      <span className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Processing...
                      </span>
                    ) : (
                      `Buy ${selectedOutcome}`
                    )}
                  </button>
                </div>
              )}

              {/* Positions */}
              {connected && positions.length > 0 && (
                <div className="mt-6 pt-6 border-t border-border">
                  <h3 className="text-sm font-medium mb-3">Your Positions</h3>
                  <div className="space-y-2">
                    {positions.map((pos) => (
                      <div
                        key={pos.marketId.toBase58()}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-muted-foreground truncate max-w-[150px]">
                          {pos.marketId.toBase58().slice(0, 8)}...
                        </span>
                        <div className="flex gap-3">
                          {pos.yesBalance > 0 && (
                            <span className="text-green-500">
                              {Number(pos.yesBalance / BigInt(1e6))} YES
                            </span>
                          )}
                          {pos.noBalance > 0 && (
                            <span className="text-red-500">
                              {Number(pos.noBalance / BigInt(1e6))} NO
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-8 mt-12">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          <p>Prediction markets powered by PNP Protocol</p>
          <p className="mt-2">
            Integrated with Confidex for privacy-preserving trades
          </p>
        </div>
      </footer>
    </main>
  );
}
