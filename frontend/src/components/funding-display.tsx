'use client';

import { FC, useState, useEffect, useMemo } from 'react';
import { Clock, TrendingUp, TrendingDown, Info } from 'lucide-react';
import { FundingRateInfo } from '@/stores/perpetuals-store';

interface FundingDisplayProps {
  fundingInfo?: FundingRateInfo;
  variant?: 'default' | 'compact' | 'inline';
  showHistory?: boolean;
  showCountdown?: boolean;
}

export const FundingDisplay: FC<FundingDisplayProps> = ({
  fundingInfo,
  variant = 'default',
  showHistory = false,
  showCountdown = true,
}) => {
  const [countdown, setCountdown] = useState<string>('--:--:--');

  // Update countdown every second
  useEffect(() => {
    if (!fundingInfo?.nextFundingTime) return;

    const updateCountdown = () => {
      const now = new Date();
      const next = new Date(fundingInfo.nextFundingTime);
      const diff = next.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown('00:00:00');
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setCountdown(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      );
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [fundingInfo?.nextFundingTime]);

  const currentRate = fundingInfo?.currentRateBps ?? 0;
  const isPositive = currentRate > 0;
  const isNegative = currentRate < 0;
  const ratePercentage = (currentRate / 100).toFixed(4);

  // Calculate estimated annual rate
  const estimatedAnnualRate = useMemo(() => {
    if (!fundingInfo) return null;
    // 8760 hours in a year, funding every hour
    const hourlyRate = currentRate / 10000;
    const annualRate = hourlyRate * 8760 * 100;
    return annualRate.toFixed(2);
  }, [currentRate, fundingInfo]);

  if (!fundingInfo) {
    return (
      <div className="text-xs text-muted-foreground">
        Funding rate unavailable
      </div>
    );
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Funding:</span>
        <span className={`font-mono ${
          isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-foreground'
        }`}>
          {isPositive ? '+' : ''}{ratePercentage}%
        </span>
        {showCountdown && (
          <>
            <span className="text-muted-foreground">in</span>
            <span className="font-mono text-foreground">{countdown}</span>
          </>
        )}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center justify-between p-2 bg-secondary rounded text-xs">
        <div className="flex items-center gap-2">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span className="text-muted-foreground">Next Funding</span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`font-mono ${
            isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-foreground'
          }`}>
            {isPositive ? '+' : ''}{ratePercentage}%
          </span>
          <span className="font-mono text-foreground">{countdown}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Current Rate */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Funding Rate</span>
          <button
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Funding rate determines payments between long and short positions. Positive = longs pay shorts. Negative = shorts pay longs."
          >
            <Info className="h-3 w-3" />
          </button>
        </div>
        <div className="flex items-center gap-1.5">
          {isPositive ? (
            <TrendingUp className="h-3 w-3 text-green-500" />
          ) : isNegative ? (
            <TrendingDown className="h-3 w-3 text-red-500" />
          ) : null}
          <span className={`text-sm font-mono font-medium ${
            isPositive ? 'text-green-500' : isNegative ? 'text-red-500' : 'text-foreground'
          }`}>
            {isPositive ? '+' : ''}{ratePercentage}%
          </span>
        </div>
      </div>

      {/* Countdown */}
      {showCountdown && (
        <div className="flex items-center justify-between p-2 bg-secondary rounded">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Next Funding</span>
          </div>
          <span className="text-sm font-mono font-medium">{countdown}</span>
        </div>
      )}

      {/* Rate Info */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex justify-between p-2 bg-secondary/50 rounded">
          <span className="text-muted-foreground">Interval</span>
          <span className="font-mono">
            {Math.floor(fundingInfo.fundingIntervalSeconds / 3600)}h
          </span>
        </div>
        <div className="flex justify-between p-2 bg-secondary/50 rounded">
          <span className="text-muted-foreground">Est. Annual</span>
          <span className={`font-mono ${
            parseFloat(estimatedAnnualRate || '0') > 0
              ? 'text-green-500'
              : parseFloat(estimatedAnnualRate || '0') < 0
              ? 'text-red-500'
              : 'text-foreground'
          }`}>
            {estimatedAnnualRate}%
          </span>
        </div>
      </div>

      {/* Payment Direction Indicator */}
      <div className={`p-2 rounded text-xs flex items-center gap-2 ${
        isPositive
          ? 'bg-green-500/10 border border-green-500/20 text-green-400'
          : isNegative
          ? 'bg-red-500/10 border border-red-500/20 text-red-400'
          : 'bg-secondary text-muted-foreground'
      }`}>
        {isPositive ? (
          <TrendingUp className="h-3 w-3" />
        ) : isNegative ? (
          <TrendingDown className="h-3 w-3" />
        ) : null}
        <span>
          {isPositive
            ? 'Longs pay shorts'
            : isNegative
            ? 'Shorts pay longs'
            : 'Neutral funding'}
        </span>
      </div>

      {/* Historical Rates */}
      {showHistory && fundingInfo.hourlyRates.length > 0 && (
        <div className="space-y-2">
          <span className="text-xs text-muted-foreground">24h History</span>
          <div className="flex items-end gap-0.5 h-8">
            {fundingInfo.hourlyRates.slice(-24).map((rate, idx) => {
              const maxRate = Math.max(
                Math.abs(Math.min(...fundingInfo.hourlyRates)),
                Math.abs(Math.max(...fundingInfo.hourlyRates)),
                1
              );
              const height = Math.max(2, (Math.abs(rate) / maxRate) * 32);
              const isRatePositive = rate > 0;

              return (
                <div
                  key={idx}
                  className={`flex-1 rounded-t transition-all ${
                    isRatePositive ? 'bg-green-500/50' : rate < 0 ? 'bg-red-500/50' : 'bg-muted'
                  }`}
                  style={{ height: `${height}px` }}
                  title={`${(rate / 100).toFixed(4)}%`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>24h ago</span>
            <span>Now</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Funding rate summary for market ticker
export const FundingRateBadge: FC<{ rateBps: number }> = ({ rateBps }) => {
  const isPositive = rateBps > 0;
  const isNegative = rateBps < 0;
  const ratePercentage = (rateBps / 100).toFixed(4);

  return (
    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
      isPositive
        ? 'bg-green-500/20 text-green-500'
        : isNegative
        ? 'bg-red-500/20 text-red-500'
        : 'bg-secondary text-muted-foreground'
    }`}>
      {isPositive ? '+' : ''}{ratePercentage}%
    </span>
  );
};
