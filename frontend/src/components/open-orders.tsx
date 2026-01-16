'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lock, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrderStore } from '@/stores/order-store';
import { useSettingsStore } from '@/stores/settings-store';

interface OpenOrder {
  id: string;
  side: 'buy' | 'sell';
  pair: string;
  amount: string; // Encrypted - shows placeholder
  price: string; // Encrypted - shows placeholder
  filled: string;
  status: 'open' | 'partial';
  createdAt: Date;
}

interface OpenOrdersProps {
  variant?: 'default' | 'table';
}

export const OpenOrders: FC<OpenOrdersProps> = ({ variant = 'default' }) => {
  const isTable = variant === 'table';
  const { connected } = useWallet();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { openOrders, removeOrder } = useOrderStore();
  const { notifications } = useSettingsStore();

  // Convert store orders to display format
  const orders: OpenOrder[] = openOrders.map(order => ({
    id: order.id,
    side: order.side,
    pair: order.pair,
    amount: '***', // Encrypted - show placeholder
    price: '***',  // Encrypted - show placeholder
    filled: `${order.filledPercent}%`,
    status: order.status === 'partial' ? 'partial' : 'open',
    createdAt: order.createdAt,
  }));

  const handleCancel = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      // TODO: Call on-chain cancel instruction when implemented
      await new Promise((r) => setTimeout(r, 1500));
      removeOrder(orderId);
      // Only show toast if notifications are enabled
      if (notifications) {
        toast.success('Order cancelled');
      }
    } catch (error) {
      // Always show error toasts
      toast.error('Failed to cancel order');
    } finally {
      setCancellingId(null);
    }
  };

  if (!connected) {
    return (
      <div className={isTable ? 'p-4' : 'bg-card border border-border rounded-lg p-6'}>
        {!isTable && <h3 className="text-lg font-semibold mb-4">Open Orders</h3>}
        <p className="text-sm text-muted-foreground text-center py-8">
          Connect wallet to view orders
        </p>
      </div>
    );
  }

  // Table variant for bottom tabs
  if (isTable) {
    return (
      <div className="p-4">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            No open orders
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="text-left py-2 px-3">Side</th>
                  <th className="text-left py-2 px-3">Pair</th>
                  <th className="text-right py-2 px-3">Amount</th>
                  <th className="text-right py-2 px-3">Price</th>
                  <th className="text-right py-2 px-3">Filled</th>
                  <th className="text-right py-2 px-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-b border-border/50 hover:bg-secondary/30">
                    <td className="py-2 px-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                        order.side === 'buy'
                          ? 'bg-emerald-500/20 text-emerald-400/80'
                          : 'bg-rose-500/20 text-rose-400/80'
                      }`}>
                        {order.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="py-2 px-3">{order.pair}</td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className="flex items-center justify-end gap-1">
                        <Lock className="h-3 w-3 text-muted-foreground" />
                        {order.amount}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className="flex items-center justify-end gap-1">
                        <Lock className="h-3 w-3 text-muted-foreground" />
                        {order.price}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{order.filled}</td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleCancel(order.id)}
                        disabled={cancellingId === order.id}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        {cancellingId === order.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </button>
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
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Open Orders</h3>
        <span className="text-xs text-muted-foreground">
          {orders.length} active
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No open orders
        </p>
      ) : (
        <div className="space-y-2">
          {orders.map((order) => (
            <div
              key={order.id}
              className="p-3 bg-secondary rounded-lg"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded ${
                      order.side === 'buy'
                        ? 'bg-emerald-500/20 text-emerald-400/80'
                        : 'bg-rose-500/20 text-rose-400/80'
                    }`}
                  >
                    {order.side.toUpperCase()}
                  </span>
                  <span className="text-sm">{order.pair}</span>
                </div>
                <button
                  onClick={() => handleCancel(order.id)}
                  disabled={cancellingId === order.id}
                  className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                >
                  {cancellingId === order.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Amount</p>
                  <div className="flex items-center gap-1 font-mono">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    <span>{order.amount}</span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">Price</p>
                  <div className="flex items-center gap-1 font-mono">
                    <Lock className="h-3 w-3 text-muted-foreground" />
                    <span>{order.price}</span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">Filled</p>
                  <p className="font-mono">{order.filled}</p>
                </div>
              </div>

              {order.status === 'partial' && (
                <div className="mt-2">
                  <div className="h-1 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary"
                      style={{ width: order.filled }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
