'use client';

import { FC, useState, useEffect, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  Lightning,
  Eye,
  EyeSlash,
  ArrowsClockwise,
  ArrowDown,
  ArrowUp,
  WarningCircle,
  ShieldCheck,
  SpinnerGap,
} from '@phosphor-icons/react';
import { useShadowWire } from '@/hooks/use-shadowwire';
import { useSettingsStore } from '@/stores/settings-store';
import { SHADOWWIRE_FEE_BPS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { SettlementToken } from '@/lib/settlement/types';

interface TokenBalance {
  token: SettlementToken;
  available: number;
  deposited: number;
  poolAddress?: string;
}

interface ShadowWireBalanceProps {
  variant?: 'default' | 'compact';
  tokens?: SettlementToken[];
  className?: string;
  onDeposit?: (token: SettlementToken) => void;
  onWithdraw?: (token: SettlementToken) => void;
}

const DEFAULT_TOKENS: SettlementToken[] = ['SOL', 'USDC'];

/**
 * ShadowWire Pool Balance Component
 *
 * Displays user's ShadowWire pool balances with deposit/withdraw actions.
 * ShadowWire provides Bulletproof ZK privacy for hidden amounts.
 */
export const ShadowWireBalance: FC<ShadowWireBalanceProps> = ({
  variant = 'default',
  tokens = DEFAULT_TOKENS,
  className,
  onDeposit,
  onWithdraw,
}) => {
  const isCompact = variant === 'compact';
  const { connected, publicKey } = useWallet();
  const { isReady, isInitializing, error: swError, getBalance } = useShadowWire();
  const { privacyMode } = useSettingsStore();

  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showBalances = !privacyMode;

  // Fetch balances for all tokens
  const fetchBalances = useCallback(async () => {
    if (!isReady || !publicKey) return;

    setIsLoading(true);
    setError(null);

    try {
      const fetchedBalances: TokenBalance[] = [];

      for (const token of tokens) {
        const balance = await getBalance(token);
        if (balance) {
          fetchedBalances.push({
            token,
            available: balance.available,
            deposited: balance.deposited,
            poolAddress: balance.pool_address,
          });
        } else {
          fetchedBalances.push({
            token,
            available: 0,
            deposited: 0,
          });
        }
      }

      setBalances(fetchedBalances);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch balances';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [isReady, publicKey, tokens, getBalance]);

  // Fetch on mount and when ready
  useEffect(() => {
    if (isReady && publicKey) {
      fetchBalances();
    }
  }, [isReady, publicKey, fetchBalances]);

  const formatBalance = (amount: number, token: SettlementToken): string => {
    if (amount === 0) return '0';
    const decimals = token === 'USDC' ? 2 : 4;
    return amount.toFixed(decimals);
  };

  const getTotalValue = (): number => {
    return balances.reduce((sum, b) => sum + b.available, 0);
  };

  if (!connected) {
    return (
      <div className={cn(
        'bg-card',
        isCompact ? 'p-4' : 'border border-border rounded-lg p-6',
        className
      )}>
        <div className="flex items-center gap-2 mb-4">
          <Lightning size={isCompact ? 16 : 20} className="text-emerald-400" />
          <h3 className={cn('font-semibold', isCompact ? 'text-sm' : 'text-lg')}>
            ShadowWire Pool
          </h3>
        </div>
        <p className={cn(
          'text-muted-foreground text-center',
          isCompact ? 'text-xs py-4' : 'text-sm py-8'
        )}>
          Connect wallet to view pool balances
        </p>
      </div>
    );
  }

  if (isInitializing) {
    return (
      <div className={cn(
        'bg-card',
        isCompact ? 'p-4' : 'border border-border rounded-lg p-6',
        className
      )}>
        <div className="flex items-center gap-2 mb-4">
          <Lightning size={isCompact ? 16 : 20} className="text-emerald-400" />
          <h3 className={cn('font-semibold', isCompact ? 'text-sm' : 'text-lg')}>
            ShadowWire Pool
          </h3>
        </div>
        <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
          <SpinnerGap size={16} className="animate-spin" />
          <span className="text-sm">Initializing WASM...</span>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'bg-card',
      isCompact ? 'p-4' : 'border border-border rounded-lg p-6',
      className
    )}>
      {/* Header */}
      <div className={cn('flex items-center justify-between', isCompact ? 'mb-3' : 'mb-4')}>
        <div className="flex items-center gap-2">
          <Lightning size={isCompact ? 16 : 20} className="text-emerald-400" />
          <h3 className={cn('font-semibold', isCompact ? 'text-sm' : 'text-lg')}>
            ShadowWire Pool
          </h3>
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
            Full Privacy
          </span>
        </div>
        <button
          onClick={fetchBalances}
          className="p-2 text-muted-foreground hover:text-foreground transition-colors"
          disabled={isLoading}
          title="Refresh balances"
        >
          <ArrowsClockwise
            size={16}
            className={isLoading ? 'animate-spin' : ''}
          />
        </button>
      </div>

      {/* Fee Notice */}
      {!isCompact && (
        <div className="mb-4 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400">
          <ShieldCheck size={12} className="inline mr-1" />
          {(SHADOWWIRE_FEE_BPS / 100).toFixed(0)}% fee for Bulletproof ZK privacy
        </div>
      )}

      {/* Error Display */}
      {(error || swError) && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-sm text-destructive">
          <WarningCircle size={16} />
          {error || swError}
        </div>
      )}

      {/* Balance List */}
      <div className={isCompact ? 'space-y-2' : 'space-y-3'}>
        {balances.length === 0 && !isLoading ? (
          <div className="text-center py-4 text-sm text-muted-foreground">
            No pool balances found. Deposit tokens to start.
          </div>
        ) : (
          balances.map((balance) => (
            <div
              key={balance.token}
              className={cn(
                'flex items-center justify-between bg-secondary rounded-lg',
                isCompact ? 'p-2' : 'p-3'
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  'bg-emerald-500/20 rounded-full flex items-center justify-center',
                  isCompact ? 'w-6 h-6' : 'w-8 h-8'
                )}>
                  <span className={cn(
                    'font-bold text-emerald-400',
                    isCompact ? 'text-[10px]' : 'text-xs'
                  )}>
                    {balance.token.slice(0, 1)}
                  </span>
                </div>
                <div>
                  <p className={cn('font-medium', isCompact ? 'text-sm' : '')}>
                    {balance.token}
                  </p>
                  {!isCompact && (
                    <p className="text-xs text-muted-foreground">
                      Pending: {showBalances ? formatBalance(balance.deposited, balance.token) : '***'}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="text-right">
                  <span className={cn('font-mono', isCompact ? 'text-sm' : '')}>
                    {isLoading ? (
                      <span className="animate-pulse">Loading...</span>
                    ) : showBalances ? (
                      formatBalance(balance.available, balance.token)
                    ) : balance.available > 0 ? (
                      '******'
                    ) : (
                      '0'
                    )}
                  </span>
                  {!isCompact && (
                    <p className="text-xs text-muted-foreground">Available</p>
                  )}
                </div>

                {/* Action Buttons */}
                {(onDeposit || onWithdraw) && (
                  <div className="flex gap-1">
                    {onDeposit && (
                      <button
                        onClick={() => onDeposit(balance.token)}
                        className="p-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
                        title="Deposit"
                      >
                        <ArrowDown size={14} />
                      </button>
                    )}
                    {onWithdraw && (
                      <button
                        onClick={() => onWithdraw(balance.token)}
                        disabled={balance.available <= 0}
                        className={cn(
                          'p-1.5 rounded transition-colors',
                          balance.available > 0
                            ? 'bg-white/10 text-white hover:bg-white/20'
                            : 'bg-white/5 text-white/30 cursor-not-allowed'
                        )}
                        title="Withdraw"
                      >
                        <ArrowUp size={14} />
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Total & Actions */}
      {!isCompact && balances.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total Pool Value</span>
            <span className="font-mono">
              {showBalances ? `~$${getTotalValue().toFixed(2)}` : '******'}
            </span>
          </div>
        </div>
      )}

      {/* Compact Actions */}
      {isCompact && (onDeposit || onWithdraw) && (
        <div className="flex gap-2 mt-3 pt-3 border-t border-border">
          {onDeposit && (
            <button
              onClick={() => onDeposit('SOL')}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors"
            >
              <ArrowDown size={12} />
              Deposit
            </button>
          )}
          {onWithdraw && (
            <button
              onClick={() => onWithdraw('SOL')}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs rounded bg-white/10 text-white hover:bg-white/20 transition-colors"
            >
              <ArrowUp size={12} />
              Withdraw
            </button>
          )}
        </div>
      )}
    </div>
  );
};
