'use client';

/**
 * Dynamic Import Utilities
 *
 * Provides lazy loading helpers for heavy components to reduce
 * initial bundle size and improve Time to Interactive (TTI).
 */

import dynamic from 'next/dynamic';
import React, { ComponentType, lazy, Suspense, ReactNode } from 'react';

/**
 * Default loading fallback component
 */
export function LoadingFallback(): React.ReactElement {
  return (
    <div className="flex items-center justify-center p-4">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

/**
 * Skeleton loading component for charts
 */
export function ChartSkeleton(): React.ReactElement {
  return (
    <div className="animate-pulse">
      <div className="h-[300px] w-full rounded-lg bg-white/5" />
    </div>
  );
}

/**
 * Skeleton loading component for order book
 */
export function OrderBookSkeleton(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-2">
      <div className="h-6 w-full rounded bg-white/5" />
      <div className="h-6 w-3/4 rounded bg-white/5" />
      <div className="h-6 w-5/6 rounded bg-white/5" />
      <div className="h-6 w-2/3 rounded bg-white/5" />
    </div>
  );
}

/**
 * Skeleton loading component for trade form
 */
export function TradeFormSkeleton(): React.ReactElement {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-10 w-full rounded bg-white/5" />
      <div className="h-10 w-full rounded bg-white/5" />
      <div className="h-12 w-full rounded bg-white/5" />
    </div>
  );
}

/**
 * Create a lazy-loaded component with Next.js dynamic import
 */
export function createDynamicComponent<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>,
  options: {
    loadingComponent?: ComponentType;
    ssr?: boolean;
  } = {}
): ComponentType<P> {
  const { loadingComponent: Loading = LoadingFallback, ssr = false } = options;

  return dynamic(importFn, {
    loading: Loading as () => React.ReactElement | null,
    ssr,
  }) as ComponentType<P>;
}

/**
 * Lazy load with preload capability
 */
export function lazyWithPreload<P extends object>(
  importFn: () => Promise<{ default: ComponentType<P> }>
) {
  const LazyComponent = lazy(importFn);
  let preloadPromise: Promise<{ default: ComponentType<P> }> | null = null;

  const preload = () => {
    if (!preloadPromise) {
      preloadPromise = importFn();
    }
    return preloadPromise;
  };

  function Preload(): null {
    preload();
    return null;
  }

  function Component(props: P & { fallback?: ReactNode }): React.ReactElement {
    const fallback = (props as { fallback?: ReactNode }).fallback;
    return (
      <Suspense fallback={fallback ?? <LoadingFallback />}>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <LazyComponent {...(props as any)} />
      </Suspense>
    );
  }

  Component.preload = preload;
  Component.Preload = Preload;

  return Component;
}

/**
 * Preload multiple components in parallel
 */
export async function preloadComponents(
  importFns: Array<() => Promise<unknown>>
): Promise<void> {
  await Promise.all(importFns.map((fn) => fn()));
}

/**
 * Prefetch common routes/components on idle
 */
export function prefetchOnIdle(preloadFns: Array<() => void>): void {
  if (typeof window === 'undefined') return;

  const prefetch = () => {
    preloadFns.forEach((fn) => fn());
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(prefetch, { timeout: 2000 });
  } else {
    setTimeout(prefetch, 2000);
  }
}
