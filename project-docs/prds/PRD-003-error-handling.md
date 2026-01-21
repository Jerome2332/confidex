# PRD-003: Error Handling & Resilience

**Status:** Draft
**Priority:** CRITICAL
**Complexity:** Medium
**Estimated Effort:** 2 days

---

## Executive Summary

Error handling is inconsistent across the codebase with silent failures, missing retry logic, and no alerting on critical failures. This PRD implements standardized error handling, exponential backoff retries, circuit breaker alerting, and comprehensive error classification.

---

## Problem Statement

Current error handling has critical gaps:

1. **Inconsistent Retry Logic** - Some operations retry infinitely, others don't retry at all
2. **Silent Failures** - Errors caught and logged but not propagated or alerted
3. **No Circuit Breaker Alerts** - Service can fail silently for hours
4. **Unbounded Retries** - Some operations retry forever without timeout
5. **Missing Error Classification** - All errors treated the same regardless of type

---

## Scope

### In Scope
- Exponential backoff with jitter for all retries
- Circuit breaker alerting (Slack/webhook)
- Bounded retry attempts by time (max 30s)
- Comprehensive error classification
- Request timeout handling

### Out of Scope
- Full observability stack (PRD-008)
- Distributed tracing (future)
- Error reporting UI

---

## Current State Analysis

### 1. Inconsistent Retry Logic

**File:** `backend/src/crank/match-executor.ts`

```typescript
// Lines 161-197 - Unbounded retry loop
async executeMatchWithRetry(buyOrder: PublicKey, sellOrder: PublicKey) {
  let retries = 0;
  while (retries < 10) {  // Fixed retry count, no time bound
    try {
      return await this.executeMatch(buyOrder, sellOrder);
    } catch (err) {
      retries++;
      // No exponential backoff
      await new Promise(r => setTimeout(r, 1000));  // Fixed 1s delay
      // Non-retryable errors still retry
    }
  }
}
```

### 2. Silent Failures

**File:** `backend/src/crank/mpc-poller.ts`

```typescript
// Lines 423-503 - Errors caught but not alerted
async pollForCallbacks() {
  try {
    const callbacks = await this.fetchPendingCallbacks();
    // ... process callbacks
  } catch (err) {
    console.error('[MpcPoller] Error:', err);
    // Silent failure - no alert, no metric, no recovery
  }
}
```

### 3. No Circuit Breaker Alerts

**File:** `backend/src/crank/index.ts`

```typescript
// Lines 350-361 - Circuit breaker trips silently
if (this.consecutiveErrors >= this.config.errorThreshold) {
  this.isPaused = true;
  console.error('[Crank] Circuit breaker tripped!');
  // No external notification - could be down for hours unnoticed
}
```

---

## Implementation Plan

### Task 1: Create Retry Utilities

**New Files:**
- `backend/src/lib/retry.ts`

**Step 1.1: Implement Exponential Backoff with Jitter**

```typescript
// backend/src/lib/retry.ts

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 5) */
  maxAttempts?: number;
  /** Maximum total time to spend retrying in ms (default: 30000) */
  maxTimeMs?: number;
  /** Initial delay between retries in ms (default: 100) */
  initialDelayMs?: number;
  /** Maximum delay between retries in ms (default: 10000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Random jitter factor 0-1 (default: 0.2) */
  jitterFactor?: number;
  /** Function to determine if error is retryable */
  isRetryable?: (error: Error) => boolean;
  /** Called on each retry attempt */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

export interface RetryResult<T> {
  success: boolean;
  value?: T;
  error?: Error;
  attempts: number;
  totalTimeMs: number;
}

/**
 * Default retryable error check
 */
export function isRetryableError(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Network/connection errors
  if (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network') ||
    message.includes('socket')
  ) {
    return true;
  }

  // Rate limiting
  if (message.includes('429') || message.includes('rate limit')) {
    return true;
  }

  // Temporary server errors
  if (
    message.includes('503') ||
    message.includes('502') ||
    message.includes('504') ||
    message.includes('service unavailable')
  ) {
    return true;
  }

  // Solana-specific retryable errors
  if (
    message.includes('blockhash not found') ||
    message.includes('slot skipped') ||
    message.includes('node is behind')
  ) {
    return true;
  }

  return false;
}

/**
 * Non-retryable Solana errors
 */
export function isSolanaFatalError(error: Error): boolean {
  const message = error.message.toLowerCase();

  return (
    message.includes('insufficient funds') ||
    message.includes('account not found') ||
    message.includes('invalid account owner') ||
    message.includes('custom program error') ||
    message.includes('0x1') // Generic Anchor error
  );
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitterFactor: number
): number {
  // Exponential backoff
  const exponentialDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);

  return Math.max(0, Math.round(cappedDelay + jitter));
}

/**
 * Retry a function with exponential backoff and jitter
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxAttempts = 5,
    maxTimeMs = 30000,
    initialDelayMs = 100,
    maxDelayMs = 10000,
    backoffMultiplier = 2,
    jitterFactor = 0.2,
    isRetryable = isRetryableError,
    onRetry,
  } = options;

  const startTime = Date.now();
  let lastError: Error | undefined;
  let attempt = 0;

  while (attempt < maxAttempts) {
    attempt++;

    // Check total time bound
    const elapsedMs = Date.now() - startTime;
    if (elapsedMs >= maxTimeMs) {
      return {
        success: false,
        error: lastError || new Error('Retry timeout exceeded'),
        attempts: attempt,
        totalTimeMs: elapsedMs,
      };
    }

    try {
      const value = await fn();
      return {
        success: true,
        value,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (err) {
      lastError = err as Error;

      // Check if error is retryable
      if (!isRetryable(lastError)) {
        return {
          success: false,
          error: lastError,
          attempts: attempt,
          totalTimeMs: Date.now() - startTime,
        };
      }

      // Don't wait after last attempt
      if (attempt < maxAttempts) {
        const delayMs = calculateDelay(
          attempt,
          initialDelayMs,
          maxDelayMs,
          backoffMultiplier,
          jitterFactor
        );

        // Check if delay would exceed time bound
        if (Date.now() - startTime + delayMs > maxTimeMs) {
          return {
            success: false,
            error: lastError,
            attempts: attempt,
            totalTimeMs: Date.now() - startTime,
          };
        }

        // Notify retry callback
        if (onRetry) {
          onRetry(lastError, attempt, delayMs);
        }

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }

  return {
    success: false,
    error: lastError || new Error('Max retry attempts exceeded'),
    attempts: attempt,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Retry decorator for class methods
 */
export function Retry(options: RetryOptions = {}) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      const result = await withRetry(
        () => originalMethod.apply(this, args),
        options
      );

      if (!result.success) {
        throw result.error;
      }

      return result.value;
    };

    return descriptor;
  };
}
```

---

### Task 2: Create Alerting System

**New Files:**
- `backend/src/lib/alerts.ts`

**Step 2.1: Implement Alert Manager**

```typescript
// backend/src/lib/alerts.ts

import fetch from 'node-fetch';

export type AlertSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface Alert {
  severity: AlertSeverity;
  title: string;
  message: string;
  component: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AlertChannel {
  name: string;
  send(alert: Alert): Promise<boolean>;
}

/**
 * Slack webhook channel
 */
export class SlackChannel implements AlertChannel {
  name = 'slack';

  constructor(private webhookUrl: string) {}

  async send(alert: Alert): Promise<boolean> {
    const emoji = {
      info: ':information_source:',
      warning: ':warning:',
      error: ':x:',
      critical: ':rotating_light:',
    }[alert.severity];

    const color = {
      info: '#36a64f',
      warning: '#ffcc00',
      error: '#ff0000',
      critical: '#8b0000',
    }[alert.severity];

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attachments: [{
            color,
            blocks: [
              {
                type: 'header',
                text: {
                  type: 'plain_text',
                  text: `${emoji} ${alert.title}`,
                  emoji: true,
                },
              },
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: alert.message,
                },
              },
              {
                type: 'context',
                elements: [
                  {
                    type: 'mrkdwn',
                    text: `*Component:* ${alert.component} | *Severity:* ${alert.severity.toUpperCase()}`,
                  },
                  {
                    type: 'mrkdwn',
                    text: `*Time:* ${new Date(alert.timestamp).toISOString()}`,
                  },
                ],
              },
            ],
          }],
        }),
      });

      return response.ok;
    } catch (err) {
      console.error('[Alert] Failed to send Slack alert:', err);
      return false;
    }
  }
}

/**
 * Generic webhook channel
 */
export class WebhookChannel implements AlertChannel {
  name = 'webhook';

  constructor(
    private url: string,
    private headers: Record<string, string> = {}
  ) {}

  async send(alert: Alert): Promise<boolean> {
    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(alert),
      });

      return response.ok;
    } catch (err) {
      console.error('[Alert] Failed to send webhook alert:', err);
      return false;
    }
  }
}

/**
 * Console/log channel (for development)
 */
export class ConsoleChannel implements AlertChannel {
  name = 'console';

  async send(alert: Alert): Promise<boolean> {
    const prefix = {
      info: '\x1b[34m[INFO]\x1b[0m',
      warning: '\x1b[33m[WARN]\x1b[0m',
      error: '\x1b[31m[ERROR]\x1b[0m',
      critical: '\x1b[35m[CRITICAL]\x1b[0m',
    }[alert.severity];

    console.log(
      `${prefix} [${alert.component}] ${alert.title}: ${alert.message}`
    );

    return true;
  }
}

/**
 * Alert Manager - handles routing alerts to channels
 */
export class AlertManager {
  private channels: AlertChannel[] = [];
  private alertHistory: Alert[] = [];
  private deduplicationWindow = 60000; // 1 minute

  constructor() {
    // Always add console channel
    this.addChannel(new ConsoleChannel());
  }

  addChannel(channel: AlertChannel): void {
    this.channels.push(channel);
    console.log(`[AlertManager] Added channel: ${channel.name}`);
  }

  /**
   * Send alert to all channels
   */
  async alert(
    severity: AlertSeverity,
    title: string,
    message: string,
    component: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const alert: Alert = {
      severity,
      title,
      message,
      component,
      timestamp: Date.now(),
      metadata,
    };

    // Deduplicate recent alerts
    if (this.isDuplicate(alert)) {
      console.log(`[AlertManager] Suppressed duplicate alert: ${title}`);
      return;
    }

    this.alertHistory.push(alert);
    this.cleanupHistory();

    // Send to all channels in parallel
    const results = await Promise.allSettled(
      this.channels.map(channel => channel.send(alert))
    );

    const failures = results.filter(r => r.status === 'rejected' || !r.value);
    if (failures.length > 0) {
      console.error(`[AlertManager] ${failures.length} channel(s) failed to send alert`);
    }
  }

  private isDuplicate(alert: Alert): boolean {
    const cutoff = Date.now() - this.deduplicationWindow;

    return this.alertHistory.some(
      prev =>
        prev.title === alert.title &&
        prev.component === alert.component &&
        prev.severity === alert.severity &&
        prev.timestamp > cutoff
    );
  }

  private cleanupHistory(): void {
    const cutoff = Date.now() - this.deduplicationWindow;
    this.alertHistory = this.alertHistory.filter(a => a.timestamp > cutoff);
  }

  // Convenience methods
  info(title: string, message: string, component: string): Promise<void> {
    return this.alert('info', title, message, component);
  }

  warning(title: string, message: string, component: string): Promise<void> {
    return this.alert('warning', title, message, component);
  }

  error(title: string, message: string, component: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.alert('error', title, message, component, metadata);
  }

  critical(title: string, message: string, component: string, metadata?: Record<string, unknown>): Promise<void> {
    return this.alert('critical', title, message, component, metadata);
  }
}

// Singleton instance
let alertManager: AlertManager | null = null;

export function getAlertManager(): AlertManager {
  if (!alertManager) {
    alertManager = new AlertManager();

    // Add Slack channel if configured
    const slackUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackUrl) {
      alertManager.addChannel(new SlackChannel(slackUrl));
    }

    // Add generic webhook if configured
    const webhookUrl = process.env.ALERT_WEBHOOK_URL;
    if (webhookUrl) {
      alertManager.addChannel(new WebhookChannel(
        webhookUrl,
        { 'X-API-Key': process.env.ALERT_WEBHOOK_API_KEY || '' }
      ));
    }
  }

  return alertManager;
}
```

---

### Task 3: Implement Error Classification

**New Files:**
- `backend/src/lib/errors.ts`

**Step 3.1: Create Error Classes**

```typescript
// backend/src/lib/errors.ts

export enum ErrorCategory {
  NETWORK = 'NETWORK',
  VALIDATION = 'VALIDATION',
  AUTHORIZATION = 'AUTHORIZATION',
  RESOURCE = 'RESOURCE',
  BLOCKCHAIN = 'BLOCKCHAIN',
  MPC = 'MPC',
  DATABASE = 'DATABASE',
  CONFIGURATION = 'CONFIGURATION',
  UNKNOWN = 'UNKNOWN',
}

export enum ErrorSeverity {
  LOW = 'LOW',         // Log and continue
  MEDIUM = 'MEDIUM',   // Log, maybe alert
  HIGH = 'HIGH',       // Alert, consider pause
  CRITICAL = 'CRITICAL', // Alert, pause service
}

export interface ClassifiedError {
  category: ErrorCategory;
  severity: ErrorSeverity;
  isRetryable: boolean;
  originalError: Error;
  code?: string;
  context?: Record<string, unknown>;
}

/**
 * Base error class with classification
 */
export class ConfidexError extends Error {
  constructor(
    message: string,
    public readonly category: ErrorCategory,
    public readonly severity: ErrorSeverity,
    public readonly isRetryable: boolean,
    public readonly code?: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ConfidexError';
  }

  toClassified(): ClassifiedError {
    return {
      category: this.category,
      severity: this.severity,
      isRetryable: this.isRetryable,
      originalError: this,
      code: this.code,
      context: this.context,
    };
  }
}

/**
 * Network-related errors
 */
export class NetworkError extends ConfidexError {
  constructor(message: string, code?: string) {
    super(
      message,
      ErrorCategory.NETWORK,
      ErrorSeverity.MEDIUM,
      true, // Usually retryable
      code
    );
    this.name = 'NetworkError';
  }
}

/**
 * Blockchain/Solana errors
 */
export class BlockchainError extends ConfidexError {
  constructor(
    message: string,
    code?: string,
    isRetryable = false,
    context?: Record<string, unknown>
  ) {
    super(
      message,
      ErrorCategory.BLOCKCHAIN,
      isRetryable ? ErrorSeverity.MEDIUM : ErrorSeverity.HIGH,
      isRetryable,
      code,
      context
    );
    this.name = 'BlockchainError';
  }
}

/**
 * MPC-related errors
 */
export class MpcError extends ConfidexError {
  constructor(
    message: string,
    code?: string,
    isRetryable = true
  ) {
    super(
      message,
      ErrorCategory.MPC,
      ErrorSeverity.HIGH,
      isRetryable,
      code
    );
    this.name = 'MpcError';
  }
}

/**
 * Classify unknown errors
 */
export function classifyError(error: Error): ClassifiedError {
  // Already classified
  if (error instanceof ConfidexError) {
    return error.toClassified();
  }

  const message = error.message.toLowerCase();

  // Network errors
  if (
    message.includes('timeout') ||
    message.includes('econnreset') ||
    message.includes('econnrefused') ||
    message.includes('network')
  ) {
    return {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.MEDIUM,
      isRetryable: true,
      originalError: error,
    };
  }

  // Rate limiting
  if (message.includes('429') || message.includes('rate limit')) {
    return {
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.LOW,
      isRetryable: true,
      originalError: error,
    };
  }

  // Solana program errors
  if (message.includes('custom program error')) {
    const match = message.match(/custom program error: (0x[0-9a-f]+)/i);
    const errorCode = match ? match[1] : undefined;

    // Known error codes
    const knownCodes: Record<string, { severity: ErrorSeverity; retryable: boolean }> = {
      '0x1': { severity: ErrorSeverity.HIGH, retryable: false }, // InstructionFallbackNotFound
      '0x1770': { severity: ErrorSeverity.MEDIUM, retryable: false }, // OrderNotActive
      '0x1771': { severity: ErrorSeverity.HIGH, retryable: false }, // OrderAlreadyMatching
      '0x1772': { severity: ErrorSeverity.MEDIUM, retryable: false }, // OrderAlreadyFilled
      '0x1780': { severity: ErrorSeverity.MEDIUM, retryable: true }, // MpcComputationPending
      '0x1781': { severity: ErrorSeverity.HIGH, retryable: false }, // MpcComputationFailed
      '0x1782': { severity: ErrorSeverity.HIGH, retryable: false }, // InsufficientBalance
      '0xbbb': { severity: ErrorSeverity.HIGH, retryable: false }, // AccountDidNotDeserialize
    };

    const config = errorCode && knownCodes[errorCode.toLowerCase()];

    return {
      category: ErrorCategory.BLOCKCHAIN,
      severity: config?.severity || ErrorSeverity.HIGH,
      isRetryable: config?.retryable || false,
      originalError: error,
      code: errorCode,
    };
  }

  // Blockhash errors
  if (message.includes('blockhash not found') || message.includes('block height exceeded')) {
    return {
      category: ErrorCategory.BLOCKCHAIN,
      severity: ErrorSeverity.LOW,
      isRetryable: true,
      originalError: error,
    };
  }

  // Insufficient funds
  if (message.includes('insufficient') || message.includes('not enough')) {
    return {
      category: ErrorCategory.RESOURCE,
      severity: ErrorSeverity.CRITICAL,
      isRetryable: false,
      originalError: error,
    };
  }

  // MPC errors
  if (message.includes('mpc') || message.includes('arcium') || message.includes('computation')) {
    return {
      category: ErrorCategory.MPC,
      severity: ErrorSeverity.HIGH,
      isRetryable: true,
      originalError: error,
    };
  }

  // Default: unknown error
  return {
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.HIGH,
    isRetryable: false,
    originalError: error,
  };
}

/**
 * Format error for logging
 */
export function formatError(error: Error | ClassifiedError): string {
  if ('category' in error && 'severity' in error) {
    const ce = error as ClassifiedError;
    return `[${ce.category}/${ce.severity}] ${ce.originalError.message}${ce.code ? ` (${ce.code})` : ''}`;
  }

  return error.message;
}
```

---

### Task 4: Integrate Error Handling

**Files to Modify:**
- `backend/src/crank/match-executor.ts`
- `backend/src/crank/mpc-poller.ts`
- `backend/src/crank/index.ts`

**Step 4.1: Update Match Executor**

```typescript
// backend/src/crank/match-executor.ts

import { withRetry, isRetryableError } from '../lib/retry.js';
import { classifyError, formatError, ErrorSeverity } from '../lib/errors.js';
import { getAlertManager } from '../lib/alerts.js';

export class MatchExecutor {
  private alertManager = getAlertManager();

  async executeMatch(buyOrder: PublicKey, sellOrder: PublicKey): Promise<boolean> {
    const operationId = `match:${buyOrder.toBase58().slice(0, 8)}:${sellOrder.toBase58().slice(0, 8)}`;

    const result = await withRetry(
      async () => {
        // ... existing match logic ...
        return await this.sendMatchTransaction(buyOrder, sellOrder);
      },
      {
        maxAttempts: 5,
        maxTimeMs: 30000,
        initialDelayMs: 200,
        maxDelayMs: 5000,
        isRetryable: (err) => {
          const classified = classifyError(err);
          return classified.isRetryable;
        },
        onRetry: (err, attempt, delayMs) => {
          const classified = classifyError(err);
          console.log(
            `[MatchExecutor] Retry ${attempt}: ${formatError(classified)} (waiting ${delayMs}ms)`
          );
        },
      }
    );

    if (!result.success) {
      const classified = classifyError(result.error!);

      // Alert based on severity
      if (classified.severity === ErrorSeverity.CRITICAL) {
        await this.alertManager.critical(
          'Match Execution Failed',
          `Failed to match orders after ${result.attempts} attempts: ${formatError(classified)}`,
          'MatchExecutor',
          {
            buyOrder: buyOrder.toBase58(),
            sellOrder: sellOrder.toBase58(),
            error: classified.originalError.message,
            code: classified.code,
          }
        );
      } else if (classified.severity === ErrorSeverity.HIGH) {
        await this.alertManager.error(
          'Match Execution Error',
          formatError(classified),
          'MatchExecutor',
          { buyOrder: buyOrder.toBase58(), sellOrder: sellOrder.toBase58() }
        );
      }

      return false;
    }

    console.log(
      `[MatchExecutor] Match successful in ${result.attempts} attempt(s), ${result.totalTimeMs}ms`
    );
    return true;
  }
}
```

**Step 4.2: Update MPC Poller**

```typescript
// backend/src/crank/mpc-poller.ts

import { withRetry } from '../lib/retry.js';
import { classifyError, formatError, MpcError, ErrorSeverity } from '../lib/errors.js';
import { getAlertManager } from '../lib/alerts.js';

export class MpcPoller {
  private alertManager = getAlertManager();
  private consecutiveFailures = 0;
  private readonly maxConsecutiveFailures = 5;

  async pollForCallbacks(): Promise<void> {
    const result = await withRetry(
      async () => {
        const callbacks = await this.fetchPendingCallbacks();
        await this.processCallbacks(callbacks);
        return callbacks.length;
      },
      {
        maxAttempts: 3,
        maxTimeMs: 15000,
        initialDelayMs: 500,
        onRetry: (err, attempt) => {
          console.warn(`[MpcPoller] Poll retry ${attempt}: ${err.message}`);
        },
      }
    );

    if (result.success) {
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      const classified = classifyError(result.error!);

      console.error(`[MpcPoller] Poll failed: ${formatError(classified)}`);

      // Alert if too many consecutive failures
      if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
        await this.alertManager.critical(
          'MPC Poller Failing',
          `MPC callback polling has failed ${this.consecutiveFailures} times consecutively`,
          'MpcPoller',
          {
            lastError: result.error!.message,
            consecutiveFailures: this.consecutiveFailures,
          }
        );
      }
    }
  }

  async executeCallback(callbackData: CallbackData): Promise<void> {
    const result = await withRetry(
      async () => {
        return await this.processCallback(callbackData);
      },
      {
        maxAttempts: 3,
        maxTimeMs: 20000,
        isRetryable: (err) => {
          // MPC callback errors are usually retryable
          return !err.message.includes('already processed');
        },
      }
    );

    if (!result.success) {
      throw new MpcError(
        `Callback execution failed: ${result.error!.message}`,
        'CALLBACK_FAILED',
        false
      );
    }
  }
}
```

**Step 4.3: Update Crank Service with Circuit Breaker Alerts**

```typescript
// backend/src/crank/index.ts

import { getAlertManager } from '../lib/alerts.js';
import { classifyError, ErrorSeverity } from '../lib/errors.js';

export class CrankService {
  private alertManager = getAlertManager();
  private lastAlertTime = 0;
  private alertCooldownMs = 300000; // 5 minutes between alerts

  private async handleError(error: Error, context: string): Promise<void> {
    const classified = classifyError(error);

    this.metrics.consecutiveErrors++;

    // Check circuit breaker
    if (this.metrics.consecutiveErrors >= this.config.errorThreshold) {
      await this.triggerCircuitBreaker(classified);
    }
  }

  private async triggerCircuitBreaker(lastError: ClassifiedError): Promise<void> {
    if (this.isPaused) return;

    this.isPaused = true;
    const pauseUntil = Date.now() + this.config.pauseDurationMs;

    console.error(`[Crank] Circuit breaker tripped! Pausing until ${new Date(pauseUntil).toISOString()}`);

    // Send alert (with cooldown)
    const now = Date.now();
    if (now - this.lastAlertTime > this.alertCooldownMs) {
      this.lastAlertTime = now;

      await this.alertManager.critical(
        'Crank Circuit Breaker Tripped',
        `The crank service has been paused due to ${this.metrics.consecutiveErrors} consecutive errors.\n` +
        `Last error: ${lastError.originalError.message}\n` +
        `Service will resume at: ${new Date(pauseUntil).toISOString()}`,
        'CrankService',
        {
          consecutiveErrors: this.metrics.consecutiveErrors,
          lastErrorCategory: lastError.category,
          lastErrorCode: lastError.code,
          pauseDurationMs: this.config.pauseDurationMs,
        }
      );
    }

    // Schedule resume
    setTimeout(() => this.resumeFromCircuitBreaker(), this.config.pauseDurationMs);
  }

  private async resumeFromCircuitBreaker(): Promise<void> {
    this.isPaused = false;
    this.metrics.consecutiveErrors = 0;

    console.log('[Crank] Circuit breaker reset, resuming operations');

    await this.alertManager.info(
      'Crank Service Resumed',
      'The crank service has resumed after circuit breaker pause',
      'CrankService'
    );
  }

  // Health check endpoint data
  getHealth(): { healthy: boolean; details: Record<string, unknown> } {
    return {
      healthy: !this.isPaused && this.metrics.consecutiveErrors < this.config.errorThreshold / 2,
      details: {
        isPaused: this.isPaused,
        consecutiveErrors: this.metrics.consecutiveErrors,
        errorThreshold: this.config.errorThreshold,
        lastPollAt: this.metrics.lastPollAt,
        uptimeMs: Date.now() - this.metrics.startedAt,
      },
    };
  }
}
```

---

### Task 5: Add Request Timeouts

**Step 5.1: Create Timeout Wrapper**

```typescript
// backend/src/lib/timeout.ts

export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Wrap a promise with a timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage = 'Operation timed out'
): Promise<T> {
  let timeoutHandle: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new TimeoutError(`${errorMessage} after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

/**
 * Decorator for adding timeout to async methods
 */
export function Timeout(timeoutMs: number, errorMessage?: string) {
  return function (
    target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args: unknown[]) {
      return withTimeout(
        originalMethod.apply(this, args),
        timeoutMs,
        errorMessage || `${propertyKey} timed out`
      );
    };

    return descriptor;
  };
}
```

**Step 5.2: Apply Timeouts to Critical Operations**

```typescript
// backend/src/crank/match-executor.ts

import { withTimeout } from '../lib/timeout.js';

export class MatchExecutor {
  async sendMatchTransaction(buyOrder: PublicKey, sellOrder: PublicKey): Promise<string> {
    // Timeout for entire transaction flow
    return withTimeout(
      this._sendMatchTransaction(buyOrder, sellOrder),
      60000, // 60 second timeout
      'Match transaction timed out'
    );
  }

  private async _sendMatchTransaction(buyOrder: PublicKey, sellOrder: PublicKey): Promise<string> {
    // Build transaction
    const tx = new Transaction();
    tx.add(this.buildMatchInstruction(buyOrder, sellOrder));

    // Get blockhash with timeout
    const { blockhash, lastValidBlockHeight } = await withTimeout(
      this.blockhashManager.getBlockhash(),
      5000,
      'Blockhash fetch timed out'
    );

    tx.recentBlockhash = blockhash;
    tx.lastValidBlockHeight = lastValidBlockHeight;
    tx.feePayer = this.crankKeypair.publicKey;

    // Send with timeout
    const signature = await withTimeout(
      this.connection.sendTransaction(tx, [this.crankKeypair]),
      30000,
      'Transaction send timed out'
    );

    // Confirm with timeout
    await withTimeout(
      this.confirmTransaction(signature, lastValidBlockHeight),
      45000,
      'Transaction confirmation timed out'
    );

    return signature;
  }
}
```

---

## Acceptance Criteria

- [ ] **Retry Logic**
  - [ ] All retries use exponential backoff with jitter
  - [ ] Retry delays: 100ms → 200ms → 400ms → ... → max 10s
  - [ ] Total retry time bounded to 30 seconds
  - [ ] Non-retryable errors fail immediately

- [ ] **Alerting**
  - [ ] Circuit breaker trips send Slack alert
  - [ ] Critical errors send immediate alert
  - [ ] Alert deduplication prevents spam (1 min window)
  - [ ] Console logging always enabled

- [ ] **Error Classification**
  - [ ] All errors classified by category and severity
  - [ ] Solana error codes mapped to known issues
  - [ ] Retryable vs non-retryable properly identified
  - [ ] Error context preserved for debugging

- [ ] **Timeouts**
  - [ ] All RPC calls have 5-10s timeout
  - [ ] Transaction sends have 30s timeout
  - [ ] Transaction confirmations have 45s timeout
  - [ ] Timeout errors properly classified

- [ ] **Tests**
  - [ ] Unit tests for retry logic
  - [ ] Unit tests for error classification
  - [ ] Integration tests for alert delivery

---

## Environment Variables

```bash
# Alerting
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/xxx
ALERT_WEBHOOK_URL=https://your-alerting-service.com/webhook
ALERT_WEBHOOK_API_KEY=your-api-key

# Retry configuration
RETRY_MAX_ATTEMPTS=5
RETRY_MAX_TIME_MS=30000
RETRY_INITIAL_DELAY_MS=100

# Circuit breaker
CIRCUIT_BREAKER_ERROR_THRESHOLD=10
CIRCUIT_BREAKER_PAUSE_MS=60000
CIRCUIT_BREAKER_ALERT_COOLDOWN_MS=300000
```

---

## Verification Commands

```bash
# Test retry logic
node -e "
const { withRetry } = require('./dist/lib/retry.js');
let attempts = 0;
withRetry(async () => {
  attempts++;
  if (attempts < 3) throw new Error('timeout');
  return 'success';
}).then(r => console.log('Result:', r));
"

# Test alerting
curl -X POST http://localhost:3001/api/admin/test-alert \
  -H 'Content-Type: application/json' \
  -d '{"severity": "warning", "message": "Test alert"}'

# Check error classification
node -e "
const { classifyError } = require('./dist/lib/errors.js');
console.log(classifyError(new Error('custom program error: 0x1782')));
"
```

---

## References

- [Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
- [Circuit Breaker Pattern](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Solana Error Codes](https://docs.rs/solana-program/latest/solana_program/program_error/enum.ProgramError.html)
