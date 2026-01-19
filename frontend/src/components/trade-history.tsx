'use client';

import { FC, useState, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Lock,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  ArrowSquareOut,
  ClockCounterClockwise,
  ArrowsClockwise,
  SpinnerGap,
  WarningCircle,
  WifiHigh,
  WifiSlash,
  Check,
  Lightning,
} from '@phosphor-icons/react';
import { useTradeHistory, Trade, SettlementStatus, SettlementLayer } from '@/hooks/use-trade-history';
import { useOrderStore } from '@/stores/order-store';

type FilterType = 'all' | 'mine' | 'buys' | 'sells';

interface TradeHistoryProps {
  variant?: 'default' | 'table';
}

// Settlement status indicator component
const SettlementIndicator: FC<{
  status?: SettlementStatus;
  layer?: SettlementLayer;
}> = ({ status = 'pending', layer = 'unknown' }) => {
  const config: Record<SettlementStatus, { icon: typeof Check; label: string; color: string; animate?: boolean }> = {
    pending: { icon: Clock, label: 'Pending', color: 'text-white/40' },
    mpc_queued: { icon: Clock, label: 'MPC Queue', color: 'text-white/60' },
    mpc_matching: { icon: SpinnerGap, label: 'Matching', color: 'text-white', animate: true },
    mpc_matched: { icon: Lightning, label: 'Matched', color: 'text-white' },
    settling: { icon: SpinnerGap, label: 'Settling', color: 'text-white', animate: true },
    settled: { icon: Check, label: 'Settled', color: 'text-emerald-400' },
    failed: { icon: WarningCircle, label: 'Failed', color: 'text-rose-400' },
  };

  const { icon: Icon, label, color, animate } = config[status];

  // Layer badge
  const layerBadge = layer !== 'unknown' && layer !== 'public' && (
    <span className={`text-[9px] px-1 rounded ${
      layer === 'shadowwire' ? 'bg-purple-500/20 text-purple-400' : 'bg-blue-500/20 text-blue-400'
    }`}>
      {layer === 'shadowwire' ? 'SW' : 'C-SPL'}
    </span>
  );

  return (
    <div className="flex items-center gap-1">
      <Icon size={12} className={`${color} ${animate ? 'animate-spin' : ''}`} />
      <span className={`text-[10px] ${color}`}>{label}</span>
      {layerBadge}
    </div>
  );
};

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
    const localTrades: Trade[] = orderHistory.map(order => {
      // Map order status to settlement status
      let settlementStatus: SettlementStatus = 'pending';
      if (order.status === 'cancelled') {
        settlementStatus = 'failed';
      } else if (order.status === 'filled') {
        settlementStatus = 'settled';
      } else if (order.status === 'partial') {
        settlementStatus = 'settling';
      } else if (order.status === 'open') {
        settlementStatus = 'mpc_queued';
      }

      return {
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
        settlementStatus,
        settlementLayer: 'unknown' as SettlementLayer,
      };
    });

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
                      ? 'bg-emerald-500/20 text-emerald-400/80'
                      : key === 'sells'
                      ? 'bg-rose-500/20 text-rose-400/80'
                      : 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 text-xs ${hasRealData ? 'text-white' : 'text-muted-foreground'}`}>
              {hasRealData ? <WifiHigh size={12} /> : <WifiSlash size={12} />}
            </div>
            <button
              onClick={refresh}
              disabled={isLoading}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <ArrowsClockwise size={12} className={isLoading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Table */}
        {isLoading && filteredTrades.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
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
                  <th className="text-center py-2 px-3">Settlement</th>
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
                            <ArrowUpRight size={12} className="text-emerald-400/80" />
                            <span className="text-emerald-400/80 text-xs font-medium">BUY</span>
                          </>
                        ) : (
                          <>
                            <ArrowDownRight size={12} className="text-rose-400/80" />
                            <span className="text-rose-400/80 text-xs font-medium">SELL</span>
                          </>
                        )}
                        {trade.isMine && (
                          <span className="ml-1 text-[10px] bg-primary/20 text-primary px-1 rounded">YOU</span>
                        )}
                      </div>
                    </td>
                    <td className={`py-2 px-3 text-right font-mono ${
                      trade.price !== null
                        ? trade.side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80'
                        : 'text-muted-foreground'
                    }`}>
                      {trade.price !== null ? `$${trade.price.toFixed(2)}` : (
                        <span className="flex items-center justify-end gap-1">
                          <Lock size={12} className="opacity-50" />***
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-muted-foreground">
                      {trade.amount === '***' ? (
                        <span className="flex items-center justify-end gap-1">
                          <Lock size={12} className="opacity-50" />***
                        </span>
                      ) : trade.amount}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <SettlementIndicator
                        status={trade.settlementStatus}
                        layer={trade.settlementLayer}
                      />
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
            <ClockCounterClockwise size={16} className="text-primary" />
            Recent Trades
          </h3>
          <div className="flex items-center gap-2">
            {/* Data source indicator */}
            <div className={`flex items-center gap-1 text-xs ${hasRealData ? 'text-white' : 'text-muted-foreground'}`}>
              {hasRealData ? (
                <>
                  <WifiHigh size={12} />
                  <span>Live</span>
                </>
              ) : (
                <>
                  <WifiSlash size={12} />
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
              <ArrowsClockwise size={12} className={isLoading ? 'animate-spin' : ''} />
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
                    ? 'bg-emerald-500/20 text-emerald-400/80'
                    : key === 'sells'
                    ? 'bg-rose-500/20 text-rose-400/80'
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
        <div className="px-4 py-2 bg-rose-500/20 border-b border-rose-500/30">
          <div className="flex items-center gap-2 text-xs text-rose-400/80">
            <WarningCircle size={12} />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Column Headers */}
      <div className="grid grid-cols-5 text-xs text-muted-foreground px-4 py-2 border-b border-border/50">
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Amount</span>
        <span className="text-center">Settlement</span>
        <span className="text-right">Time</span>
      </div>

      {/* Trade List */}
      <div className="max-h-[400px] overflow-y-auto">
        {isLoading && filteredTrades.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
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
                className={`grid grid-cols-5 text-sm px-4 py-2 hover:bg-secondary/30 transition-colors ${
                  trade.isMine ? 'bg-primary/5' : ''
                }`}
              >
                {/* Side */}
                <div className="flex items-center gap-1">
                  {trade.side === 'buy' ? (
                    <>
                      <ArrowUpRight size={12} className="text-emerald-400/80" />
                      <span className="text-emerald-400/80 text-xs font-medium">BUY</span>
                    </>
                  ) : (
                    <>
                      <ArrowDownRight size={12} className="text-rose-400/80" />
                      <span className="text-rose-400/80 text-xs font-medium">SELL</span>
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
                        ? 'text-emerald-400/80'
                        : 'text-rose-400/80'
                      : 'text-muted-foreground'
                  }`}
                >
                  {trade.price !== null ? (
                    `$${trade.price.toFixed(2)}`
                  ) : (
                    <span className="flex items-center justify-end gap-1">
                      <Lock size={12} className="opacity-50" />
                      <span>***</span>
                    </span>
                  )}
                </span>

                {/* Amount */}
                <span className="text-right font-mono text-muted-foreground">
                  {trade.amount === '***' ? (
                    <span className="flex items-center justify-end gap-1">
                      <Lock size={12} className="opacity-50" />
                      <span>***</span>
                    </span>
                  ) : (
                    trade.amount
                  )}
                </span>

                {/* Settlement */}
                <div className="flex justify-center">
                  <SettlementIndicator
                    status={trade.settlementStatus}
                    layer={trade.settlementLayer}
                  />
                </div>

                {/* Time */}
                <div className="text-right text-xs text-muted-foreground">
                  <div className="flex items-center justify-end gap-1">
                    <Clock size={12} />
                    <span>{formatTime(trade.timestamp)}</span>
                  </div>
                  {trade.txSignature && (
                    <a
                      href={`https://explorer.solana.com/tx/${trade.txSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-primary hover:underline mt-0.5"
                    >
                      <ArrowSquareOut size={10} />
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
            <Lock size={12} />
            <span>Amounts encrypted</span>
          </div>
        </div>
      </div>
    </div>
  );
};
