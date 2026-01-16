'use client';

import { FC, useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, Activity, Clock, DollarSign } from 'lucide-react';

interface MarketData {
  pair: string;
  price: number;
  change24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  lastUpdate: Date;
}

export const MarketTicker: FC = () => {
  const [marketData, setMarketData] = useState<MarketData>({
    pair: 'SOL/USDC',
    price: 104.50,
    change24h: 2.34,
    high24h: 106.25,
    low24h: 101.80,
    volume24h: 125000,
    lastUpdate: new Date(),
  });

  const [isUpdating, setIsUpdating] = useState(false);

  // Simulate price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setIsUpdating(true);
      setMarketData(prev => {
        const change = (Math.random() - 0.5) * 0.5;
        const newPrice = Math.round((prev.price + change) * 100) / 100;
        const newChange = prev.change24h + (Math.random() - 0.5) * 0.1;

        return {
          ...prev,
          price: Math.max(90, Math.min(120, newPrice)),
          change24h: Math.round(newChange * 100) / 100,
          high24h: Math.max(prev.high24h, newPrice),
          low24h: Math.min(prev.low24h, newPrice),
          volume24h: prev.volume24h + Math.floor(Math.random() * 1000),
          lastUpdate: new Date(),
        };
      });
      setTimeout(() => setIsUpdating(false), 300);
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const isPositive = marketData.change24h >= 0;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-xs font-bold">
            SOL
          </div>
          <div>
            <h3 className="font-semibold">{marketData.pair}</h3>
            <span className="text-xs text-muted-foreground">Solana</span>
          </div>
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Activity className={`h-3 w-3 ${isUpdating ? 'text-primary animate-pulse' : ''}`} />
          <span>Live</span>
        </div>
      </div>

      {/* Price Display */}
      <div className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold font-mono transition-colors ${
            isUpdating ? (isPositive ? 'text-green-400' : 'text-red-400') : 'text-foreground'
          }`}>
            ${marketData.price.toFixed(2)}
          </span>
          <div className={`flex items-center gap-1 text-sm ${
            isPositive ? 'text-green-400' : 'text-red-400'
          }`}>
            {isPositive ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            <span>{isPositive ? '+' : ''}{marketData.change24h.toFixed(2)}%</span>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-2 bg-secondary/50 rounded">
          <div className="text-xs text-muted-foreground">24h High</div>
          <div className="font-mono text-sm text-green-400">
            ${marketData.high24h.toFixed(2)}
          </div>
        </div>
        <div className="p-2 bg-secondary/50 rounded">
          <div className="text-xs text-muted-foreground">24h Low</div>
          <div className="font-mono text-sm text-red-400">
            ${marketData.low24h.toFixed(2)}
          </div>
        </div>
        <div className="p-2 bg-secondary/50 rounded col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">24h Volume</div>
              <div className="font-mono text-sm flex items-center gap-1">
                <DollarSign className="h-3 w-3" />
                {(marketData.volume24h / 1000).toFixed(1)}K
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs text-muted-foreground">Updated</div>
              <div className="text-xs flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {marketData.lastUpdate.toLocaleTimeString()}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Price Range Bar */}
      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>${marketData.low24h.toFixed(2)}</span>
          <span>24h Range</span>
          <span>${marketData.high24h.toFixed(2)}</span>
        </div>
        <div className="h-2 bg-secondary rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500 rounded-full relative"
            style={{ width: '100%' }}
          >
            {/* Current price indicator */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-white rounded shadow-lg"
              style={{
                left: `${((marketData.price - marketData.low24h) / (marketData.high24h - marketData.low24h)) * 100}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Quick Stats Footer */}
      <div className="mt-4 pt-3 border-t border-border flex justify-between text-xs text-muted-foreground">
        <span>Market: Confidential</span>
        <span className="text-primary">Privacy Enabled</span>
      </div>
    </div>
  );
};
