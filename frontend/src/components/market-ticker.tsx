'use client';

import { FC, useState, useEffect, useRef } from 'react';
import { Pulse, Copy, Clock, WifiHigh, WifiSlash, Star, ArrowSquareOut, CaretDown, TrendUp, TrendDown } from '@phosphor-icons/react';
import { TokenIcon } from './token-selector';
import { useSolPrice } from '@/hooks/use-pyth-price';
import { toast } from 'sonner';

interface MarketData {
  pair: string;
  price: number;
  previousPrice: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  lastUpdate: Date;
}

interface MarketTickerProps {
  variant?: 'card' | 'bar';
}

// Mock program ID for display
const PROGRAM_ID = '63bxUBrB...3aqfArB';
const FULL_PROGRAM_ID = '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB';

export const MarketTicker: FC<MarketTickerProps> = ({ variant = 'card' }) => {
  const { price: pythPrice, priceData, isLoading, error, isStreaming, lastUpdate } = useSolPrice();

  const [isFavorite, setIsFavorite] = useState(false);
  const [marketData, setMarketData] = useState<MarketData>({
    pair: 'SOL/USDC',
    price: 0,
    previousPrice: 0,
    change24h: 0,
    high24h: 0,
    low24h: Infinity,
    volume24h: 48415954.13, // Mock volume
    lastUpdate: new Date(),
  });

  const [priceDirection, setPriceDirection] = useState<'up' | 'down' | 'neutral'>('neutral');
  const priceHistory24hRef = useRef<{ price: number; time: Date }[]>([]);
  const initialPriceRef = useRef<number | null>(null);

  // Update market data when Pyth price changes
  useEffect(() => {
    if (pythPrice && pythPrice > 0) {
      if (initialPriceRef.current === null) {
        initialPriceRef.current = pythPrice;
      }

      priceHistory24hRef.current.push({ price: pythPrice, time: new Date() });

      const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      priceHistory24hRef.current = priceHistory24hRef.current
        .filter(p => p.time.getTime() > oneDayAgo)
        .slice(-1000);

      const prices = priceHistory24hRef.current.map(p => p.price);
      const high24h = Math.max(...prices, pythPrice);
      const low24h = Math.min(...prices.filter(p => p > 0), pythPrice);

      const oldestPrice = priceHistory24hRef.current[0]?.price || initialPriceRef.current || pythPrice;
      const change24h = oldestPrice > 0 ? ((pythPrice - oldestPrice) / oldestPrice) * 100 : 0;

      setMarketData(prev => {
        const direction = pythPrice > prev.price ? 'up' : pythPrice < prev.price ? 'down' : 'neutral';
        setPriceDirection(direction);

        return {
          ...prev,
          price: pythPrice,
          previousPrice: prev.price,
          change24h: Math.round(change24h * 100) / 100,
          high24h,
          low24h: low24h === Infinity ? pythPrice : low24h,
          lastUpdate: lastUpdate || new Date(),
        };
      });
    }
  }, [pythPrice, lastUpdate]);

  const isPositive = marketData.change24h >= 0;
  const hasValidPrice = marketData.price > 0;
  const priceChangeAbs = Math.abs(marketData.price - (initialPriceRef.current || marketData.price)).toFixed(3);

  const copyContractAddress = () => {
    navigator.clipboard.writeText(FULL_PROGRAM_ID);
    toast.success('Contract address copied');
  };

  const formatVolume = (vol: number) => {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
    if (vol >= 1e3) return `${(vol / 1e3).toFixed(2)}K`;
    return vol.toFixed(2);
  };

  // Bar variant - compact horizontal layout for header
  if (variant === 'bar') {
    return (
      <div className="bg-card/50 border-b border-border px-4 py-2">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Pair selector with favorite */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsFavorite(!isFavorite)}
              className={`p-1 transition-colors ${isFavorite ? 'text-yellow-500' : 'text-muted-foreground hover:text-yellow-500'}`}
            >
              <Star size={16} weight={isFavorite ? 'fill' : 'regular'} />
            </button>
            <button className="flex items-center gap-2 hover:bg-secondary/50 rounded-lg px-2 py-1 transition-colors">
              <TokenIcon symbol="SOL" size={24} />
              <span className="font-semibold">{marketData.pair}</span>
              <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded font-medium">Spot</span>
              <CaretDown size={16} className="text-muted-foreground" />
            </button>
          </div>

          {/* Center: Price and stats */}
          <div className="flex items-center gap-6">
            {/* Price and change */}
            <div className="flex items-center gap-3">
              <span
                className={`text-lg font-bold font-mono ${
                  priceDirection === 'up'
                    ? 'text-white'
                    : priceDirection === 'down'
                    ? 'text-white/60'
                    : 'text-foreground'
                }`}
              >
                {hasValidPrice ? `$${marketData.price.toFixed(2)}` : '—'}
              </span>
              <div
                className={`flex items-center gap-1 text-sm ${
                  isPositive ? 'text-white' : 'text-white/60'
                }`}
              >
                {isPositive ? (
                  <TrendUp size={12} />
                ) : (
                  <TrendDown size={12} />
                )}
                <span className="text-xs font-mono">
                  {isPositive ? '+' : ''}{priceChangeAbs} / {isPositive ? '+' : ''}{marketData.change24h.toFixed(2)}%
                </span>
              </div>
            </div>

            {/* Stats */}
            <div className="hidden lg:flex items-center gap-4 text-xs text-muted-foreground">
              <div>
                <span className="mr-1">24h High:</span>
                <span className="text-white font-mono">
                  {hasValidPrice && marketData.high24h > 0 ? `$${marketData.high24h.toFixed(2)}` : '—'}
                </span>
              </div>
              <div>
                <span className="mr-1">24h Low:</span>
                <span className="text-white/60 font-mono">
                  {hasValidPrice && marketData.low24h < Infinity ? `$${marketData.low24h.toFixed(2)}` : '—'}
                </span>
              </div>
              <div>
                <span className="mr-1">24h Vol:</span>
                <span className="text-foreground font-mono">{formatVolume(marketData.volume24h)} USDC</span>
              </div>
            </div>
          </div>

          {/* Right: Contract and status */}
          <div className="flex items-center gap-3">
            {/* Contract address */}
            <div className="hidden md:flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">Contract:</span>
              <button
                onClick={copyContractAddress}
                className="flex items-center gap-1 text-primary hover:underline font-mono"
              >
                {PROGRAM_ID}
                <Copy size={12} />
              </button>
              <a
                href={`https://explorer.solana.com/address/${FULL_PROGRAM_ID}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-muted-foreground hover:text-foreground"
              >
                <ArrowSquareOut size={12} />
              </a>
            </div>

            {/* Status indicator */}
            <div className={`flex items-center gap-1 text-xs ${isStreaming ? 'text-white' : 'text-muted-foreground'}`}>
              {isStreaming ? <WifiHigh size={12} /> : <WifiSlash size={12} />}
            </div>
            <div className="text-[10px] bg-purple-500/10 text-purple-500 px-1.5 py-0.5 rounded font-medium">
              PYTH
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Card variant - full card layout (default)
  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsFavorite(!isFavorite)}
            className={`p-1 transition-colors ${isFavorite ? 'text-yellow-500' : 'text-muted-foreground hover:text-yellow-500'}`}
          >
            <Star size={16} weight={isFavorite ? 'fill' : 'regular'} />
          </button>
          <TokenIcon symbol="SOL" size={32} />
          <div>
            <h3 className="font-semibold">{marketData.pair}</h3>
            <span className="text-xs text-muted-foreground">Solana</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 text-xs ${isStreaming ? 'text-white' : 'text-muted-foreground'}`}>
            {isStreaming ? (
              <>
                <WifiHigh size={12} />
                <span>Live</span>
              </>
            ) : (
              <>
                <WifiSlash size={12} />
                <span>Polling</span>
              </>
            )}
          </div>
          <div className="text-[10px] bg-purple-500/10 text-purple-500 px-1.5 py-0.5 rounded font-medium">
            PYTH
          </div>
        </div>
      </div>

      {/* Price Display */}
      <div className="mb-4">
        {isLoading && !hasValidPrice ? (
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold font-mono text-muted-foreground animate-pulse">
              Loading...
            </span>
          </div>
        ) : error && !hasValidPrice ? (
          <div className="text-red-500 text-sm">{error}</div>
        ) : (
          <div className="flex items-baseline gap-2">
            <span
              className={`text-3xl font-bold font-mono transition-colors duration-300 ${
                priceDirection === 'up'
                  ? 'text-white'
                  : priceDirection === 'down'
                  ? 'text-white/60'
                  : 'text-foreground'
              }`}
            >
              ${marketData.price.toFixed(2)}
            </span>
            <div
              className={`flex items-center gap-1 text-sm ${
                isPositive ? 'text-white' : 'text-white/60'
              }`}
            >
              {isPositive ? (
                <TrendUp size={16} />
              ) : (
                <TrendDown size={16} />
              )}
              <span>
                {isPositive ? '+' : ''}{marketData.change24h.toFixed(2)}%
              </span>
            </div>
          </div>
        )}

        {priceData && (
          <div className="text-xs text-muted-foreground mt-1">
            Confidence: ±{((priceData.confidence / priceData.price) * 100).toFixed(3)}%
          </div>
        )}
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-2 bg-secondary/50 rounded">
          <div className="text-xs text-muted-foreground">24h High</div>
          <div className="font-mono text-sm text-white">
            {hasValidPrice && marketData.high24h > 0 ? `$${marketData.high24h.toFixed(2)}` : '—'}
          </div>
        </div>
        <div className="p-2 bg-secondary/50 rounded">
          <div className="text-xs text-muted-foreground">24h Low</div>
          <div className="font-mono text-sm text-white/60">
            {hasValidPrice && marketData.low24h < Infinity ? `$${marketData.low24h.toFixed(2)}` : '—'}
          </div>
        </div>
        <div className="p-2 bg-secondary/50 rounded">
          <div className="text-xs text-muted-foreground">24h Volume</div>
          <div className="font-mono text-sm">{formatVolume(marketData.volume24h)} USDC</div>
        </div>
        <div className="p-2 bg-secondary/50 rounded">
          <div className="text-xs text-muted-foreground">Updated</div>
          <div className="text-xs flex items-center gap-1">
            <Clock size={12} />
            {marketData.lastUpdate.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Contract Address */}
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Contract:</span>
          <div className="flex items-center gap-2">
            <button
              onClick={copyContractAddress}
              className="flex items-center gap-1 text-primary hover:underline font-mono"
            >
              {PROGRAM_ID}
              <Copy size={12} />
            </button>
            <a
              href={`https://explorer.solana.com/address/${FULL_PROGRAM_ID}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowSquareOut size={12} />
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-3 pt-3 border-t border-border flex justify-between text-xs text-muted-foreground">
        <span>Market: Confidential</span>
        <span className="text-primary flex items-center gap-1">
          <Pulse size={12} />
          Privacy Enabled
        </span>
      </div>
    </div>
  );
};
