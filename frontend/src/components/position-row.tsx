'use client';

import { FC, useState } from 'react';
import { Lock, Warning, X, Plus, Minus, SpinnerGap, TrendUp, TrendDown } from '@phosphor-icons/react';
import { PerpPosition, usePerpetualStore } from '@/stores/perpetuals-store';

interface PositionRowProps {
  position: PerpPosition;
  markPrice?: number;
  onClose?: (id: string) => void;
  onAddMargin?: (id: string) => void;
  onRemoveMargin?: (id: string) => void;
  showActions?: boolean;
  compact?: boolean;
}

export const PositionRow: FC<PositionRowProps> = ({
  position,
  markPrice,
  onClose,
  onAddMargin,
  onRemoveMargin,
  showActions = true,
  compact = false,
}) => {
  const { isClosingPosition, isAddingMargin, isRemovingMargin } = usePerpetualStore();
  const [showActionMenu, setShowActionMenu] = useState(false);

  const isLong = position.side === 'long';
  const isClosing = isClosingPosition === position.id;
  const isModifyingMargin = isAddingMargin === position.id || isRemovingMargin === position.id;

  // Calculate distance to liquidation price
  const liquidationPrice = isLong
    ? position.liquidatableBelowPrice
    : position.liquidatableAbovePrice;

  const distanceToLiquidation = markPrice && liquidationPrice
    ? isLong
      ? ((markPrice - liquidationPrice) / markPrice) * 100
      : ((liquidationPrice - markPrice) / markPrice) * 100
    : null;

  const isAtRisk = distanceToLiquidation !== null && distanceToLiquidation < 10;
  const isHighRisk = distanceToLiquidation !== null && distanceToLiquidation < 5;

  if (compact) {
    return (
      <div className={`flex items-center justify-between py-2 px-3 border-b border-border last:border-0 ${
        isHighRisk ? 'bg-rose-500/10' : isAtRisk ? 'bg-white/5' : ''
      }`}>
        <div className="flex items-center gap-2">
          <div className={`w-1.5 h-1.5 rounded-full ${isLong ? 'bg-emerald-400/80' : 'bg-rose-400/80'}`} />
          <span className="text-sm font-medium">{position.marketSymbol}</span>
          <span className={`text-xs ${isLong ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
            {position.leverage}x {isLong ? 'Long' : 'Short'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Encrypted size indicator */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock size={12} />
            <span>Size</span>
          </div>
          {/* Encrypted PnL indicator */}
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Lock size={12} />
            <span>PnL</span>
          </div>
          {isAtRisk && <Warning size={12} className={isHighRisk ? 'text-rose-400/80' : 'text-white/80'} />}
        </div>
      </div>
    );
  }

  return (
    <div className={`p-3 border-b border-border last:border-0 transition-colors ${
      isHighRisk ? 'bg-rose-500/10' : isAtRisk ? 'bg-white/5' : 'hover:bg-secondary/50'
    }`}>
      {/* Header Row */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isLong ? (
            <TrendUp size={16} className="text-emerald-400/80" />
          ) : (
            <TrendDown size={16} className="text-rose-400/80" />
          )}
          <span className="font-medium">{position.marketSymbol}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            isLong ? 'bg-emerald-500/20 text-emerald-400/80' : 'bg-rose-500/20 text-rose-400/80'
          }`}>
            {position.leverage}x {isLong ? 'Long' : 'Short'}
          </span>
        </div>

        {showActions && (
          <div className="flex items-center gap-1">
            {onAddMargin && (
              <button
                onClick={() => onAddMargin(position.id)}
                disabled={isModifyingMargin}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Add Margin"
              >
                {isAddingMargin === position.id ? (
                  <SpinnerGap size={16} className="animate-spin" />
                ) : (
                  <Plus size={16} />
                )}
              </button>
            )}
            {onRemoveMargin && (
              <button
                onClick={() => onRemoveMargin(position.id)}
                disabled={isModifyingMargin}
                className="p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                title="Remove Margin"
              >
                {isRemovingMargin === position.id ? (
                  <SpinnerGap size={16} className="animate-spin" />
                ) : (
                  <Minus size={16} />
                )}
              </button>
            )}
            {onClose && (
              <button
                onClick={() => onClose(position.id)}
                disabled={isClosing}
                className="p-1 text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                title="Close Position"
              >
                {isClosing ? (
                  <SpinnerGap size={16} className="animate-spin" />
                ) : (
                  <X size={16} />
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Position Details Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {/* Size (Encrypted) */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Size</span>
          <div className="flex items-center gap-1 text-foreground">
            <Lock size={12} className="text-primary" />
            <span className="font-mono">••••••</span>
          </div>
        </div>

        {/* Entry Price (Encrypted) */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Entry</span>
          <div className="flex items-center gap-1 text-foreground">
            <Lock size={12} className="text-primary" />
            <span className="font-mono">••••••</span>
          </div>
        </div>

        {/* Collateral (Encrypted) */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Collateral</span>
          <div className="flex items-center gap-1 text-foreground">
            <Lock size={12} className="text-primary" />
            <span className="font-mono">••••••</span>
          </div>
        </div>

        {/* Unrealized PnL (Encrypted) */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Unrealized PnL</span>
          <div className="flex items-center gap-1 text-foreground">
            <Lock size={12} className="text-primary" />
            <span className="font-mono">••••••</span>
          </div>
        </div>

        {/* Mark Price (Public) */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Mark Price</span>
          <span className="font-mono text-foreground">
            {markPrice ? `$${markPrice.toFixed(2)}` : '—'}
          </span>
        </div>

        {/* Liquidation Price (Public) */}
        <div className="flex justify-between">
          <span className="text-muted-foreground">Liq. Price</span>
          <span className={`font-mono ${isHighRisk ? 'text-rose-400/80' : isAtRisk ? 'text-white/80' : 'text-foreground'}`}>
            ${liquidationPrice.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Liquidation Warning */}
      {isAtRisk && (
        <div className={`mt-2 p-2 rounded text-xs flex items-center gap-2 ${
          isHighRisk
            ? 'bg-rose-500/20 border border-rose-500/30 text-rose-400/80'
            : 'bg-white/10 border border-white/30 text-white/80'
        }`}>
          <Warning size={12} className="shrink-0" />
          <span>
            {isHighRisk
              ? `Position at high risk! ${distanceToLiquidation?.toFixed(1)}% from liquidation.`
              : `Position approaching liquidation: ${distanceToLiquidation?.toFixed(1)}% away.`}
          </span>
        </div>
      )}

      {/* Funding Info */}
      {position.pendingFunding !== BigInt(0) && (
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>Pending Funding</span>
          <div className="flex items-center gap-1">
            <Lock size={12} className="text-primary" />
            <span className="font-mono">••••••</span>
          </div>
        </div>
      )}

      {/* Threshold Verification Status */}
      {!position.thresholdVerified && (
        <div className="mt-2 p-2 bg-white/5 border border-white/20 rounded text-xs text-white/80 flex items-center gap-2">
          <SpinnerGap size={12} className="animate-spin" />
          <span>Verifying position parameters via MPC...</span>
        </div>
      )}
    </div>
  );
};

// Empty state component for when there are no positions
export const NoPositions: FC<{ message?: string }> = ({ message = 'No open positions' }) => {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
      <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
        <Lock size={20} />
      </div>
      <p className="text-sm">{message}</p>
      <p className="text-xs mt-1">Open a perpetual position to get started</p>
    </div>
  );
};
