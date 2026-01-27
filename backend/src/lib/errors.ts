/**
 * Error Classification System
 *
 * Typed error classes with severity, retry hints, and context.
 * Enables consistent error handling across the codebase.
 */

import { AlertSeverity } from './alerts.js';

// =============================================================================
// Error Codes
// =============================================================================

export enum ErrorCode {
  // Network errors (1xxx)
  NETWORK_ERROR = 1000,
  CONNECTION_TIMEOUT = 1001,
  CONNECTION_RESET = 1002,
  DNS_LOOKUP_FAILED = 1003,
  SOCKET_HANG_UP = 1004,

  // Blockchain errors (2xxx)
  BLOCKHASH_NOT_FOUND = 2000,
  BLOCKHASH_EXPIRED = 2001,
  TRANSACTION_FAILED = 2002,
  TRANSACTION_DROPPED = 2003,
  INSUFFICIENT_FUNDS = 2004,
  ACCOUNT_NOT_FOUND = 2005,
  INVALID_ACCOUNT_OWNER = 2006,
  INVALID_ACCOUNT_DATA = 2007,
  PROGRAM_ERROR = 2008,
  INSTRUCTION_ERROR = 2009,
  SIGNATURE_VERIFICATION_FAILED = 2010,
  RENT_EXEMPT_VIOLATION = 2011,

  // MPC errors (3xxx)
  MPC_TIMEOUT = 3000,
  MPC_COMPUTATION_FAILED = 3001,
  MPC_CLUSTER_UNAVAILABLE = 3002,
  MPC_ENCRYPTION_FAILED = 3003,
  MPC_CALLBACK_FAILED = 3004,
  MPC_KEYGEN_INCOMPLETE = 3005,
  MPC_INVALID_RESPONSE = 3006,
  MPC_SIGNATURE_INVALID = 3007,

  // Rate limiting (4xxx)
  RATE_LIMIT_EXCEEDED = 4000,
  TOO_MANY_REQUESTS = 4001,
  SERVICE_UNAVAILABLE = 4002,

  // Validation errors (5xxx)
  VALIDATION_ERROR = 5000,
  INVALID_INPUT = 5001,
  MISSING_REQUIRED_FIELD = 5002,
  OUT_OF_RANGE = 5003,

  // Settlement errors (6xxx)
  SETTLEMENT_TIMEOUT = 6000,
  SETTLEMENT_ROLLBACK_FAILED = 6001,
  SETTLEMENT_ALREADY_COMPLETE = 6002,
  SETTLEMENT_NOT_FOUND = 6003,
  SETTLEMENT_INVALID_STATE = 6004,
  SETTLEMENT_PARTIAL_TRANSFER = 6005,

  // ShadowWire errors (7xxx)
  SHADOWWIRE_TRANSFER_FAILED = 7000,
  SHADOWWIRE_INSUFFICIENT_BALANCE = 7001,
  SHADOWWIRE_API_ERROR = 7002,
  SHADOWWIRE_INVALID_TOKEN = 7003,
  SHADOWWIRE_TIMEOUT = 7004,
  SHADOWWIRE_CIRCUIT_OPEN = 7005,

  // Order errors (8xxx)
  ORDER_NOT_FOUND = 8000,
  ORDER_ALREADY_SETTLED = 8001,
  ORDER_EXPIRED = 8002,
  ORDER_INVALID_STATUS = 8003,
  ORDER_MATCH_FAILED = 8004,

  // Internal errors (9xxx)
  INTERNAL_ERROR = 9000,
  CONFIGURATION_ERROR = 9001,
  UNEXPECTED_STATE = 9002,
}

// =============================================================================
// Base Error Class
// =============================================================================

export interface ErrorContext {
  [key: string]: unknown;
}

export interface ConfidexErrorOptions {
  code: ErrorCode;
  message: string;
  cause?: Error;
  context?: ErrorContext;
  isRetryable?: boolean;
  severity?: AlertSeverity;
}

export class ConfidexError extends Error {
  readonly code: ErrorCode;
  readonly cause?: Error;
  readonly context: ErrorContext;
  readonly isRetryable: boolean;
  readonly severity: AlertSeverity;
  readonly timestamp: Date;

  constructor(options: ConfidexErrorOptions) {
    super(options.message);
    this.name = 'ConfidexError';
    this.code = options.code;
    this.cause = options.cause;
    this.context = options.context ?? {};
    this.isRetryable = options.isRetryable ?? false;
    this.severity = options.severity ?? 'error';
    this.timestamp = new Date();

    // Maintains proper stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert to a plain object for logging/serialization
   */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      isRetryable: this.isRetryable,
      severity: this.severity,
      context: this.context,
      timestamp: this.timestamp.toISOString(),
      cause: this.cause?.message,
      stack: this.stack,
    };
  }

  /**
   * Create a new error with additional context
   */
  withContext(additionalContext: ErrorContext): ConfidexError {
    return new ConfidexError({
      code: this.code,
      message: this.message,
      cause: this.cause,
      context: { ...this.context, ...additionalContext },
      isRetryable: this.isRetryable,
      severity: this.severity,
    });
  }
}

// =============================================================================
// Network Error
// =============================================================================

export class NetworkError extends ConfidexError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.NETWORK_ERROR,
    cause?: Error,
    context?: ErrorContext
  ) {
    super({
      code,
      message,
      cause,
      context,
      isRetryable: true,
      severity: 'warning',
    });
    this.name = 'NetworkError';
  }

  static connectionTimeout(context?: ErrorContext): NetworkError {
    return new NetworkError('Connection timeout', ErrorCode.CONNECTION_TIMEOUT, undefined, context);
  }

  static connectionReset(context?: ErrorContext): NetworkError {
    return new NetworkError('Connection reset', ErrorCode.CONNECTION_RESET, undefined, context);
  }

  static dnsLookupFailed(hostname: string, cause?: Error): NetworkError {
    return new NetworkError('DNS lookup failed', ErrorCode.DNS_LOOKUP_FAILED, cause, { hostname });
  }

  static socketHangUp(context?: ErrorContext): NetworkError {
    return new NetworkError('Socket hang up', ErrorCode.SOCKET_HANG_UP, undefined, context);
  }
}

// =============================================================================
// Blockchain Error
// =============================================================================

export class BlockchainError extends ConfidexError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.TRANSACTION_FAILED,
    cause?: Error,
    context?: ErrorContext,
    isRetryable: boolean = false
  ) {
    super({
      code,
      message,
      cause,
      context,
      isRetryable,
      severity: isRetryable ? 'warning' : 'error',
    });
    this.name = 'BlockchainError';
  }

  static blockhashNotFound(blockhash?: string): BlockchainError {
    return new BlockchainError(
      'Blockhash not found',
      ErrorCode.BLOCKHASH_NOT_FOUND,
      undefined,
      { blockhash },
      true // retryable
    );
  }

  static blockhashExpired(blockhash?: string): BlockchainError {
    return new BlockchainError(
      'Blockhash expired',
      ErrorCode.BLOCKHASH_EXPIRED,
      undefined,
      { blockhash },
      true // retryable
    );
  }

  static transactionFailed(signature?: string, cause?: Error): BlockchainError {
    return new BlockchainError(
      'Transaction failed',
      ErrorCode.TRANSACTION_FAILED,
      cause,
      { signature },
      false
    );
  }

  static transactionDropped(signature?: string): BlockchainError {
    return new BlockchainError(
      'Transaction dropped',
      ErrorCode.TRANSACTION_DROPPED,
      undefined,
      { signature },
      true // retryable
    );
  }

  static insufficientFunds(required?: number, available?: number): BlockchainError {
    return new BlockchainError(
      'Insufficient funds',
      ErrorCode.INSUFFICIENT_FUNDS,
      undefined,
      { required, available },
      false // not retryable
    );
  }

  static accountNotFound(pubkey: string): BlockchainError {
    return new BlockchainError(
      'Account not found',
      ErrorCode.ACCOUNT_NOT_FOUND,
      undefined,
      { pubkey },
      false
    );
  }

  static invalidAccountOwner(pubkey: string, expectedOwner: string, actualOwner: string): BlockchainError {
    return new BlockchainError(
      'Invalid account owner',
      ErrorCode.INVALID_ACCOUNT_OWNER,
      undefined,
      { pubkey, expectedOwner, actualOwner },
      false
    );
  }

  static programError(programId: string, errorCode: number, cause?: Error): BlockchainError {
    return new BlockchainError(
      `Program error: 0x${errorCode.toString(16)}`,
      ErrorCode.PROGRAM_ERROR,
      cause,
      { programId, errorCode },
      false
    );
  }

  static instructionError(index: number, message: string, cause?: Error): BlockchainError {
    return new BlockchainError(
      `Instruction error at index ${index}: ${message}`,
      ErrorCode.INSTRUCTION_ERROR,
      cause,
      { instructionIndex: index },
      false
    );
  }
}

// =============================================================================
// MPC Error
// =============================================================================

export class MpcError extends ConfidexError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.MPC_COMPUTATION_FAILED,
    cause?: Error,
    context?: ErrorContext,
    isRetryable: boolean = true
  ) {
    super({
      code,
      message,
      cause,
      context,
      isRetryable,
      severity: 'error',
    });
    this.name = 'MpcError';
  }

  static timeout(computationId?: string, timeoutMs?: number): MpcError {
    return new MpcError(
      'MPC computation timeout',
      ErrorCode.MPC_TIMEOUT,
      undefined,
      { computationId, timeoutMs },
      true
    );
  }

  static computationFailed(computationId?: string, reason?: string, cause?: Error): MpcError {
    return new MpcError(
      `MPC computation failed: ${reason || 'unknown reason'}`,
      ErrorCode.MPC_COMPUTATION_FAILED,
      cause,
      { computationId, reason },
      true
    );
  }

  static clusterUnavailable(clusterOffset?: number): MpcError {
    return new MpcError(
      'MPC cluster unavailable',
      ErrorCode.MPC_CLUSTER_UNAVAILABLE,
      undefined,
      { clusterOffset },
      true
    );
  }

  static encryptionFailed(reason: string, cause?: Error): MpcError {
    return new MpcError(
      `Encryption failed: ${reason}`,
      ErrorCode.MPC_ENCRYPTION_FAILED,
      cause,
      { reason },
      false // not retryable - likely a code issue
    );
  }

  static callbackFailed(computationId?: string, cause?: Error): MpcError {
    return new MpcError(
      'MPC callback failed',
      ErrorCode.MPC_CALLBACK_FAILED,
      cause,
      { computationId },
      true
    );
  }

  static keygenIncomplete(mxeProgramId?: string): MpcError {
    return new MpcError(
      'MXE keygen not complete',
      ErrorCode.MPC_KEYGEN_INCOMPLETE,
      undefined,
      { mxeProgramId },
      true
    );
  }
}

// =============================================================================
// Rate Limit Error
// =============================================================================

export class RateLimitError extends ConfidexError {
  readonly retryAfterMs?: number;

  constructor(message: string, retryAfterMs?: number, context?: ErrorContext) {
    super({
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      message,
      context: { ...context, retryAfterMs },
      isRetryable: true,
      severity: 'warning',
    });
    this.name = 'RateLimitError';
    this.retryAfterMs = retryAfterMs;
  }

  static fromResponse(statusCode: number, retryAfterHeader?: string): RateLimitError {
    const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : undefined;
    return new RateLimitError(
      `Rate limit exceeded (HTTP ${statusCode})`,
      retryAfterMs,
      { statusCode }
    );
  }
}

// =============================================================================
// Validation Error
// =============================================================================

export class ValidationError extends ConfidexError {
  constructor(message: string, context?: ErrorContext) {
    super({
      code: ErrorCode.VALIDATION_ERROR,
      message,
      context,
      isRetryable: false,
      severity: 'warning',
    });
    this.name = 'ValidationError';
  }

  static invalidInput(field: string, reason: string): ValidationError {
    return new ValidationError(`Invalid input for ${field}: ${reason}`, { field, reason });
  }

  static missingRequired(field: string): ValidationError {
    return new ValidationError(`Missing required field: ${field}`, { field });
  }

  static outOfRange(field: string, min?: number, max?: number, actual?: number): ValidationError {
    return new ValidationError(
      `${field} out of range: ${actual} (expected ${min ?? '-∞'} to ${max ?? '∞'})`,
      { field, min, max, actual }
    );
  }
}

// =============================================================================
// Settlement Error
// =============================================================================

export class SettlementError extends ConfidexError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.SETTLEMENT_TIMEOUT,
    cause?: Error,
    context?: ErrorContext,
    isRetryable: boolean = false
  ) {
    super({
      code,
      message,
      cause,
      context,
      isRetryable,
      severity: 'error',
    });
    this.name = 'SettlementError';
  }

  static timeout(settlementId?: string, timeoutMs?: number): SettlementError {
    return new SettlementError(
      'Settlement timeout',
      ErrorCode.SETTLEMENT_TIMEOUT,
      undefined,
      { settlementId, timeoutMs },
      true // retryable
    );
  }

  static rollbackFailed(settlementId?: string, transferId?: string, cause?: Error): SettlementError {
    return new SettlementError(
      'Settlement rollback failed - manual intervention required',
      ErrorCode.SETTLEMENT_ROLLBACK_FAILED,
      cause,
      { settlementId, transferId },
      false // not retryable - requires manual intervention
    );
  }

  static alreadyComplete(settlementId?: string): SettlementError {
    return new SettlementError(
      'Settlement already completed',
      ErrorCode.SETTLEMENT_ALREADY_COMPLETE,
      undefined,
      { settlementId },
      false
    );
  }

  static notFound(settlementId?: string): SettlementError {
    return new SettlementError(
      'Settlement not found',
      ErrorCode.SETTLEMENT_NOT_FOUND,
      undefined,
      { settlementId },
      false
    );
  }

  static invalidState(settlementId?: string, currentState?: string, expectedStates?: string[]): SettlementError {
    return new SettlementError(
      `Settlement in invalid state: ${currentState}, expected: ${expectedStates?.join(' or ')}`,
      ErrorCode.SETTLEMENT_INVALID_STATE,
      undefined,
      { settlementId, currentState, expectedStates },
      false
    );
  }

  static partialTransfer(settlementId?: string, completedTransfers?: string[]): SettlementError {
    return new SettlementError(
      'Partial transfer occurred - rollback required',
      ErrorCode.SETTLEMENT_PARTIAL_TRANSFER,
      undefined,
      { settlementId, completedTransfers },
      false // not retryable - requires rollback
    );
  }
}

// =============================================================================
// ShadowWire Error
// =============================================================================

export class ShadowWireError extends ConfidexError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.SHADOWWIRE_API_ERROR,
    cause?: Error,
    context?: ErrorContext,
    isRetryable: boolean = true
  ) {
    super({
      code,
      message,
      cause,
      context,
      isRetryable,
      severity: 'error',
    });
    this.name = 'ShadowWireError';
  }

  static transferFailed(transferId?: string, reason?: string, cause?: Error): ShadowWireError {
    return new ShadowWireError(
      `ShadowWire transfer failed: ${reason || 'unknown'}`,
      ErrorCode.SHADOWWIRE_TRANSFER_FAILED,
      cause,
      { transferId, reason },
      true
    );
  }

  static insufficientBalance(sender?: string, token?: string, required?: bigint, available?: bigint): ShadowWireError {
    return new ShadowWireError(
      'Insufficient balance for ShadowWire transfer',
      ErrorCode.SHADOWWIRE_INSUFFICIENT_BALANCE,
      undefined,
      { sender, token, required: required?.toString(), available: available?.toString() },
      false // not retryable - need more funds
    );
  }

  static apiError(statusCode?: number, message?: string, cause?: Error): ShadowWireError {
    return new ShadowWireError(
      `ShadowWire API error: ${message || 'unknown'}`,
      ErrorCode.SHADOWWIRE_API_ERROR,
      cause,
      { statusCode, message },
      true
    );
  }

  static invalidToken(token?: string): ShadowWireError {
    return new ShadowWireError(
      `Token not supported by ShadowWire: ${token}`,
      ErrorCode.SHADOWWIRE_INVALID_TOKEN,
      undefined,
      { token },
      false // not retryable - token not supported
    );
  }

  static timeout(transferId?: string, timeoutMs?: number): ShadowWireError {
    return new ShadowWireError(
      'ShadowWire transfer timeout',
      ErrorCode.SHADOWWIRE_TIMEOUT,
      undefined,
      { transferId, timeoutMs },
      true
    );
  }

  static circuitOpen(): ShadowWireError {
    return new ShadowWireError(
      'ShadowWire circuit breaker is open - service unavailable',
      ErrorCode.SHADOWWIRE_CIRCUIT_OPEN,
      undefined,
      undefined,
      true // retryable after circuit resets
    );
  }
}

// =============================================================================
// Order Error
// =============================================================================

export class OrderError extends ConfidexError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.ORDER_NOT_FOUND,
    cause?: Error,
    context?: ErrorContext,
    isRetryable: boolean = false
  ) {
    super({
      code,
      message,
      cause,
      context,
      isRetryable,
      severity: 'warning',
    });
    this.name = 'OrderError';
  }

  static notFound(orderId?: string): OrderError {
    return new OrderError(
      'Order not found',
      ErrorCode.ORDER_NOT_FOUND,
      undefined,
      { orderId },
      false
    );
  }

  static alreadySettled(orderId?: string): OrderError {
    return new OrderError(
      'Order already settled',
      ErrorCode.ORDER_ALREADY_SETTLED,
      undefined,
      { orderId },
      false
    );
  }

  static expired(orderId?: string, expiryTime?: number): OrderError {
    return new OrderError(
      'Order has expired',
      ErrorCode.ORDER_EXPIRED,
      undefined,
      { orderId, expiryTime },
      false
    );
  }

  static invalidStatus(orderId?: string, currentStatus?: string, expectedStatuses?: string[]): OrderError {
    return new OrderError(
      `Order in invalid status: ${currentStatus}, expected: ${expectedStatuses?.join(' or ')}`,
      ErrorCode.ORDER_INVALID_STATUS,
      undefined,
      { orderId, currentStatus, expectedStatuses },
      false
    );
  }

  static matchFailed(buyOrderId?: string, sellOrderId?: string, reason?: string): OrderError {
    return new OrderError(
      `Order matching failed: ${reason || 'unknown'}`,
      ErrorCode.ORDER_MATCH_FAILED,
      undefined,
      { buyOrderId, sellOrderId, reason },
      true // may be retryable
    );
  }
}

// =============================================================================
// Error Classification
// =============================================================================

/**
 * Classify a generic error into a typed ConfidexError
 */
export function classifyError(error: unknown): ConfidexError {
  if (error instanceof ConfidexError) {
    return error;
  }

  if (!(error instanceof Error)) {
    return new ConfidexError({
      code: ErrorCode.INTERNAL_ERROR,
      message: String(error),
      isRetryable: false,
      severity: 'error',
    });
  }

  const message = error.message.toLowerCase();

  // Network errors
  if (
    message.includes('timeout') ||
    message.includes('etimedout')
  ) {
    return NetworkError.connectionTimeout({ originalMessage: error.message });
  }

  if (message.includes('econnreset') || message.includes('connection reset')) {
    return NetworkError.connectionReset({ originalMessage: error.message });
  }

  if (message.includes('enotfound') || message.includes('dns')) {
    return NetworkError.dnsLookupFailed('unknown', error);
  }

  if (message.includes('socket hang up')) {
    return NetworkError.socketHangUp({ originalMessage: error.message });
  }

  // Blockchain errors
  if (message.includes('blockhash not found')) {
    return BlockchainError.blockhashNotFound();
  }

  if (message.includes('blockhash') && message.includes('expired')) {
    return BlockchainError.blockhashExpired();
  }

  if (message.includes('insufficient funds')) {
    return BlockchainError.insufficientFunds();
  }

  if (message.includes('account not found')) {
    return BlockchainError.accountNotFound('unknown');
  }

  if (message.includes('invalid account owner')) {
    return BlockchainError.invalidAccountOwner('unknown', 'unknown', 'unknown');
  }

  if (message.includes('custom program error')) {
    const match = message.match(/0x([0-9a-f]+)/i);
    const errorCode = match ? parseInt(match[1], 16) : 0;
    return BlockchainError.programError('unknown', errorCode, error);
  }

  if (message.includes('instruction error')) {
    return BlockchainError.instructionError(0, error.message, error);
  }

  // Rate limiting
  if (
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('429')
  ) {
    return new RateLimitError(error.message);
  }

  if (message.includes('503') || message.includes('service unavailable')) {
    return new ConfidexError({
      code: ErrorCode.SERVICE_UNAVAILABLE,
      message: error.message,
      cause: error,
      isRetryable: true,
      severity: 'warning',
    });
  }

  // MPC errors
  if (message.includes('mpc') || message.includes('arcium')) {
    return MpcError.computationFailed(undefined, error.message, error);
  }

  // Settlement errors
  if (message.includes('settlement')) {
    if (message.includes('timeout')) {
      return SettlementError.timeout();
    }
    if (message.includes('rollback')) {
      return SettlementError.rollbackFailed(undefined, undefined, error);
    }
    if (message.includes('already complete') || message.includes('already settled')) {
      return SettlementError.alreadyComplete();
    }
    return new SettlementError(error.message, ErrorCode.SETTLEMENT_INVALID_STATE, error);
  }

  // ShadowWire errors
  if (message.includes('shadowwire')) {
    if (message.includes('insufficient') || message.includes('balance')) {
      return ShadowWireError.insufficientBalance();
    }
    if (message.includes('timeout')) {
      return ShadowWireError.timeout();
    }
    if (message.includes('circuit')) {
      return ShadowWireError.circuitOpen();
    }
    return ShadowWireError.apiError(undefined, error.message, error);
  }

  // Order errors
  if (message.includes('order')) {
    if (message.includes('not found')) {
      return OrderError.notFound();
    }
    if (message.includes('already settled')) {
      return OrderError.alreadySettled();
    }
    if (message.includes('expired')) {
      return OrderError.expired();
    }
    return OrderError.matchFailed(undefined, undefined, error.message);
  }

  // Default to internal error
  return new ConfidexError({
    code: ErrorCode.INTERNAL_ERROR,
    message: error.message,
    cause: error,
    isRetryable: false,
    severity: 'error',
  });
}

/**
 * Check if an error is retryable
 */
export function isRetryable(error: unknown): boolean {
  if (error instanceof ConfidexError) {
    return error.isRetryable;
  }
  return classifyError(error).isRetryable;
}

/**
 * Get the error code from any error
 */
export function getErrorCode(error: unknown): ErrorCode {
  if (error instanceof ConfidexError) {
    return error.code;
  }
  return classifyError(error).code;
}

/**
 * Get the severity from any error
 */
export function getErrorSeverity(error: unknown): AlertSeverity {
  if (error instanceof ConfidexError) {
    return error.severity;
  }
  return classifyError(error).severity;
}
