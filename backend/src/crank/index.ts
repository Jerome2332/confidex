/**
 * Crank Service
 *
 * Main orchestrator for automated order matching.
 * Coordinates order monitoring, matching algorithm, and execution.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { CrankConfig, loadCrankConfig, validateConfig } from './config.js';
import { CrankWallet, generateCrankWallet } from './crank-wallet.js';
import { OrderMonitor } from './order-monitor.js';
import { MatchingAlgorithm } from './matching-algorithm.js';
import { OrderStateManager } from './order-state-manager.js';
import { MatchExecutor } from './match-executor.js';
import { CrankStatus, CrankMetrics, CrankStatusResponse } from './types.js';

export class CrankService {
  private config: CrankConfig;
  private connection: Connection;
  private wallet: CrankWallet;
  private orderMonitor: OrderMonitor;
  private matchingAlgorithm: MatchingAlgorithm;
  private stateManager: OrderStateManager;
  private matchExecutor: MatchExecutor | null = null;

  // Service state
  private status: CrankStatus = 'stopped';
  private pollTimer: NodeJS.Timeout | null = null;
  private metrics: CrankMetrics;

  // Circuit breaker
  private consecutiveErrors: number = 0;
  private circuitBreakerActive: boolean = false;

  constructor(config?: CrankConfig) {
    this.config = config || loadCrankConfig();
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');
    this.wallet = new CrankWallet(
      this.connection,
      this.config.walletPath,
      this.config.minSolBalance
    );
    this.orderMonitor = new OrderMonitor(
      this.connection,
      new PublicKey(this.config.programs.confidexDex)
    );
    this.matchingAlgorithm = new MatchingAlgorithm();
    this.stateManager = new OrderStateManager();

    this.metrics = this.initializeMetrics();
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): CrankMetrics {
    return {
      status: 'stopped',
      startedAt: null,
      lastPollAt: null,
      totalPolls: 0,
      totalMatchAttempts: 0,
      successfulMatches: 0,
      failedMatches: 0,
      consecutiveErrors: 0,
      walletBalance: null,
      openOrderCount: 0,
      pendingMatches: 0,
    };
  }

  /**
   * Start the crank service
   */
  async start(): Promise<void> {
    if (this.status === 'running') {
      console.log('[CrankService] Already running');
      return;
    }

    console.log('[CrankService] Starting...');
    this.status = 'starting';
    this.metrics.status = 'starting';

    try {
      // Validate config
      const { warnings } = validateConfig(this.config);
      for (const warning of warnings) {
        console.warn(`[CrankService] Warning: ${warning}`);
      }

      // Load wallet
      await this.wallet.load();
      await this.wallet.logBalanceStatus();

      // Initialize match executor with loaded wallet
      this.matchExecutor = new MatchExecutor(
        this.connection,
        this.wallet.getKeypair(),
        this.config
      );

      // Start polling loop
      this.status = 'running';
      this.metrics.status = 'running';
      this.metrics.startedAt = Date.now();

      console.log('[CrankService] Started successfully');
      console.log(`[CrankService] Polling every ${this.config.pollingIntervalMs}ms`);
      console.log(`[CrankService] Using ${this.config.useAsyncMpc ? 'async' : 'sync'} MPC flow`);

      // Run first poll immediately
      await this.poll();

      // Schedule recurring polls
      this.schedulePoll();
    } catch (error) {
      console.error('[CrankService] Failed to start:', error);
      this.status = 'error';
      this.metrics.status = 'error';
      throw error;
    }
  }

  /**
   * Stop the crank service
   */
  stop(): void {
    console.log('[CrankService] Stopping...');

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.status = 'stopped';
    this.metrics.status = 'stopped';
    this.stateManager.clearAllLocks();

    console.log('[CrankService] Stopped');
  }

  /**
   * Pause the crank service
   */
  pause(): void {
    if (this.status !== 'running') {
      console.log('[CrankService] Not running, cannot pause');
      return;
    }

    console.log('[CrankService] Pausing...');

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.status = 'paused';
    this.metrics.status = 'paused';

    console.log('[CrankService] Paused');
  }

  /**
   * Resume the crank service
   */
  resume(): void {
    if (this.status !== 'paused') {
      console.log('[CrankService] Not paused, cannot resume');
      return;
    }

    console.log('[CrankService] Resuming...');
    this.status = 'running';
    this.metrics.status = 'running';
    this.consecutiveErrors = 0;
    this.circuitBreakerActive = false;

    this.schedulePoll();

    console.log('[CrankService] Resumed');
  }

  /**
   * Schedule next poll
   */
  private schedulePoll(): void {
    if (this.status !== 'running') return;

    this.pollTimer = setTimeout(async () => {
      await this.poll();
      this.schedulePoll();
    }, this.config.pollingIntervalMs);
  }

  /**
   * Main polling loop
   */
  private async poll(): Promise<void> {
    if (this.status !== 'running') return;

    // Check circuit breaker
    if (this.circuitBreakerActive) {
      console.log('[CrankService] Circuit breaker active, skipping poll');
      return;
    }

    this.metrics.totalPolls++;
    this.metrics.lastPollAt = Date.now();

    try {
      // Fetch open orders
      const orders = await this.orderMonitor.fetchAllOpenOrders();
      this.metrics.openOrderCount = orders.length;

      if (orders.length === 0) {
        console.log('[CrankService] No open orders found');
        this.resetConsecutiveErrors();
        return;
      }

      // Get order counts
      const counts = this.orderMonitor.getOrderCounts(orders);
      console.log(`[CrankService] Found ${orders.length} orders (${counts.buy} buy, ${counts.sell} sell)`);

      // Skip if no orders on one side
      if (counts.buy === 0 || counts.sell === 0) {
        console.log('[CrankService] Need orders on both sides to match');
        this.resetConsecutiveErrors();
        return;
      }

      // Find match candidates
      const lockedOrders = this.stateManager.getLockedOrders();
      const candidates = this.matchingAlgorithm.findMatchCandidates(orders, lockedOrders);

      if (candidates.length === 0) {
        console.log('[CrankService] No matchable candidates found');
        this.resetConsecutiveErrors();
        return;
      }

      // Select top candidates
      const selectedCandidates = this.matchingAlgorithm.selectTopCandidates(
        candidates,
        this.config.maxConcurrentMatches
      );

      console.log(`[CrankService] Processing ${selectedCandidates.length} match candidates`);

      // Execute matches
      for (const candidate of selectedCandidates) {
        const buyPda = candidate.buyOrder.pda.toString();
        const sellPda = candidate.sellOrder.pda.toString();

        // Acquire locks
        if (!this.stateManager.acquireLocks(buyPda, sellPda)) {
          console.log(`[CrankService] Could not acquire locks, skipping`);
          continue;
        }

        try {
          this.metrics.totalMatchAttempts++;
          const result = await this.matchExecutor!.executeMatch(candidate);

          if (result.success) {
            this.metrics.successfulMatches++;
            console.log(`[CrankService] Match executed: ${result.signature}`);
          } else {
            this.metrics.failedMatches++;
            console.log(`[CrankService] Match failed: ${result.error}`);
          }

          // Release locks after match attempt
          this.stateManager.releaseLocks(buyPda, sellPda);
          this.resetConsecutiveErrors();
        } catch (error) {
          console.error('[CrankService] Error executing match:', error);
          this.stateManager.releaseLocks(buyPda, sellPda);
          this.incrementConsecutiveErrors();
        }
      }

      // Update pending matches count
      this.metrics.pendingMatches = this.stateManager.getPendingMatchCount();
    } catch (error) {
      console.error('[CrankService] Poll error:', error);
      this.incrementConsecutiveErrors();
    }
  }

  /**
   * Reset consecutive errors counter
   */
  private resetConsecutiveErrors(): void {
    this.consecutiveErrors = 0;
    this.metrics.consecutiveErrors = 0;
  }

  /**
   * Increment consecutive errors and check circuit breaker
   */
  private incrementConsecutiveErrors(): void {
    this.consecutiveErrors++;
    this.metrics.consecutiveErrors = this.consecutiveErrors;

    if (this.consecutiveErrors >= this.config.circuitBreaker.errorThreshold) {
      console.warn('[CrankService] Circuit breaker triggered!');
      this.circuitBreakerActive = true;

      // Reset after pause duration
      setTimeout(() => {
        console.log('[CrankService] Circuit breaker reset');
        this.circuitBreakerActive = false;
        this.consecutiveErrors = 0;
        this.metrics.consecutiveErrors = 0;
      }, this.config.circuitBreaker.pauseDurationMs);
    }
  }

  /**
   * Get current status and metrics
   */
  async getStatus(): Promise<CrankStatusResponse> {
    // Update wallet balance
    if (this.status === 'running' || this.status === 'paused') {
      try {
        this.metrics.walletBalance = await this.wallet.getBalance();
      } catch {
        // Ignore balance fetch errors
      }
    }

    return {
      status: this.status,
      metrics: { ...this.metrics },
      config: {
        pollingIntervalMs: this.config.pollingIntervalMs,
        useAsyncMpc: this.config.useAsyncMpc,
        maxConcurrentMatches: this.config.maxConcurrentMatches,
      },
    };
  }

  /**
   * Get the current status
   */
  getServiceStatus(): CrankStatus {
    return this.status;
  }
}

// Export utilities
export { loadCrankConfig, validateConfig } from './config.js';
export { CrankWallet, generateCrankWallet } from './crank-wallet.js';
export { OrderMonitor } from './order-monitor.js';
export { MatchingAlgorithm } from './matching-algorithm.js';
export { OrderStateManager } from './order-state-manager.js';
export { MatchExecutor } from './match-executor.js';
export * from './types.js';
