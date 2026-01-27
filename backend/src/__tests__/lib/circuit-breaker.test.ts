/**
 * Circuit Breaker Pattern Tests
 *
 * Tests for circuit breaker implementation to protect against cascading failures:
 * - State transitions: closed → open → half-open → closed
 * - Failure counting and threshold triggers
 * - Reset timeout behavior
 * - Half-open state test requests
 *
 * The circuit breaker pattern prevents repeated calls to failing services,
 * allowing them time to recover.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// =============================================================================
// Circuit Breaker Implementation (to be moved to lib/circuit-breaker.ts)
// =============================================================================

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Time in ms before attempting to close the circuit */
  resetTimeoutMs: number;
  /** Number of successful test requests needed to close half-open circuit */
  successThreshold?: number;
  /** Optional name for logging */
  name?: string;
}

interface CircuitBreakerStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailure: Date | null;
  lastSuccess: Date | null;
  lastStateChange: Date | null;
}

/**
 * Generic Circuit Breaker implementation
 */
class CircuitBreaker<T> {
  private state: CircuitState = 'closed';
  private failures = 0;
  private successes = 0;
  private lastFailure: Date | null = null;
  private lastSuccess: Date | null = null;
  private lastStateChange: Date | null = null;
  private config: Required<CircuitBreakerConfig>;

  constructor(config: CircuitBreakerConfig) {
    this.config = {
      failureThreshold: config.failureThreshold,
      resetTimeoutMs: config.resetTimeoutMs,
      successThreshold: config.successThreshold ?? 1,
      name: config.name ?? 'unnamed',
    };
  }

  /**
   * Execute a function with circuit breaker protection
   */
  async execute(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Check if reset timeout has passed
      if (this.lastFailure && this.shouldAttemptReset()) {
        this.transitionTo('half-open');
      } else {
        throw new CircuitOpenError(
          `Circuit breaker [${this.config.name}] is open`,
          this.getStats()
        );
      }
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Record a successful call
   */
  private recordSuccess(): void {
    this.failures = 0;
    this.successes++;
    this.lastSuccess = new Date();

    if (this.state === 'half-open') {
      if (this.successes >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }
  }

  /**
   * Record a failed call
   */
  private recordFailure(): void {
    this.failures++;
    this.successes = 0;
    this.lastFailure = new Date();

    if (this.state === 'half-open') {
      // Any failure in half-open state reopens the circuit
      this.transitionTo('open');
    } else if (this.state === 'closed') {
      if (this.failures >= this.config.failureThreshold) {
        this.transitionTo('open');
      }
    }
  }

  /**
   * Check if enough time has passed to attempt reset
   */
  private shouldAttemptReset(): boolean {
    if (!this.lastFailure) return false;
    const elapsed = Date.now() - this.lastFailure.getTime();
    return elapsed >= this.config.resetTimeoutMs;
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;
    this.lastStateChange = new Date();

    if (newState === 'closed') {
      // Reset counters when closing
      this.failures = 0;
      this.successes = 0;
    } else if (newState === 'half-open') {
      // Reset success counter for half-open testing
      this.successes = 0;
    }

    // Log state transition (in real impl, use proper logger)
    console.log(
      `[CircuitBreaker:${this.config.name}] ${oldState} → ${newState}`
    );
  }

  /**
   * Get current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailure: this.lastFailure,
      lastSuccess: this.lastSuccess,
      lastStateChange: this.lastStateChange,
    };
  }

  /**
   * Get current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Manually reset the circuit breaker (for admin intervention)
   */
  reset(): void {
    this.transitionTo('closed');
  }

  /**
   * Manually open the circuit breaker (for maintenance)
   */
  trip(): void {
    this.transitionTo('open');
  }
}

/**
 * Error thrown when circuit is open
 */
class CircuitOpenError extends Error {
  readonly stats: CircuitBreakerStats;

  constructor(message: string, stats: CircuitBreakerStats) {
    super(message);
    this.name = 'CircuitOpenError';
    this.stats = stats;
  }
}

// =============================================================================
// Tests
// =============================================================================

describe('CircuitBreaker', () => {
  let circuitBreaker: CircuitBreaker<string>;

  beforeEach(() => {
    vi.useFakeTimers();
    circuitBreaker = new CircuitBreaker<string>({
      failureThreshold: 3,
      resetTimeoutMs: 30000, // 30 seconds
      successThreshold: 2,
      name: 'test',
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should start in closed state', () => {
      expect(circuitBreaker.getState()).toBe('closed');
    });

    it('should have zero failures and successes initially', () => {
      const stats = circuitBreaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.successes).toBe(0);
      expect(stats.lastFailure).toBeNull();
      expect(stats.lastSuccess).toBeNull();
    });
  });

  describe('Closed State', () => {
    it('should allow requests when closed', async () => {
      const result = await circuitBreaker.execute(() => Promise.resolve('success'));
      expect(result).toBe('success');
    });

    it('should count failures in closed state', async () => {
      await expect(
        circuitBreaker.execute(() => Promise.reject(new Error('fail')))
      ).rejects.toThrow('fail');

      expect(circuitBreaker.getStats().failures).toBe(1);
      expect(circuitBreaker.getState()).toBe('closed');
    });

    it('should reset failure count on success', async () => {
      // First, record some failures
      await expect(
        circuitBreaker.execute(() => Promise.reject(new Error('fail')))
      ).rejects.toThrow();
      await expect(
        circuitBreaker.execute(() => Promise.reject(new Error('fail')))
      ).rejects.toThrow();

      expect(circuitBreaker.getStats().failures).toBe(2);

      // Now succeed
      await circuitBreaker.execute(() => Promise.resolve('success'));

      expect(circuitBreaker.getStats().failures).toBe(0);
    });
  });

  describe('Opening the Circuit', () => {
    it('should open after reaching failure threshold', async () => {
      // Fail 3 times (threshold)
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow('fail');
      }

      expect(circuitBreaker.getState()).toBe('open');
    });

    it('should reject requests when open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow('fail');
      }

      // Now requests should fail fast
      await expect(
        circuitBreaker.execute(() => Promise.resolve('success'))
      ).rejects.toThrow(CircuitOpenError);
    });

    it('should include stats in CircuitOpenError', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      try {
        await circuitBreaker.execute(() => Promise.resolve('success'));
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CircuitOpenError);
        const circuitErr = err as CircuitOpenError;
        expect(circuitErr.stats.state).toBe('open');
        expect(circuitErr.stats.failures).toBe(3);
      }
    });
  });

  describe('Half-Open State', () => {
    it('should transition to half-open after reset timeout', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      expect(circuitBreaker.getState()).toBe('open');

      // Advance time past reset timeout
      vi.advanceTimersByTime(31000); // 31 seconds

      // Next execute attempt should trigger half-open transition
      // Note: This will still execute the function since we're in half-open
      const result = await circuitBreaker.execute(() => Promise.resolve('test'));
      expect(result).toBe('test');
      // After success, we're still half-open (need 2 successes)
      expect(circuitBreaker.getState()).toBe('half-open');
    });

    it('should close after successThreshold successes in half-open', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      // Advance past reset timeout
      vi.advanceTimersByTime(31000);

      // First success - transitions to half-open but needs 2 successes to close
      await circuitBreaker.execute(() => Promise.resolve('success1'));
      expect(circuitBreaker.getState()).toBe('half-open');

      // Second success - should close the circuit
      await circuitBreaker.execute(() => Promise.resolve('success2'));
      expect(circuitBreaker.getState()).toBe('closed');
    });

    it('should reopen on any failure in half-open state', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      // Advance past reset timeout
      vi.advanceTimersByTime(31000);

      // First call succeeds - now half-open
      await circuitBreaker.execute(() => Promise.resolve('success'));
      expect(circuitBreaker.getState()).toBe('half-open');

      // Next call fails - should reopen
      await expect(
        circuitBreaker.execute(() => Promise.reject(new Error('fail again')))
      ).rejects.toThrow('fail again');

      expect(circuitBreaker.getState()).toBe('open');
    });
  });

  describe('Manual Controls', () => {
    it('should allow manual reset', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      expect(circuitBreaker.getState()).toBe('open');

      // Manual reset
      circuitBreaker.reset();

      expect(circuitBreaker.getState()).toBe('closed');
      expect(circuitBreaker.getStats().failures).toBe(0);
    });

    it('should allow manual trip', async () => {
      expect(circuitBreaker.getState()).toBe('closed');

      // Manual trip (for maintenance)
      circuitBreaker.trip();

      expect(circuitBreaker.getState()).toBe('open');
    });
  });

  describe('Statistics', () => {
    it('should track last failure timestamp', async () => {
      vi.setSystemTime(new Date('2026-01-27T12:00:00Z'));

      await expect(
        circuitBreaker.execute(() => Promise.reject(new Error('fail')))
      ).rejects.toThrow();

      expect(circuitBreaker.getStats().lastFailure).toEqual(
        new Date('2026-01-27T12:00:00Z')
      );
    });

    it('should track last success timestamp', async () => {
      vi.setSystemTime(new Date('2026-01-27T12:00:00Z'));

      await circuitBreaker.execute(() => Promise.resolve('success'));

      expect(circuitBreaker.getStats().lastSuccess).toEqual(
        new Date('2026-01-27T12:00:00Z')
      );
    });

    it('should track state change timestamp', async () => {
      vi.setSystemTime(new Date('2026-01-27T12:00:00Z'));

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      expect(circuitBreaker.getStats().lastStateChange).toEqual(
        new Date('2026-01-27T12:00:00Z')
      );
    });
  });

  describe('Configuration Validation', () => {
    it('should use default successThreshold of 1 if not provided', async () => {
      const cb = new CircuitBreaker<string>({
        failureThreshold: 3,
        resetTimeoutMs: 30000,
        name: 'test-default',
      });

      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      // Advance past reset timeout
      vi.advanceTimersByTime(31000);

      // Single success should close with default threshold of 1
      await cb.execute(() => Promise.resolve('success'));
      expect(cb.getState()).toBe('closed');
    });

    it('should require higher successThreshold when configured', async () => {
      const cb = new CircuitBreaker<string>({
        failureThreshold: 2,
        resetTimeoutMs: 10000,
        successThreshold: 3,
        name: 'high-threshold',
      });

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        await expect(
          cb.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      // Advance past reset timeout
      vi.advanceTimersByTime(11000);

      // Need 3 successes to close
      await cb.execute(() => Promise.resolve('s1'));
      expect(cb.getState()).toBe('half-open');

      await cb.execute(() => Promise.resolve('s2'));
      expect(cb.getState()).toBe('half-open');

      await cb.execute(() => Promise.resolve('s3'));
      expect(cb.getState()).toBe('closed');
    });
  });

  describe('Edge Cases', () => {
    it('should handle synchronous exceptions', async () => {
      const fn = () => {
        throw new Error('sync error');
      };

      await expect(circuitBreaker.execute(fn as any)).rejects.toThrow('sync error');
      expect(circuitBreaker.getStats().failures).toBe(1);
    });

    it('should not count already-open rejections as failures', async () => {
      // Open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(
          circuitBreaker.execute(() => Promise.reject(new Error('fail')))
        ).rejects.toThrow();
      }

      expect(circuitBreaker.getStats().failures).toBe(3);

      // Try to execute when open
      await expect(
        circuitBreaker.execute(() => Promise.resolve('success'))
      ).rejects.toThrow(CircuitOpenError);

      // Failures should still be 3 (not incremented)
      expect(circuitBreaker.getStats().failures).toBe(3);
    });

    it('should handle rapid success/failure alternation', async () => {
      await circuitBreaker.execute(() => Promise.resolve('s'));
      await expect(
        circuitBreaker.execute(() => Promise.reject(new Error('f')))
      ).rejects.toThrow();
      await circuitBreaker.execute(() => Promise.resolve('s'));
      await expect(
        circuitBreaker.execute(() => Promise.reject(new Error('f')))
      ).rejects.toThrow();

      // Should still be closed (failures reset by successes)
      expect(circuitBreaker.getState()).toBe('closed');
    });
  });
});

describe('CircuitBreaker Integration Scenarios', () => {
  describe('ShadowWire API Scenario', () => {
    it('should protect against ShadowWire API failures', async () => {
      vi.useFakeTimers();

      const shadowWireBreaker = new CircuitBreaker<{ success: boolean }>({
        failureThreshold: 5,
        resetTimeoutMs: 30000,
        successThreshold: 2,
        name: 'shadowwire',
      });

      // Simulate API being down
      const failingApi = () => Promise.reject(new Error('Connection refused'));

      // First 5 failures open the circuit
      for (let i = 0; i < 5; i++) {
        await expect(shadowWireBreaker.execute(failingApi)).rejects.toThrow();
      }

      expect(shadowWireBreaker.getState()).toBe('open');

      // Fast-fail for 30 seconds
      for (let i = 0; i < 10; i++) {
        await expect(
          shadowWireBreaker.execute(() => Promise.resolve({ success: true }))
        ).rejects.toThrow(CircuitOpenError);
      }

      // After 30 seconds, try again
      vi.advanceTimersByTime(31000);

      // Now API is back up
      const workingApi = () => Promise.resolve({ success: true });

      await shadowWireBreaker.execute(workingApi);
      expect(shadowWireBreaker.getState()).toBe('half-open');

      await shadowWireBreaker.execute(workingApi);
      expect(shadowWireBreaker.getState()).toBe('closed');

      vi.useRealTimers();
    });
  });

  describe('MPC Cluster Scenario', () => {
    it('should protect against MPC timeout cascade', async () => {
      // Use real timers but with immediate rejections to avoid timing issues
      const mpcBreaker = new CircuitBreaker<{ result: string }>({
        failureThreshold: 3,
        resetTimeoutMs: 60000, // 1 minute for MPC
        successThreshold: 1,
        name: 'mpc-cluster',
      });

      // Simulate immediate failures (like timeout errors from an external system)
      const failingApi = () => Promise.reject(new Error('MPC timeout'));

      // 3 failures open the circuit
      for (let i = 0; i < 3; i++) {
        await expect(mpcBreaker.execute(failingApi)).rejects.toThrow('MPC timeout');
      }

      expect(mpcBreaker.getState()).toBe('open');

      // Verify fast-fail - circuit should reject immediately without calling the function
      const start = performance.now();
      await expect(
        mpcBreaker.execute(() => Promise.resolve({ result: '1' }))
      ).rejects.toThrow(CircuitOpenError);
      const elapsed = performance.now() - start;

      // Should fail fast (< 50ms since no actual network call is made)
      expect(elapsed).toBeLessThan(50);
    });
  });
});
