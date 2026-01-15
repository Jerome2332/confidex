'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lock, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface OpenOrder {
  id: string;
  side: 'buy' | 'sell';
  pair: string;
  amount: string; // Encrypted
  price: string; // Encrypted
  filled: string;
  status: 'open' | 'partial';
  createdAt: Date;
}

export const OpenOrders: FC = () => {
  const { connected } = useWallet();
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Mock orders
  const orders: OpenOrder[] = [
    {
      id: '1',
      side: 'buy',
      pair: 'SOL/USDC',
      amount: '***',
      price: '***',
      filled: '0%',
      status: 'open',
      createdAt: new Date(Date.now() - 3600000),
    },
    {
      id: '2',
      side: 'sell',
      pair: 'SOL/USDC',
      amount: '***',
      price: '***',
      filled: '45%',
      status: 'partial',
      createdAt: new Date(Date.now() - 7200000),
    },
  ];

  const handleCancel = async (orderId: string) => {
    setCancellingId(orderId);
    try {
      await new Promise((r) => setTimeout(r, 1500));
      toast.success('Order cancelled');
    } catch (error) {
      toast.error('Failed to cancel order');
    } finally {
      setCancellingId(null);
    }
  };

  if (!connected) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Open Orders</h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          Connect wallet to view orders
        </p>
      </div>
    );
  }

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
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
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
