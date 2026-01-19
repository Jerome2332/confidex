'use client';

import { FC, ReactNode } from 'react';
import { X, Warning, Shield, Lock } from '@phosphor-icons/react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
  children?: ReactNode;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'default',
  children,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-card border border-border rounded-lg w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            {variant === 'danger' ? (
              <Warning size={20} className="text-destructive" />
            ) : (
              <Shield size={20} className="text-primary" />
            )}
            <h3 className="font-semibold">{title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {description && (
            <p className="text-sm text-muted-foreground mb-4">{description}</p>
          )}
          {children}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-border bg-secondary/30">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              variant === 'danger'
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

// Specialized confirmation for order transactions
interface OrderConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  side: 'buy' | 'sell';
  amount: string;
  price: string;
  orderType: 'limit' | 'market';
  needsWrap: boolean;
  wrapAmount?: string;
}

export const OrderConfirmDialog: FC<OrderConfirmDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  side,
  amount,
  price,
  orderType,
  needsWrap,
  wrapAmount,
}) => {
  if (!isOpen) return null;

  const total = orderType === 'limit' && price
    ? (parseFloat(amount) * parseFloat(price)).toFixed(2)
    : '---';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="relative bg-card border border-border rounded-lg w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Shield size={20} className="text-primary" />
            <h3 className="font-semibold">Confirm Order</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Order Summary */}
          <div className="space-y-3 mb-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Type</span>
              <span className={`text-sm font-medium ${
                side === 'buy' ? 'text-emerald-400/80' : 'text-rose-400/80'
              }`}>
                {side.toUpperCase()} {orderType.toUpperCase()}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Amount</span>
              <span className="text-sm font-mono">{amount} SOL</span>
            </div>
            {orderType === 'limit' && (
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Price</span>
                <span className="text-sm font-mono">{price} USDC</span>
              </div>
            )}
            <div className="flex justify-between items-center border-t border-border pt-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-sm font-mono font-medium">
                {side === 'buy' ? `${total} USDC` : `${amount} SOL`}
              </span>
            </div>
          </div>

          {/* Auto-wrap notice */}
          {needsWrap && wrapAmount && (
            <div className="p-3 bg-white/5 border border-white/20 rounded-lg mb-4">
              <div className="flex items-center gap-2 text-sm text-white/80">
                <Lock size={16} />
                <span>Will auto-wrap {wrapAmount} with this transaction</span>
              </div>
            </div>
          )}

          {/* Privacy notice */}
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-start gap-2">
              <Lock size={16} className="text-primary flex-shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Your order amount and price will be encrypted using Arcium MPC.
                This transaction will be submitted to the Solana network.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-border bg-secondary/30">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-secondary text-foreground rounded-lg text-sm font-medium hover:bg-secondary/80 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              side === 'buy'
                ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 border border-emerald-500/30'
                : 'bg-rose-500/20 hover:bg-rose-500/30 text-rose-400 border border-rose-500/30'
            }`}
          >
            {needsWrap ? `Wrap & ${side === 'buy' ? 'Buy' : 'Sell'}` : `${side === 'buy' ? 'Buy' : 'Sell'} SOL`}
          </button>
        </div>
      </div>
    </div>
  );
};
