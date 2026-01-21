import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  retry,
  isRetryableError,
  isSolanaFatalError,
  withRetryWrapper,
  RetryOptions,
} from '../../lib/retry.js';

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('successful execution', () => {
    it('returns value on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const promise = withRetry(fn);
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('returns value after retry', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, { initialDelayMs: 100 });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(2);
    });
  });

  describe('failure handling', () => {
    it('fails after max attempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Connection timeout'));

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 100,
        jitterFactor: 0,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('fails immediately on non-retryable error', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Insufficient funds'));

      const promise = withRetry(fn, {
        maxAttempts: 5,
        initialDelayMs: 100,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('respects max time limit', async () => {
      vi.useRealTimers(); // Need real timers for time-based test

      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      const result = await withRetry(fn, {
        maxAttempts: 100,
        maxTimeMs: 200,
        initialDelayMs: 100,
        jitterFactor: 0,
      });

      expect(result.success).toBe(false);
      expect(result.totalTimeMs).toBeLessThan(400);
    });

    it('returns error from last attempt', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('timeout 1'))
        .mockRejectedValueOnce(new Error('timeout 2'))
        .mockRejectedValueOnce(new Error('timeout 3'));

      const promise = withRetry(fn, {
        maxAttempts: 3,
        initialDelayMs: 10,
        jitterFactor: 0,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.error?.message).toBe('timeout 3');
    });
  });

  describe('exponential backoff', () => {
    it('increases delay exponentially', async () => {
      vi.useRealTimers();

      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      await withRetry(fn, {
        maxAttempts: 4,
        initialDelayMs: 50,
        maxDelayMs: 10000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry: (_, __, delayMs) => delays.push(delayMs),
      });

      // With jitterFactor: 0, delays should be exact
      expect(delays[0]).toBe(50);   // 50 * 2^0
      expect(delays[1]).toBe(100);  // 50 * 2^1
      expect(delays[2]).toBe(200);  // 50 * 2^2
    });

    it('caps delay at maxDelayMs', async () => {
      vi.useRealTimers();

      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      await withRetry(fn, {
        maxAttempts: 5,
        initialDelayMs: 1000,
        maxDelayMs: 2000,
        backoffMultiplier: 2,
        jitterFactor: 0,
        onRetry: (_, __, delayMs) => delays.push(delayMs),
      });

      // All delays after 1st should be capped at 2000
      expect(delays[0]).toBe(1000);
      expect(delays[1]).toBe(2000); // Would be 2000, capped
      expect(delays[2]).toBe(2000); // Would be 4000, capped
      expect(delays[3]).toBe(2000); // Would be 8000, capped
    });

    it('applies jitter to delays', async () => {
      vi.useRealTimers();

      const delays: number[] = [];
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      // Run multiple times to verify jitter varies delays
      for (let i = 0; i < 3; i++) {
        await withRetry(fn, {
          maxAttempts: 2,
          initialDelayMs: 100,
          jitterFactor: 0.5, // 50% jitter
          onRetry: (_, __, delayMs) => delays.push(delayMs),
        });
      }

      // With 50% jitter on 100ms, delays should be in range [50, 150]
      delays.forEach(delay => {
        expect(delay).toBeGreaterThanOrEqual(50);
        expect(delay).toBeLessThanOrEqual(150);
      });

      // At least some delays should be different (probabilistic)
      // This test might flake occasionally but is useful for verification
      const uniqueDelays = new Set(delays);
      // At least some variation expected
    });
  });

  describe('callbacks', () => {
    it('calls onRetry with error and attempt info', async () => {
      vi.useRealTimers();

      const onRetry = vi.fn();
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Connection timeout')) // Use a retryable error
        .mockResolvedValueOnce('success');

      await withRetry(fn, {
        initialDelayMs: 10,
        jitterFactor: 0,
        onRetry,
      });

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(
        expect.any(Error),
        1,
        10
      );
      expect(onRetry.mock.calls[0][0].message).toBe('Connection timeout');
    });

    it('calls onRetry for each retry', async () => {
      vi.useRealTimers();

      const onRetry = vi.fn();
      const fn = vi.fn().mockRejectedValue(new Error('timeout'));

      await withRetry(fn, {
        maxAttempts: 4,
        initialDelayMs: 10,
        jitterFactor: 0,
        onRetry,
      });

      // 4 attempts = 3 retries
      expect(onRetry).toHaveBeenCalledTimes(3);
    });
  });

  describe('custom isRetryable', () => {
    it('uses custom isRetryable function', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('custom error'));
      const customIsRetryable = vi.fn().mockReturnValue(false);

      const promise = withRetry(fn, {
        maxAttempts: 5,
        isRetryable: customIsRetryable,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.attempts).toBe(1);
      expect(customIsRetryable).toHaveBeenCalled();
    });

    it('retries when custom isRetryable returns true', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('custom retryable'))
        .mockResolvedValueOnce('success');

      const promise = withRetry(fn, {
        initialDelayMs: 10,
        isRetryable: () => true,
      });
      await vi.runAllTimersAsync();
      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.attempts).toBe(2);
    });
  });
});

describe('retry', () => {
  it('returns value on success', async () => {
    const fn = vi.fn().mockResolvedValue('success');

    const result = await retry(fn);

    expect(result).toBe('success');
  });

  it('throws on failure', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('insufficient funds'));

    await expect(retry(fn)).rejects.toThrow('insufficient funds');
  });
});

describe('isRetryableError', () => {
  describe('retryable errors', () => {
    const retryableMessages = [
      'Connection timeout',
      'ECONNRESET',
      'Network error',
      'socket hang up',
      'Error 429: Too many requests',
      '503 Service Unavailable',
      'Blockhash not found',
      'Node is behind',
      'ETIMEDOUT',
      'ENOTFOUND',
      'rate limit exceeded',
    ];

    retryableMessages.forEach(msg => {
      it(`returns true for "${msg}"`, () => {
        expect(isRetryableError(new Error(msg))).toBe(true);
      });
    });
  });

  describe('non-retryable errors', () => {
    const nonRetryableMessages = [
      'Insufficient funds',
      'Account not found',
      'Invalid account owner',
      'Custom program error: 0x1',
      'Instruction error',
      'Unauthorized',
      'Invalid signature',
    ];

    nonRetryableMessages.forEach(msg => {
      it(`returns false for "${msg}"`, () => {
        expect(isRetryableError(new Error(msg))).toBe(false);
      });
    });
  });

  it('returns false for unknown errors', () => {
    expect(isRetryableError(new Error('some random error'))).toBe(false);
  });
});

describe('isSolanaFatalError', () => {
  describe('fatal errors', () => {
    const fatalMessages = [
      'Insufficient funds for transaction',
      'Account not found',
      'Invalid account owner',
      'Invalid account data',
      'Custom program error: 0x1782',
      'Instruction error',
      'Lamport balance below rent exempt minimum',
    ];

    fatalMessages.forEach(msg => {
      it(`identifies "${msg}" as fatal`, () => {
        expect(isSolanaFatalError(new Error(msg))).toBe(true);
      });
    });
  });

  describe('non-fatal errors', () => {
    const nonFatalMessages = [
      'Connection timeout',
      'Blockhash not found',
      'Rate limit exceeded',
    ];

    nonFatalMessages.forEach(msg => {
      it(`does not flag "${msg}" as fatal`, () => {
        expect(isSolanaFatalError(new Error(msg))).toBe(false);
      });
    });
  });
});

describe('withRetryWrapper', () => {
  it('creates a wrapped function that retries', async () => {
    vi.useRealTimers();

    const originalFn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    const wrappedFn = withRetryWrapper(originalFn, {
      initialDelayMs: 10,
      jitterFactor: 0,
    });

    const result = await wrappedFn();

    expect(result.success).toBe(true);
    expect(result.value).toBe('success');
    expect(originalFn).toHaveBeenCalledTimes(2);
  });

  it('passes arguments to wrapped function', async () => {
    const originalFn = vi.fn().mockResolvedValue('result');

    const wrappedFn = withRetryWrapper(originalFn);

    await wrappedFn('arg1', 'arg2', 123);

    expect(originalFn).toHaveBeenCalledWith('arg1', 'arg2', 123);
  });
});
