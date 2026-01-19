'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { WalletButton } from '@/components/wallet-button';
import { ShareButtons } from '@/components/share-buttons';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { toast } from 'sonner';
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  SpinnerGap,
  ArrowSquareOut,
  Calendar,
  Drop,
  User,
  ChartBar,
  TrendUp,
  TrendDown,
} from '@phosphor-icons/react';

import { createLogger } from '@/lib/logger';
import {
  PredictionMarket,
  MarketPosition,
  fetchMarket,
  buyOutcomeTokens,
  getUserPositions,
  calculatePotentialWinnings,
} from '@/lib/pnp';
import {
  categorizeMarket,
  getCategoryLabel,
  formatTimeRemaining,
  type MarketCategory,
} from '@/lib/market-categories';

const log = createLogger('market-detail');

// Helper to get Solscan URL based on network
const getSolscanUrl = (signature: string) => {
  const cluster = process.env.NEXT_PUBLIC_PNP_NETWORK === 'mainnet' ? '' : '?cluster=devnet';
  return `https://solscan.io/tx/${signature}${cluster}`;
};

// Category badge component
function CategoryBadge({ category }: { category: MarketCategory }) {
  const label = getCategoryLabel(category);

  const colorMap: Record<MarketCategory, string> = {
    crypto: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    politics: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    tech: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    sports: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    other: 'bg-white/10 text-white/60 border-white/20',
  };

  return (
    <span
      className={`inline-flex items-center px-3 py-1 text-sm font-medium rounded-full border ${colorMap[category]}`}
    >
      {label}
    </span>
  );
}

// Price chart placeholder component
function PriceChartPlaceholder() {
  return (
    <div className="border border-white/10 rounded-xl p-6 bg-white/[0.02]">
      <div className="flex items-center gap-2 mb-4">
        <ChartBar size={20} className="text-white/40" />
        <h3 className="text-lg font-light text-white">Price History</h3>
      </div>
      <div className="h-48 flex items-center justify-center border border-dashed border-white/10 rounded-lg bg-white/[0.01]">
        <div className="text-center">
          <ChartBar size={40} className="text-white/20 mx-auto mb-3" />
          <p className="text-white/40 text-sm">Price chart coming soon</p>
          <p className="text-white/25 text-xs mt-1">Track YES/NO prices over time</p>
        </div>
      </div>
    </div>
  );
}

// Outcome trading card component
function OutcomeCard({
  type,
  price,
  amount,
  setAmount,
  potentialWinnings,
  onBuy,
  isTransacting,
  connected,
}: {
  type: 'YES' | 'NO';
  price: number;
  amount: string;
  setAmount: (v: string) => void;
  potentialWinnings: number;
  onBuy: () => void;
  isTransacting: boolean;
  connected: boolean;
}) {
  const isYes = type === 'YES';
  const colorClass = isYes
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : 'border-rose-500/30 bg-rose-500/10';
  const textColorClass = isYes ? 'text-emerald-400' : 'text-rose-400';
  const btnColorClass = isYes
    ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border-emerald-500/30'
    : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border-rose-500/30';

  return (
    <div className={`border-2 rounded-xl p-5 ${colorClass}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          {isYes ? (
            <CheckCircle size={24} className={textColorClass} />
          ) : (
            <XCircle size={24} className={textColorClass} />
          )}
          <span className="text-xl font-medium text-white">{type}</span>
        </div>
        <span className={`text-3xl font-light ${textColorClass}`}>
          {(price * 100).toFixed(1)}%
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-sm text-white/50 mb-1">Amount (USDC)</label>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full p-3 rounded-lg border border-white/10 bg-black text-white focus:outline-none focus:ring-2 focus:ring-white/30"
          />
        </div>

        {amount && parseFloat(amount) > 0 && (
          <div className="p-3 bg-white/5 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-white/50">Potential winnings:</span>
              <span className={`font-medium ${textColorClass}`}>
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

        <button
          onClick={onBuy}
          disabled={!connected || !amount || parseFloat(amount) <= 0 || isTransacting}
          className={`w-full p-3 rounded-lg font-medium border transition-colors ${btnColorClass} disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isTransacting ? (
            <span className="flex items-center justify-center gap-2">
              <SpinnerGap size={16} className="animate-spin" />
              Processing...
            </span>
          ) : (
            `Buy ${type}`
          )}
        </button>
      </div>
    </div>
  );
}

export default function MarketDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction, connected } = useWallet();

  const [market, setMarket] = useState<PredictionMarket | null>(null);
  const [position, setPosition] = useState<MarketPosition | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [yesAmount, setYesAmount] = useState('');
  const [noAmount, setNoAmount] = useState('');
  const [isTransacting, setIsTransacting] = useState(false);
  const [lastTrade, setLastTrade] = useState<{
    signature: string;
    outcome: 'YES' | 'NO';
    tokensReceived: bigint;
  } | null>(null);

  // Fetch market data
  useEffect(() => {
    async function loadMarket() {
      setIsLoading(true);
      setError(null);

      try {
        const marketId = new PublicKey(params.id);
        const marketData = await fetchMarket(connection, marketId);
        setMarket(marketData);
      } catch (err) {
        log.error('Failed to load market:', { error: err instanceof Error ? err.message : String(err) });
        setError('Failed to load market. It may not exist or there was a network error.');
      } finally {
        setIsLoading(false);
      }
    }

    loadMarket();
  }, [params.id, connection]);

  // Fetch user position
  useEffect(() => {
    async function loadPosition() {
      if (!publicKey || !market) return;

      try {
        const positions = await getUserPositions(connection, publicKey);
        const userPosition = positions.find((p) => p.marketId.equals(market.id));
        setPosition(userPosition || null);
      } catch (err) {
        log.error('Failed to load position:', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    loadPosition();
  }, [publicKey, market, connection]);

  // Auto-clear last trade after 5 seconds
  useEffect(() => {
    if (lastTrade) {
      const timer = setTimeout(() => setLastTrade(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [lastTrade]);

  // Calculate potential winnings
  const calculateWinnings = useCallback(
    (amount: number, outcome: 'YES' | 'NO') => {
      if (!market) return 0;
      const price = outcome === 'YES' ? market.yesToken.price : market.noToken.price;
      return calculatePotentialWinnings(amount, price);
    },
    [market]
  );

  // Handle buy
  const handleBuy = useCallback(
    async (outcome: 'YES' | 'NO') => {
      if (!publicKey || !signTransaction || !market) return;

      const amount = outcome === 'YES' ? yesAmount : noAmount;
      if (!amount || parseFloat(amount) <= 0) return;

      setIsTransacting(true);
      const toastId = toast.loading(`Buying ${outcome} tokens...`, {
        description: 'Waiting for wallet approval',
      });

      try {
        const maxPrice =
          outcome === 'YES'
            ? market.yesToken.price * 1.05
            : market.noToken.price * 1.05;

        const result = await buyOutcomeTokens(
          connection,
          market.id,
          outcome,
          parseFloat(amount),
          maxPrice,
          { publicKey, signTransaction, sendTransaction }
        );

        toast.success(`Bought ${outcome} tokens!`, {
          id: toastId,
          description: `${amount} USDC → ${(Number(result.tokensReceived) / 1e6).toFixed(2)} tokens`,
          action: {
            label: 'View TX',
            onClick: () => window.open(getSolscanUrl(result.signature), '_blank'),
          },
          duration: 5000,
        });

        setLastTrade({
          signature: result.signature,
          outcome,
          tokensReceived: result.tokensReceived,
        });

        // Clear amount and refresh market
        if (outcome === 'YES') {
          setYesAmount('');
        } else {
          setNoAmount('');
        }

        // Refresh market data
        const marketId = new PublicKey(params.id);
        const updatedMarket = await fetchMarket(connection, marketId);
        setMarket(updatedMarket);

        // Refresh position
        if (publicKey) {
          const positions = await getUserPositions(connection, publicKey);
          const userPosition = positions.find((p) => p.marketId.equals(market.id));
          setPosition(userPosition || null);
        }
      } catch (err) {
        toast.error('Transaction failed', {
          id: toastId,
          description: err instanceof Error ? err.message : 'Unknown error',
          duration: 5000,
        });
        log.error('Buy failed:', { error: err instanceof Error ? err.message : String(err) });
      } finally {
        setIsTransacting(false);
      }
    },
    [publicKey, signTransaction, sendTransaction, market, connection, yesAmount, noAmount, params.id]
  );

  // Loading state
  if (isLoading) {
    return (
      <main className="min-h-screen bg-black">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center py-24">
            <SpinnerGap size={32} className="animate-spin text-white/40" />
          </div>
        </div>
      </main>
    );
  }

  // Error state
  if (error || !market) {
    return (
      <main className="min-h-screen bg-black">
        <Header />
        <div className="container mx-auto px-4 py-8">
          <div className="max-w-2xl mx-auto text-center py-24">
            <XCircle size={48} className="text-rose-400/60 mx-auto mb-4" />
            <h1 className="text-xl font-light text-white mb-2">Market Not Found</h1>
            <p className="text-white/50 mb-6">{error || 'The market you are looking for does not exist.'}</p>
            <Link
              href="/predict"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-white/20 text-white/80 hover:text-white hover:border-white/40 transition-colors"
            >
              <ArrowLeft size={16} />
              Back to Markets
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const category = categorizeMarket(market.question);
  const timeRemaining = formatTimeRemaining(market.endTime);
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const shareText = `${market.question} - Trade on Confidex prediction markets`;

  const yesWinnings = yesAmount ? calculateWinnings(parseFloat(yesAmount), 'YES') : 0;
  const noWinnings = noAmount ? calculateWinnings(parseFloat(noAmount), 'NO') : 0;

  return (
    <main className="min-h-screen bg-black">
      <Header />

      <div className="container mx-auto px-4 py-8">
        {/* Back link and share buttons */}
        <div className="flex items-center justify-between mb-6">
          <Link
            href="/predict"
            className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Back to Markets</span>
          </Link>
          <ShareButtons url={shareUrl} text={shareText} />
        </div>

        {/* Market header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <CategoryBadge category={category} />
            <div
              className={`flex items-center gap-1 text-sm ${
                timeRemaining.urgent ? 'text-amber-400' : 'text-white/50'
              }`}
            >
              <Clock size={16} />
              <span>
                {timeRemaining.text} left ({market.endTime.toLocaleDateString()})
              </span>
            </div>
          </div>
          <h1 className="text-2xl md:text-3xl font-light text-white">{market.question}</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Trading cards */}
            {!connected ? (
              <div className="border border-white/10 rounded-xl p-8 text-center">
                <p className="text-white/50 mb-4">Connect your wallet to trade</p>
                <WalletButton />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <OutcomeCard
                  type="YES"
                  price={market.yesToken.price}
                  amount={yesAmount}
                  setAmount={setYesAmount}
                  potentialWinnings={yesWinnings}
                  onBuy={() => handleBuy('YES')}
                  isTransacting={isTransacting}
                  connected={connected}
                />
                <OutcomeCard
                  type="NO"
                  price={market.noToken.price}
                  amount={noAmount}
                  setAmount={setNoAmount}
                  potentialWinnings={noWinnings}
                  onBuy={() => handleBuy('NO')}
                  isTransacting={isTransacting}
                  connected={connected}
                />
              </div>
            )}

            {/* Success message */}
            {lastTrade && (
              <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle size={20} className="text-emerald-400" />
                    <span className="text-emerald-400">
                      Bought {(Number(lastTrade.tokensReceived) / 1e6).toFixed(2)} {lastTrade.outcome} tokens
                    </span>
                  </div>
                  <a
                    href={getSolscanUrl(lastTrade.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm text-white/40 hover:text-white/60"
                  >
                    View <ArrowSquareOut size={12} />
                  </a>
                </div>
              </div>
            )}

            {/* Price chart placeholder */}
            <PriceChartPlaceholder />
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Market details */}
            <div className="border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-light text-white mb-4">Market Details</h3>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Calendar size={20} className="text-white/40 mt-0.5" />
                  <div>
                    <p className="text-sm text-white/50">Resolution Date</p>
                    <p className="text-white">
                      {market.endTime.toLocaleDateString('en-US', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Drop size={20} className="text-white/40 mt-0.5" />
                  <div>
                    <p className="text-sm text-white/50">Total Liquidity</p>
                    <p className="text-white">
                      ${(Number(market.totalLiquidity) / 1e6).toLocaleString()} USDC
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <User size={20} className="text-white/40 mt-0.5" />
                  <div>
                    <p className="text-sm text-white/50">Creator</p>
                    <p className="text-white font-mono text-sm">
                      {market.creator.toBase58().slice(0, 4)}...{market.creator.toBase58().slice(-4)}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Current prices */}
            <div className="border border-white/10 rounded-xl p-6">
              <h3 className="text-lg font-light text-white mb-4">Current Prices</h3>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                  <div className="flex items-center gap-2">
                    <TrendUp size={20} className="text-emerald-400" />
                    <span className="text-white">YES</span>
                  </div>
                  <span className="text-lg font-medium text-emerald-400">
                    {(market.yesToken.price * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-rose-500/10 rounded-lg border border-rose-500/20">
                  <div className="flex items-center gap-2">
                    <TrendDown size={20} className="text-rose-400" />
                    <span className="text-white">NO</span>
                  </div>
                  <span className="text-lg font-medium text-rose-400">
                    {(market.noToken.price * 100).toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* User position */}
            {position && (position.yesBalance > 0 || position.noBalance > 0) && (
              <div className="border border-white/10 rounded-xl p-6">
                <h3 className="text-lg font-light text-white mb-4">Your Position</h3>
                <div className="space-y-3">
                  {position.yesBalance > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">YES tokens</span>
                      <span className="text-emerald-400 font-medium">
                        {(Number(position.yesBalance) / 1e6).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {position.noBalance > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-white/60">NO tokens</span>
                      <span className="text-rose-400 font-medium">
                        {(Number(position.noBalance) / 1e6).toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
