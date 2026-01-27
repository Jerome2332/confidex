/**
 * Performance Monitoring Utilities
 *
 * Tracks Core Web Vitals and custom performance metrics.
 * Reports to console in development, can be extended to send to analytics.
 *
 * Metrics tracked:
 * - FCP (First Contentful Paint)
 * - LCP (Largest Contentful Paint)
 * - FID (First Input Delay)
 * - CLS (Cumulative Layout Shift)
 * - TTFB (Time to First Byte)
 * - Custom interaction metrics
 */

type MetricName = 'FCP' | 'LCP' | 'FID' | 'CLS' | 'TTFB' | 'INP';

interface Metric {
  name: MetricName | string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta?: number;
  id?: string;
}

// Thresholds for Core Web Vitals (in ms, except CLS which is unitless)
const THRESHOLDS: Record<MetricName, { good: number; poor: number }> = {
  FCP: { good: 1800, poor: 3000 },
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  TTFB: { good: 800, poor: 1800 },
  INP: { good: 200, poor: 500 },
};

/**
 * Get rating for a metric value
 */
function getRating(name: MetricName, value: number): 'good' | 'needs-improvement' | 'poor' {
  const threshold = THRESHOLDS[name];
  if (!threshold) return 'good';

  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

/**
 * Report a metric (logs in dev, can be extended for analytics)
 */
function reportMetric(metric: Metric): void {
  if (process.env.NODE_ENV === 'development') {
    const emoji = metric.rating === 'good' ? '✅' : metric.rating === 'needs-improvement' ? '⚠️' : '❌';
    console.log(
      `${emoji} [Performance] ${metric.name}: ${metric.value.toFixed(2)}${metric.name === 'CLS' ? '' : 'ms'} (${metric.rating})`
    );
  }

  // In production, send to analytics service
  // Example: sendToAnalytics(metric);
}

/**
 * Initialize Core Web Vitals reporting
 * Uses the web-vitals library pattern with native APIs
 */
export function initWebVitals(): void {
  if (typeof window === 'undefined') return;

  // First Contentful Paint (FCP)
  observePaint('first-contentful-paint', (entry) => {
    reportMetric({
      name: 'FCP',
      value: entry.startTime,
      rating: getRating('FCP', entry.startTime),
    });
  });

  // Largest Contentful Paint (LCP)
  observeLCP((value) => {
    reportMetric({
      name: 'LCP',
      value,
      rating: getRating('LCP', value),
    });
  });

  // First Input Delay (FID)
  observeFID((value) => {
    reportMetric({
      name: 'FID',
      value,
      rating: getRating('FID', value),
    });
  });

  // Cumulative Layout Shift (CLS)
  observeCLS((value) => {
    reportMetric({
      name: 'CLS',
      value,
      rating: getRating('CLS', value),
    });
  });

  // Time to First Byte (TTFB)
  observeTTFB((value) => {
    reportMetric({
      name: 'TTFB',
      value,
      rating: getRating('TTFB', value),
    });
  });
}

/**
 * Observe paint timing entries
 */
function observePaint(
  name: string,
  callback: (entry: PerformanceEntry) => void
): void {
  if (!('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name === name) {
          callback(entry);
          observer.disconnect();
        }
      }
    });
    observer.observe({ type: 'paint', buffered: true });
  } catch {
    // Silent fail if not supported
  }
}

/**
 * Observe Largest Contentful Paint
 */
function observeLCP(callback: (value: number) => void): void {
  if (!('PerformanceObserver' in window)) return;

  try {
    let lcpValue = 0;
    const observer = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const lastEntry = entries[entries.length - 1];
      lcpValue = lastEntry.startTime;
    });
    observer.observe({ type: 'largest-contentful-paint', buffered: true });

    // Report on visibility change or page hide
    const reportLCP = () => {
      if (lcpValue > 0) {
        callback(lcpValue);
        observer.disconnect();
      }
    };

    document.addEventListener('visibilitychange', reportLCP, { once: true });
    document.addEventListener('pagehide', reportLCP, { once: true });
  } catch {
    // Silent fail if not supported
  }
}

/**
 * Observe First Input Delay
 */
function observeFID(callback: (value: number) => void): void {
  if (!('PerformanceObserver' in window)) return;

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const fidEntry = entry as PerformanceEventTiming;
        callback(fidEntry.processingStart - fidEntry.startTime);
        observer.disconnect();
      }
    });
    observer.observe({ type: 'first-input', buffered: true });
  } catch {
    // Silent fail if not supported
  }
}

/**
 * Observe Cumulative Layout Shift
 */
function observeCLS(callback: (value: number) => void): void {
  if (!('PerformanceObserver' in window)) return;

  try {
    let clsValue = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const layoutShift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        if (!layoutShift.hadRecentInput) {
          clsValue += layoutShift.value;
        }
      }
    });
    observer.observe({ type: 'layout-shift', buffered: true });

    // Report on visibility change or page hide
    const reportCLS = () => {
      callback(clsValue);
      observer.disconnect();
    };

    document.addEventListener('visibilitychange', reportCLS, { once: true });
    document.addEventListener('pagehide', reportCLS, { once: true });
  } catch {
    // Silent fail if not supported
  }
}

/**
 * Observe Time to First Byte
 */
function observeTTFB(callback: (value: number) => void): void {
  try {
    const navEntry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navEntry) {
      callback(navEntry.responseStart - navEntry.requestStart);
    }
  } catch {
    // Silent fail if not supported
  }
}

/**
 * Custom timing marker
 * Use to measure specific interactions
 */
export function markTiming(name: string): void {
  if (typeof performance !== 'undefined') {
    performance.mark(name);
  }
}

/**
 * Measure time between two marks
 */
export function measureTiming(
  name: string,
  startMark: string,
  endMark: string
): number | null {
  if (typeof performance === 'undefined') return null;

  try {
    performance.measure(name, startMark, endMark);
    const entries = performance.getEntriesByName(name, 'measure');
    if (entries.length > 0) {
      return entries[0].duration;
    }
  } catch {
    // Marks may not exist
  }

  return null;
}

/**
 * Track a custom interaction timing
 */
export function trackInteraction(
  name: string,
  duration: number,
  metadata?: Record<string, unknown>
): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[Interaction] ${name}: ${duration.toFixed(2)}ms`, metadata);
  }

  // In production, send to analytics
  // Example: sendToAnalytics({ name, duration, ...metadata });
}

/**
 * Higher-order function to measure async operation duration
 */
export function withTiming<T>(
  name: string,
  fn: () => Promise<T>
): () => Promise<T> {
  return async () => {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      trackInteraction(name, duration, { success: true });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      trackInteraction(name, duration, { success: false, error });
      throw error;
    }
  };
}

// Type augmentation for PerformanceEventTiming
interface PerformanceEventTiming extends PerformanceEntry {
  processingStart: number;
}
