'use client';

import { FC, useEffect } from 'react';
import { Lock, SpinnerGap, Check, Clock, Lightning } from '@phosphor-icons/react';
import { useMpcEvents, formatRequestId, isComputationPending, estimateTimeRemaining } from '@/hooks/use-mpc-events';
import { cn } from '@/lib/utils';

interface MpcStatusProps {
  variant?: 'compact' | 'expanded';
  className?: string;
  autoStart?: boolean;
}

/**
 * Real-time display of MPC computation status
 * Shows pending price comparisons and fill calculations
 */
export const MpcStatus: FC<MpcStatusProps> = ({
  variant = 'compact',
  className,
  autoStart = true,
}) => {
  const {
    pendingComputations,
    isListening,
    startListening,
    stopListening,
  } = useMpcEvents();

  // Auto-start listening on mount
  useEffect(() => {
    if (autoStart && !isListening) {
      startListening();
    }
    return () => {
      if (isListening) {
        stopListening();
      }
    };
  }, [autoStart, isListening, startListening, stopListening]);

  const pendingCount = pendingComputations.filter(isComputationPending).length;
  const completedCount = pendingComputations.filter(c => c.status === 'completed').length;

  if (pendingComputations.length === 0) {
    return null;
  }

  if (variant === 'compact') {
    return (
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 bg-white/5 rounded-lg border border-white/10 text-xs',
        className
      )}>
        <Lock size={12} className="text-white/60" />
        <span className="text-white/60">MPC:</span>
        {pendingCount > 0 ? (
          <>
            <SpinnerGap size={12} className="animate-spin text-white" />
            <span className="text-white">{pendingCount} matching</span>
          </>
        ) : (
          <>
            <Check size={12} className="text-emerald-400" />
            <span className="text-emerald-400">{completedCount} complete</span>
          </>
        )}
      </div>
    );
  }

  // Expanded variant - shows individual computations
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 text-xs text-white/60">
        <Lock size={12} />
        <span>MPC Computations</span>
        {isListening && (
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
            </span>
            Live
          </span>
        )}
      </div>

      <div className="space-y-1.5">
        {pendingComputations.map((comp) => (
          <MpcComputationRow key={comp.requestId} computation={comp} />
        ))}
      </div>
    </div>
  );
};

/**
 * Individual computation row
 */
const MpcComputationRow: FC<{
  computation: {
    requestId: string;
    type: 'compare' | 'fill';
    status: 'pending' | 'completed' | 'failed';
    result?: {
      pricesMatch?: boolean;
      buyFullyFilled?: boolean;
      sellFullyFilled?: boolean;
    };
    createdAt: number;
  };
}> = ({ computation }) => {
  const isPending = computation.status === 'pending';
  const timeRemaining = estimateTimeRemaining(computation as Parameters<typeof estimateTimeRemaining>[0]);

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2 py-1.5 rounded border text-xs',
        isPending
          ? 'bg-white/5 border-white/10'
          : computation.status === 'completed'
          ? 'bg-emerald-500/10 border-emerald-500/20'
          : 'bg-rose-500/10 border-rose-500/20'
      )}
    >
      {/* Status icon */}
      {isPending ? (
        <SpinnerGap size={12} className="animate-spin text-white/60" />
      ) : computation.status === 'completed' ? (
        <Check size={12} className="text-emerald-400" />
      ) : (
        <Clock size={12} className="text-rose-400" />
      )}

      {/* Type */}
      <span className="text-white/80">
        {computation.type === 'compare' ? 'Price Compare' : 'Fill Calc'}
      </span>

      {/* Request ID (truncated) */}
      <span className="text-white/40 font-mono text-[10px]">
        {formatRequestId(computation.requestId)}
      </span>

      {/* Result or status */}
      <div className="ml-auto">
        {isPending ? (
          <span className="text-white/40">
            ~{Math.ceil(timeRemaining / 1000)}s
          </span>
        ) : computation.result ? (
          <span className="text-emerald-400">
            {computation.type === 'compare'
              ? computation.result.pricesMatch
                ? 'Matched!'
                : 'No match'
              : 'Filled'}
          </span>
        ) : null}
      </div>
    </div>
  );
};

/**
 * Inline MPC indicator for order rows
 */
export const MpcIndicator: FC<{
  status: 'queued' | 'comparing' | 'matched' | 'settling' | 'complete';
  className?: string;
}> = ({ status, className }) => {
  const config = {
    queued: { icon: Clock, label: 'Queued', color: 'text-white/40' },
    comparing: { icon: SpinnerGap, label: 'Comparing', color: 'text-white', animate: true },
    matched: { icon: Check, label: 'Matched', color: 'text-emerald-400' },
    settling: { icon: Lightning, label: 'Settling', color: 'text-white', animate: true },
    complete: { icon: Check, label: 'Complete', color: 'text-emerald-400' },
  };

  const statusConfig = config[status] || config.queued;
  const Icon = statusConfig.icon;
  const label = statusConfig.label;
  const color = statusConfig.color;
  const animate = 'animate' in statusConfig ? statusConfig.animate : false;

  return (
    <div className={cn('flex items-center gap-1 text-[10px]', color, className)}>
      <Icon className={cn('h-3 w-3', animate && 'animate-spin')} />
      <span>{label}</span>
    </div>
  );
};
