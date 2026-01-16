'use client';

import { FC, useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lock, Clock, ArrowUpRight, ArrowDownRight, Filter, ExternalLink, History } from 'lucide-react';
import { useOrderStore } from '@/stores/order-store';

interface Trade {
  id: string;
  side: 'buy' | 'sell';
  pair: string;
  price: number; // Visible after match
  amount: string; // Encrypted until your trade
  timestamp: Date;
  txSignature?: string;
  isMine: boolean;
}

type FilterType = 'all' | 'mine' | 'buys' | 'sells';

// Generate mock trade history for demo
const generateMockTrades = (count: number): Trade[] => {
  const trades: Trade[] = [];
  const now = Date.now();

  for (let i = 0; i < count; i++) {
    const isBuy = Math.random() > 0.5;
    const isMine = Math.random() > 0.85; // 15% chance it's user's trade
    const minutesAgo = Math.floor(Math.random() * 120); // Last 2 hours

    trades.push({
      id: `trade-${i}-${Date.now()}`,
      side: isBuy ? 'buy' : 'sell',
      pair: 'SOL/USDC',
      price: 104 + (Math.random() - 0.5) * 2,
      amount: isMine ? (Math.random() * 5 + 0.1).toFixed(4) : '***',
      timestamp: new Date(now - minutesAgo * 60 * 1000),
      txSignature: Math.random() > 0.3 ? `${Math.random().toString(36).substring(2, 15)}...` : undefined,
      isMine,
    });
  }

  return trades.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
};

export const TradeHistory: FC = () => {
  const { connected } = useWallet();
  const { orderHistory } = useOrderStore();
  const [filter, setFilter] = useState<FilterType>('all');
  const [trades, setTrades] = useState<Trade[]>([]);

  // Initialize with mock trades and refresh periodically
  useEffect(() => {
    setTrades(generateMockTrades(20));

    // Simulate new trades coming in
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        const newTrade: Trade = {
          id: `trade-${Date.now()}`,
          side: Math.random() > 0.5 ? 'buy' : 'sell',
          pair: 'SOL/USDC',
          price: 104 + (Math.random() - 0.5) * 2,
          amount: '***',
          timestamp: new Date(),
          isMine: false,
        };
        setTrades(prev => [newTrade, ...prev.slice(0, 19)]);
      }
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  // Filter trades
  const filteredTrades = useMemo(() => {
    return trades.filter(trade => {
      switch (filter) {
        case 'mine':
          return trade.isMine;
        case 'buys':
          return trade.side === 'buy';
        case 'sells':
          return trade.side === 'sell';
        default:
          return true;
      }
    });
  }, [trades, filter]);

  const formatTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Recent Trades
          </h3>
          <span className="text-xs text-muted-foreground">
            {filteredTrades.length} trades
          </span>
        </div>

        {/* Filter Tabs */}
        <div className="flex gap-1 p-1 bg-secondary/50 rounded-lg">
          {[
            { key: 'all', label: 'All' },
            { key: 'mine', label: 'Mine' },
            { key: 'buys', label: 'Buys' },
            { key: 'sells', label: 'Sells' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key as FilterType)}
              className={`flex-1 px-2 py-1 text-xs rounded transition-colors ${
                filter === key
                  ? key === 'buys'
                    ? 'bg-green-500/20 text-green-400'
                    : key === 'sells'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-background text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-4 text-xs text-muted-foreground px-4 py-2 border-b border-border/50">
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trade List */}
      <div className="max-h-[400px] overflow-y-auto">
        {filteredTrades.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            {filter === 'mine' ? (
              connected ? (
                'No trades yet'
              ) : (
                'Connect wallet to see your trades'
              )
            ) : (
              'No trades to display'
            )}
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filteredTrades.map((trade) => (
              <div
                key={trade.id}
                className={`grid grid-cols-4 text-sm px-4 py-2 hover:bg-secondary/30 transition-colors ${
                  trade.isMine ? 'bg-primary/5' : ''
                }`}
              >
                {/* Side */}
                <div className="flex items-center gap-1">
                  {trade.side === 'buy' ? (
                    <>
                      <ArrowUpRight className="h-3 w-3 text-green-400" />
                      <span className="text-green-400 text-xs font-medium">BUY</span>
                    </>
                  ) : (
                    <>
                      <ArrowDownRight className="h-3 w-3 text-red-400" />
                      <span className="text-red-400 text-xs font-medium">SELL</span>
                    </>
                  )}
                  {trade.isMine && (
                    <span className="ml-1 text-[10px] bg-primary/20 text-primary px-1 rounded">
                      YOU
                    </span>
                  )}
                </div>

                {/* Price */}
                <span className={`text-right font-mono ${
                  trade.side === 'buy' ? 'text-green-400' : 'text-red-400'
                }`}>
                  ${trade.price.toFixed(2)}
                </span>

                {/* Amount */}
                <span className="text-right font-mono text-muted-foreground">
                  {trade.amount === '***' ? (
                    <span className="flex items-center justify-end gap-1">
                      <Lock className="h-3 w-3 opacity-50" />
                      <span>***</span>
                    </span>
                  ) : (
                    trade.amount
                  )}
                </span>

                {/* Time */}
                <div className="text-right text-xs text-muted-foreground">
                  <div className="flex items-center justify-end gap-1">
                    <Clock className="h-3 w-3" />
                    <span>{formatTime(trade.timestamp)}</span>
                  </div>
                  {trade.txSignature && (
                    <a
                      href={`https://explorer.solana.com/tx/${trade.txSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-primary hover:underline mt-0.5"
                    >
                      <ExternalLink className="h-2.5 w-2.5" />
                      <span className="text-[10px]">tx</span>
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="p-3 border-t border-border bg-secondary/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              24h Vol: <span className="text-foreground font-mono">$---</span>
            </span>
            <span>
              Trades: <span className="text-foreground">{trades.length}</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Lock className="h-3 w-3" />
            <span>Amounts encrypted</span>
          </div>
        </div>
      </div>
    </div>
  );
};
