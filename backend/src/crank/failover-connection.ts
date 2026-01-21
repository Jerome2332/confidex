/**
 * Failover Connection
 *
 * Provides RPC connection with automatic failover to backup endpoints
 * when the primary endpoint fails or becomes unhealthy.
 */

import { Connection, ConnectionConfig } from '@solana/web3.js';
import { withTimeout, TimeoutError, DEFAULT_TIMEOUTS } from '../lib/timeout.js';
import { classifyError, NetworkError, ErrorCode } from '../lib/errors.js';

export interface RpcEndpoint {
  url: string;
  weight?: number; // Higher weight = preferred (default: 1)
  maxRetries?: number; // Max retries before failover (default: 2)
}

export interface FailoverConnectionConfig {
  endpoints: RpcEndpoint[];
  commitment?: 'processed' | 'confirmed' | 'finalized';
  healthCheckIntervalMs?: number;
  healthCheckTimeoutMs?: number;
  maxConsecutiveFailures?: number;
  onEndpointChange?: (from: string, to: string, reason: string) => void;
}

interface EndpointState {
  endpoint: RpcEndpoint;
  consecutiveFailures: number;
  lastFailure: number | null;
  lastSuccess: number | null;
  isHealthy: boolean;
  latencyMs: number | null;
}

/**
 * RPC Connection with automatic failover
 */
export class FailoverConnection {
  private endpoints: EndpointState[];
  private currentIndex: number = 0;
  private connection: Connection;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private config: Required<Omit<FailoverConnectionConfig, 'endpoints' | 'onEndpointChange'>> & {
    onEndpointChange?: FailoverConnectionConfig['onEndpointChange'];
  };

  constructor(config: FailoverConnectionConfig) {
    if (config.endpoints.length === 0) {
      throw new Error('At least one endpoint is required');
    }

    this.config = {
      commitment: config.commitment ?? 'confirmed',
      healthCheckIntervalMs: config.healthCheckIntervalMs ?? 30_000,
      healthCheckTimeoutMs: config.healthCheckTimeoutMs ?? 5_000,
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
      onEndpointChange: config.onEndpointChange,
    };

    // Initialize endpoint states
    this.endpoints = config.endpoints.map((endpoint) => ({
      endpoint: {
        url: endpoint.url,
        weight: endpoint.weight ?? 1,
        maxRetries: endpoint.maxRetries ?? 2,
      },
      consecutiveFailures: 0,
      lastFailure: null,
      lastSuccess: null,
      isHealthy: true,
      latencyMs: null,
    }));

    // Sort by weight (descending)
    this.endpoints.sort((a, b) => (b.endpoint.weight ?? 1) - (a.endpoint.weight ?? 1));

    // Create initial connection
    this.connection = this.createConnection(this.endpoints[0].endpoint.url);

    console.log(`[FailoverConnection] Initialized with ${this.endpoints.length} endpoints`);
    console.log(`[FailoverConnection] Primary: ${this.endpoints[0].endpoint.url}`);
  }

  /**
   * Create a new connection to the specified URL
   */
  private createConnection(url: string): Connection {
    const connectionConfig: ConnectionConfig = {
      commitment: this.config.commitment,
      confirmTransactionInitialTimeout: DEFAULT_TIMEOUTS.TRANSACTION,
    };

    return new Connection(url, connectionConfig);
  }

  /**
   * Get the current connection
   */
  getConnection(): Connection {
    return this.connection;
  }

  /**
   * Get the current endpoint URL
   */
  getCurrentEndpoint(): string {
    return this.endpoints[this.currentIndex].endpoint.url;
  }

  /**
   * Start health checks
   */
  startHealthChecks(): void {
    if (this.healthCheckTimer) return;

    this.healthCheckTimer = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheckIntervalMs);

    console.log(`[FailoverConnection] Health checks started (interval: ${this.config.healthCheckIntervalMs}ms)`);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('[FailoverConnection] Health checks stopped');
    }
  }

  /**
   * Perform health checks on all endpoints
   */
  private async performHealthChecks(): Promise<void> {
    const checks = this.endpoints.map(async (state, index) => {
      try {
        const startTime = Date.now();
        const tempConnection = this.createConnection(state.endpoint.url);

        await withTimeout(tempConnection.getSlot(), {
          timeoutMs: this.config.healthCheckTimeoutMs,
          operation: `health check ${state.endpoint.url}`,
        });

        const latency = Date.now() - startTime;

        state.isHealthy = true;
        state.latencyMs = latency;
        state.lastSuccess = Date.now();
        state.consecutiveFailures = 0;
      } catch {
        state.isHealthy = false;
        state.lastFailure = Date.now();
        state.consecutiveFailures++;
      }
    });

    await Promise.allSettled(checks);

    // Check if we should switch to a healthier endpoint
    const currentState = this.endpoints[this.currentIndex];
    if (!currentState.isHealthy) {
      await this.failoverToHealthyEndpoint('health check failure');
    }
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    const state = this.endpoints[this.currentIndex];
    state.consecutiveFailures = 0;
    state.lastSuccess = Date.now();
    state.isHealthy = true;
  }

  /**
   * Record a failed operation and potentially failover
   */
  async recordFailure(error: unknown): Promise<boolean> {
    const state = this.endpoints[this.currentIndex];
    state.consecutiveFailures++;
    state.lastFailure = Date.now();

    // Check if error is network-related
    const classified = classifyError(error);
    const isNetworkError =
      classified instanceof NetworkError ||
      classified.code === ErrorCode.CONNECTION_TIMEOUT ||
      classified.code === ErrorCode.CONNECTION_RESET ||
      classified.code === ErrorCode.SERVICE_UNAVAILABLE;

    if (isNetworkError && state.consecutiveFailures >= this.config.maxConsecutiveFailures) {
      state.isHealthy = false;
      return await this.failoverToHealthyEndpoint('consecutive failures');
    }

    return false;
  }

  /**
   * Failover to the next healthy endpoint
   */
  private async failoverToHealthyEndpoint(reason: string): Promise<boolean> {
    const previousEndpoint = this.endpoints[this.currentIndex].endpoint.url;

    // Find next healthy endpoint
    for (let i = 0; i < this.endpoints.length; i++) {
      const index = (this.currentIndex + i + 1) % this.endpoints.length;
      const state = this.endpoints[index];

      if (state.isHealthy || state.consecutiveFailures < this.config.maxConsecutiveFailures) {
        this.currentIndex = index;
        this.connection = this.createConnection(state.endpoint.url);

        console.log(`[FailoverConnection] Switched from ${previousEndpoint} to ${state.endpoint.url} (reason: ${reason})`);

        if (this.config.onEndpointChange) {
          this.config.onEndpointChange(previousEndpoint, state.endpoint.url, reason);
        }

        return true;
      }
    }

    // All endpoints unhealthy, reset to primary
    console.warn('[FailoverConnection] All endpoints unhealthy, resetting to primary');
    this.currentIndex = 0;
    this.connection = this.createConnection(this.endpoints[0].endpoint.url);

    // Reset all failure counts
    for (const state of this.endpoints) {
      state.consecutiveFailures = 0;
      state.isHealthy = true;
    }

    return false;
  }

  /**
   * Execute an RPC operation with automatic failover
   */
  async executeWithFailover<T>(
    operation: (connection: Connection) => Promise<T>,
    options?: { maxRetries?: number; timeoutMs?: number }
  ): Promise<T> {
    const maxRetries = options?.maxRetries ?? 3;
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUTS.RPC;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const result = await withTimeout(operation(this.connection), {
          timeoutMs,
          operation: 'RPC call',
        });

        this.recordSuccess();
        return result;
      } catch (error) {
        lastError = error;

        // Record failure and potentially failover
        const didFailover = await this.recordFailure(error);

        if (didFailover) {
          console.log(`[FailoverConnection] Retrying after failover (attempt ${attempt + 1}/${maxRetries})`);
        } else if (attempt < maxRetries - 1) {
          // Short delay before retry on same endpoint
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
      }
    }

    throw lastError;
  }

  /**
   * Get status of all endpoints
   */
  getEndpointStatus(): Array<{
    url: string;
    isHealthy: boolean;
    isCurrent: boolean;
    consecutiveFailures: number;
    latencyMs: number | null;
  }> {
    return this.endpoints.map((state, index) => ({
      url: state.endpoint.url,
      isHealthy: state.isHealthy,
      isCurrent: index === this.currentIndex,
      consecutiveFailures: state.consecutiveFailures,
      latencyMs: state.latencyMs,
    }));
  }

  /**
   * Force switch to a specific endpoint
   */
  switchToEndpoint(url: string): boolean {
    const index = this.endpoints.findIndex((s) => s.endpoint.url === url);
    if (index === -1) return false;

    const previousEndpoint = this.endpoints[this.currentIndex].endpoint.url;
    this.currentIndex = index;
    this.connection = this.createConnection(url);

    console.log(`[FailoverConnection] Manually switched from ${previousEndpoint} to ${url}`);
    return true;
  }

  /**
   * Add a new endpoint
   */
  addEndpoint(endpoint: RpcEndpoint): void {
    this.endpoints.push({
      endpoint: {
        url: endpoint.url,
        weight: endpoint.weight ?? 1,
        maxRetries: endpoint.maxRetries ?? 2,
      },
      consecutiveFailures: 0,
      lastFailure: null,
      lastSuccess: null,
      isHealthy: true,
      latencyMs: null,
    });

    // Re-sort by weight
    this.endpoints.sort((a, b) => (b.endpoint.weight ?? 1) - (a.endpoint.weight ?? 1));
  }

  /**
   * Remove an endpoint
   */
  removeEndpoint(url: string): boolean {
    if (this.endpoints.length <= 1) return false;

    const index = this.endpoints.findIndex((s) => s.endpoint.url === url);
    if (index === -1) return false;

    // If removing current endpoint, switch first
    if (index === this.currentIndex) {
      this.failoverToHealthyEndpoint('endpoint removed');
    }

    this.endpoints.splice(index, 1);

    // Adjust current index if needed
    if (this.currentIndex >= this.endpoints.length) {
      this.currentIndex = 0;
    }

    return true;
  }
}

/**
 * Create a FailoverConnection from environment variables
 */
export function createFailoverConnectionFromEnv(): FailoverConnection {
  const endpoints: RpcEndpoint[] = [];

  // Primary endpoint
  const primaryUrl = process.env.HELIUS_RPC_URL || process.env.RPC_URL || 'https://api.devnet.solana.com';
  endpoints.push({ url: primaryUrl, weight: 10 });

  // Backup endpoints (comma-separated)
  const backupUrls = process.env.BACKUP_RPC_URLS?.split(',').filter(Boolean) || [];
  for (const url of backupUrls) {
    endpoints.push({ url: url.trim(), weight: 5 });
  }

  // Fallback public endpoint
  if (!endpoints.some((e) => e.url.includes('devnet.solana.com'))) {
    endpoints.push({ url: 'https://api.devnet.solana.com', weight: 1 });
  }

  return new FailoverConnection({
    endpoints,
    commitment: 'confirmed',
    healthCheckIntervalMs: parseInt(process.env.RPC_HEALTH_CHECK_INTERVAL_MS || '30000', 10),
    maxConsecutiveFailures: parseInt(process.env.RPC_MAX_FAILURES || '3', 10),
  });
}
