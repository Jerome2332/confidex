'use client';

import { FC, useEffect, useState } from 'react';
import { Shield, Lock, Lightning, Check, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

export type OrderProgressStep =
  | 'idle'
  | 'generating-proof'
  | 'proof-ready'
  | 'encrypting'
  | 'encrypted'
  | 'submitting'
  | 'confirming'
  | 'mpc-queued'
  | 'mpc-comparing'
  | 'mpc-matched'
  | 'settling'
  | 'complete'
  | 'error';

interface OrderProgressProps {
  step: OrderProgressStep;
  errorMessage?: string;
  className?: string;
  variant?: 'inline' | 'expanded';
}

interface StepConfig {
  label: string;
  description: string;
  icon: typeof Shield;
  layer: 1 | 2 | 3;
}

const STEP_CONFIG: Record<OrderProgressStep, StepConfig> = {
  idle: {
    label: 'Ready',
    description: 'Enter order details',
    icon: Shield,
    layer: 1,
  },
  'generating-proof': {
    label: 'Generating ZK Proof',
    description: 'Proving eligibility without revealing identity...',
    icon: Shield,
    layer: 1,
  },
  'proof-ready': {
    label: 'Proof Ready',
    description: 'Eligibility verified via Groth16',
    icon: Shield,
    layer: 1,
  },
  encrypting: {
    label: 'Encrypting Order',
    description: 'Encrypting with Arcium RescueCipher...',
    icon: Lock,
    layer: 2,
  },
  encrypted: {
    label: 'Order Encrypted',
    description: 'Amount and price secured',
    icon: Lock,
    layer: 2,
  },
  submitting: {
    label: 'Submitting',
    description: 'Sending to Solana...',
    icon: Lock,
    layer: 2,
  },
  confirming: {
    label: 'Confirming',
    description: 'Waiting for block confirmation...',
    icon: Lock,
    layer: 2,
  },
  'mpc-queued': {
    label: 'MPC Queued',
    description: 'Order sent to Arcium cluster...',
    icon: Lock,
    layer: 2,
  },
  'mpc-comparing': {
    label: 'MPC Matching',
    description: 'Comparing encrypted prices...',
    icon: Lock,
    layer: 2,
  },
  'mpc-matched': {
    label: 'Match Found',
    description: 'Orders matched via MPC',
    icon: Lock,
    layer: 2,
  },
  settling: {
    label: 'Settling',
    description: 'Executing via ShadowWire...',
    icon: Lightning,
    layer: 3,
  },
  complete: {
    label: 'Complete',
    description: 'Order executed privately',
    icon: Check,
    layer: 3,
  },
  error: {
    label: 'Error',
    description: 'Something went wrong',
    icon: WarningCircle,
    layer: 1,
  },
};

/**
 * Shows detailed order progress with the 3-layer privacy steps
 */
export const OrderProgress: FC<OrderProgressProps> = ({
  step,
  errorMessage,
  className,
  variant = 'inline',
}) => {
  const config = STEP_CONFIG[step];
  const Icon = config.icon;

  const isLoading = [
    'generating-proof',
    'encrypting',
    'submitting',
    'confirming',
    'mpc-queued',
    'mpc-comparing',
    'settling',
  ].includes(step);

  const isSuccess = step === 'complete';
  const isError = step === 'error';

  // Layer progress (which layers are complete)
  const layer1Complete = [
    'proof-ready',
    'encrypting',
    'encrypted',
    'submitting',
    'confirming',
    'mpc-queued',
    'mpc-comparing',
    'mpc-matched',
    'settling',
    'complete',
  ].includes(step);

  const layer2Complete = ['mpc-matched', 'settling', 'complete'].includes(step);
  const layer3Complete = step === 'complete';

  if (variant === 'inline') {
    return (
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs',
          isError
            ? 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
            : isSuccess
            ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
            : 'bg-white/5 border border-white/10 text-white/80',
          className
        )}
      >
        {isLoading ? (
          <SpinnerGap size={12} className="animate-spin" />
        ) : isSuccess ? (
          <Check size={12} />
        ) : isError ? (
          <WarningCircle size={12} />
        ) : (
          <Icon size={12} />
        )}
        <div className="flex flex-col">
          <span className="font-medium">{config.label}</span>
          <span className="text-[10px] text-white/50">
            {isError && errorMessage ? errorMessage : config.description}
          </span>
        </div>

        {/* Layer indicators */}
        <div className="ml-auto flex items-center gap-1">
          <div
            className={cn(
              'h-1.5 w-4 rounded-full transition-colors',
              layer1Complete || config.layer === 1 && isLoading
                ? layer1Complete
                  ? 'bg-emerald-400'
                  : 'bg-white animate-pulse'
                : 'bg-white/20'
            )}
            title="ZK Proof"
          />
          <div
            className={cn(
              'h-1.5 w-4 rounded-full transition-colors',
              layer2Complete || config.layer === 2 && isLoading
                ? layer2Complete
                  ? 'bg-emerald-400'
                  : 'bg-white animate-pulse'
                : 'bg-white/20'
            )}
            title="MPC Matching"
          />
          <div
            className={cn(
              'h-1.5 w-4 rounded-full transition-colors',
              layer3Complete || config.layer === 3 && isLoading
                ? layer3Complete
                  ? 'bg-emerald-400'
                  : 'bg-white animate-pulse'
                : 'bg-white/20'
            )}
            title="Settlement"
          />
        </div>
      </div>
    );
  }

  // Expanded variant - full 3-layer visualization
  return (
    <div className={cn('space-y-3', className)}>
      {/* Header */}
      <div className="flex items-center gap-2">
        {isLoading ? (
          <SpinnerGap size={16} className="animate-spin text-white" />
        ) : isSuccess ? (
          <Check size={16} className="text-emerald-400" />
        ) : isError ? (
          <WarningCircle size={16} className="text-rose-400" />
        ) : (
          <Icon size={16} className="text-white" />
        )}
        <span className="text-sm font-medium text-white">{config.label}</span>
      </div>

      {/* Description */}
      <p className="text-xs text-white/60">
        {isError && errorMessage ? errorMessage : config.description}
      </p>

      {/* Layer Progress */}
      <div className="grid grid-cols-3 gap-2">
        {/* Layer 1: ZK */}
        <div
          className={cn(
            'p-2 rounded-lg border transition-all',
            layer1Complete
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : config.layer === 1 && isLoading
              ? 'bg-white/10 border-white/30 ring-1 ring-white/20'
              : 'bg-white/5 border-white/10'
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {layer1Complete ? (
              <Check size={12} className="text-emerald-400" />
            ) : config.layer === 1 && isLoading ? (
              <SpinnerGap size={12} className="animate-spin text-white" />
            ) : (
              <Shield size={12} className="text-white/50" />
            )}
            <span className="text-[10px] font-medium text-white/80">ZK Proof</span>
          </div>
          <span className="text-[9px] text-white/40">Noir + Sunspot</span>
        </div>

        {/* Layer 2: MPC */}
        <div
          className={cn(
            'p-2 rounded-lg border transition-all',
            layer2Complete
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : config.layer === 2 && isLoading
              ? 'bg-white/10 border-white/30 ring-1 ring-white/20'
              : 'bg-white/5 border-white/10'
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {layer2Complete ? (
              <Check size={12} className="text-emerald-400" />
            ) : config.layer === 2 && isLoading ? (
              <SpinnerGap size={12} className="animate-spin text-white" />
            ) : (
              <Lock size={12} className="text-white/50" />
            )}
            <span className="text-[10px] font-medium text-white/80">MPC</span>
          </div>
          <span className="text-[9px] text-white/40">Arcium</span>
        </div>

        {/* Layer 3: Settlement */}
        <div
          className={cn(
            'p-2 rounded-lg border transition-all',
            layer3Complete
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : config.layer === 3 && isLoading
              ? 'bg-white/10 border-white/30 ring-1 ring-white/20'
              : 'bg-white/5 border-white/10'
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            {layer3Complete ? (
              <Check size={12} className="text-emerald-400" />
            ) : config.layer === 3 && isLoading ? (
              <SpinnerGap size={12} className="animate-spin text-white" />
            ) : (
              <Lightning size={12} className="text-white/50" />
            )}
            <span className="text-[10px] font-medium text-white/80">Settle</span>
          </div>
          <span className="text-[9px] text-white/40">ShadowWire</span>
        </div>
      </div>
    </div>
  );
};

/**
 * Hook to manage order progress state based on toast/event sequences
 */
export function useOrderProgress() {
  const [step, setStep] = useState<OrderProgressStep>('idle');
  const [errorMessage, setErrorMessage] = useState<string | undefined>();

  const reset = () => {
    setStep('idle');
    setErrorMessage(undefined);
  };

  const setError = (message: string) => {
    setStep('error');
    setErrorMessage(message);
  };

  return {
    step,
    setStep,
    errorMessage,
    setError,
    reset,
  };
}
