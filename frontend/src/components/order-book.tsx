'use client';

import { FC, useState, useEffect, useMemo } from 'react';
import { Lock, TrendingUp, TrendingDown, Activity, BarChart3 } from 'lucide-react';
import { useOrderStore } from '@/stores/order-store';

interface OrderBookEntry {
  price: number;
  orderCount: number; // Number of orders at this level (visible)
  depthIndicator: number; // 0-100, represents encrypted depth
  isEncrypted: boolean;
}

type ViewMode = 'both' | 'bids' | 'asks';

// Generate realistic price levels based on a mid price
const generatePriceLevels = (midPrice: number, side: 'ask' | 'bid', count: number): OrderBookEntry[] => {
  const levels: OrderBookEntry[] = [];
  const tickSize = 0.25;

  for (let i = 0; i < count; i++) {
    const offset = (i + 1) * tickSize;
    const price = side === 'ask' ? midPrice + offset : midPrice - offset;
    // Random order count 1-5 and depth indicator for visual effect
    levels.push({
      price: Math.round(price * 100) / 100,
      orderCount: Math.floor(Math.random() * 5) + 1,
      depthIndicator: Math.floor(Math.random() * 80) + 20,
      isEncrypted: true,
    });
  }

  return side === 'ask' ? levels.reverse() : levels;
};

export const OrderBook: FC = () => {
  const [viewMode, setViewMode] = useState<ViewMode>('both');
  const [midPrice, setMidPrice] = useState(104.50);
  const [priceChange, setPriceChange] = useState<'up' | 'down' | 'neutral'>('neutral');
  const { openOrders } = useOrderStore();

  // Simulate price updates
  useEffect(() => {
    const interval = setInterval(() => {
      setMidPrice(prev => {
        const change = (Math.random() - 0.5) * 0.5;
        const newPrice = Math.round((prev + change) * 100) / 100;
        setPriceChange(change > 0 ? 'up' : change < 0 ? 'down' : 'neutral');
        return Math.max(90, Math.min(120, newPrice)); // Keep in reasonable range
      });
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Generate order book levels
  const asks = useMemo(() => generatePriceLevels(midPrice, 'ask', 8), [midPrice]);
  const bids = useMemo(() => generatePriceLevels(midPrice, 'bid', 8), [midPrice]);

  // Calculate spread
  const bestAsk = asks[asks.length - 1]?.price || midPrice + 0.25;
  const bestBid = bids[0]?.price || midPrice - 0.25;
  const spread = Math.round((bestAsk - bestBid) * 100) / 100;
  const spreadPercent = ((spread / midPrice) * 100).toFixed(2);

  // Count user's orders at each level
  const userOrdersByPrice = useMemo(() => {
    const counts: Record<string, { buy: number; sell: number }> = {};
    openOrders.forEach(order => {
      // In demo mode, we can't know the price, but we can show indicator
      // For real implementation, this would match encrypted prices
    });
    return counts;
  }, [openOrders]);

  const renderPriceRow = (entry: OrderBookEntry, side: 'ask' | 'bid', index: number) => {
    const isAsk = side === 'ask';
    const depthWidth = `${entry.depthIndicator}%`;

    return (
      <div
        key={`${side}-${index}`}
        className="relative grid grid-cols-3 text-sm px-2 py-1.5 hover:bg-secondary/70 rounded transition-colors cursor-pointer group"
      >
        {/* Depth visualization background */}
        <div
          className={`absolute inset-y-0 ${isAsk ? 'right-0' : 'left-0'} opacity-20 rounded transition-all ${
            isAsk ? 'bg-red-500' : 'bg-green-500'
          }`}
          style={{ width: depthWidth }}
        />

        {/* Price */}
        <span className={`relative z-10 font-mono ${isAsk ? 'text-red-400' : 'text-green-400'}`}>
          {entry.price.toFixed(2)}
        </span>

        {/* Encrypted depth indicator */}
        <span className="relative z-10 text-right text-muted-foreground font-mono">
          <span className="flex items-center justify-end gap-1">
            <Lock className="h-3 w-3 opacity-50" />
            <span className="opacity-60">
              {'█'.repeat(Math.ceil(entry.depthIndicator / 25))}
            </span>
          </span>
        </span>

        {/* Order count */}
        <span className="relative z-10 text-right text-muted-foreground text-xs">
          {entry.orderCount} order{entry.orderCount > 1 ? 's' : ''}
        </span>

        {/* Hover tooltip */}
        <div className="absolute left-1/2 -translate-x-1/2 -top-8 bg-popover border border-border rounded px-2 py-1 text-xs opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
          {isAsk ? 'Sell' : 'Buy'} orders at ${entry.price.toFixed(2)}
        </div>
      </div>
    );
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Order Book
          </h3>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            <span>Encrypted</span>
          </div>
        </div>

        {/* View Mode Selector */}
        <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
          <button
            onClick={() => setViewMode('both')}
            className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
              viewMode === 'both' ? 'bg-background text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Both
          </button>
          <button
            onClick={() => setViewMode('bids')}
            className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
              viewMode === 'bids' ? 'bg-green-500/20 text-green-400' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Bids
          </button>
          <button
            onClick={() => setViewMode('asks')}
            className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
              viewMode === 'asks' ? 'bg-red-500/20 text-red-400' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Asks
          </button>
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 text-xs text-muted-foreground px-4 py-2 border-b border-border/50">
        <span>Price (USDC)</span>
        <span className="text-right">Depth</span>
        <span className="text-right">Orders</span>
      </div>

      {/* Asks (Sells) - shown in reverse so best ask is at bottom */}
      {(viewMode === 'both' || viewMode === 'asks') && (
        <div className="px-2 py-1">
          {asks.map((ask, i) => renderPriceRow(ask, 'ask', i))}
        </div>
      )}

      {/* Spread / Mid Price */}
      <div className="mx-2 my-1 py-2 px-3 bg-secondary/50 rounded-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`text-lg font-mono font-semibold ${
              priceChange === 'up' ? 'text-green-400' :
              priceChange === 'down' ? 'text-red-400' : 'text-foreground'
            }`}>
              ${midPrice.toFixed(2)}
            </span>
            {priceChange === 'up' && <TrendingUp className="h-4 w-4 text-green-400" />}
            {priceChange === 'down' && <TrendingDown className="h-4 w-4 text-red-400" />}
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Spread</div>
            <div className="text-xs font-mono">
              ${spread.toFixed(2)} <span className="text-muted-foreground">({spreadPercent}%)</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bids (Buys) */}
      {(viewMode === 'both' || viewMode === 'bids') && (
        <div className="px-2 py-1">
          {bids.map((bid, i) => renderPriceRow(bid, 'bid', i))}
        </div>
      )}

      {/* Stats Footer */}
      <div className="p-3 border-t border-border bg-secondary/30">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            <div>
              <span className="text-muted-foreground">Asks:</span>
              <span className="ml-1 text-red-400">{asks.reduce((sum, a) => sum + a.orderCount, 0)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Bids:</span>
              <span className="ml-1 text-green-400">{bids.reduce((sum, b) => sum + b.orderCount, 0)}</span>
            </div>
          </div>
          <div className="flex items-center gap-1 text-muted-foreground">
            <Activity className="h-3 w-3" />
            <span>Live</span>
          </div>
        </div>
      </div>

      {/* Privacy Note */}
      <div className="px-4 py-3 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          Amounts encrypted via Arcium MPC. Depth bars show relative liquidity.
        </p>
      </div>
    </div>
  );
};
