import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withTimeout,
  withTimeoutFn,
  TimeoutError,
  delay,
  deadline,
  raceDeadline,
  fetchWithTimeout,
  DEFAULT_TIMEOUTS,
} from '../../lib/timeout.js';

describe('TimeoutError', () => {
  it('creates error with timeout details', () => {
    const error = new TimeoutError(5000, 'fetch data');

    expect(error.name).toBe('TimeoutError');
    expect(error.timeoutMs).toBe(5000);
    expect(error.operation).toBe('fetch data');
    expect(error.message).toContain('5000ms');
    expect(error.message).toContain('fetch data');
    expect(error.isRetryable).toBe(true);
  });

  it('creates error without operation name', () => {
    const error = new TimeoutError(1000);

    expect(error.message).toContain('1000ms');
    expect(error.operation).toBeUndefined();
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns value when promise resolves before timeout', async () => {
    const promise = Promise.resolve('success');

    const resultPromise = withTimeout(promise, { timeoutMs: 1000 });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('success');
  });

  it('throws TimeoutError when promise takes too long', async () => {
    const slowPromise = new Promise((resolve) => {
      setTimeout(() => resolve('late'), 5000);
    });

    const resultPromise = withTimeout(slowPromise, {
      timeoutMs: 100,
      operation: 'slow operation',
    });

    // Advance timers just past timeout
    await vi.advanceTimersByTimeAsync(150);

    await expect(resultPromise).rejects.toThrow(TimeoutError);
    await expect(resultPromise).rejects.toMatchObject({
      timeoutMs: 100,
      operation: 'slow operation',
    });
  });

  it('cleans up timeout on success', async () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const promise = Promise.resolve('success');

    await withTimeout(promise, { timeoutMs: 5000 });

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });

  it('respects abort signal', async () => {
    vi.useRealTimers(); // Need real timers for abort controller

    const controller = new AbortController();
    const slowPromise = new Promise((resolve) => {
      setTimeout(() => resolve('done'), 10000);
    });

    const resultPromise = withTimeout(slowPromise, {
      timeoutMs: 5000,
      signal: controller.signal,
    });

    // Abort immediately
    controller.abort();

    await expect(resultPromise).rejects.toThrow(TimeoutError);
  });

  it('throws immediately if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      withTimeout(Promise.resolve('test'), {
        timeoutMs: 1000,
        signal: controller.signal,
      })
    ).rejects.toThrow(TimeoutError);
  });
});

describe('withTimeoutFn', () => {
  it('wraps async function with timeout', async () => {
    vi.useRealTimers();

    const asyncFn = async (x: number) => {
      return x * 2;
    };

    const wrappedFn = withTimeoutFn(asyncFn, { timeoutMs: 1000 });
    const result = await wrappedFn(5);

    expect(result).toBe(10);
  });

  it('throws TimeoutError when wrapped function times out', async () => {
    vi.useFakeTimers();

    const slowFn = async () => {
      return new Promise((resolve) => setTimeout(() => resolve('done'), 5000));
    };

    const wrappedFn = withTimeoutFn(slowFn, { timeoutMs: 100 });
    const resultPromise = wrappedFn();

    await vi.advanceTimersByTimeAsync(150);

    await expect(resultPromise).rejects.toThrow(TimeoutError);
  });
});

describe('delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after specified time', async () => {
    const resolved = vi.fn();
    const promise = delay(1000).then(resolved);

    expect(resolved).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);

    expect(resolved).toHaveBeenCalled();
  });

  it('can be aborted', async () => {
    vi.useRealTimers();

    const controller = new AbortController();
    const delayPromise = delay(10000, controller.signal);

    controller.abort();

    await expect(delayPromise).rejects.toThrow(TimeoutError);
  });

  it('rejects immediately if signal already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(delay(1000, controller.signal)).rejects.toThrow(TimeoutError);
  });
});

describe('deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects after specified time', async () => {
    const deadlinePromise = deadline(1000, 'test deadline');

    await vi.advanceTimersByTimeAsync(1000);

    await expect(deadlinePromise).rejects.toThrow(TimeoutError);
    await expect(deadlinePromise).rejects.toMatchObject({
      timeoutMs: 1000,
      operation: 'test deadline',
    });
  });
});

describe('raceDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns value if promise wins race', async () => {
    const fastPromise = Promise.resolve('fast');

    const resultPromise = raceDeadline(fastPromise, 1000);
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe('fast');
  });

  it('throws if deadline wins race', async () => {
    const slowPromise = new Promise((resolve) => {
      setTimeout(() => resolve('slow'), 5000);
    });

    const resultPromise = raceDeadline(slowPromise, 100, 'slow operation');

    await vi.advanceTimersByTimeAsync(150);

    await expect(resultPromise).rejects.toThrow(TimeoutError);
  });
});

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns response when fetch completes in time', async () => {
    const mockResponse = new Response('OK', { status: 200 });
    global.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await fetchWithTimeout('https://api.example.com', {
      timeoutMs: 5000,
    });

    expect(result).toBe(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({
        signal: expect.any(AbortSignal),
      })
    );
  });

  it('throws TimeoutError when fetch times out', async () => {
    const abortError = new Error('abort');
    abortError.name = 'AbortError';
    global.fetch = vi.fn().mockRejectedValue(abortError);

    await expect(
      fetchWithTimeout('https://api.example.com', { timeoutMs: 100 })
    ).rejects.toThrow(TimeoutError);
  });

  it('rethrows non-abort errors', async () => {
    const networkError = new Error('Network failure');
    global.fetch = vi.fn().mockRejectedValue(networkError);

    await expect(
      fetchWithTimeout('https://api.example.com', { timeoutMs: 5000 })
    ).rejects.toThrow('Network failure');
  });

  it('passes through fetch options', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('OK'));

    await fetchWithTimeout('https://api.example.com', {
      timeoutMs: 5000,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'test' }),
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: 'test' }),
      })
    );
  });
});

describe('DEFAULT_TIMEOUTS', () => {
  it('has sensible default values', () => {
    expect(DEFAULT_TIMEOUTS.RPC).toBe(30_000);
    expect(DEFAULT_TIMEOUTS.TRANSACTION).toBe(60_000);
    expect(DEFAULT_TIMEOUTS.MPC_COMPUTATION).toBe(120_000);
    expect(DEFAULT_TIMEOUTS.MPC_CALLBACK).toBe(30_000);
    expect(DEFAULT_TIMEOUTS.HTTP).toBe(10_000);
    expect(DEFAULT_TIMEOUTS.HEALTHCHECK).toBe(5_000);
  });
});
