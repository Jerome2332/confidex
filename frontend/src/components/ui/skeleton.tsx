'use client';

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
  'aria-label'?: string;
}

/**
 * Skeleton Loading Component
 *
 * Displays a pulsing placeholder while content is loading.
 * Follows Confidex monochrome design system.
 */
export function Skeleton({ className, 'aria-label': ariaLabel }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-white/10',
        className
      )}
      role="status"
      aria-label={ariaLabel || 'Loading'}
      aria-busy="true"
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

/**
 * Skeleton for text content
 */
export function SkeletonText({ lines = 1, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-busy="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            'h-4',
            i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'
          )}
        />
      ))}
      <span className="sr-only">Loading text content...</span>
    </div>
  );
}

/**
 * Skeleton for trading panel input
 */
export function SkeletonInput({ className }: { className?: string }) {
  return (
    <div className={cn('space-y-2', className)} role="status" aria-busy="true">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-12 w-full" />
      <span className="sr-only">Loading input field...</span>
    </div>
  );
}

/**
 * Skeleton for order book row
 */
export function SkeletonOrderRow({ className }: { className?: string }) {
  return (
    <div
      className={cn('flex items-center justify-between py-1', className)}
      role="status"
      aria-busy="true"
    >
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-16" />
      <Skeleton className="h-4 w-24" />
      <span className="sr-only">Loading order row...</span>
    </div>
  );
}

/**
 * Skeleton for order book component
 */
export function SkeletonOrderBook({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-1" role="status" aria-label="Loading order book" aria-busy="true">
      {/* Header */}
      <div className="flex items-center justify-between py-2 border-b border-white/10">
        <Skeleton className="h-3 w-12" />
        <Skeleton className="h-3 w-10" />
        <Skeleton className="h-3 w-14" />
      </div>

      {/* Sell orders */}
      {Array.from({ length: rows / 2 }).map((_, i) => (
        <SkeletonOrderRow key={`sell-${i}`} />
      ))}

      {/* Spread */}
      <div className="py-2 border-y border-white/10">
        <Skeleton className="h-5 w-24 mx-auto" />
      </div>

      {/* Buy orders */}
      {Array.from({ length: rows / 2 }).map((_, i) => (
        <SkeletonOrderRow key={`buy-${i}`} />
      ))}

      <span className="sr-only">Loading order book data...</span>
    </div>
  );
}

/**
 * Skeleton for trading panel
 */
export function SkeletonTradingPanel() {
  return (
    <div className="space-y-6 p-6" role="status" aria-label="Loading trading panel" aria-busy="true">
      {/* Tab selector */}
      <div className="flex gap-2">
        <Skeleton className="h-10 w-20 rounded-lg" />
        <Skeleton className="h-10 w-20 rounded-lg" />
      </div>

      {/* Input fields */}
      <SkeletonInput />
      <SkeletonInput />

      {/* Slider */}
      <Skeleton className="h-2 w-full rounded-full" />

      {/* Info rows */}
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>

      {/* Button */}
      <Skeleton className="h-12 w-full rounded-lg" />

      <span className="sr-only">Loading trading panel...</span>
    </div>
  );
}

/**
 * Skeleton for balance display
 */
export function SkeletonBalance() {
  return (
    <div className="flex items-center gap-3" role="status" aria-label="Loading balance" aria-busy="true">
      <Skeleton className="h-8 w-8 rounded-full" />
      <div className="space-y-1">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-32" />
      </div>
      <span className="sr-only">Loading balance...</span>
    </div>
  );
}

/**
 * Skeleton for chart area
 */
export function SkeletonChart({ className }: { className?: string }) {
  return (
    <div
      className={cn('relative', className)}
      role="status"
      aria-label="Loading chart"
      aria-busy="true"
    >
      {/* Chart placeholder */}
      <div className="h-full w-full bg-white/5 rounded-lg flex items-center justify-center">
        <div className="text-center">
          <Skeleton className="h-8 w-8 rounded-full mx-auto mb-2" />
          <Skeleton className="h-4 w-24 mx-auto" />
        </div>
      </div>

      {/* Fake axis labels */}
      <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-8" />
        ))}
      </div>

      <div className="absolute bottom-0 left-12 right-0 h-8 flex justify-between items-center px-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-3 w-10" />
        ))}
      </div>

      <span className="sr-only">Loading price chart...</span>
    </div>
  );
}

/**
 * Skeleton for position row
 */
export function SkeletonPositionRow() {
  return (
    <div
      className="flex items-center justify-between p-4 border-b border-white/10"
      role="status"
      aria-busy="true"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-lg" />
        <div className="space-y-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>
      <div className="text-right space-y-1">
        <Skeleton className="h-4 w-20 ml-auto" />
        <Skeleton className="h-3 w-12 ml-auto" />
      </div>
      <span className="sr-only">Loading position...</span>
    </div>
  );
}
