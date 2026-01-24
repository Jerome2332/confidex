/**
 * Queue module types
 */

// =============================================================================
// Liquidation Job Types
// =============================================================================

/**
 * Liquidation job data
 */
export interface LiquidationJob {
  /** Position PDA (base58) */
  readonly positionPda: string;
  /** Market PDA (base58) */
  readonly marketPda: string;
  /** Position side */
  readonly side: 'long' | 'short';
  /** Position leverage */
  readonly leverage: number;
  /** Mark price at detection (as string for BigInt) */
  readonly markPrice: string;
  /** Timestamp when liquidation was detected */
  readonly detectedAt: number;
  /** Optional: batch request PDA that verified liquidation */
  readonly batchRequestPda?: string;
}

/**
 * Liquidation job result
 */
export interface LiquidationResult {
  /** Whether liquidation was successful */
  readonly success: boolean;
  /** Transaction signature if successful */
  readonly signature?: string;
  /** Error message if failed */
  readonly error?: string;
  /** Whether position was already liquidated/closed */
  readonly alreadyLiquidated?: boolean;
  /** Liquidation bonus earned (in lamports) */
  readonly bonusEarned?: number;
  /** Processing time in ms */
  readonly processingTimeMs?: number;
}

// =============================================================================
// Settlement Job Types
// =============================================================================

/**
 * Settlement job data
 */
export interface SettlementJob {
  /** Order PDA (base58) */
  readonly orderPda: string;
  /** Trading pair PDA (base58) */
  readonly pairPda: string;
  /** Order side */
  readonly side: 'buy' | 'sell';
  /** Order owner (base58) */
  readonly owner: string;
  /** Settlement method: 0=ShadowWire, 1=C-SPL, 2=StandardSPL */
  readonly settlementMethod: number;
  /** Timestamp when settlement was triggered */
  readonly triggeredAt: number;
}

/**
 * Settlement job result
 */
export interface SettlementResult {
  readonly success: boolean;
  readonly signature?: string;
  readonly error?: string;
  readonly alreadySettled?: boolean;
  readonly processingTimeMs?: number;
}

// =============================================================================
// MPC Callback Job Types
// =============================================================================

/**
 * MPC callback job data
 */
export interface MpcCallbackJob {
  /** MPC request ID */
  readonly requestId: string;
  /** Computation type */
  readonly computationType: string;
  /** Related order/position PDAs */
  readonly relatedPdas: string[];
  /** Timestamp when callback was received */
  readonly receivedAt: number;
}

/**
 * MPC callback result
 */
export interface MpcCallbackResult {
  readonly success: boolean;
  readonly signature?: string;
  readonly error?: string;
  readonly processingTimeMs?: number;
}

// =============================================================================
// Queue Configuration
// =============================================================================

export interface QueueConfig {
  /** Redis connection URL */
  readonly redisUrl: string;
  /** Queue name prefix */
  readonly prefix: string;
  /** Default job options */
  readonly defaultJobOptions: {
    readonly attempts: number;
    readonly backoffType: 'exponential' | 'fixed';
    readonly backoffDelay: number;
    readonly removeOnComplete: number;
    readonly removeOnFail: number;
  };
  /** Worker concurrency */
  readonly concurrency: number;
  /** Rate limiting */
  readonly rateLimit: {
    readonly max: number;
    readonly duration: number;
  };
}

// =============================================================================
// Queue Stats
// =============================================================================

export interface QueueStats {
  readonly waiting: number;
  readonly active: number;
  readonly completed: number;
  readonly failed: number;
  readonly delayed: number;
  readonly paused: number;
}

// =============================================================================
// Job Priority
// =============================================================================

/**
 * Job priority levels (lower number = higher priority)
 */
export enum JobPriority {
  Critical = 1,
  High = 10,
  Normal = 50,
  Low = 100,
}
