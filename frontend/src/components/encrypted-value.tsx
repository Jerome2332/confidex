'use client';

import { FC, useState } from 'react';
import { Lock, LockOpen, Eye, EyeSlash, SpinnerGap } from '@phosphor-icons/react';

type ValueType = 'currency' | 'number' | 'percentage' | 'price';

interface EncryptedValueProps {
  /** The encrypted bytes (for display purposes - actual decryption happens via MPC) */
  encryptedData?: Uint8Array | null;
  /** Decrypted value (only available to position owner) */
  decryptedValue?: number | bigint | null;
  /** Label for the value */
  label?: string;
  /** Type of value for formatting */
  type?: ValueType;
  /** Currency symbol for currency type */
  currency?: string;
  /** Number of decimal places */
  decimals?: number;
  /** Whether the user can decrypt this value */
  canDecrypt?: boolean;
  /** Callback when decrypt is requested */
  onDecrypt?: () => void;
  /** Whether decryption is in progress */
  isDecrypting?: boolean;
  /** Show lock icon */
  showLock?: boolean;
  /** Size variant */
  size?: 'xs' | 'sm' | 'md';
  /** Color class for the value text */
  valueColor?: string;
}

/**
 * Format a value based on its type
 */
function formatValue(
  value: number | bigint,
  type: ValueType,
  currency: string,
  decimals: number
): string {
  const numValue = typeof value === 'bigint' ? Number(value) : value;

  switch (type) {
    case 'currency':
      return `${currency}${numValue.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    case 'price':
      return `${currency}${numValue.toFixed(decimals)}`;
    case 'percentage':
      return `${numValue.toFixed(decimals)}%`;
    case 'number':
    default:
      return numValue.toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
  }
}

const SIZE_CONFIG = {
  xs: { icon: 10, text: 'text-xs', dots: 4 },
  sm: { icon: 12, text: 'text-sm', dots: 6 },
  md: { icon: 14, text: 'text-base', dots: 8 },
};

/**
 * Component for displaying encrypted values with optional decryption
 *
 * Shows a placeholder with lock icon for encrypted values.
 * Position owners can request decryption via MPC.
 */
export const EncryptedValue: FC<EncryptedValueProps> = ({
  encryptedData,
  decryptedValue,
  label,
  type = 'number',
  currency = '$',
  decimals = 2,
  canDecrypt = false,
  onDecrypt,
  isDecrypting = false,
  showLock = true,
  size = 'sm',
  valueColor,
}) => {
  const [showDecrypted, setShowDecrypted] = useState(false);
  const sizeConfig = SIZE_CONFIG[size];
  const hasDecryptedValue = decryptedValue !== null && decryptedValue !== undefined;

  const handleToggleVisibility = () => {
    if (hasDecryptedValue) {
      setShowDecrypted(!showDecrypted);
    } else if (canDecrypt && onDecrypt) {
      onDecrypt();
    }
  };

  // Show decrypted value if available and user wants to see it
  if (showDecrypted && hasDecryptedValue) {
    return (
      <div className="flex items-center gap-1.5">
        {label && <span className="text-muted-foreground">{label}</span>}
        <button
          onClick={handleToggleVisibility}
          className="flex items-center gap-1 group"
        >
          <span className={`font-mono ${sizeConfig.text} ${valueColor || 'text-foreground'}`}>
            {formatValue(decryptedValue, type, currency, decimals)}
          </span>
          <EyeSlash
            size={sizeConfig.icon}
            className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </button>
      </div>
    );
  }

  // Show encrypted placeholder
  return (
    <div className="flex items-center gap-1.5">
      {label && <span className="text-muted-foreground">{label}</span>}
      <div className="flex items-center gap-1">
        {showLock && (
          isDecrypting ? (
            <SpinnerGap size={sizeConfig.icon} className="text-primary animate-spin" />
          ) : (
            <Lock size={sizeConfig.icon} className="text-primary" />
          )
        )}
        <span className={`font-mono ${sizeConfig.text} text-muted-foreground`}>
          {'•'.repeat(sizeConfig.dots)}
        </span>
        {canDecrypt && hasDecryptedValue && (
          <button
            onClick={handleToggleVisibility}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Show value"
          >
            <Eye size={sizeConfig.icon} />
          </button>
        )}
      </div>
    </div>
  );
};

/**
 * Component for displaying liquidation status without revealing the threshold
 */
interface LiquidationStatusProps {
  /** Current mark price (public from oracle) */
  markPrice: number;
  /** Whether position is long */
  isLong: boolean;
  /** Risk level based on MPC batch check results */
  riskLevel?: 'safe' | 'warning' | 'critical' | 'unknown';
  /** Distance to liquidation as percentage (only available after MPC check) */
  distancePercent?: number;
  /** Whether the threshold is verified via MPC */
  thresholdVerified?: boolean;
}

export const LiquidationStatus: FC<LiquidationStatusProps> = ({
  markPrice,
  isLong,
  riskLevel = 'unknown',
  distancePercent,
  thresholdVerified = false,
}) => {
  const getRiskConfig = () => {
    switch (riskLevel) {
      case 'safe':
        return {
          color: 'text-emerald-400/80',
          bgColor: 'bg-emerald-500/10',
          borderColor: 'border-emerald-500/30',
          label: 'Safe',
        };
      case 'warning':
        return {
          color: 'text-yellow-400/80',
          bgColor: 'bg-yellow-500/10',
          borderColor: 'border-yellow-500/30',
          label: 'Caution',
        };
      case 'critical':
        return {
          color: 'text-rose-400/80',
          bgColor: 'bg-rose-500/10',
          borderColor: 'border-rose-500/30',
          label: 'At Risk',
        };
      case 'unknown':
      default:
        return {
          color: 'text-muted-foreground',
          bgColor: 'bg-white/5',
          borderColor: 'border-white/10',
          label: 'Unknown',
        };
    }
  };

  const riskConfig = getRiskConfig();

  return (
    <div className="flex flex-col gap-1">
      {/* Liquidation Price (now encrypted) */}
      <div className="flex justify-between items-center">
        <span className="text-xs text-muted-foreground">Liq. Price</span>
        <div className="flex items-center gap-1">
          <Lock size={12} className="text-primary" />
          <span className="font-mono text-xs text-muted-foreground">••••••</span>
        </div>
      </div>

      {/* Risk Status */}
      <div className={`
        flex items-center justify-between px-2 py-1 rounded text-xs
        ${riskConfig.bgColor} ${riskConfig.borderColor} border
      `}>
        <span className={riskConfig.color}>{riskConfig.label}</span>
        {distancePercent !== undefined && thresholdVerified && (
          <span className={`font-mono ${riskConfig.color}`}>
            {distancePercent.toFixed(1)}% margin
          </span>
        )}
        {!thresholdVerified && (
          <span className="text-muted-foreground flex items-center gap-1">
            <SpinnerGap size={10} className="animate-spin" />
            MPC verifying
          </span>
        )}
      </div>
    </div>
  );
};

export default EncryptedValue;
