'use client';

import { FC } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lock, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { useState } from 'react';

interface BalanceItem {
  token: string;
  available: string;
  inOrders: string;
  isEncrypted: boolean;
}

export const BalanceDisplay: FC = () => {
  const { connected } = useWallet();
  const [showBalances, setShowBalances] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Mock balances - would come from on-chain state
  const balances: BalanceItem[] = [
    { token: 'SOL', available: '10.5', inOrders: '2.0', isEncrypted: true },
    { token: 'USDC', available: '1,250.00', inOrders: '500.00', isEncrypted: true },
  ];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await new Promise((r) => setTimeout(r, 1000));
    setIsRefreshing(false);
  };

  const handleReveal = () => {
    // In production, this would decrypt balances using the user's key
    setShowBalances(!showBalances);
  };

  if (!connected) {
    return (
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Balances</h3>
        <p className="text-sm text-muted-foreground text-center py-8">
          Connect wallet to view balances
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Confidential Balances</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReveal}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            title={showBalances ? 'Hide balances' : 'Reveal balances'}
          >
            {showBalances ? (
              <EyeOff className="h-4 w-4" />
            ) : (
              <Eye className="h-4 w-4" />
            )}
          </button>
          <button
            onClick={handleRefresh}
            className="p-2 text-muted-foreground hover:text-foreground transition-colors"
            disabled={isRefreshing}
          >
            <RefreshCw
              className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {balances.map((balance) => (
          <div
            key={balance.token}
            className="flex items-center justify-between p-3 bg-secondary rounded-lg"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center">
                <span className="text-xs font-bold text-primary">
                  {balance.token.slice(0, 1)}
                </span>
              </div>
              <div>
                <p className="font-medium">{balance.token}</p>
                <p className="text-xs text-muted-foreground">
                  In orders:{' '}
                  {showBalances ? balance.inOrders : '***'}
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                {balance.isEncrypted && !showBalances && (
                  <Lock className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="font-mono">
                  {showBalances ? balance.available : '••••••'}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Available</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex gap-2">
          <button className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Wrap Tokens
          </button>
          <button className="flex-1 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors">
            Unwrap
          </button>
        </div>
      </div>
    </div>
  );
};
