'use client';

import { FC, useState, useEffect, useMemo } from 'react';
import { TrendUp, TrendDown, Lock, Pulse } from '@phosphor-icons/react';
import { PrecisionSelector, PrecisionOption } from './precision-selector';
import { useOrderStore } from '@/stores/order-store';
import { useSolPrice } from '@/hooks/use-pyth-price';

interface OrderBookEntry {
  price: number;
  orderCount: number;
  depthIndicator: number; // 0-100, represents encrypted depth
  isEncrypted: boolean;
}

type ViewMode = 'book' | 'trades';

interface OrderBookProps {
  variant?: 'default' | 'compact';
  maxRows?: number;
}

// Generate realistic price levels based on a mid price
const generatePriceLevels = (midPrice: number, side: 'ask' | 'bid', count: number, precision: number): OrderBookEntry[] => {
  const levels: OrderBookEntry[] = [];
  const tickSize = precision;

  for (let i = 0; i < count; i++) {
    const offset = (i + 1) * tickSize;
    const price = side === 'ask' ? midPrice + offset : midPrice - offset;
    levels.push({
      price: Math.round(price * (1 / precision)) * precision,
      orderCount: Math.floor(Math.random() * 5) + 1,
      depthIndicator: Math.floor(Math.random() * 80) + 20,
      isEncrypted: true,
    });
  }

  return side === 'ask' ? levels.reverse() : levels;
};

export const OrderBook: FC<OrderBookProps> = ({ variant = 'default', maxRows = 12 }) => {
  const isCompact = variant === 'compact';
  const [viewMode, setViewMode] = useState<ViewMode>('book');
  const [precision, setPrecision] = useState<PrecisionOption>('0.01');
  const [priceChange, setPriceChange] = useState<'up' | 'down' | 'neutral'>('neutral');
  const { openOrders } = useOrderStore();
  const { price: livePrice } = useSolPrice();

  // Use live price or fallback
  const midPrice = livePrice || 104.50;

  // Simulate price direction changes
  const [lastPrice, setLastPrice] = useState(midPrice);
  useEffect(() => {
    if (livePrice && livePrice !== lastPrice) {
      setPriceChange(livePrice > lastPrice ? 'up' : livePrice < lastPrice ? 'down' : 'neutral');
      setLastPrice(livePrice);
    }
  }, [livePrice, lastPrice]);

  // Generate order book levels
  const precisionNum = parseFloat(precision);
  const asks = useMemo(() => generatePriceLevels(midPrice, 'ask', maxRows, precisionNum), [midPrice, maxRows, precisionNum]);
  const bids = useMemo(() => generatePriceLevels(midPrice, 'bid', maxRows, precisionNum), [midPrice, maxRows, precisionNum]);

  // Calculate spread
  const bestAsk = asks[asks.length - 1]?.price || midPrice + precisionNum;
  const bestBid = bids[0]?.price || midPrice - precisionNum;
  const spread = Math.round((bestAsk - bestBid) * 100) / 100;
  const spreadPercent = ((spread / midPrice) * 100).toFixed(2);

  // Mock recent trades for "Trades" tab
  const recentTrades = useMemo(() => {
    const trades = [];
    let tradePrice = midPrice;
    for (let i = 0; i < 15; i++) {
      const isBuy = Math.random() > 0.5;
      tradePrice += (Math.random() - 0.5) * 0.5;
      trades.push({
        id: i,
        price: Math.round(tradePrice * 100) / 100,
        side: isBuy ? 'buy' : 'sell',
        time: new Date(Date.now() - i * 30000),
      });
    }
    return trades;
  }, [midPrice]);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const renderPriceRow = (entry: OrderBookEntry, side: 'ask' | 'bid', index: number) => {
    const isAsk = side === 'ask';
    const depthWidth = `${entry.depthIndicator}%`;

    return (
      <div
        key={`${side}-${index}`}
        className={`relative grid grid-cols-3 px-2 hover:bg-secondary/50 transition-colors cursor-pointer group ${
          isCompact ? 'text-xs py-0.5' : 'text-xs py-1'
        }`}
      >
        {/* Depth visualization background */}
        <div
          className={`absolute inset-y-0 ${isAsk ? 'right-0' : 'left-0'} opacity-20 transition-all ${
            isAsk ? 'bg-rose-500/50' : 'bg-emerald-500/50'
          }`}
          style={{ width: depthWidth }}
        />

        {/* Price */}
        <span className={`relative z-10 font-mono ${isAsk ? 'text-rose-400/80' : 'text-emerald-400/80'}`}>
          {entry.price.toFixed(precision === '1' ? 0 : precision === '0.1' ? 1 : 2)}
        </span>

        {/* Encrypted depth indicator */}
        <span className="relative z-10 text-right text-muted-foreground font-mono">
          <span className="flex items-center justify-end gap-1">
            <Lock size={10} className="opacity-40" />
            <span className="opacity-60 text-[10px]">
              {'█'.repeat(Math.ceil(entry.depthIndicator / 25))}
            </span>
          </span>
        </span>

        {/* Order count */}
        <span className="relative z-10 text-right text-muted-foreground text-[10px]">
          {entry.orderCount}
        </span>
      </div>
    );
  };

  return (
    <div className={`h-full flex flex-col bg-card ${isCompact ? '' : 'border border-border rounded-lg'}`}>
      {/* Header with Tab Toggle */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border shrink-0">
        <div className="flex gap-3 text-xs">
          <button
            onClick={() => setViewMode('book')}
            className={`transition-colors ${
              viewMode === 'book' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Order Book
          </button>
          <button
            onClick={() => setViewMode('trades')}
            className={`transition-colors ${
              viewMode === 'trades' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Trades
          </button>
        </div>
        {viewMode === 'book' && (
          <PrecisionSelector
            value={precision}
            onChange={setPrecision}
          />
        )}
      </div>

      {viewMode === 'book' ? (
        <>
          {/* Column Headers */}
          <div className="grid grid-cols-3 text-[10px] text-muted-foreground px-2 py-1 border-b border-border/30 shrink-0">
            <span>Price (USDC)</span>
            <span className="text-right">Depth</span>
            <span className="text-right">Orders</span>
          </div>

          {/* Asks (Sells) - scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="flex flex-col justify-end min-h-full">
              {asks.map((ask, i) => renderPriceRow(ask, 'ask', i))}
            </div>
          </div>

          {/* Spread / Mid Price */}
          <div className="mx-2 my-1 bg-secondary/50 rounded px-2 py-1.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`font-mono font-semibold text-sm ${
                  priceChange === 'up' ? 'text-white' :
                  priceChange === 'down' ? 'text-white/60' : 'text-foreground'
                }`}>
                  ${midPrice.toFixed(2)}
                </span>
                {priceChange === 'up' && <TrendUp size={12} className="text-white" />}
                {priceChange === 'down' && <TrendDown size={12} className="text-white/60" />}
              </div>
              <span className="text-[10px] text-muted-foreground font-mono">
                Spread: ${spread.toFixed(2)} ({spreadPercent}%)
              </span>
            </div>
          </div>

          {/* Bids (Buys) - scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {bids.map((bid, i) => renderPriceRow(bid, 'bid', i))}
          </div>

          {/* Footer Stats */}
          <div className="border-t border-border bg-secondary/20 px-2 py-1.5 shrink-0">
            <div className="flex items-center justify-between text-[10px]">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground">
                  Asks: <span className="text-rose-400/80">{asks.reduce((sum, a) => sum + a.orderCount, 0)}</span>
                </span>
                <span className="text-muted-foreground">
                  Bids: <span className="text-emerald-400/80">{bids.reduce((sum, b) => sum + b.orderCount, 0)}</span>
                </span>
              </div>
              <div className="flex items-center gap-1 text-muted-foreground">
                <Lock size={10} />
                <span>Encrypted</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        /* Trades View */
        <>
          {/* Column Headers */}
          <div className="grid grid-cols-3 text-[10px] text-muted-foreground px-2 py-1 border-b border-border/30 shrink-0">
            <span>Price</span>
            <span className="text-right">Side</span>
            <span className="text-right">Time</span>
          </div>

          {/* Trades List */}
          <div className="flex-1 overflow-y-auto">
            {recentTrades.map((trade) => (
              <div
                key={trade.id}
                className="grid grid-cols-3 px-2 py-1 text-xs hover:bg-secondary/30 transition-colors"
              >
                <span className={`font-mono ${trade.side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                  ${trade.price.toFixed(2)}
                </span>
                <span className={`text-right text-[10px] ${trade.side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                  {trade.side.toUpperCase()}
                </span>
                <span className="text-right text-muted-foreground text-[10px]">
                  {formatTime(trade.time)}
                </span>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-border bg-secondary/20 px-2 py-1.5 shrink-0">
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>{recentTrades.length} recent trades</span>
              <div className="flex items-center gap-1">
                <Pulse size={10} className="text-white/60" />
                <span>Live</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
