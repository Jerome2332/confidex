'use client';

import { FC } from 'react';
import { Lock } from 'lucide-react';

interface OrderBookEntry {
  price: string;
  amount: string; // Encrypted - shown as indicator
  total: string;
  isEncrypted: boolean;
}

export const OrderBook: FC = () => {
  // Mock data - in production, prices are visible but amounts are encrypted
  const asks: OrderBookEntry[] = [
    { price: '105.50', amount: '###', total: '###', isEncrypted: true },
    { price: '105.25', amount: '###', total: '###', isEncrypted: true },
    { price: '105.00', amount: '###', total: '###', isEncrypted: true },
    { price: '104.75', amount: '###', total: '###', isEncrypted: true },
    { price: '104.50', amount: '###', total: '###', isEncrypted: true },
  ];

  const bids: OrderBookEntry[] = [
    { price: '104.25', amount: '###', total: '###', isEncrypted: true },
    { price: '104.00', amount: '###', total: '###', isEncrypted: true },
    { price: '103.75', amount: '###', total: '###', isEncrypted: true },
    { price: '103.50', amount: '###', total: '###', isEncrypted: true },
    { price: '103.25', amount: '###', total: '###', isEncrypted: true },
  ];

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Order Book</h3>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Lock className="h-3 w-3" />
          <span>Amounts hidden</span>
        </div>
      </div>

      {/* Header */}
      <div className="grid grid-cols-3 text-xs text-muted-foreground mb-2 px-2">
        <span>Price (USDC)</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Total</span>
      </div>

      {/* Asks (Sells) */}
      <div className="space-y-1 mb-4">
        {asks.map((ask, i) => (
          <div
            key={i}
            className="grid grid-cols-3 text-sm px-2 py-1 hover:bg-secondary/50 rounded transition-colors"
          >
            <span className="text-red-400">{ask.price}</span>
            <span className="text-right text-muted-foreground font-mono">
              {ask.isEncrypted ? (
                <span className="flex items-center justify-end gap-1">
                  <Lock className="h-3 w-3" />
                </span>
              ) : (
                ask.amount
              )}
            </span>
            <span className="text-right text-muted-foreground font-mono">
              {ask.isEncrypted ? '---' : ask.total}
            </span>
          </div>
        ))}
      </div>

      {/* Spread */}
      <div className="py-2 px-2 bg-secondary/50 rounded text-center mb-4">
        <span className="text-sm font-mono">104.375</span>
        <span className="text-xs text-muted-foreground ml-2">Spread: 0.25</span>
      </div>

      {/* Bids (Buys) */}
      <div className="space-y-1">
        {bids.map((bid, i) => (
          <div
            key={i}
            className="grid grid-cols-3 text-sm px-2 py-1 hover:bg-secondary/50 rounded transition-colors"
          >
            <span className="text-green-400">{bid.price}</span>
            <span className="text-right text-muted-foreground font-mono">
              {bid.isEncrypted ? (
                <span className="flex items-center justify-end gap-1">
                  <Lock className="h-3 w-3" />
                </span>
              ) : (
                bid.amount
              )}
            </span>
            <span className="text-right text-muted-foreground font-mono">
              {bid.isEncrypted ? '---' : bid.total}
            </span>
          </div>
        ))}
      </div>

      {/* Privacy Note */}
      <div className="mt-4 pt-4 border-t border-border">
        <p className="text-xs text-muted-foreground text-center">
          Order amounts are encrypted via Arcium MPC.
          Only price levels are visible.
        </p>
      </div>
    </div>
  );
};
