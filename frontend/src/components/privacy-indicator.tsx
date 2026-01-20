'use client';

import { FC, ComponentType } from 'react';
import { Shield, ShieldCheck, ShieldWarning, Lock, Eye, EyeSlash, IconProps } from '@phosphor-icons/react';

/**
 * Privacy levels for the Confidex DEX
 */
export type PrivacyLevel = 'full' | 'partial' | 'public';

interface PrivacyIndicatorProps {
  /** Current privacy level */
  level: PrivacyLevel;
  /** Show detailed tooltip on hover */
  showTooltip?: boolean;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Show label text */
  showLabel?: boolean;
}

const PRIVACY_CONFIG: Record<PrivacyLevel, {
  icon: ComponentType<IconProps>;
  label: string;
  description: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  full: {
    icon: ShieldCheck,
    label: 'Full Privacy',
    description: 'V2 encryption + encrypted thresholds + MPC verification',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
  partial: {
    icon: Shield,
    label: 'Partial Privacy',
    description: 'V2 encryption enabled (some metadata visible)',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/10',
    borderColor: 'border-yellow-500/30',
  },
  public: {
    icon: ShieldWarning,
    label: 'Public Mode',
    description: 'Legacy plaintext mode (no encryption)',
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10',
    borderColor: 'border-rose-500/30',
  },
};

const SIZE_CONFIG = {
  sm: { iconSize: 14, textSize: 'text-xs', padding: 'px-2 py-0.5' },
  md: { iconSize: 16, textSize: 'text-sm', padding: 'px-3 py-1' },
  lg: { iconSize: 20, textSize: 'text-base', padding: 'px-4 py-1.5' },
};

/**
 * Privacy indicator badge showing current encryption level
 */
export const PrivacyIndicator: FC<PrivacyIndicatorProps> = ({
  level,
  showTooltip = true,
  size = 'sm',
  showLabel = true,
}) => {
  const config = PRIVACY_CONFIG[level];
  const sizeConfig = SIZE_CONFIG[size];
  const IconComponent = config.icon;

  return (
    <div
      className={`
        inline-flex items-center gap-1.5 rounded-full border
        ${config.bgColor} ${config.borderColor} ${sizeConfig.padding}
        ${showTooltip ? 'cursor-help' : ''}
      `}
      title={showTooltip ? config.description : undefined}
    >
      <IconComponent size={sizeConfig.iconSize} className={config.color} />
      {showLabel && (
        <span className={`${sizeConfig.textSize} ${config.color} font-medium`}>
          {config.label}
        </span>
      )}
    </div>
  );
};

/**
 * Compact privacy badge for headers/nav
 */
export const PrivacyBadge: FC<{ level: PrivacyLevel }> = ({ level }) => {
  const config = PRIVACY_CONFIG[level];
  const IconComponent = config.icon;

  return (
    <div
      className={`
        flex items-center gap-1 px-2 py-0.5 rounded-full text-xs
        ${config.bgColor} ${config.borderColor} border
      `}
      title={config.description}
    >
      <IconComponent size={12} className={config.color} />
      <span className={config.color}>{level === 'full' ? 'V2' : level === 'partial' ? 'V2' : 'V1'}</span>
    </div>
  );
};

/**
 * Hook to determine current privacy level based on config
 */
export function usePrivacyLevel(): PrivacyLevel {
  // In V2, we always have full privacy with encrypted thresholds
  // This could be dynamic based on feature flags or chain state
  return 'full';
}

/**
 * Privacy status component for displaying encryption mode
 */
export const PrivacyStatus: FC<{
  showDetails?: boolean;
}> = ({ showDetails = false }) => {
  const level = usePrivacyLevel();
  const config = PRIVACY_CONFIG[level];

  if (!showDetails) {
    return <PrivacyIndicator level={level} />;
  }

  return (
    <div className={`rounded-lg border ${config.borderColor} ${config.bgColor} p-3`}>
      <div className="flex items-center gap-2 mb-2">
        <PrivacyIndicator level={level} />
      </div>
      <p className="text-xs text-muted-foreground">{config.description}</p>

      {/* Privacy details */}
      <div className="mt-3 space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <Lock size={12} className={level === 'full' ? 'text-emerald-400' : 'text-muted-foreground'} />
          <span className={level === 'full' ? 'text-foreground' : 'text-muted-foreground'}>
            Encrypted order amounts
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Lock size={12} className={level === 'full' ? 'text-emerald-400' : 'text-muted-foreground'} />
          <span className={level === 'full' ? 'text-foreground' : 'text-muted-foreground'}>
            Encrypted liquidation thresholds
          </span>
        </div>
        <div className="flex items-center gap-2">
          <EyeSlash size={12} className={level === 'full' ? 'text-emerald-400' : 'text-muted-foreground'} />
          <span className={level === 'full' ? 'text-foreground' : 'text-muted-foreground'}>
            Hash-based position IDs
          </span>
        </div>
        <div className="flex items-center gap-2">
          <EyeSlash size={12} className={level === 'full' ? 'text-emerald-400' : 'text-muted-foreground'} />
          <span className={level === 'full' ? 'text-foreground' : 'text-muted-foreground'}>
            Coarse timestamps (hour precision)
          </span>
        </div>
      </div>
    </div>
  );
};

export default PrivacyIndicator;
