'use client';

import { useState } from 'react';
import { Header } from '@/components/header';
import { WalletButton } from '@/components/wallet-button';
import { usePredictions } from '@/hooks/use-predictions';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Loader2,
  CheckCircle,
  XCircle,
  Github,
  BookOpen,
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
    <main className="min-h-screen bg-black">
      <Header />

      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Markets List */}
          <div className="lg:col-span-2">
            <h2 className="text-xl font-light text-white mb-4">Prediction Markets</h2>

            {isLoadingMarkets ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-white/40" />
              </div>
            ) : markets.length === 0 ? (
              <div className="border border-white/10 rounded-xl p-8 text-center">
                <p className="text-white/60 mb-4">No active markets</p>
                <p className="text-sm text-white/40">
                  Markets will appear here once they are created via the PNP protocol.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {markets.map((market) => (
                  <div
                    key={market.id.toBase58()}
                    className={`border rounded-xl p-4 cursor-pointer transition-colors ${
                      selectedMarket?.id.equals(market.id)
                        ? 'border-white/30 bg-white/5'
                        : 'border-white/10 hover:border-white/20'
                    }`}
                    onClick={() => selectMarket(market.id)}
                  >
                    <h3 className="font-normal text-white mb-2">{market.question}</h3>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-1">
                          <TrendingUp className="h-4 w-4 text-emerald-400/80" />
                          <span className="text-emerald-400/80">
                            YES {(market.yesToken.price * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <TrendingDown className="h-4 w-4 text-rose-400/80" />
                          <span className="text-rose-400/80">
                            NO {(market.noToken.price * 100).toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-white/40">
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
                <h3 className="text-lg font-normal mb-4 text-white/50">
                  Example Markets (Demo)
                </h3>
                <div className="space-y-4 opacity-60">
                  <div className="border border-white/10 rounded-xl p-4">
                    <h3 className="font-normal text-white mb-2">
                      Will SOL reach $200 by end of Q1 2026?
                    </h3>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4 text-emerald-400/80" />
                        <span className="text-emerald-400/80">YES 62.5%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingDown className="h-4 w-4 text-rose-400/80" />
                        <span className="text-rose-400/80">NO 37.5%</span>
                      </div>
                    </div>
                  </div>
                  <div className="border border-white/10 rounded-xl p-4">
                    <h3 className="font-normal text-white mb-2">
                      Will Arcium C-SPL launch on mainnet by February 2026?
                    </h3>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-4 w-4 text-emerald-400/80" />
                        <span className="text-emerald-400/80">YES 78.3%</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <TrendingDown className="h-4 w-4 text-rose-400/80" />
                        <span className="text-rose-400/80">NO 21.7%</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Trading Panel */}
          <div className="lg:col-span-1">
            <div className="border border-white/10 rounded-xl p-6 sticky top-4 bg-white/5">
              <h2 className="text-lg font-normal text-white mb-4">Trade</h2>

              {!connected ? (
                <div className="text-center py-8">
                  <p className="text-white/50 mb-4">
                    Connect your wallet to trade
                  </p>
                  <WalletButton />
                </div>
              ) : !selectedMarket ? (
                <div className="text-center py-8 text-white/50">
                  Select a market to trade
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Market Question */}
                  <div className="p-3 bg-white/5 rounded-lg">
                    <p className="text-sm font-normal text-white">{selectedMarket.question}</p>
                  </div>

                  {/* Outcome Selection */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      className={`p-3 rounded-lg border-2 transition-colors ${
                        selectedOutcome === 'YES'
                          ? 'border-emerald-500/30 bg-emerald-500/20'
                          : 'border-white/10 hover:border-emerald-500/20'
                      }`}
                      onClick={() => setSelectedOutcome('YES')}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle className="h-5 w-5 text-emerald-400/80" />
                        <span className="font-medium text-white">YES</span>
                      </div>
                      <div className="text-sm text-white/50 mt-1">
                        {(selectedMarket.yesToken.price * 100).toFixed(1)}%
                      </div>
                    </button>
                    <button
                      className={`p-3 rounded-lg border-2 transition-colors ${
                        selectedOutcome === 'NO'
                          ? 'border-rose-500/30 bg-rose-500/20'
                          : 'border-white/10 hover:border-rose-500/20'
                      }`}
                      onClick={() => setSelectedOutcome('NO')}
                    >
                      <div className="flex items-center justify-center gap-2">
                        <XCircle className="h-5 w-5 text-rose-400/80" />
                        <span className="font-medium text-white">NO</span>
                      </div>
                      <div className="text-sm text-white/50 mt-1">
                        {(selectedMarket.noToken.price * 100).toFixed(1)}%
                      </div>
                    </button>
                  </div>

                  {/* Amount Input */}
                  <div>
                    <label className="block text-sm text-white/50 mb-1">
                      Amount (USDC)
                    </label>
                    <input
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full p-3 rounded-lg border border-white/10 bg-black text-white focus:outline-none focus:ring-2 focus:ring-white/30"
                    />
                  </div>

                  {/* Potential Winnings */}
                  {amount && (
                    <div className="p-3 bg-white/5 rounded-lg">
                      <div className="flex justify-between text-sm">
                        <span className="text-white/50">Potential winnings:</span>
                        <span className="font-medium text-emerald-400/80">
                          {potentialWinnings.toFixed(2)} USDC
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-white/50">Return:</span>
                        <span className="font-medium text-white">
                          {((potentialWinnings / parseFloat(amount) - 1) * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Error Display */}
                  {lastError && (
                    <div className="p-3 bg-rose-500/20 border border-rose-500/30 rounded-lg text-sm text-rose-400/80">
                      {lastError}
                    </div>
                  )}

                  {/* Buy Button */}
                  <button
                    onClick={handleBuy}
                    disabled={!amount || isTransacting}
                    className={`w-full p-3 rounded-lg font-medium transition-colors ${
                      selectedOutcome === 'YES'
                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                        : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30'
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
                <div className="mt-6 pt-6 border-t border-white/10">
                  <h3 className="text-sm font-medium text-white mb-3">Your Positions</h3>
                  <div className="space-y-2">
                    {positions.map((pos) => (
                      <div
                        key={pos.marketId.toBase58()}
                        className="flex justify-between text-sm"
                      >
                        <span className="text-white/40 truncate max-w-[150px]">
                          {pos.marketId.toBase58().slice(0, 8)}...
                        </span>
                        <div className="flex gap-3">
                          {pos.yesBalance > 0 && (
                            <span className="text-emerald-400/80">
                              {Number(pos.yesBalance / BigInt(1e6))} YES
                            </span>
                          )}
                          {pos.noBalance > 0 && (
                            <span className="text-rose-400/80">
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
      <footer className="border-t border-white/10 py-6 mt-8">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-6 text-sm text-white/40">
              <span>Built for Solana Privacy Hack 2026</span>
              <div className="flex items-center gap-4">
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  <Github className="h-4 w-4" />
                </a>
                <a
                  href="https://docs.arcium.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  <BookOpen className="h-4 w-4" />
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-white/40">
              <span>Powered by</span>
              <span className="bg-white/10 px-2 py-0.5 rounded">Arcium MPC</span>
              <span className="bg-white/10 px-2 py-0.5 rounded">Noir ZK</span>
              <span className="bg-white/10 px-2 py-0.5 rounded">ShadowWire</span>
            </div>
          </div>
        </div>
      </footer>
    </main>
  );
}
