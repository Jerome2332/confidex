'use client';

import Link from 'next/link';
import { Clock, Lightning, TrendUp, TrendDown } from '@phosphor-icons/react';
import {
  categorizeMarket,
  getCategoryLabel,
  formatTimeRemaining,
  type MarketCategory,
} from '@/lib/market-categories';
import type { PredictionMarket } from '@/lib/pnp';

interface MarketCardProps {
  market: PredictionMarket;
  className?: string;
}

/**
 * Category badge component
 */
function CategoryBadge({ category }: { category: MarketCategory }) {
  const label = getCategoryLabel(category);

  const colorMap: Record<MarketCategory, string> = {
    crypto: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
    politics: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
    tech: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
    sports: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
    other: 'bg-white/10 text-white/60 border-white/20',
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${colorMap[category]}`}
    >
      {label}
    </span>
  );
}

/**
 * Probability bar component
 */
function ProbabilityBar({ yesPercent }: { yesPercent: number }) {
  return (
    <div className="relative h-2 bg-white/10 rounded-full overflow-hidden">
      <div
        className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/80 to-emerald-400/60 rounded-full transition-all duration-300"
        style={{ width: `${yesPercent}%` }}
      />
    </div>
  );
}

/**
 * Market card component for the prediction markets list
 * Navigates to the market detail page when clicked
 */
export function MarketCard({ market, className = '' }: MarketCardProps) {
  const category = categorizeMarket(market.question);
  const yesPercent = market.yesToken.price * 100;
  const noPercent = market.noToken.price * 100;
  const timeRemaining = formatTimeRemaining(market.endTime);

  return (
    <Link
      href={`/predict/${market.id.toBase58()}`}
      className={`block group ${className}`}
    >
      <div className="border border-white/10 rounded-xl p-4 transition-all duration-200 hover:border-white/25 hover:bg-white/[0.02] group-focus-visible:ring-2 group-focus-visible:ring-white/30 group-focus-visible:border-white/30">
        {/* Header with category and time */}
        <div className="flex items-center justify-between mb-3">
          <CategoryBadge category={category} />
          <div
            className={`flex items-center gap-1 text-xs ${
              timeRemaining.urgent ? 'text-amber-400' : 'text-white/40'
            }`}
          >
            {timeRemaining.urgent && <Lightning size={12} />}
            <Clock size={12} />
            <span>{timeRemaining.text}</span>
          </div>
        </div>

        {/* Question */}
        <h3 className="font-normal text-white mb-4 line-clamp-2 group-hover:text-white/90">
          {market.question}
        </h3>

        {/* Probability bar */}
        <div className="mb-3">
          <ProbabilityBar yesPercent={yesPercent} />
        </div>

        {/* Price indicators */}
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <TrendUp size={16} className="text-emerald-400/80" />
              <span className="text-emerald-400/80 font-medium">
                {yesPercent.toFixed(1)}%
              </span>
              <span className="text-white/30 text-xs">YES</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendDown size={16} className="text-rose-400/80" />
              <span className="text-rose-400/80 font-medium">
                {noPercent.toFixed(1)}%
              </span>
              <span className="text-white/30 text-xs">NO</span>
            </div>
          </div>

          {/* Liquidity indicator (if available) */}
          {market.totalLiquidity > 0 && (
            <span className="text-xs text-white/30">
              ${(Number(market.totalLiquidity) / 1e6).toLocaleString()} liq
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Market card skeleton for loading states
 */
export function MarketCardSkeleton() {
  return (
    <div className="border border-white/10 rounded-xl p-4 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-3">
        <div className="h-5 w-16 bg-white/10 rounded-full" />
        <div className="h-4 w-20 bg-white/10 rounded" />
      </div>

      {/* Question skeleton */}
      <div className="space-y-2 mb-4">
        <div className="h-4 w-full bg-white/10 rounded" />
        <div className="h-4 w-3/4 bg-white/10 rounded" />
      </div>

      {/* Bar skeleton */}
      <div className="h-2 w-full bg-white/10 rounded-full mb-3" />

      {/* Prices skeleton */}
      <div className="flex items-center gap-4">
        <div className="h-4 w-16 bg-white/10 rounded" />
        <div className="h-4 w-16 bg-white/10 rounded" />
      </div>
    </div>
  );
}

/**
 * Compact market card for smaller lists
 */
export function MarketCardCompact({ market, className = '' }: MarketCardProps) {
  const yesPercent = market.yesToken.price * 100;
  const timeRemaining = formatTimeRemaining(market.endTime);

  return (
    <Link
      href={`/predict/${market.id.toBase58()}`}
      className={`block group ${className}`}
    >
      <div className="flex items-center justify-between p-3 border border-white/10 rounded-lg hover:border-white/20 hover:bg-white/[0.02] transition-colors">
        <div className="flex-1 min-w-0 mr-4">
          <p className="text-sm text-white truncate group-hover:text-white/90">
            {market.question}
          </p>
          <p
            className={`text-xs mt-0.5 ${
              timeRemaining.urgent ? 'text-amber-400' : 'text-white/40'
            }`}
          >
            {timeRemaining.text} left
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-sm font-medium text-emerald-400/80">
            {yesPercent.toFixed(0)}%
          </span>
          <span className="text-xs text-white/30">YES</span>
        </div>
      </div>
    </Link>
  );
}
