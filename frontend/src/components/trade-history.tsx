'use client';

import { FC, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Lock,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  History,
  RefreshCw,
  Loader2,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useTradeHistory, Trade } from '@/hooks/use-trade-history';
import { useOrderStore } from '@/stores/order-store';

type FilterType = 'all' | 'mine' | 'buys' | 'sells';

interface TradeHistoryProps {
  variant?: 'default' | 'table';
}

export const TradeHistory: FC<TradeHistoryProps> = ({ variant = 'default' }) => {
  const isTable = variant === 'table';
  const { connected, publicKey } = useWallet();
  const { orderHistory } = useOrderStore();
  const [filter, setFilter] = useState<FilterType>('all');

  // Fetch real trade history from Helius
  const {
    trades: realTrades,
    isLoading,
    error,
    refresh,
    hasMore,
    loadMore,
    getUserTrades,
    getBuyTrades,
    getSellTrades,
  } = useTradeHistory({
    mode: 'program', // Fetch all program transactions
    limit: 20,
    autoRefresh: true,
    refreshInterval: 30000,
  });

  // Combine real trades with local order history
  const allTrades = useMemo(() => {
    // Convert local order history to Trade format
    const localTrades: Trade[] = orderHistory.map(order => ({
      id: order.id,
      signature: order.id, // Local orders don't have signatures
      side: order.side,
      pair: order.pair,
      price: null, // Encrypted
      amount: '***', // Encrypted
      timestamp: order.createdAt,
      txSignature: '',
      isMine: true,
      type: 'ORDER',
      description: `${order.side.toUpperCase()} order (local)`,
      fee: 0,
      status: order.status === 'cancelled' ? 'failed' : 'success',
    }));

    // Merge and sort by timestamp (newest first)
    const combined = [...localTrades, ...realTrades];
    combined.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Remove duplicates (if any)
    const seen = new Set<string>();
    return combined.filter(trade => {
      if (seen.has(trade.id)) return false;
      seen.add(trade.id);
      return true;
    });
  }, [realTrades, orderHistory]);

  // Filter trades based on selected filter
  const filteredTrades = useMemo(() => {
    switch (filter) {
      case 'mine':
        return allTrades.filter(t => t.isMine);
      case 'buys':
        return allTrades.filter(t => t.side === 'buy');
      case 'sells':
        return allTrades.filter(t => t.side === 'sell');
      default:
        return allTrades;
    }
  }, [allTrades, filter]);

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

  const hasRealData = realTrades.length > 0;

  // Table variant for bottom tabs - simplified header
  if (isTable) {
    return (
      <div className="p-4">
        {/* Compact filter */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex gap-2">
            {[
              { key: 'all', label: 'All' },
              { key: 'mine', label: 'Mine' },
              { key: 'buys', label: 'Buys' },
              { key: 'sells', label: 'Sells' },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilter(key as FilterType)}
                className={`px-2 py-1 text-xs rounded transition-colors ${
                  filter === key
                    ? key === 'buys'
                      ? 'bg-green-500/20 text-green-400'
                      : key === 'sells'
                      ? 'bg-red-500/20 text-red-400'
                      : 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 text-xs ${hasRealData ? 'text-green-500' : 'text-muted-foreground'}`}>
              {hasRealData ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            </div>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Table */}
        {isLoading && filteredTrades.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTrades.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No trades to display
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-3">Side</th>
                  <th className="text-right py-2 px-3">Price</th>
                  <th className="text-right py-2 px-3">Amount</th>
                  <th className="text-right py-2 px-3">Time</th>
                </tr>
              </thead>
              <tbody>
                {filteredTrades.slice(0, 20).map((trade) => (
                  <tr key={trade.id} className={`border-b border-border/50 hover:bg-secondary/30 ${trade.isMine ? 'bg-primary/5' : ''}`}>
                    <td className="py-2 px-3">
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
                          <span className="ml-1 text-[10px] bg-primary/20 text-primary px-1 rounded">YOU</span>
                        )}
                      </div>
                    </td>
                    <td className={`py-2 px-3 text-right font-mono ${
                      trade.price !== null
                        ? trade.side === 'buy' ? 'text-green-400' : 'text-red-400'
                        : 'text-muted-foreground'
                    }`}>
                      {trade.price !== null ? `$${trade.price.toFixed(2)}` : (
                        <span className="flex items-center justify-end gap-1">
                          <Lock className="h-3 w-3 opacity-50" />***
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                      {trade.amount === '***' ? (
                        <span className="flex items-center justify-end gap-1">
                          <Lock className="h-3 w-3 opacity-50" />***
                        </span>
                      ) : trade.amount}
                    </td>
                    <td className="py-2 px-3 text-right text-xs text-muted-foreground">
                      {formatTime(trade.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // Default card variant
  return (
    <div className="bg-card border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            Recent Trades
          </h3>
          <div className="flex items-center gap-2">
            {/* Data source indicator */}
            <div className={`flex items-center gap-1 text-xs ${hasRealData ? 'text-green-500' : 'text-muted-foreground'}`}>
              {hasRealData ? (
                <>
                  <Wifi className="h-3 w-3" />
                  <span>Live</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  <span>Local</span>
                </>
              )}
            </div>
            {/* Refresh button */}
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw className={`h-3 w-3 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-xs text-muted-foreground">
              {filteredTrades.length} trades
            </span>
          </div>
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

      {/* Error Display */}
      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20">
          <div className="flex items-center gap-2 text-xs text-red-500">
            <AlertCircle className="h-3 w-3" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-4 text-xs text-muted-foreground px-4 py-2 border-b border-border/50">
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trade List */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading && filteredTrades.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredTrades.length === 0 ? (
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
                <span
                  className={`text-right font-mono ${
                    trade.price !== null
                      ? trade.side === 'buy'
                        ? 'text-green-400'
                        : 'text-red-400'
                      : 'text-muted-foreground'
                  }`}
                >
                  {trade.price !== null ? (
                    `$${trade.price.toFixed(2)}`
                  ) : (
                    <span className="flex items-center justify-end gap-1">
                      <Lock className="h-3 w-3 opacity-50" />
                      <span>***</span>
                    </span>
                  )}
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

            {/* Load More Button */}
            {hasMore && !isLoading && (
              <div className="py-2 text-center">
                <button
                  onClick={loadMore}
                  className="text-xs text-primary hover:underline"
                >
                  Load more...
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats Footer */}
      <div className="p-3 border-t border-border bg-secondary/30">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            <span>
              Trades: <span className="text-foreground">{allTrades.length}</span>
            </span>
            {connected && (
              <span>
                Your trades:{' '}
                <span className="text-foreground">
                  {allTrades.filter(t => t.isMine).length}
                </span>
              </span>
            )}
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
