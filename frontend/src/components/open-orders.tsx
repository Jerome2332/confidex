'use client';

import { FC, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Lock, X, SpinnerGap, ArrowsClockwise } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useOrderStore } from '@/stores/order-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useUserOrders } from '@/hooks/use-user-orders';
import { buildCancelOrderTransaction } from '@/lib/confidex-client';
import { TRADING_PAIRS } from '@/lib/constants';
import { createLogger } from '@/lib/logger';
import { MpcStatus, MpcIndicator } from './mpc-status';

// Default to SOL/USDC pair mints
const DEFAULT_BASE_MINT = TRADING_PAIRS[0].baseMint;
const DEFAULT_QUOTE_MINT = TRADING_PAIRS[0].quoteMint;

const log = createLogger('open-orders');

interface OpenOrder {
  id: string;
  side: 'buy' | 'sell';
  pair: string;
  amount: string; // Encrypted - shows placeholder
  price: string; // Encrypted - shows placeholder
  filled: string;
  // V2: Simplified status - Active (open/partial/pending) or Inactive (filled/cancelled)
  status: 'open' | 'partial' | 'pending';
  mpcStatus?: 'queued' | 'comparing' | 'matched' | 'settling' | 'complete';
  createdAt: Date;
  isLegacyBroken?: boolean; // Legacy orders that can't be cancelled
}

interface OpenOrdersProps {
  variant?: 'default' | 'table';
}

export const OpenOrders: FC<OpenOrdersProps> = ({ variant = 'default' }) => {
  const isTable = variant === 'table';
  const { connected, publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const { openOrders, removeOrder } = useOrderStore();
  const { notifications } = useSettingsStore();

  // Fetch orders from on-chain (syncs with order store)
  const {
    isLoading: isLoadingOnChain,
    error: onChainError,
    refresh: refreshOnChain,
    lastUpdate,
  } = useUserOrders();

  // Convert store orders to display format, filtering out legacy broken orders
  const allOrders: OpenOrder[] = openOrders.map(order => ({
    id: order.id,
    side: order.side,
    pair: order.pair,
    amount: '***', // Encrypted - show placeholder
    price: '***',  // Encrypted - show placeholder
    filled: `${order.filledPercent}%`,
    // V2: Use simplified Active/Inactive status model
    status: order.status === 'partial' ? 'partial' : order.status === 'pending' ? 'pending' : 'open',
    mpcStatus: order.status === 'pending' ? 'comparing' : order.status === 'filled' ? 'complete' : undefined,
    createdAt: order.createdAt,
    isLegacyBroken: order.isLegacyBroken,
  }));

  // Filter out legacy broken orders (can't be cancelled without overflow)
  const orders = allOrders.filter(o => !o.isLegacyBroken);
  const legacyOrderCount = allOrders.length - orders.length;

  const handleCancel = async (orderId: string) => {
    if (!publicKey || !sendTransaction) {
      toast.error('Wallet not connected');
      return;
    }

    setCancellingId(orderId);
    try {
      // Find the order in the store to get on-chain details
      const order = openOrders.find(o => o.id === orderId);
      if (!order) {
        throw new Error('Order not found');
      }

      // Check if we have the order nonce for PDA derivation
      if (order.orderNonce === undefined) {
        // Fallback for orders placed before we tracked orderNonce
        log.warn('Order missing orderNonce, using local removal only', { orderId });
        removeOrder(orderId);
        if (notifications) {
          toast.success('Order removed from local state');
        }
        return;
      }

      // Get mint addresses - use stored values or defaults
      const baseMint = order.baseMint
        ? new PublicKey(order.baseMint)
        : new PublicKey(DEFAULT_BASE_MINT);
      const quoteMint = order.quoteMint
        ? new PublicKey(order.quoteMint)
        : new PublicKey(DEFAULT_QUOTE_MINT);

      log.info('Cancelling order on-chain', {
        orderId,
        orderNonce: order.orderNonce?.toString(),
        pair: order.pair,
      });

      if (!order.orderNonce) {
        throw new Error('Order nonce not available - cannot cancel order');
      }

      log.debug('Building cancel transaction', {
        orderId: order.id,
        orderNonce: order.orderNonce.toString(),
        maker: publicKey.toBase58(),
        baseMint: baseMint.toBase58(),
        quoteMint: quoteMint.toBase58(),
      });

      // Build the cancel transaction
      const transaction = await buildCancelOrderTransaction({
        connection,
        maker: publicKey,
        orderId: order.orderNonce,
        baseMint,
        quoteMint,
      });

      // Simulate first to get better error messages
      log.debug('Simulating cancel transaction...');
      try {
        const simulation = await connection.simulateTransaction(transaction);
        if (simulation.value.err) {
          log.error('Transaction simulation failed', {
            err: simulation.value.err,
            logs: simulation.value.logs,
          });

          // Check for OrderNotOpen error (6007) - order already cancelled/filled
          const logsStr = simulation.value.logs?.join('\n') || '';
          if (logsStr.includes('OrderNotOpen') || logsStr.includes('6007')) {
            log.info('Order already closed on-chain, removing from local state', { orderId });
            removeOrder(orderId);
            if (notifications) {
              toast.info('Order already closed');
            }
            return;
          }

          throw new Error(`Simulation failed: ${JSON.stringify(simulation.value.err)}\nLogs: ${logsStr}`);
        }
        log.debug('Simulation succeeded', { logs: simulation.value.logs });
      } catch (simError) {
        // Re-check for OrderNotOpen in case it's in the error message
        const errMsg = simError instanceof Error ? simError.message : String(simError);
        if (errMsg.includes('OrderNotOpen') || errMsg.includes('6007')) {
          log.info('Order already closed on-chain, removing from local state', { orderId });
          removeOrder(orderId);
          if (notifications) {
            toast.info('Order already closed');
          }
          return;
        }
        log.error('Simulation error', { error: errMsg });
        throw simError;
      }

      // Send and confirm the transaction
      const signature = await sendTransaction(transaction, connection);
      log.info('Cancel transaction sent', { signature });

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }

      log.info('Order cancelled successfully', { signature, orderId });

      // Remove from local state
      removeOrder(orderId);

      // Only show toast if notifications are enabled
      if (notifications) {
        toast.success('Order cancelled');
      }
    } catch (error) {
      log.error('Failed to cancel order', {
        error: error instanceof Error ? error.message : String(error),
        orderId
      });
      // Always show error toasts
      toast.error(error instanceof Error ? error.message : 'Failed to cancel order');
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
        {/* Header with refresh */}
        <div className="flex items-center justify-between mb-3">
          <MpcStatus variant="compact" />
          <div className="flex items-center gap-2">
            {lastUpdate && (
              <span className="text-[10px] text-muted-foreground">
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={refreshOnChain}
              disabled={isLoadingOnChain}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Refresh orders"
            >
              <ArrowsClockwise size={14} className={isLoadingOnChain ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {onChainError && (
          <div className="mb-2 text-xs text-amber-400/80 bg-amber-500/10 px-2 py-1 rounded">
            {onChainError}
          </div>
        )}

        {legacyOrderCount > 0 && (
          <div className="mb-2 text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded">
            {legacyOrderCount} legacy order{legacyOrderCount > 1 ? 's' : ''} hidden (incompatible format)
          </div>
        )}

        {isLoadingOnChain && orders.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
          </div>
        ) : orders.length === 0 ? (
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
                  <th className="text-center py-2 px-3">MPC</th>
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
                        <Lock size={12} className="text-muted-foreground" />
                        {order.amount}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">
                      <span className="flex items-center justify-end gap-1">
                        <Lock size={12} className="text-muted-foreground" />
                        {order.price}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right font-mono">{order.filled}</td>
                    <td className="py-2 px-3 text-center">
                      {order.mpcStatus ? (
                        <MpcIndicator status={order.mpcStatus} />
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Waiting</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleCancel(order.id)}
                        disabled={cancellingId === order.id}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      >
                        {cancellingId === order.id ? (
                          <SpinnerGap size={16} className="animate-spin" />
                        ) : (
                          <X size={16} />
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
        <h3 className="font-semibold flex items-center gap-2">
          Open Orders
          <button
            onClick={refreshOnChain}
            disabled={isLoadingOnChain}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh orders"
          >
            <ArrowsClockwise size={12} className={isLoadingOnChain ? 'animate-spin' : ''} />
          </button>
        </h3>
        <span className="text-xs text-muted-foreground">
          {orders.length} active
        </span>
      </div>

      {/* MPC Status Banner */}
      <MpcStatus variant="compact" className="mb-3" />

      {onChainError && (
        <div className="mb-2 text-xs text-amber-400/80 bg-amber-500/10 px-2 py-1 rounded">
          {onChainError}
        </div>
      )}

      {legacyOrderCount > 0 && (
        <div className="mb-2 text-xs text-muted-foreground bg-secondary/50 px-2 py-1 rounded">
          {legacyOrderCount} legacy order{legacyOrderCount > 1 ? 's' : ''} hidden (incompatible format)
        </div>
      )}

      {isLoadingOnChain && orders.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <SpinnerGap size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
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
                    <SpinnerGap size={16} className="animate-spin" />
                  ) : (
                    <X size={16} />
                  )}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Amount</p>
                  <div className="flex items-center gap-1 font-mono">
                    <Lock size={12} className="text-muted-foreground" />
                    <span>{order.amount}</span>
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">Price</p>
                  <div className="flex items-center gap-1 font-mono">
                    <Lock size={12} className="text-muted-foreground" />
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
