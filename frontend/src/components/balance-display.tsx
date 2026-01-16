'use client';

import { FC, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { Lock, Eye, EyeOff, RefreshCw, AlertCircle } from 'lucide-react';
import { useBalance } from '@/hooks/use-balance';
import { useBalanceStore } from '@/stores/balance-store';
import { useSettingsStore } from '@/stores/settings-store';
import Link from 'next/link';

interface BalanceItem {
  token: string;
  available: string;
  inOrders: string;
  isEncrypted: boolean;
  rawBalance: bigint;
}

interface BalanceDisplayProps {
  variant?: 'default' | 'compact';
}

export const BalanceDisplay: FC<BalanceDisplayProps> = ({ variant = 'default' }) => {
  const isCompact = variant === 'compact';
  const { connected } = useWallet();
  const { balances, isLoading, error, refresh } = useBalance();
  const { solInOrders, usdcInOrders, setWrappedBalances } = useBalanceStore();
  const { privacyMode, setPrivacyMode } = useSettingsStore();

  // Privacy mode controls whether balances are hidden by default
  // When privacyMode is true, balances are hidden (showBalances = false)
  const showBalances = !privacyMode;

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
    // Toggle privacy mode (which controls showBalances)
    setPrivacyMode(!privacyMode);
  };

  const hasZeroBalance = balances.sol === BigInt(0) && balances.usdc === BigInt(0);

  if (!connected) {
    return (
      <div className={`bg-card ${isCompact ? 'p-4' : 'border border-border rounded-lg p-6'}`}>
        <h3 className={`font-semibold ${isCompact ? 'text-sm mb-2' : 'text-lg mb-4'}`}>Balances</h3>
        <p className={`text-muted-foreground text-center ${isCompact ? 'text-xs py-4' : 'text-sm py-8'}`}>
          Connect wallet to view balances
        </p>
      </div>
    );
  }

  return (
    <div className={`bg-card ${isCompact ? 'p-4 border-t border-border' : 'border border-border rounded-lg p-6'}`}>
      <div className={`flex items-center justify-between ${isCompact ? 'mb-3' : 'mb-4'}`}>
        <h3 className={`font-semibold ${isCompact ? 'text-sm' : 'text-lg'}`}>{isCompact ? 'Balances' : 'Confidential Balances'}</h3>
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

      <div className={isCompact ? 'space-y-2' : 'space-y-3'}>
        {balanceItems.map((balance) => (
          <div
            key={balance.token}
            className={`flex items-center justify-between bg-secondary rounded-lg ${isCompact ? 'p-2' : 'p-3'}`}
          >
            <div className="flex items-center gap-3">
              <div className={`bg-primary/20 rounded-full flex items-center justify-center ${isCompact ? 'w-6 h-6' : 'w-8 h-8'}`}>
                <span className={`font-bold text-primary ${isCompact ? 'text-[10px]' : 'text-xs'}`}>
                  {balance.token.slice(0, 1)}
                </span>
              </div>
              <div>
                <p className={`font-medium ${isCompact ? 'text-sm' : ''}`}>{balance.token}</p>
                {!isCompact && (
                  <p className="text-xs text-muted-foreground">
                    In orders:{' '}
                    {showBalances ? balance.inOrders : '***'}
                  </p>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-2">
                {balance.isEncrypted && !showBalances && (
                  <Lock className="h-3 w-3 text-muted-foreground" />
                )}
                <span className={`font-mono ${isCompact ? 'text-sm' : ''}`}>
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
              {!isCompact && <p className="text-xs text-muted-foreground">Available</p>}
            </div>
          </div>
        ))}
      </div>

      <div className={`border-t border-border ${isCompact ? 'mt-3 pt-3' : 'mt-4 pt-4'}`}>
        <div className="flex gap-2">
          <Link
            href="/wrap"
            className={`flex-1 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors text-center ${isCompact ? 'py-1.5 text-xs' : 'py-2 text-sm'}`}
          >
            Wrap
          </Link>
          <Link
            href="/wrap?tab=unwrap"
            className={`flex-1 bg-secondary text-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors text-center ${isCompact ? 'py-1.5 text-xs' : 'py-2 text-sm'}`}
          >
            Unwrap
          </Link>
        </div>
      </div>
    </div>
  );
};
