'use client';

import { FC, useState } from 'react';
import { Shield, Lock, Lightning, Check, Clock, SpinnerGap, ArrowRight } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';

interface LayerStatus {
  status: 'idle' | 'active' | 'complete';
  detail?: string;
}

interface PrivacyArchitectureProps {
  variant?: 'static' | 'interactive';
  size?: 'sm' | 'md' | 'lg';
  layer1Status?: LayerStatus;
  layer2Status?: LayerStatus;
  layer3Status?: LayerStatus;
  showFlow?: boolean;
  className?: string;
}

/**
 * Visual representation of the 3-layer privacy architecture
 * Can be static (landing page) or interactive (trading flow)
 */
export const PrivacyArchitecture: FC<PrivacyArchitectureProps> = ({
  variant = 'static',
  size = 'md',
  layer1Status = { status: 'idle' },
  layer2Status = { status: 'idle' },
  layer3Status = { status: 'idle' },
  showFlow = true,
  className,
}) => {
  const isInteractive = variant === 'interactive';

  const sizeClasses = {
    sm: 'gap-2',
    md: 'gap-4',
    lg: 'gap-6',
  };

  const iconSizes = {
    sm: 16,
    md: 24,
    lg: 32,
  };

  const containerSizes = {
    sm: 'w-10 h-10',
    md: 'w-14 h-14',
    lg: 'w-16 h-16',
  };

  const getStatusIcon = (status: LayerStatus['status']) => {
    switch (status) {
      case 'active':
        return <SpinnerGap size={iconSizes[size]} className="animate-spin text-white" />;
      case 'complete':
        return <Check size={iconSizes[size]} className="text-emerald-400" />;
      default:
        return null;
    }
  };

  const getStatusColor = (status: LayerStatus['status']) => {
    switch (status) {
      case 'active':
        return 'border-white/50 bg-white/20';
      case 'complete':
        return 'border-emerald-500/50 bg-emerald-500/20';
      default:
        return 'border-white/10 bg-white/5';
    }
  };

  const layers = [
    {
      id: 'compliance',
      label: 'Layer 1',
      title: 'ZK Proofs',
      description: 'Eligibility verification',
      tech: 'Noir + Sunspot',
      icon: Shield,
      status: layer1Status,
    },
    {
      id: 'execution',
      label: 'Layer 2',
      title: 'MPC Matching',
      description: 'Encrypted order comparison',
      tech: 'Arcium Cerberus',
      icon: Lock,
      status: layer2Status,
    },
    {
      id: 'settlement',
      label: 'Layer 3',
      title: 'Private Settlement',
      description: 'Confidential transfers',
      tech: 'ShadowWire',
      icon: Lightning,
      status: layer3Status,
    },
  ];

  return (
    <div className={cn('flex flex-col', sizeClasses[size], className)}>
      {/* Layers */}
      <div className={cn('flex items-center justify-center', sizeClasses[size])}>
        {layers.map((layer, index) => (
          <div key={layer.id} className="flex items-center">
            {/* Layer Card */}
            <div
              className={cn(
                'flex flex-col items-center p-3 rounded-xl border transition-all duration-300',
                getStatusColor(layer.status.status),
                isInteractive && layer.status.status === 'active' && 'ring-2 ring-white/30 ring-offset-2 ring-offset-black'
              )}
            >
              {/* Icon Container */}
              <div
                className={cn(
                  'rounded-full flex items-center justify-center mb-2',
                  containerSizes[size],
                  layer.status.status === 'active'
                    ? 'bg-white/20'
                    : layer.status.status === 'complete'
                    ? 'bg-emerald-500/20'
                    : 'bg-white/10'
                )}
              >
                {layer.status.status === 'idle' ? (
                  <layer.icon size={iconSizes[size]} className="text-white" />
                ) : (
                  getStatusIcon(layer.status.status)
                )}
              </div>

              {/* Label */}
              <span className="text-[10px] text-white/50 font-light">{layer.label}</span>
              <span className="text-xs font-medium text-white">{layer.title}</span>

              {size !== 'sm' && (
                <>
                  <span className="text-[10px] text-white/60 mt-1 text-center max-w-[100px]">
                    {layer.description}
                  </span>
                  <span className="text-[10px] text-white/40 mt-1 bg-white/5 px-2 py-0.5 rounded-full">
                    {layer.tech}
                  </span>
                </>
              )}

              {/* Status Detail */}
              {isInteractive && layer.status.detail && (
                <span className="text-[10px] text-white/80 mt-2 animate-pulse">
                  {layer.status.detail}
                </span>
              )}
            </div>

            {/* Arrow Between Layers */}
            {showFlow && index < layers.length - 1 && (
              <div className="mx-2">
                <ArrowRight
                  size={16}
                  className={cn(
                    'transition-colors duration-300',
                    layers[index + 1].status.status !== 'idle'
                      ? 'text-white/60'
                      : 'text-white/20'
                  )}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Flow Labels (optional) */}
      {showFlow && size !== 'sm' && (
        <div className="flex justify-center items-center gap-8 text-[10px] text-white/40 mt-2">
          <span>Prove Eligibility</span>
          <span>→</span>
          <span>Encrypt & Match</span>
          <span>→</span>
          <span>Settle Privately</span>
        </div>
      )}
    </div>
  );
};

/**
 * Compact horizontal status bar for the trading panel
 */
export const PrivacyStatusBar: FC<{
  zkStatus: LayerStatus;
  mpcStatus: LayerStatus;
  settlementStatus: LayerStatus;
  className?: string;
}> = ({ zkStatus, mpcStatus, settlementStatus, className }) => {
  const getStatusDot = (status: LayerStatus['status']) => {
    switch (status) {
      case 'active':
        return (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
          </span>
        );
      case 'complete':
        return <span className="h-2 w-2 rounded-full bg-emerald-400" />;
      default:
        return <span className="h-2 w-2 rounded-full bg-white/20" />;
    }
  };

  const statuses = [
    { label: 'ZK', status: zkStatus, detail: zkStatus.detail || 'Eligibility' },
    { label: 'MPC', status: mpcStatus, detail: mpcStatus.detail || 'Matching' },
    { label: 'Settlement', status: settlementStatus, detail: settlementStatus.detail || 'Transfer' },
  ];

  return (
    <div className={cn('flex items-center gap-4 px-3 py-2 bg-white/5 rounded-lg border border-white/10', className)}>
      {statuses.map((item, index) => (
        <div key={item.label} className="flex items-center gap-2">
          {getStatusDot(item.status.status)}
          <div className="flex flex-col">
            <span className="text-[10px] text-white/50">{item.label}</span>
            <span className="text-xs text-white/80">{item.detail}</span>
          </div>
          {index < statuses.length - 1 && (
            <ArrowRight size={12} className="text-white/20 ml-2" />
          )}
        </div>
      ))}
    </div>
  );
};

/**
 * Minimal inline status indicator
 */
export const PrivacyStepIndicator: FC<{
  currentStep: 'zk' | 'mpc' | 'settlement' | 'complete' | null;
  className?: string;
}> = ({ currentStep, className }) => {
  const steps = ['zk', 'mpc', 'settlement'] as const;

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {steps.map((step, index) => {
        const isActive = currentStep === step;
        const isComplete =
          currentStep === 'complete' ||
          (currentStep && steps.indexOf(currentStep) > index);

        return (
          <div key={step} className="flex items-center">
            <div
              className={cn(
                'h-1.5 w-6 rounded-full transition-all duration-300',
                isActive
                  ? 'bg-white animate-pulse'
                  : isComplete
                  ? 'bg-emerald-400'
                  : 'bg-white/20'
              )}
            />
            {index < steps.length - 1 && <div className="w-1" />}
          </div>
        );
      })}
    </div>
  );
};
