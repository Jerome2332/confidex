'use client';

import { Header } from '@/components/header';
import { MarketCardSkeleton } from '@/components/market-card';

/**
 * Loading state for the prediction markets page
 *
 * Shows skeleton loading states for market cards and filters
 */
export default function PredictLoading() {
  return (
    <main className="min-h-screen bg-black">
      <Header />

      <div
        className="container mx-auto px-4 py-8"
        role="status"
        aria-label="Loading prediction markets"
        aria-busy="true"
      >
        {/* Page header skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 w-48 rounded bg-white/10 animate-pulse" />
          <div className="h-10 w-36 rounded-lg bg-white/10 animate-pulse" />
        </div>

        {/* Search bar skeleton */}
        <div className="mb-6">
          <div className="h-12 w-full rounded-xl bg-white/5 border border-white/10 animate-pulse" />
        </div>

        {/* Filter bar skeleton */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex flex-wrap items-center gap-2">
            {['All', 'Crypto', 'Tech', 'Sports', 'Politics'].map((_, i) => (
              <div
                key={i}
                className="h-10 w-20 rounded-lg bg-white/10 animate-pulse"
              />
            ))}
          </div>
          <div className="h-10 w-36 rounded-lg bg-white/10 animate-pulse" />
        </div>

        {/* Markets grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(6)].map((_, i) => (
            <MarketCardSkeleton key={i} />
          ))}
        </div>

        <span className="sr-only">Loading prediction markets, please wait...</span>
      </div>
    </main>
  );
}
