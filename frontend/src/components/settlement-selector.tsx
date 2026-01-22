'use client';

import { FC, useState, useRef, useEffect } from 'react';
import { CaretDown, Lightning, Cloud, Coins, Check, ShieldCheck, Info } from '@phosphor-icons/react';
import { useSettingsStore } from '@/stores/settings-store';
import type { SettlementMethod } from '@/lib/settlement/types';
import { SHADOWWIRE_FEE_BPS, LIGHT_PROTOCOL_ENABLED, CSPL_ENABLED } from '@/lib/constants';
import { cn } from '@/lib/utils';

interface SettlementOption {
  id: SettlementMethod;
  name: string;
  shortName: string;
  description: string;
  icon: typeof Lightning;
  privacyLevel: 'full' | 'partial' | 'none';
  feeBps: number;
  available: boolean;
  badge?: string;
}

const SETTLEMENT_OPTIONS: SettlementOption[] = [
  {
    id: 'shadowwire',
    name: 'ShadowWire',
    shortName: 'ShadowWire',
    description: `Bulletproof ZK privacy - amounts hidden on-chain (${(SHADOWWIRE_FEE_BPS / 100).toFixed(0)}% fee)`,
    icon: Lightning,
    privacyLevel: 'full',
    feeBps: SHADOWWIRE_FEE_BPS,
    available: true,
    badge: 'Full Privacy',
  },
  {
    id: 'light',
    name: 'Light Protocol',
    shortName: 'Light',
    description: 'ZK Compression - rent-free accounts, ~5000x cheaper',
    icon: Cloud,
    privacyLevel: 'partial',
    feeBps: 0,
    available: LIGHT_PROTOCOL_ENABLED,
    badge: 'Rent-Free',
  },
  {
    id: 'cspl',
    name: 'Confidential SPL',
    shortName: 'C-SPL',
    description: CSPL_ENABLED
      ? 'Arcium MPC confidential tokens - zero fees'
      : 'Coming soon - awaiting Arcium C-SPL SDK',
    icon: Coins,
    privacyLevel: 'full',
    feeBps: 0,
    available: CSPL_ENABLED,
    badge: CSPL_ENABLED ? 'Zero Fee' : 'Coming Soon',
  },
  {
    id: 'auto',
    name: 'Auto (Recommended)',
    shortName: 'Auto',
    description: CSPL_ENABLED
      ? 'Prefers C-SPL (zero fee), falls back to ShadowWire'
      : 'Uses ShadowWire for full privacy (1% fee)',
    icon: ShieldCheck,
    privacyLevel: 'full',
    feeBps: CSPL_ENABLED ? 0 : SHADOWWIRE_FEE_BPS,
    available: true,
    badge: 'Recommended',
  },
];

const PRIVACY_COLORS = {
  full: 'text-emerald-400',
  partial: 'text-amber-400',
  none: 'text-white/50',
};

const PRIVACY_LABELS = {
  full: 'Full Privacy',
  partial: 'Partial Privacy',
  none: 'Public',
};

interface SettlementSelectorProps {
  variant?: 'compact' | 'full';
  showFees?: boolean;
  className?: string;
}

export const SettlementSelector: FC<SettlementSelectorProps> = ({
  variant = 'compact',
  showFees = true,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { settlementMethod, setSettlementMethod, showSettlementFees } = useSettingsStore();

  const selectedOption = SETTLEMENT_OPTIONS.find(o => o.id === settlementMethod) || SETTLEMENT_OPTIONS[3]; // Default to auto

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (method: SettlementMethod) => {
    setSettlementMethod(method);
    setIsOpen(false);
  };

  const Icon = selectedOption.icon;

  if (variant === 'compact') {
    return (
      <div className={cn('relative', className)} ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
        >
          <Icon size={12} className={PRIVACY_COLORS[selectedOption.privacyLevel]} />
          <span>Settlement: {selectedOption.shortName}</span>
          <CaretDown
            size={10}
            className={cn('transition-transform', isOpen && 'rotate-180')}
          />
        </button>

        {isOpen && (
          <div className="absolute bottom-full left-0 mb-1 w-64 bg-black border border-white/10 rounded-lg shadow-lg p-1 z-50">
            <div className="px-2 py-1.5 text-[10px] text-white/40 uppercase tracking-wide border-b border-white/10 mb-1">
              Settlement Method
            </div>
            {SETTLEMENT_OPTIONS.map((option) => {
              const OptionIcon = option.icon;
              const isSelected = option.id === settlementMethod;
              const isDisabled = !option.available;

              return (
                <button
                  key={option.id}
                  onClick={() => !isDisabled && handleSelect(option.id)}
                  disabled={isDisabled}
                  className={cn(
                    'w-full flex items-start gap-2 p-2 rounded transition-colors text-left',
                    isSelected && 'bg-white/10',
                    !isSelected && !isDisabled && 'hover:bg-white/5',
                    isDisabled && 'opacity-40 cursor-not-allowed'
                  )}
                  role="option"
                  aria-selected={isSelected}
                >
                  <div className={cn(
                    'w-7 h-7 rounded flex items-center justify-center flex-shrink-0 mt-0.5',
                    isSelected ? 'bg-primary/20' : 'bg-white/5'
                  )}>
                    <OptionIcon size={14} className={PRIVACY_COLORS[option.privacyLevel]} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className={cn(
                        'text-xs font-medium',
                        isSelected ? 'text-white' : 'text-white/80'
                      )}>
                        {option.name}
                      </span>
                      {option.badge && (
                        <span className={cn(
                          'text-[8px] px-1 py-0.5 rounded',
                          option.privacyLevel === 'full'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : 'bg-amber-500/20 text-amber-400'
                        )}>
                          {option.badge}
                        </span>
                      )}
                      {isSelected && (
                        <Check size={10} className="text-primary ml-auto" />
                      )}
                    </div>
                    <p className="text-[10px] text-white/50 mt-0.5 leading-relaxed">
                      {option.description}
                    </p>
                    {showFees && showSettlementFees && option.feeBps > 0 && (
                      <p className="text-[9px] text-white/40 mt-1">
                        Fee: {(option.feeBps / 100).toFixed(2)}%
                      </p>
                    )}
                    {!option.available && (
                      <p className="text-[9px] text-rose-400/70 mt-1">
                        Not available
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Full variant - for settings panel or modal
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-1.5">
        <Lightning size={14} className="text-primary" />
        <span className="text-xs font-medium text-white">Settlement Method</span>
        <span title="Choose how your trades are settled on-chain">
          <Info size={12} className="text-white/40 cursor-help" />
        </span>
      </div>

      <div className="grid gap-1.5">
        {SETTLEMENT_OPTIONS.map((option) => {
          const OptionIcon = option.icon;
          const isSelected = option.id === settlementMethod;
          const isDisabled = !option.available;

          return (
            <button
              key={option.id}
              onClick={() => !isDisabled && handleSelect(option.id)}
              disabled={isDisabled}
              className={cn(
                'w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left',
                isSelected
                  ? 'bg-primary/10 border-primary/30'
                  : 'bg-white/5 border-white/10 hover:border-white/20',
                isDisabled && 'opacity-40 cursor-not-allowed'
              )}
            >
              <div className={cn(
                'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                isSelected ? 'bg-primary/20' : 'bg-white/10'
              )}>
                <OptionIcon size={18} className={PRIVACY_COLORS[option.privacyLevel]} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">{option.name}</span>
                  {option.badge && (
                    <span className={cn(
                      'text-[9px] px-1.5 py-0.5 rounded',
                      option.privacyLevel === 'full'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : 'bg-amber-500/20 text-amber-400'
                    )}>
                      {option.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-white/50 mt-0.5">{option.description}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className={cn('text-[10px]', PRIVACY_COLORS[option.privacyLevel])}>
                    {PRIVACY_LABELS[option.privacyLevel]}
                  </span>
                  {showFees && option.feeBps > 0 && (
                    <span className="text-[10px] text-white/40">
                      {(option.feeBps / 100).toFixed(2)}% fee
                    </span>
                  )}
                  {option.feeBps === 0 && (
                    <span className="text-[10px] text-white/40">No fee</span>
                  )}
                </div>
              </div>
              {isSelected && (
                <Check size={16} className="text-primary flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
};
