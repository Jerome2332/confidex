/**
 * Crank Service
 *
 * Main orchestrator for automated order matching.
 * Coordinates order monitoring, matching algorithm, and execution.
 * Includes circuit breaker alerting, error classification, graceful shutdown,
 * and distributed locking for multi-instance coordination.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { CrankConfig, loadCrankConfig, validateConfig } from './config.js';
import { CrankWallet, generateCrankWallet } from './crank-wallet.js';
import { OrderMonitor } from './order-monitor.js';
import { MatchingAlgorithm } from './matching-algorithm.js';
import { OrderStateManager } from './order-state-manager.js';
import { MatchExecutor } from './match-executor.js';
import { MpcPoller } from './mpc-poller.js';
import { SettlementExecutor } from './settlement-executor.js';
import { CrankStatus, CrankMetrics, CrankStatusResponse } from './types.js';
import { initAlertManagerFromEnv, AlertManager } from '../lib/alerts.js';
import { classifyError } from '../lib/errors.js';
import { DatabaseClient } from '../db/client.js';
import { DatabaseManager } from '../db/index.js';
import { DistributedLockService, LOCK_NAMES } from './distributed-lock.js';
import { logger } from '../lib/logger.js';
// RPC reliability components
import { FailoverConnection, createFailoverConnectionFromEnv } from './failover-connection.js';
import { BlockhashManager, createBlockhashManagerFromEnv } from './blockhash-manager.js';
// Prometheus metrics
import {
  crankMatchAttemptsTotal,
  crankMatchDuration,
  crankOpenOrders,
  crankPendingMatches,
  crankConsecutiveErrors,
  crankStatus,
  walletBalance,
} from '../routes/metrics.js';
// V6 Async MPC services
import { PositionVerifier } from './position-verifier.js';
import { MarginProcessor } from './margin-processor.js';
import { LiquidationChecker } from './liquidation-checker.js';
// V7 Close position service
import { ClosePositionProcessor } from './close-position-processor.js';
// V7 Funding settlement service
import { FundingSettlementProcessor } from './funding-settlement-processor.js';

const log = logger.crank;

export class CrankService {
  private config: CrankConfig;
  private connection: Connection;
  private wallet: CrankWallet;
  private orderMonitor: OrderMonitor;
  private matchingAlgorithm: MatchingAlgorithm;
  private stateManager: OrderStateManager;
  private matchExecutor: MatchExecutor | null = null;
  private mpcPoller: MpcPoller | null = null;
  private settlementExecutor: SettlementExecutor | null = null;

  // V6 Async MPC services for perpetuals
  private positionVerifier: PositionVerifier | null = null;
  private marginProcessor: MarginProcessor | null = null;
  private liquidationChecker: LiquidationChecker | null = null;
  // V7 Close position processor
  private closePositionProcessor: ClosePositionProcessor | null = null;
  // V7 Funding settlement processor
  private fundingSettlementProcessor: FundingSettlementProcessor | null = null;

  // Service state
  private status: CrankStatus = 'stopped';
  private pollTimer: NodeJS.Timeout | null = null;
  private metrics: CrankMetrics;

  // Circuit breaker
  private consecutiveErrors: number = 0;
  private circuitBreakerActive: boolean = false;

  // Alerting
  private alertManager: AlertManager;

  // Persistence and distributed locking
  private db: DatabaseManager | null = null;
  private lockService: DistributedLockService | null = null;
  private isShuttingDown: boolean = false;
  private activeOperations: Set<Promise<unknown>> = new Set();

  // RPC reliability components
  private failoverConnection: FailoverConnection | null = null;
  private blockhashManager: BlockhashManager | null = null;

  constructor(config?: CrankConfig) {
    this.config = config || loadCrankConfig();

    // Initialize FailoverConnection for RPC reliability
    this.failoverConnection = createFailoverConnectionFromEnv();
    this.connection = this.failoverConnection.getConnection();

    // Initialize BlockhashManager for blockhash caching
    this.blockhashManager = createBlockhashManagerFromEnv(this.connection);

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

    // Initialize alerting from environment variables
    this.alertManager = initAlertManagerFromEnv();

    this.metrics = this.initializeMetrics();

    // Setup graceful shutdown handlers
    this.setupShutdownHandlers();
  }

  /**
   * Setup process signal handlers for graceful shutdown
   */
  private setupShutdownHandlers(): void {
    const shutdown = async (signal: string) => {
      log.info({ signal }, 'Received shutdown signal, initiating graceful shutdown');
      await this.gracefulShutdown();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      log.fatal({ error }, 'Uncaught exception');
      this.alertManager.critical(
        'Uncaught Exception',
        `Crank service crashed: ${error.message}`,
        { stack: error.stack },
        'uncaught-exception'
      );
      await this.gracefulShutdown();
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason) => {
      log.error({ reason }, 'Unhandled rejection');
      this.alertManager.error(
        'Unhandled Rejection',
        `Unhandled promise rejection: ${reason}`,
        { reason: String(reason) },
        'unhandled-rejection'
      );
    });
  }

  /**
   * Initialize the persistence layer
   */
  private initializePersistence(): void {
    const dbClient = DatabaseClient.getInstance(this.config.dbPath);
    this.db = new DatabaseManager(dbClient);
    this.db.initialize();
    log.info({ dbPath: this.config.dbPath }, 'Database initialized');

    // Initialize distributed lock service
    this.lockService = new DistributedLockService(this.db.locks);
    log.info({ instanceId: this.lockService.getInstanceId() }, 'Lock service initialized');
  }

  /**
   * Recover pending operations from a previous crash/restart
   * This should be called after persistence is initialized but before normal polling starts
   */
  private async recoverPendingOperations(): Promise<void> {
    if (!this.db) {
      log.warn('Database not initialized, skipping recovery');
      return;
    }

    log.info('Starting pending operations recovery');

    try {
      // Release any stale locks from previous instance
      const staleLockTimeout = 300; // 5 minutes
      const releasedLocks = this.db.pendingOps.releaseStaleLocks(staleLockTimeout);
      if (releasedLocks > 0) {
        log.info({ releasedLocks, timeoutSeconds: staleLockTimeout }, 'Released stale operation locks');
      }

      // Get counts before recovery
      const statusCounts = this.db.pendingOps.getCountByStatus();
      log.info({
        pending: statusCounts.pending,
        inProgress: statusCounts.in_progress,
        completed: statusCounts.completed,
        failed: statusCounts.failed,
      }, 'Pending operations status before recovery');

      // Find pending match operations
      const pendingMatches = this.db.pendingOps.findReadyToProcess('match', 100);
      if (pendingMatches.length > 0) {
        log.info({ count: pendingMatches.length }, 'Found pending match operations to recover');

        for (const op of pendingMatches) {
          try {
            // Parse the payload
            const payload = JSON.parse(op.payload);
            log.debug({
              operationId: op.id,
              buyOrderPda: payload.buyOrderPda?.slice(0, 8),
              sellOrderPda: payload.sellOrderPda?.slice(0, 8),
            }, 'Recovering match operation');

            // Mark as in progress (will be picked up by normal polling if orders still valid)
            // We don't re-execute immediately - let the normal poll cycle handle it
            // This prevents duplicate execution attempts
            this.db.pendingOps.markInProgress(op.id, this.lockService?.getInstanceId() || 'recovery');

            // Note: The actual re-matching will happen in the next poll cycle
            // if the orders are still valid and matchable
          } catch (parseError) {
            log.error({
              operationId: op.id,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            }, 'Failed to parse pending match operation');
            this.db.pendingOps.markFailed(op.id, 'Invalid payload during recovery');
          }
        }
      }

      // Find pending settlement operations
      const pendingSettlements = this.db.pendingOps.findReadyToProcess('settlement', 100);
      if (pendingSettlements.length > 0) {
        log.info({ count: pendingSettlements.length }, 'Found pending settlement operations to recover');

        for (const op of pendingSettlements) {
          try {
            const payload = JSON.parse(op.payload);
            log.debug({
              operationId: op.id,
              matchId: payload.matchId?.slice(0, 8),
            }, 'Recovering settlement operation');

            // Mark as in progress - settlement executor will pick these up
            this.db.pendingOps.markInProgress(op.id, this.lockService?.getInstanceId() || 'recovery');
          } catch (parseError) {
            log.error({
              operationId: op.id,
              error: parseError instanceof Error ? parseError.message : String(parseError),
            }, 'Failed to parse pending settlement operation');
            this.db.pendingOps.markFailed(op.id, 'Invalid payload during recovery');
          }
        }
      }

      // Find pending MPC callback operations
      const pendingCallbacks = this.db.pendingOps.findReadyToProcess('mpc_callback', 100);
      if (pendingCallbacks.length > 0) {
        log.info({ count: pendingCallbacks.length }, 'Found pending MPC callback operations to recover');

        for (const op of pendingCallbacks) {
          try {
            // MPC callbacks are handled by the MPC poller - mark for reprocessing
            this.db.pendingOps.markInProgress(op.id, this.lockService?.getInstanceId() || 'recovery');
          } catch (err) {
            log.error({
              operationId: op.id,
              error: err instanceof Error ? err.message : String(err),
            }, 'Failed to recover MPC callback operation');
            this.db.pendingOps.markFailed(op.id, 'Recovery failed');
          }
        }
      }

      // Run maintenance to clean up old completed/failed operations
      const maintenance = this.db.runMaintenance();
      log.info({
        transactionsDeleted: maintenance.transactionsDeleted,
        completedOpsDeleted: maintenance.completedOpsDeleted,
        failedOpsDeleted: maintenance.failedOpsDeleted,
        expiredLocksDeleted: maintenance.expiredLocksDeleted,
        staleOrdersDeleted: maintenance.staleOrdersDeleted,
        mpcRecordsDeleted: maintenance.mpcRecordsDeleted,
      }, 'Database maintenance completed');

      log.info({
        matchesRecovered: pendingMatches.length,
        settlementsRecovered: pendingSettlements.length,
        callbacksRecovered: pendingCallbacks.length,
      }, 'Pending operations recovery completed');
    } catch (error) {
      log.error({
        error: error instanceof Error ? error.message : String(error),
      }, 'Error during pending operations recovery');
      // Don't throw - allow service to start even if recovery partially fails
    }
  }

  /**
   * Graceful shutdown - waits for active operations to complete
   */
  async gracefulShutdown(): Promise<void> {
    if (this.isShuttingDown) {
      log.info('Already shutting down');
      return;
    }

    this.isShuttingDown = true;
    log.info('Initiating graceful shutdown');

    // Stop accepting new work
    this.pause();

    // Wait for active operations with timeout
    const shutdownTimeout = this.config.shutdownTimeoutMs;
    const startTime = Date.now();

    log.info({ activeOperations: this.activeOperations.size, timeoutMs: shutdownTimeout }, 'Waiting for active operations');

    // Wait for active operations
    while (this.activeOperations.size > 0) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= shutdownTimeout) {
        log.warn({ pendingOperations: this.activeOperations.size }, 'Shutdown timeout reached with operations still pending');
        break;
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // Release distributed locks
    if (this.lockService) {
      const releasedLocks = this.lockService.releaseAll();
      log.info({ releasedLocks }, 'Released distributed locks');
      await this.lockService.shutdown();
    }

    // Stop the service
    this.stop();

    // Close database connection
    if (this.db) {
      this.db.close();
      log.info('Database connection closed');
    }

    // Send shutdown complete alert
    await this.alertManager.info(
      'Crank Service Shutdown',
      'Crank service has shut down gracefully.',
      {
        shutdownDurationMs: Date.now() - startTime,
        operationsCompleted: this.activeOperations.size === 0,
      },
      'crank-shutdown'
    );

    log.info('Graceful shutdown complete');
  }

  /**
   * Track an active operation for graceful shutdown
   */
  private trackOperation<T>(operation: Promise<T>): Promise<T> {
    this.activeOperations.add(operation);

    return operation.finally(() => {
      this.activeOperations.delete(operation);
    });
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
      log.info('Already running');
      return;
    }

    log.info('Starting crank service');
    this.status = 'starting';
    this.metrics.status = 'starting';
    this.isShuttingDown = false;

    try {
      // Initialize persistence layer
      this.initializePersistence();

      // Try to acquire startup lock (prevents multiple instances starting)
      if (this.lockService) {
        const startupLock = this.lockService.tryAcquire(LOCK_NAMES.CRANK_STARTUP, { ttlSeconds: 30 });
        if (!startupLock) {
          log.warn('Another instance is starting, waiting');
          // Wait and retry
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }

      // Validate config
      const { warnings } = validateConfig(this.config);
      for (const warning of warnings) {
        log.warn({ warning }, 'Configuration warning');
      }

      // Recover any pending operations from previous crash/restart
      await this.recoverPendingOperations();

      // Start RPC reliability components
      if (this.failoverConnection) {
        this.failoverConnection.startHealthChecks();
        log.info('RPC failover health checks started');
      }
      if (this.blockhashManager) {
        this.blockhashManager.start();
        log.info('Blockhash manager started');
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

      // Initialize MPC poller for async MPC flow
      if (this.config.useAsyncMpc) {
        this.mpcPoller = new MpcPoller(
          this.connection,
          this.wallet.getKeypair(),
          this.config,
          this.db?.mpcProcessed // Pass database repository for persistence
        );
        this.mpcPoller.start();
        log.info('MPC result poller started');
      }

      // Initialize settlement executor to settle matched orders
      this.settlementExecutor = new SettlementExecutor(
        this.connection,
        this.wallet.getKeypair(),
        this.config
      );
      this.settlementExecutor.start();
      log.info('Settlement executor started');

      // Initialize V6 async MPC services for perpetuals
      if (this.config.useAsyncMpc) {
        // Position verification service
        this.positionVerifier = new PositionVerifier(
          this.connection,
          this.wallet.getKeypair(),
          this.config
        );
        await this.positionVerifier.start();
        log.info('Position verifier started');

        // Margin operation processor
        this.marginProcessor = new MarginProcessor(
          this.connection,
          this.wallet.getKeypair(),
          this.config
        );
        await this.marginProcessor.start();
        log.info('Margin processor started');

        // Liquidation checker
        this.liquidationChecker = new LiquidationChecker(
          this.connection,
          this.wallet.getKeypair(),
          this.config
        );
        await this.liquidationChecker.start();
        log.info('Liquidation checker started');

        // V7 Close position processor
        this.closePositionProcessor = new ClosePositionProcessor(
          this.connection,
          this.wallet.getKeypair(),
          this.config
        );
        await this.closePositionProcessor.start();
        log.info('Close position processor started');

        // V7 Funding settlement processor
        this.fundingSettlementProcessor = new FundingSettlementProcessor(
          this.connection,
          this.wallet.getKeypair(),
          this.config
        );
        await this.fundingSettlementProcessor.start();
        log.info('Funding settlement processor started');
      }

      // Start polling loop
      this.status = 'running';
      this.metrics.status = 'running';
      this.metrics.startedAt = Date.now();

      // Record Prometheus metric for crank status (1 = running)
      crankStatus.set(1);

      log.info({
        pollingIntervalMs: this.config.pollingIntervalMs,
        useAsyncMpc: this.config.useAsyncMpc,
      }, 'Crank service started successfully');

      // Run first poll immediately
      await this.poll();

      // Schedule recurring polls
      this.schedulePoll();
    } catch (error) {
      log.error({ error }, 'Failed to start crank service');
      this.status = 'error';
      this.metrics.status = 'error';
      throw error;
    }
  }

  /**
   * Stop the crank service
   */
  stop(): void {
    log.info('Stopping crank service');

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    // Stop MPC poller
    if (this.mpcPoller) {
      this.mpcPoller.stop();
      this.mpcPoller = null;
    }

    // Stop settlement executor
    if (this.settlementExecutor) {
      this.settlementExecutor.stop();
      this.settlementExecutor = null;
    }

    // Stop V6 async MPC services
    if (this.positionVerifier) {
      this.positionVerifier.stop();
      this.positionVerifier = null;
    }

    if (this.marginProcessor) {
      this.marginProcessor.stop();
      this.marginProcessor = null;
    }

    if (this.liquidationChecker) {
      this.liquidationChecker.stop();
      this.liquidationChecker = null;
    }

    if (this.closePositionProcessor) {
      this.closePositionProcessor.stop();
      this.closePositionProcessor = null;
    }

    if (this.fundingSettlementProcessor) {
      this.fundingSettlementProcessor.stop();
      this.fundingSettlementProcessor = null;
    }

    // Stop RPC reliability components
    if (this.blockhashManager) {
      this.blockhashManager.stop();
      log.info('Blockhash manager stopped');
    }
    if (this.failoverConnection) {
      this.failoverConnection.stopHealthChecks();
      log.info('RPC failover health checks stopped');
    }

    this.status = 'stopped';
    this.metrics.status = 'stopped';
    this.stateManager.clearAllLocks();

    // Record Prometheus metric for crank status (0 = stopped)
    crankStatus.set(0);

    log.info('Crank service stopped');
  }

  /**
   * Pause the crank service
   */
  pause(): void {
    if (this.status !== 'running') {
      log.info('Not running, cannot pause');
      return;
    }

    log.info('Pausing crank service');

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    this.status = 'paused';
    this.metrics.status = 'paused';

    // Record Prometheus metric for crank status (-1 = paused)
    crankStatus.set(-1);

    log.info('Crank service paused');
  }

  /**
   * Resume the crank service
   */
  resume(): void {
    if (this.status !== 'paused') {
      log.info('Not paused, cannot resume');
      return;
    }

    log.info('Resuming crank service');
    this.status = 'running';
    this.metrics.status = 'running';
    this.consecutiveErrors = 0;
    this.circuitBreakerActive = false;

    // Record Prometheus metrics
    crankStatus.set(1); // 1 = running
    crankConsecutiveErrors.set(0);

    this.schedulePoll();

    log.info('Crank service resumed');
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
      log.debug('Circuit breaker active, skipping poll');
      return;
    }

    this.metrics.totalPolls++;
    this.metrics.lastPollAt = Date.now();

    try {
      // Fetch open orders
      const orders = await this.orderMonitor.fetchAllOpenOrders();
      this.metrics.openOrderCount = orders.length;

      // Record Prometheus metrics for open orders
      const orderCounts = this.orderMonitor.getOrderCounts(orders);
      crankOpenOrders.set({ side: 'buy' }, orderCounts.buy);
      crankOpenOrders.set({ side: 'sell' }, orderCounts.sell);

      if (orders.length === 0) {
        log.debug('No open orders found');
        this.resetConsecutiveErrors();
        return;
      }

      // Get order counts
      const counts = this.orderMonitor.getOrderCounts(orders);
      log.info({ total: orders.length, buy: counts.buy, sell: counts.sell }, 'Found orders');

      // Debug: Log each order's details (V5: no plaintext fields)
      for (const { pda, order } of orders) {
        const sideStr = order.side === 0 ? 'BUY' : 'SELL';
        log.debug({
          pda: pda.toString().slice(0, 12),
          side: sideStr,
          maker: order.maker.toString().slice(0, 12),
          createdAtHour: Number(order.createdAtHour),
        }, 'Order details');
      }

      // Skip if no orders on one side
      if (counts.buy === 0 || counts.sell === 0) {
        log.debug('Need orders on both sides to match');
        this.resetConsecutiveErrors();
        return;
      }

      // Find match candidates
      const lockedOrders = this.stateManager.getLockedOrders();
      const candidates = this.matchingAlgorithm.findMatchCandidates(orders, lockedOrders);

      if (candidates.length === 0) {
        log.debug('No matchable candidates found');
        this.resetConsecutiveErrors();
        return;
      }

      // Select top candidates
      const selectedCandidates = this.matchingAlgorithm.selectTopCandidates(
        candidates,
        this.config.maxConcurrentMatches
      );

      log.info({ count: selectedCandidates.length }, 'Processing match candidates');

      // Execute matches
      for (const candidate of selectedCandidates) {
        const buyPda = candidate.buyOrder.pda.toString();
        const sellPda = candidate.sellOrder.pda.toString();

        // Acquire locks
        if (!this.stateManager.acquireLocks(buyPda, sellPda)) {
          log.debug({ buyPda: buyPda.slice(0, 8), sellPda: sellPda.slice(0, 8) }, 'Could not acquire locks, skipping');
          continue;
        }

        try {
          this.metrics.totalMatchAttempts++;

          // Track operation for graceful shutdown and measure duration
          const matchStartTime = Date.now();
          const matchOperation = this.matchExecutor!.executeMatch(candidate);
          const result = await this.trackOperation(matchOperation);
          const matchDurationSec = (Date.now() - matchStartTime) / 1000;

          // Record Prometheus metrics
          crankMatchDuration.observe({ type: 'spot' }, matchDurationSec);

          if (result.success) {
            this.metrics.successfulMatches++;
            crankMatchAttemptsTotal.inc({ status: 'success' });
            log.info({ signature: result.signature }, 'Match executed successfully');
          } else {
            this.metrics.failedMatches++;
            crankMatchAttemptsTotal.inc({ status: 'failed' });
            log.warn({ error: result.error }, 'Match failed');
          }

          // Release locks after match attempt
          this.stateManager.releaseLocks(buyPda, sellPda);
          this.resetConsecutiveErrors();
        } catch (error) {
          log.error({ error }, 'Error executing match');
          this.stateManager.releaseLocks(buyPda, sellPda);
          this.incrementConsecutiveErrors(error);
        }
      }

      // Update pending matches count
      this.metrics.pendingMatches = this.stateManager.getPendingMatchCount();
      crankPendingMatches.set(this.metrics.pendingMatches);
    } catch (error) {
      log.error({ error }, 'Poll error');
      this.incrementConsecutiveErrors(error);
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
  private incrementConsecutiveErrors(error?: unknown): void {
    this.consecutiveErrors++;
    this.metrics.consecutiveErrors = this.consecutiveErrors;

    // Record Prometheus metric
    crankConsecutiveErrors.set(this.consecutiveErrors);

    if (this.consecutiveErrors >= this.config.circuitBreaker.errorThreshold) {
      log.warn({ consecutiveErrors: this.consecutiveErrors }, 'Circuit breaker triggered');
      this.circuitBreakerActive = true;

      // Classify and alert on circuit breaker activation
      const classified = error ? classifyError(error) : null;
      this.alertManager.critical(
        'Circuit Breaker Triggered',
        `Crank service paused after ${this.consecutiveErrors} consecutive errors. ` +
        `Will resume in ${this.config.circuitBreaker.pauseDurationMs / 1000}s.`,
        {
          consecutiveErrors: this.consecutiveErrors,
          threshold: this.config.circuitBreaker.errorThreshold,
          pauseDurationMs: this.config.circuitBreaker.pauseDurationMs,
          lastErrorType: classified?.name || 'Unknown',
          lastErrorMessage: classified?.message || 'No error details',
          lastErrorCode: classified?.code || 0,
        },
        'circuit-breaker-triggered' // Dedupe key
      );

      // Reset after pause duration
      setTimeout(() => {
        log.info('Circuit breaker reset');
        this.circuitBreakerActive = false;
        this.consecutiveErrors = 0;
        this.metrics.consecutiveErrors = 0;

        // Send recovery alert
        this.alertManager.info(
          'Circuit Breaker Reset',
          'Crank service resumed after circuit breaker cooldown.',
          {
            pauseDurationMs: this.config.circuitBreaker.pauseDurationMs,
          },
          'circuit-breaker-reset' // Dedupe key
        );
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
        // Record Prometheus metric for wallet balance
        walletBalance.set({ wallet: 'crank' }, this.metrics.walletBalance);
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
   * Get metrics for Prometheus export
   */
  getMetrics(): CrankMetrics {
    return { ...this.metrics };
  }

  /**
   * Get the current status
   */
  getServiceStatus(): CrankStatus {
    return this.status;
  }

  /**
   * Skip all pending MPC computations
   * Useful for clearing stale computations that will never complete
   */
  async skipPendingMpcComputations(): Promise<number> {
    if (!this.mpcPoller) {
      log.warn('MPC poller not initialized');
      return 0;
    }
    return this.mpcPoller.skipAllPending();
  }

  /**
   * Get RPC health status including failover endpoints
   */
  getRpcHealth(): {
    endpoints: Array<{
      url: string;
      isHealthy: boolean;
      isCurrent: boolean;
      consecutiveFailures: number;
      latencyMs: number | null;
    }>;
    blockhash: {
      cacheSize: number;
      oldestAge: number | null;
      newestAge: number | null;
      currentSlot: number;
      isRefreshing: boolean;
    };
  } | null {
    if (!this.failoverConnection || !this.blockhashManager) {
      return null;
    }

    return {
      endpoints: this.failoverConnection.getEndpointStatus(),
      blockhash: this.blockhashManager.getStats(),
    };
  }
}

// Export utilities
export { loadCrankConfig, validateConfig } from './config.js';
export { CrankWallet, generateCrankWallet } from './crank-wallet.js';
export { OrderMonitor } from './order-monitor.js';
export { MatchingAlgorithm } from './matching-algorithm.js';
export { OrderStateManager } from './order-state-manager.js';
export { MatchExecutor } from './match-executor.js';
export { MpcPoller } from './mpc-poller.js';
export { SettlementExecutor } from './settlement-executor.js';
// V6 Async MPC services for perpetuals
export { PositionVerifier } from './position-verifier.js';
export { MarginProcessor } from './margin-processor.js';
export { LiquidationChecker } from './liquidation-checker.js';
// V7 Close position processor
export { ClosePositionProcessor } from './close-position-processor.js';
// V7 Funding settlement processor
export { FundingSettlementProcessor } from './funding-settlement-processor.js';
// RPC reliability components
export { FailoverConnection, createFailoverConnectionFromEnv } from './failover-connection.js';
export { BlockhashManager, createBlockhashManagerFromEnv } from './blockhash-manager.js';
export * from './types.js';
