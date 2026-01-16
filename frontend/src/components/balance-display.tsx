'use client';

import { FC, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lock, Eye, EyeOff, RefreshCw, AlertCircle } from 'lucide-react';
import { useState } from 'react';
import { useBalance } from '@/hooks/use-balance';
import { useBalanceStore } from '@/stores/balance-store';
import Link from 'next/link';

interface BalanceItem {
  token: string;
  available: string;
  inOrders: string;
  isEncrypted: boolean;
  rawBalance: bigint;
}

export const BalanceDisplay: FC = () => {
  const { connected } = useWallet();
  const { balances, isLoading, error, refresh } = useBalance();
  const { solInOrders, usdcInOrders, setWrappedBalances } = useBalanceStore();
  const [showBalances, setShowBalances] = useState(false);

  // Update the global store when balances change
  useEffect(() => {
    setWrappedBalances(balances.sol, balances.usdc);
  }, [balances.sol, balances.usdc, setWrappedBalances]);

  // Format in-orders amounts
  const formatInOrders = (amount: bigint, decimals: number): string => {
    if (amount === BigInt(0)) return '0';
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const remainder = amount % divisor;
    const fractionStr = remainder.toString().padStart(decimals, '0');
    return decimals === 9
      ? `${whole}.${fractionStr.slice(0, 4)}`
      : `${whole}.${fractionStr.slice(0, 2)}`;
  };

  const balanceItems: BalanceItem[] = [
    {
      token: 'SOL',
      available: balances.solUiAmount,
      inOrders: formatInOrders(solInOrders, 9),
      isEncrypted: true,
      rawBalance: balances.sol,
    },
    {
      token: 'USDC',
      available: balances.usdcUiAmount,
      inOrders: formatInOrders(usdcInOrders, 6),
      isEncrypted: true,
      rawBalance: balances.usdc,
    },
  ];

  const handleRefresh = async () => {
    await refresh();
  };

  const handleReveal = () => {
    setShowBalances(!showBalances);
  };

  const hasZeroBalance = balances.sol === BigInt(0) && balances.usdc === BigInt(0);

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
            disabled={isLoading}
          >
            <RefreshCw
              className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
            />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {hasZeroBalance && !isLoading && (
        <div className="mb-4 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg flex items-center gap-2 text-sm text-yellow-600 dark:text-yellow-400">
          <AlertCircle className="h-4 w-4" />
          No wrapped tokens. Wrap tokens to start trading.
        </div>
      )}

      <div className="space-y-3">
        {balanceItems.map((balance) => (
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
                  {isLoading ? (
                    <span className="animate-pulse">Loading...</span>
                  ) : showBalances ? (
                    balance.available
                  ) : balance.rawBalance > BigInt(0) ? (
                    '••••••'
                  ) : (
                    '0'
                  )}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">Available</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="flex gap-2">
          <Link
            href="/wrap"
            className="flex-1 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors text-center"
          >
            Wrap Tokens
          </Link>
          <Link
            href="/wrap?tab=unwrap"
            className="flex-1 py-2 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors text-center"
          >
            Unwrap
          </Link>
        </div>
      </div>
    </div>
  );
};
