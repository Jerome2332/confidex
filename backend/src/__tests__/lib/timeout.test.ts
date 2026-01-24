import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import {
  withTimeout,
  withTimeoutFn,
  TimeoutError,
  delay,
  deadline,
  raceDeadline,
  fetchWithTimeout,
  DEFAULT_TIMEOUTS,
  Timeout,
} from '../../lib/timeout.js';

// Suppress unhandled rejections from Promise.race losers during tests
// This is expected behavior when testing timeout functions with fake timers
let originalListeners: NodeJS.UnhandledRejectionListener[] = [];
beforeAll(() => {
  originalListeners = process.listeners('unhandledRejection') as NodeJS.UnhandledRejectionListener[];
  process.removeAllListeners('unhandledRejection');
  process.on('unhandledRejection', (reason) => {
    // Silently ignore TimeoutError rejections - these are expected from Promise.race losers
    if (reason instanceof TimeoutError) {
      return;
    }
    // Re-throw other errors
    throw reason;
  });
});

afterAll(() => {
  process.removeAllListeners('unhandledRejection');
  originalListeners.forEach((listener) => {
    process.on('unhandledRejection', listener);
  });
});

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

    // Catch the rejection to avoid unhandled rejection
    try {
      await resultPromise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).timeoutMs).toBe(100);
      expect((error as TimeoutError).operation).toBe('slow operation');
    }
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

    try {
      await resultPromise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
    }

    vi.useRealTimers();
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

    try {
      await deadlinePromise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).timeoutMs).toBe(1000);
      expect((error as TimeoutError).operation).toBe('test deadline');
    }
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

    try {
      await resultPromise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
    }
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

describe('Timeout decorator', () => {
  it('wraps class method with timeout', async () => {
    // Test decorator by applying it manually (avoids decorator syntax)
    class TestService {
      async fetchData(): Promise<string> {
        return 'data';
      }
    }

    // Apply decorator manually
    const descriptor: TypedPropertyDescriptor<() => Promise<string>> = {
      value: TestService.prototype.fetchData,
      writable: true,
      enumerable: false,
      configurable: true,
    };
    const decorated = Timeout(1000, 'fetchData')(TestService.prototype, 'fetchData', descriptor);
    TestService.prototype.fetchData = decorated.value!;

    const service = new TestService();
    const result = await service.fetchData();

    expect(result).toBe('data');
  });

  it('times out slow method', async () => {
    vi.useFakeTimers();

    class TestService {
      async slowMethod(): Promise<string> {
        return new Promise((resolve) => setTimeout(() => resolve('slow'), 5000));
      }
    }

    // Apply decorator manually
    const descriptor: TypedPropertyDescriptor<() => Promise<string>> = {
      value: TestService.prototype.slowMethod,
      writable: true,
      enumerable: false,
      configurable: true,
    };
    const decorated = Timeout(100, 'slowMethod')(TestService.prototype, 'slowMethod', descriptor);
    TestService.prototype.slowMethod = decorated.value!;

    const service = new TestService();
    const resultPromise = service.slowMethod();

    await vi.advanceTimersByTimeAsync(150);

    try {
      await resultPromise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      expect((error as TimeoutError).operation).toBe('slowMethod');
    }

    vi.useRealTimers();
  });

  it('uses method name as default operation name', async () => {
    vi.useFakeTimers();

    class TestService {
      async myCustomMethod(): Promise<string> {
        return new Promise((resolve) => setTimeout(() => resolve('slow'), 5000));
      }
    }

    // Apply decorator manually without operation name
    const descriptor: TypedPropertyDescriptor<() => Promise<string>> = {
      value: TestService.prototype.myCustomMethod,
      writable: true,
      enumerable: false,
      configurable: true,
    };
    const decorated = Timeout(100)(TestService.prototype, 'myCustomMethod', descriptor);
    TestService.prototype.myCustomMethod = decorated.value!;

    const service = new TestService();
    const resultPromise = service.myCustomMethod();

    await vi.advanceTimersByTimeAsync(150);

    try {
      await resultPromise;
      expect.fail('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(TimeoutError);
      // Operation name defaults to method name (propertyKey)
      expect((error as TimeoutError).operation).toBe('myCustomMethod');
    }

    vi.useRealTimers();
  });

  it('handles descriptor without value', () => {
    // Decorator should return descriptor unchanged if no value
    const descriptor: TypedPropertyDescriptor<() => Promise<unknown>> = {};
    const result = Timeout(1000)({}, 'test', descriptor);
    expect(result).toEqual(descriptor);
  });

  it('preserves this context in decorated method', async () => {
    class TestService {
      private value = 42;

      async getValue(): Promise<number> {
        return this.value;
      }
    }

    // Apply decorator manually
    const descriptor: TypedPropertyDescriptor<() => Promise<number>> = {
      value: TestService.prototype.getValue,
      writable: true,
      enumerable: false,
      configurable: true,
    };
    const decorated = Timeout(1000)(TestService.prototype, 'getValue', descriptor);
    TestService.prototype.getValue = decorated.value!;

    const service = new TestService();
    const result = await service.getValue();

    expect(result).toBe(42);
  });
});
