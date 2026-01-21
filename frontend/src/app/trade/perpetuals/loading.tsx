'use client';

import { Header } from '@/components/header';
import {
  SkeletonOrderBook,
  SkeletonTradingPanel,
  SkeletonChart,
} from '@/components/ui/skeleton';

/**
 * Loading state for the perpetuals trading page
 *
 * Shows skeleton loading states matching the perps layout
 */
export default function PerpetualsLoading() {
  return (
    <main className="h-screen flex flex-col bg-background">
      {/* Header */}
      <Header showMarketTicker />

      {/* Main Content - Trading terminal layout */}
      <div
        className="flex-1 flex overflow-hidden min-h-0"
        role="status"
        aria-label="Loading perpetuals trading interface"
        aria-busy="true"
      >
        {/* Left: Chart + Order Book + Bottom Tabs */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top: Chart + Order Book */}
          <div className="flex-1 flex overflow-hidden min-h-0">
            {/* Chart Skeleton */}
            <div className="flex-1 min-w-0 p-4">
              <SkeletonChart className="h-full" />
            </div>

            {/* Order Book Skeleton */}
            <div className="w-64 border-l border-border overflow-y-auto hidden lg:block p-3">
              <SkeletonOrderBook rows={12} />
            </div>
          </div>

          {/* Bottom Tabs Skeleton */}
          <div className="h-[200px] border-t border-border p-4">
            <div className="flex gap-4 mb-4">
              {['Positions', 'Orders', 'History', 'Funding'].map((tab) => (
                <div
                  key={tab}
                  className="h-8 w-20 rounded bg-white/10 animate-pulse"
                />
              ))}
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex justify-between py-2">
                  <div className="h-4 w-24 rounded bg-white/10 animate-pulse" />
                  <div className="h-4 w-16 rounded bg-white/10 animate-pulse" />
                  <div className="h-4 w-20 rounded bg-white/10 animate-pulse" />
                  <div className="h-4 w-16 rounded bg-white/10 animate-pulse" />
                  <div className="h-4 w-12 rounded bg-white/10 animate-pulse" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: Trading Panel Skeleton (with leverage) */}
        <div className="w-80 border-l border-border overflow-y-auto hidden md:block">
          <SkeletonTradingPanel />
        </div>
      </div>

      <span className="sr-only">Loading perpetuals trading interface, please wait...</span>
    </main>
  );
}
