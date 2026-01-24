'use client';

import { FC, useState, useEffect, useMemo, useRef } from 'react';
import { TrendUp, TrendDown, Lock, Pulse, CloudSlash, Spinner, WifiHigh, WifiSlash } from '@phosphor-icons/react';
import { PrecisionSelector, PrecisionOption } from './precision-selector';
import { useOrderStore } from '@/stores/order-store';
import { useSolPrice } from '@/hooks/use-pyth-price';
import { useOrderBook, OrderBookLevel } from '@/hooks/use-order-book';
import { useRecentTrades } from '@/hooks/use-recent-trades';
import { useOrderStream, useTradeStream } from '@/hooks/streaming';

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

// Simple seeded random for deterministic mock data (avoids hydration mismatch)
const seededRandom = (seed: number): number => {
  const x = Math.sin(seed * 9999) * 10000;
  return x - Math.floor(x);
};

// Generate mock price levels for empty/demo state
const generateMockLevels = (midPrice: number, side: 'ask' | 'bid', count: number, precision: number): OrderBookEntry[] => {
  const levels: OrderBookEntry[] = [];
  const tickSize = precision;
  const sideSeed = side === 'ask' ? 1 : 2;

  for (let i = 0; i < count; i++) {
    const offset = (i + 1) * tickSize;
    const price = side === 'ask' ? midPrice + offset : midPrice - offset;
    // Use deterministic values based on index and side
    const seed = sideSeed * 100 + i;
    levels.push({
      price: Math.round(price * (1 / precision)) * precision,
      orderCount: Math.floor(seededRandom(seed) * 5) + 1,
      depthIndicator: Math.floor(seededRandom(seed + 50) * 80) + 20,
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

  // Track if component is mounted to avoid hydration mismatch
  // Server renders mock data, client switches to real data after mount
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Fetch real order book data from chain (polling)
  const {
    asks: chainAsks,
    bids: chainBids,
    loading: orderBookLoading,
    error: orderBookError,
  } = useOrderBook();

  // Real-time order events via WebSocket
  // These augment the polling data with instant updates
  const {
    events: orderEvents,
    isConnected: wsConnected,
    placements,
    cancellations,
  } = useOrderStream();

  // Real-time trade events via WebSocket
  const { events: tradeEvents, isConnected: tradeWsConnected } = useTradeStream();

  // Track recent streaming activity for visual feedback
  const [streamingActive, setStreamingActive] = useState(false);
  useEffect(() => {
    if (orderEvents.length > 0 || tradeEvents.length > 0) {
      setStreamingActive(true);
      const timer = setTimeout(() => setStreamingActive(false), 500);
      return () => clearTimeout(timer);
    }
  }, [orderEvents.length, tradeEvents.length]);

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

  // Use real orders if available AND mounted (to avoid hydration mismatch)
  // Server always renders mock data, client switches to real after mount
  const precisionNum = parseFloat(precision);
  const hasRealOrders = isMounted && (chainAsks.length > 0 || chainBids.length > 0);

  // Filter and limit orders by precision and maxRows
  const asks = useMemo(() => {
    if (hasRealOrders) {
      // Group by precision level
      const grouped = new Map<number, OrderBookEntry>();
      for (const order of chainAsks) {
        const roundedPrice = Math.round(order.price / precisionNum) * precisionNum;
        const existing = grouped.get(roundedPrice);
        if (existing) {
          existing.orderCount += order.orderCount;
          existing.depthIndicator = Math.min(100, existing.depthIndicator + order.depthIndicator / 2);
        } else {
          grouped.set(roundedPrice, { ...order, price: roundedPrice });
        }
      }
      return Array.from(grouped.values())
        .sort((a, b) => a.price - b.price)
        .slice(-maxRows); // Keep best asks (lowest prices at bottom)
    }
    return generateMockLevels(midPrice, 'ask', maxRows, precisionNum);
  }, [chainAsks, hasRealOrders, midPrice, maxRows, precisionNum, isMounted]);

  const bids = useMemo(() => {
    if (hasRealOrders) {
      const grouped = new Map<number, OrderBookEntry>();
      for (const order of chainBids) {
        const roundedPrice = Math.round(order.price / precisionNum) * precisionNum;
        const existing = grouped.get(roundedPrice);
        if (existing) {
          existing.orderCount += order.orderCount;
          existing.depthIndicator = Math.min(100, existing.depthIndicator + order.depthIndicator / 2);
        } else {
          grouped.set(roundedPrice, { ...order, price: roundedPrice });
        }
      }
      return Array.from(grouped.values())
        .sort((a, b) => b.price - a.price)
        .slice(0, maxRows); // Keep best bids (highest prices at top)
    }
    return generateMockLevels(midPrice, 'bid', maxRows, precisionNum);
  }, [chainBids, hasRealOrders, midPrice, maxRows, precisionNum, isMounted]);

  // Calculate spread
  const bestAsk = asks[asks.length - 1]?.price || midPrice + precisionNum;
  const bestBid = bids[0]?.price || midPrice - precisionNum;
  const spread = Math.round((bestAsk - bestBid) * 100) / 100;
  const spreadPercent = ((spread / midPrice) * 100).toFixed(2);

  // Fetch recent trades from chain events
  const { trades: chainTrades, isListening: tradesListening } = useRecentTrades(50);

  // Use real trades if available AND mounted, fallback to mock data
  const recentTrades = useMemo(() => {
    if (isMounted && chainTrades.length > 0) {
      return chainTrades.map((t, idx) => ({
        id: t.id,
        price: t.price || midPrice + (seededRandom(idx + 1000) - 0.5) * 2, // Use price or deterministic estimate
        side: t.side,
        time: t.time,
      }));
    }

    // Generate mock trades for demo (deterministic to avoid hydration mismatch)
    const mockTrades = [];
    let tradePrice = midPrice;
    for (let i = 0; i < 15; i++) {
      const isBuy = seededRandom(i + 500) > 0.5;
      tradePrice += (seededRandom(i + 600) - 0.5) * 0.5;
      mockTrades.push({
        id: String(i),
        price: Math.round(tradePrice * 100) / 100,
        side: isBuy ? 'buy' : 'sell' as const,
        time: new Date(1737489600000 - i * 30000), // Fixed base timestamp to avoid hydration mismatch
      });
    }
    return mockTrades;
  }, [chainTrades, midPrice, isMounted]);

  const hasRealTrades = isMounted && chainTrades.length > 0;

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const renderPriceRow = (entry: OrderBookEntry, side: 'ask' | 'bid', index: number) => {
    const isAsk = side === 'ask';
    const depthWidth = `${entry.depthIndicator}%`;

    return (
      <div
        key={`${side}-${index}`}
        data-testid={`${side}-row`}
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
    <div
      className={`h-full flex flex-col bg-card ${isCompact ? '' : 'border border-border rounded-lg'}`}
      role="region"
      aria-label="Order book and recent trades"
      data-testid="order-book"
    >
      {/* Header with Tab Toggle */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border shrink-0">
        <div className="flex gap-3 text-xs" role="tablist" aria-label="Order book view selection">
          <button
            onClick={() => setViewMode('book')}
            role="tab"
            aria-selected={viewMode === 'book'}
            aria-controls="order-book-content"
            id="order-book-tab"
            className={`transition-colors ${
              viewMode === 'book' ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Order Book
          </button>
          <button
            onClick={() => setViewMode('trades')}
            role="tab"
            aria-selected={viewMode === 'trades'}
            aria-controls="trades-content"
            id="trades-tab"
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
        <div id="order-book-content" role="tabpanel" aria-labelledby="order-book-tab" className="flex flex-col flex-1 min-h-0">
          {/* Column Headers */}
          <div className="grid grid-cols-3 text-[10px] text-muted-foreground px-2 py-1 border-b border-border/30 shrink-0" role="row" aria-label="Order book column headers">
            <span role="columnheader">Price (USDC)</span>
            <span role="columnheader" className="text-right">Depth</span>
            <span role="columnheader" className="text-right">Orders</span>
          </div>

          {/* Asks (Sells) - scrollable */}
          <div className="flex-1 overflow-y-auto min-h-0" role="table" aria-label="Sell orders (asks)">
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
              <div className="flex items-center gap-2 text-muted-foreground">
                {/* WebSocket status indicator */}
                <div className="flex items-center gap-1" title={wsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
                  {wsConnected ? (
                    <WifiHigh size={10} className={`text-emerald-400/60 ${streamingActive ? 'animate-pulse' : ''}`} />
                  ) : (
                    <WifiSlash size={10} className="text-amber-400/60" />
                  )}
                </div>
                <span className="text-muted-foreground/40">|</span>
                {/* Data source status */}
                <div className="flex items-center gap-1">
                  {orderBookLoading ? (
                    <>
                      <Spinner size={10} className="animate-spin" />
                      <span>Loading...</span>
                    </>
                  ) : orderBookError ? (
                    <>
                      <CloudSlash size={10} className="text-rose-400/60" />
                      <span className="text-rose-400/60">Offline</span>
                    </>
                  ) : hasRealOrders ? (
                    <>
                      <Pulse size={10} className="text-emerald-400/60" />
                      <span>Live</span>
                    </>
                  ) : (
                    <>
                      <Lock size={10} />
                      <span>Demo</span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Trades View */
        <div id="trades-content" role="tabpanel" aria-labelledby="trades-tab" className="flex flex-col flex-1 min-h-0">
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
              <div className="flex items-center gap-2">
                {/* WebSocket status indicator */}
                <div className="flex items-center gap-1" title={tradeWsConnected ? 'WebSocket connected' : 'WebSocket disconnected'}>
                  {tradeWsConnected ? (
                    <WifiHigh size={10} className={`text-emerald-400/60 ${streamingActive ? 'animate-pulse' : ''}`} />
                  ) : (
                    <WifiSlash size={10} className="text-amber-400/60" />
                  )}
                </div>
                <span className="text-muted-foreground/40">|</span>
                <div className="flex items-center gap-1">
                {hasRealTrades ? (
                  <>
                    <Pulse size={10} className="text-emerald-400/60" aria-hidden="true" />
                    <span>Live</span>
                  </>
                ) : tradesListening ? (
                  <>
                    <Spinner size={10} className="animate-spin" aria-hidden="true" />
                    <span>Waiting...</span>
                  </>
                ) : (
                  <>
                    <Lock size={10} aria-hidden="true" />
                    <span>Demo</span>
                  </>
                )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
