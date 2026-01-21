# PRD-006: Frontend UX & Accessibility

**Status:** Draft
**Priority:** HIGH
**Complexity:** Medium
**Estimated Effort:** 2-3 days

---

## Executive Summary

The frontend lacks error boundaries, loading states, accessibility compliance, and mobile responsiveness. This PRD implements production-grade UX with proper error handling, accessibility, and responsive design.

---

## Problem Statement

Current frontend UX gaps:

1. **No Error Boundaries** - Unhandled errors cause white screen of death
2. **Missing Loading States** - No feedback during data fetches
3. **Poor Accessibility** - Missing ARIA labels, keyboard navigation
4. **Not Mobile Responsive** - Trading interface unusable on mobile
5. **No Transaction Feedback** - Users don't know if orders succeeded

---

## Scope

### In Scope
- Global and page-level error boundaries
- Suspense boundaries with loading states
- ARIA labels and accessibility attributes
- Mobile-responsive trading interface
- Toast notifications for transactions

### Out of Scope
- Complete redesign
- i18n/localization
- Dark/light theme toggle (already implemented)

---

## Implementation Plan

### Task 1: Global Error Boundary

**New Files:**
- `frontend/src/app/error.tsx`
- `frontend/src/app/global-error.tsx`
- `frontend/src/components/error-boundary.tsx`

**Step 1.1: Next.js Error Boundary**

```typescript
// frontend/src/app/error.tsx
'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw, Home } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function Error({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log error to error reporting service
    console.error('[ErrorBoundary]', error);

    // Report to Sentry if configured
    if (typeof window !== 'undefined' && window.Sentry) {
      window.Sentry.captureException(error);
    }
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mb-6 flex justify-center">
          <div className="rounded-full bg-rose-500/20 p-4">
            <AlertTriangle size={48} className="text-rose-400" weight="light" />
          </div>
        </div>

        <h1 className="mb-2 text-2xl font-light text-white">
          Something went wrong
        </h1>

        <p className="mb-6 text-white/60">
          An unexpected error occurred. Our team has been notified.
        </p>

        {process.env.NODE_ENV === 'development' && (
          <pre className="mb-6 max-h-40 overflow-auto rounded-lg bg-white/5 p-4 text-left text-xs text-rose-400">
            {error.message}
            {error.stack && (
              <>
                {'\n\n'}
                {error.stack}
              </>
            )}
          </pre>
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button
            onClick={reset}
            className="inline-flex items-center gap-2"
            variant="default"
          >
            <RefreshCw size={16} />
            Try Again
          </Button>

          <Button
            onClick={() => window.location.href = '/'}
            variant="outline"
            className="inline-flex items-center gap-2"
          >
            <Home size={16} />
            Go Home
          </Button>
        </div>

        {error.digest && (
          <p className="mt-6 text-xs text-white/40">
            Error ID: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
```

**Step 1.2: Global Error Boundary (for root layout errors)**

```typescript
// frontend/src/app/global-error.tsx
'use client';

import { Inter } from 'next/font/google';
import { AlertTriangle, RefreshCw } from '@phosphor-icons/react';

const inter = Inter({ subsets: ['latin'] });

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-black text-white`}>
        <div className="flex min-h-screen flex-col items-center justify-center px-4">
          <div className="max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <div className="rounded-full bg-rose-500/20 p-4">
                <AlertTriangle size={48} className="text-rose-400" />
              </div>
            </div>

            <h1 className="mb-2 text-2xl font-light">
              Application Error
            </h1>

            <p className="mb-6 text-white/60">
              A critical error occurred. Please refresh the page.
            </p>

            <button
              onClick={reset}
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-black transition hover:bg-white/90"
            >
              <RefreshCw size={16} />
              Refresh Page
            </button>

            {error.digest && (
              <p className="mt-6 text-xs text-white/40">
                Error ID: {error.digest}
              </p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
```

**Step 1.3: Reusable Error Boundary Component**

```typescript
// frontend/src/components/error-boundary.tsx
'use client';

import { Component, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-white/10 bg-white/5 p-8">
          <AlertTriangle size={32} className="mb-4 text-rose-400" />
          <p className="mb-4 text-white/60">Something went wrong</p>
          <Button onClick={this.handleRetry} size="sm" variant="outline">
            <RefreshCw size={14} className="mr-2" />
            Retry
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

### Task 2: Loading States & Suspense

**New Files:**
- `frontend/src/app/loading.tsx`
- `frontend/src/components/loading-skeleton.tsx`
- `frontend/src/components/loading-spinner.tsx`

**Step 2.1: Global Loading State**

```typescript
// frontend/src/app/loading.tsx

import { Spinner } from '@phosphor-icons/react';

export default function Loading() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <Spinner size={48} className="animate-spin text-white/60" />
      <p className="mt-4 text-white/40">Loading...</p>
    </div>
  );
}
```

**Step 2.2: Loading Skeleton Components**

```typescript
// frontend/src/components/loading-skeleton.tsx

import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-lg bg-white/10',
        className
      )}
    />
  );
}

export function OrderBookSkeleton() {
  return (
    <div className="space-y-2 p-4">
      <div className="mb-4 flex justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
      {[...Array(8)].map((_, i) => (
        <div key={i} className="flex justify-between gap-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-24" />
        </div>
      ))}
    </div>
  );
}

export function TradingPanelSkeleton() {
  return (
    <div className="space-y-4 p-6">
      <div className="flex gap-2">
        <Skeleton className="h-10 flex-1" />
        <Skeleton className="h-10 flex-1" />
      </div>
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <div className="flex gap-2">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-8 flex-1" />
        ))}
      </div>
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

export function BalanceSkeleton() {
  return (
    <div className="space-y-3 p-4">
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

export function PositionsSkeleton() {
  return (
    <div className="space-y-3 p-4">
      <div className="flex justify-between text-sm text-white/40">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-16" />
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="flex justify-between">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}
```

**Step 2.3: Loading Spinner**

```typescript
// frontend/src/components/loading-spinner.tsx

import { cn } from '@/lib/utils';
import { Spinner } from '@phosphor-icons/react';

interface LoadingSpinnerProps {
  size?: number;
  className?: string;
  text?: string;
}

export function LoadingSpinner({
  size = 24,
  className,
  text,
}: LoadingSpinnerProps) {
  return (
    <div className={cn('flex items-center justify-center gap-2', className)}>
      <Spinner size={size} className="animate-spin text-white/60" />
      {text && <span className="text-white/60">{text}</span>}
    </div>
  );
}

export function FullPageLoader({ text = 'Loading...' }: { text?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="text-center">
        <Spinner size={48} className="mx-auto animate-spin text-white/60" />
        <p className="mt-4 text-white/40">{text}</p>
      </div>
    </div>
  );
}
```

---

### Task 3: Accessibility Improvements

**Files to Modify:**
- `frontend/src/components/trading-panel.tsx`
- `frontend/src/components/order-book.tsx`
- `frontend/src/components/header.tsx`

**Step 3.1: Trading Panel Accessibility**

```typescript
// frontend/src/components/trading-panel.tsx

// Add to the component:

export function TradingPanel() {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/5 p-6"
      role="region"
      aria-label="Trading panel"
    >
      {/* Side Selection */}
      <div
        role="tablist"
        aria-label="Order side"
        className="mb-6 flex gap-2"
      >
        <button
          role="tab"
          aria-selected={side === 'buy'}
          aria-controls="order-form"
          id="buy-tab"
          onClick={() => setSide('buy')}
          className={cn(
            'flex-1 rounded-lg py-3 font-medium transition',
            side === 'buy'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-white/5 text-white/60 hover:bg-white/10'
          )}
        >
          Buy
        </button>
        <button
          role="tab"
          aria-selected={side === 'sell'}
          aria-controls="order-form"
          id="sell-tab"
          onClick={() => setSide('sell')}
          className={cn(
            'flex-1 rounded-lg py-3 font-medium transition',
            side === 'sell'
              ? 'bg-rose-500/20 text-rose-400'
              : 'bg-white/5 text-white/60 hover:bg-white/10'
          )}
        >
          Sell
        </button>
      </div>

      {/* Order Form */}
      <form
        id="order-form"
        role="tabpanel"
        aria-labelledby={side === 'buy' ? 'buy-tab' : 'sell-tab'}
        onSubmit={handleSubmit}
        className="space-y-4"
      >
        {/* Price Input */}
        <div>
          <label
            htmlFor="price-input"
            className="mb-2 block text-sm text-white/60"
          >
            Price (USDC)
          </label>
          <input
            id="price-input"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="0.00"
            aria-describedby={priceError ? 'price-error' : undefined}
            aria-invalid={!!priceError}
            className={cn(
              'w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30',
              priceError ? 'border-rose-500' : 'border-white/10'
            )}
          />
          {priceError && (
            <p id="price-error" role="alert" className="mt-1 text-sm text-rose-400">
              {priceError}
            </p>
          )}
        </div>

        {/* Amount Input */}
        <div>
          <label
            htmlFor="amount-input"
            className="mb-2 block text-sm text-white/60"
          >
            Amount (SOL)
          </label>
          <input
            id="amount-input"
            type="number"
            inputMode="decimal"
            step="0.001"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.000"
            aria-describedby={amountError ? 'amount-error' : 'amount-hint'}
            aria-invalid={!!amountError}
            className={cn(
              'w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30',
              amountError ? 'border-rose-500' : 'border-white/10'
            )}
          />
          <p id="amount-hint" className="mt-1 text-sm text-white/40">
            Available: {availableBalance.toFixed(4)} SOL
          </p>
          {amountError && (
            <p id="amount-error" role="alert" className="mt-1 text-sm text-rose-400">
              {amountError}
            </p>
          )}
        </div>

        {/* Quick Amount Buttons */}
        <div
          role="group"
          aria-label="Quick amount selection"
          className="flex gap-2"
        >
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              onClick={() => setAmountPercent(pct)}
              aria-label={`Set amount to ${pct}% of available balance`}
              className="flex-1 rounded-lg bg-white/5 py-2 text-sm text-white/60 transition hover:bg-white/10"
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={!isValid || isSubmitting}
          aria-busy={isSubmitting}
          className={cn(
            'w-full rounded-lg py-4 font-medium transition',
            side === 'buy'
              ? 'bg-emerald-500 text-white hover:bg-emerald-600 disabled:bg-emerald-500/50'
              : 'bg-rose-500 text-white hover:bg-rose-600 disabled:bg-rose-500/50',
            'disabled:cursor-not-allowed'
          )}
        >
          {isSubmitting ? (
            <LoadingSpinner size={20} text="Placing order..." />
          ) : (
            `${side === 'buy' ? 'Buy' : 'Sell'} SOL`
          )}
        </button>
      </form>

      {/* Encryption Status - Screen Reader Announcement */}
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {isEncrypted ? 'Order values encrypted' : 'Encryption initializing'}
      </div>
    </div>
  );
}
```

**Step 3.2: Order Book Accessibility**

```typescript
// frontend/src/components/order-book.tsx

export function OrderBook({ data, onPriceClick }: OrderBookProps) {
  return (
    <div
      className="rounded-xl border border-white/10 bg-white/5"
      role="region"
      aria-label="Order book"
    >
      <div className="border-b border-white/10 p-4">
        <h2 className="font-medium text-white">Order Book</h2>
      </div>

      {/* Column Headers */}
      <div
        className="grid grid-cols-3 gap-4 border-b border-white/10 px-4 py-2 text-sm text-white/40"
        role="row"
        aria-label="Column headers"
      >
        <span role="columnheader">Price</span>
        <span role="columnheader" className="text-center">Size</span>
        <span role="columnheader" className="text-right">Total</span>
      </div>

      {/* Asks (Sell Orders) */}
      <div
        role="table"
        aria-label="Sell orders"
        className="divide-y divide-white/5"
      >
        {data.asks.slice(0, 8).reverse().map((ask, index) => (
          <button
            key={`ask-${index}`}
            role="row"
            onClick={() => onPriceClick?.(ask.price)}
            aria-label={`Sell order: ${ask.size} at $${ask.price}`}
            className="grid w-full grid-cols-3 gap-4 px-4 py-2 text-sm transition hover:bg-white/5"
          >
            <span role="cell" className="text-rose-400 tabular-nums">
              {ask.price.toFixed(2)}
            </span>
            <span role="cell" className="text-center tabular-nums text-white/80">
              {ask.size.toFixed(4)}
            </span>
            <span role="cell" className="text-right tabular-nums text-white/60">
              {ask.total.toFixed(4)}
            </span>
          </button>
        ))}
      </div>

      {/* Spread Indicator */}
      <div
        className="border-y border-white/10 bg-white/5 px-4 py-3"
        role="status"
        aria-label={`Spread: $${spread.toFixed(2)} (${spreadPercent.toFixed(2)}%)`}
      >
        <div className="flex items-center justify-between text-sm">
          <span className="text-white/40">Spread</span>
          <span className="font-mono text-white">
            ${spread.toFixed(2)} ({spreadPercent.toFixed(2)}%)
          </span>
        </div>
      </div>

      {/* Bids (Buy Orders) */}
      <div
        role="table"
        aria-label="Buy orders"
        className="divide-y divide-white/5"
      >
        {data.bids.slice(0, 8).map((bid, index) => (
          <button
            key={`bid-${index}`}
            role="row"
            onClick={() => onPriceClick?.(bid.price)}
            aria-label={`Buy order: ${bid.size} at $${bid.price}`}
            className="grid w-full grid-cols-3 gap-4 px-4 py-2 text-sm transition hover:bg-white/5"
          >
            <span role="cell" className="text-emerald-400 tabular-nums">
              {bid.price.toFixed(2)}
            </span>
            <span role="cell" className="text-center tabular-nums text-white/80">
              {bid.size.toFixed(4)}
            </span>
            <span role="cell" className="text-right tabular-nums text-white/60">
              {bid.total.toFixed(4)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

**Step 3.3: Skip Links and Focus Management**

```typescript
// frontend/src/components/skip-links.tsx

export function SkipLinks() {
  return (
    <div className="sr-only focus-within:not-sr-only">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-50 rounded-lg bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to main content
      </a>
      <a
        href="#trading-panel"
        className="fixed left-4 top-16 z-50 rounded-lg bg-white px-4 py-2 text-black focus:outline-none focus:ring-2 focus:ring-white"
      >
        Skip to trading
      </a>
    </div>
  );
}
```

---

### Task 4: Mobile Responsive Design

**Files to Modify:**
- `frontend/src/app/page.tsx`
- `frontend/src/components/trading-panel.tsx`
- `frontend/src/components/mobile-nav.tsx`

**Step 4.1: Responsive Trading Layout**

```typescript
// frontend/src/app/page.tsx

export default function TradingPage() {
  return (
    <main id="main-content" className="min-h-screen bg-black">
      <Header />

      {/* Desktop Layout */}
      <div className="hidden lg:block">
        <div className="mx-auto max-w-7xl px-4 py-6">
          <div className="grid grid-cols-12 gap-6">
            {/* Order Book */}
            <div className="col-span-3">
              <OrderBook />
            </div>

            {/* Chart */}
            <div className="col-span-6">
              <TradingChart />
            </div>

            {/* Trading Panel */}
            <div id="trading-panel" className="col-span-3">
              <TradingPanel />
            </div>
          </div>

          {/* Positions */}
          <div className="mt-6">
            <PositionsTable />
          </div>
        </div>
      </div>

      {/* Mobile Layout */}
      <div className="lg:hidden">
        <MobileTradingView />
      </div>
    </main>
  );
}
```

**Step 4.2: Mobile Trading View with Tabs**

```typescript
// frontend/src/components/mobile-trading-view.tsx
'use client';

import { useState } from 'react';
import { ChartLine, ListBullets, Scales, Wallet } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { TradingChart } from './trading-chart';
import { OrderBook } from './order-book';
import { TradingPanel } from './trading-panel';
import { PositionsTable } from './positions-table';
import { BalanceDisplay } from './balance-display';

type MobileTab = 'chart' | 'book' | 'trade' | 'positions';

export function MobileTradingView() {
  const [activeTab, setActiveTab] = useState<MobileTab>('trade');

  const tabs = [
    { id: 'chart' as const, icon: ChartLine, label: 'Chart' },
    { id: 'book' as const, icon: ListBullets, label: 'Book' },
    { id: 'trade' as const, icon: Scales, label: 'Trade' },
    { id: 'positions' as const, icon: Wallet, label: 'Positions' },
  ];

  return (
    <div className="flex h-[calc(100vh-64px)] flex-col">
      {/* Content Area */}
      <div className="flex-1 overflow-auto px-4 py-4">
        {activeTab === 'chart' && <TradingChart className="h-full" />}
        {activeTab === 'book' && <OrderBook />}
        {activeTab === 'trade' && (
          <div className="space-y-4">
            <BalanceDisplay />
            <TradingPanel />
          </div>
        )}
        {activeTab === 'positions' && <PositionsTable />}
      </div>

      {/* Bottom Navigation */}
      <nav
        className="border-t border-white/10 bg-black/90 backdrop-blur-lg"
        role="navigation"
        aria-label="Mobile navigation"
      >
        <div className="flex">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1 py-3 transition',
                  isActive
                    ? 'text-white'
                    : 'text-white/40 hover:text-white/60'
                )}
              >
                <Icon size={24} weight={isActive ? 'fill' : 'regular'} />
                <span className="text-xs">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Safe area padding for iOS */}
        <div className="h-safe-area-inset-bottom bg-black" />
      </nav>
    </div>
  );
}
```

**Step 4.3: Mobile-Responsive Trading Panel**

```typescript
// frontend/src/components/trading-panel.tsx

// Add responsive classes:

export function TradingPanel({ className }: { className?: string }) {
  return (
    <div className={cn(
      'rounded-xl border border-white/10 bg-white/5',
      // Mobile: Full width, less padding
      'p-4 sm:p-6',
      className
    )}>
      {/* Side Selection - Stack on small screens */}
      <div className="mb-4 flex gap-2 sm:mb-6">
        {/* ... buttons ... */}
      </div>

      <form className="space-y-3 sm:space-y-4">
        {/* Inputs stack normally */}
        <div>
          <label className="mb-1 block text-sm text-white/60 sm:mb-2">
            Price (USDC)
          </label>
          <input
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-white sm:px-4 sm:py-3"
            // ... other props
          />
        </div>

        {/* Quick Amount - 2 columns on mobile */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[25, 50, 75, 100].map((pct) => (
            <button
              key={pct}
              type="button"
              className="rounded-lg bg-white/5 py-2 text-sm text-white/60"
            >
              {pct}%
            </button>
          ))}
        </div>

        {/* Submit - Full width, slightly smaller on mobile */}
        <button
          type="submit"
          className="w-full rounded-lg py-3 font-medium sm:py-4"
        >
          {side === 'buy' ? 'Buy' : 'Sell'} SOL
        </button>
      </form>
    </div>
  );
}
```

---

### Task 5: Toast Notifications

**New Files:**
- `frontend/src/components/toast-provider.tsx`
- `frontend/src/hooks/use-toast.ts`

**Step 5.1: Toast Provider**

```typescript
// frontend/src/components/toast-provider.tsx
'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { X, CheckCircle, Warning, Info, XCircle } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number;
}

interface ToastContextValue {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
  success: (title: string, message?: string) => string;
  error: (title: string, message?: string) => string;
  warning: (title: string, message?: string) => string;
  info: (title: string, message?: string) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    const duration = toast.duration ?? 5000;

    setToasts((prev) => [...prev, { ...toast, id }]);

    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }

    return id;
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const success = useCallback(
    (title: string, message?: string) => addToast({ type: 'success', title, message }),
    [addToast]
  );

  const error = useCallback(
    (title: string, message?: string) => addToast({ type: 'error', title, message }),
    [addToast]
  );

  const warning = useCallback(
    (title: string, message?: string) => addToast({ type: 'warning', title, message }),
    [addToast]
  );

  const info = useCallback(
    (title: string, message?: string) => addToast({ type: 'info', title, message }),
    [addToast]
  );

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
      {children}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

function ToastContainer({
  toasts,
  removeToast,
}: {
  toasts: Toast[];
  removeToast: (id: string) => void;
}) {
  const icons = {
    success: CheckCircle,
    error: XCircle,
    warning: Warning,
    info: Info,
  };

  const colors = {
    success: 'border-emerald-500/30 bg-emerald-500/10',
    error: 'border-rose-500/30 bg-rose-500/10',
    warning: 'border-amber-500/30 bg-amber-500/10',
    info: 'border-blue-500/30 bg-blue-500/10',
  };

  const iconColors = {
    success: 'text-emerald-400',
    error: 'text-rose-400',
    warning: 'text-amber-400',
    info: 'text-blue-400',
  };

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 sm:bottom-6 sm:right-6"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => {
          const Icon = icons[toast.type];

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={cn(
                'pointer-events-auto flex w-80 items-start gap-3 rounded-xl border p-4 shadow-lg backdrop-blur-lg sm:w-96',
                colors[toast.type]
              )}
              role="alert"
            >
              <Icon size={24} className={iconColors[toast.type]} weight="fill" />

              <div className="flex-1 min-w-0">
                <p className="font-medium text-white">{toast.title}</p>
                {toast.message && (
                  <p className="mt-1 text-sm text-white/60">{toast.message}</p>
                )}
                {toast.action && (
                  <button
                    onClick={toast.action.onClick}
                    className="mt-2 text-sm font-medium text-white underline underline-offset-2"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="text-white/40 transition hover:text-white"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
```

**Step 5.2: Transaction Toast Usage**

```typescript
// frontend/src/components/trading-panel.tsx

import { useToast } from '@/components/toast-provider';

export function TradingPanel() {
  const toast = useToast();

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);

      // Encrypt and submit order
      const signature = await placeOrder(/* ... */);

      toast.success('Order Placed', `Transaction: ${signature.slice(0, 8)}...`);

      // Reset form
      setPrice('');
      setAmount('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';

      if (message.includes('User rejected')) {
        toast.warning('Transaction Cancelled', 'You rejected the transaction');
      } else {
        toast.error('Order Failed', message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };
}
```

---

## Acceptance Criteria

- [ ] **Error Boundaries**
  - [ ] Page-level error boundary catches component errors
  - [ ] Global error boundary catches root layout errors
  - [ ] Errors logged to console and Sentry (if configured)
  - [ ] Retry button attempts to recover
  - [ ] Error ID displayed for support

- [ ] **Loading States**
  - [ ] Global loading state shows spinner
  - [ ] Order book has skeleton loader
  - [ ] Trading panel has skeleton loader
  - [ ] Positions table has skeleton loader
  - [ ] Loading states are accessible (aria-busy)

- [ ] **Accessibility**
  - [ ] All interactive elements have accessible names
  - [ ] Form inputs have associated labels
  - [ ] Error messages announced to screen readers
  - [ ] Keyboard navigation works throughout
  - [ ] Skip links allow bypassing navigation
  - [ ] Color contrast meets WCAG AA

- [ ] **Mobile Responsive**
  - [ ] Trading interface usable on 375px width
  - [ ] Bottom navigation for mobile
  - [ ] Touch targets minimum 44x44px
  - [ ] No horizontal scroll on mobile
  - [ ] Safe area insets respected on iOS

- [ ] **Toast Notifications**
  - [ ] Success toast on order placement
  - [ ] Error toast on failures
  - [ ] Toast auto-dismisses after 5 seconds
  - [ ] Toast can be manually dismissed
  - [ ] Toasts announced to screen readers

---

## Testing Checklist

```bash
# Accessibility testing
npx pa11y http://localhost:3000

# Lighthouse accessibility audit
npx lighthouse http://localhost:3000 --only-categories=accessibility

# Mobile responsive testing
# Open Chrome DevTools -> Toggle device toolbar
# Test at: 375px (iPhone SE), 390px (iPhone 14), 768px (iPad)
```

---

## References

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [Next.js Error Handling](https://nextjs.org/docs/app/building-your-application/routing/error-handling)
- [Radix UI Accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility)
- [Tailwind Responsive Design](https://tailwindcss.com/docs/responsive-design)
