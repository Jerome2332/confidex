import { describe, it, expect } from 'vitest';
import {
  ConfidexError,
  NetworkError,
  BlockchainError,
  MpcError,
  RateLimitError,
  ValidationError,
  ErrorCode,
  classifyError,
  isRetryable,
  getErrorCode,
  getErrorSeverity,
} from '../../lib/errors.js';

describe('Error Classes', () => {
  describe('ConfidexError', () => {
    it('creates error with all properties', () => {
      const cause = new Error('root cause');
      const error = new ConfidexError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        cause,
        context: { key: 'value' },
        isRetryable: true,
        severity: 'warning',
      });

      expect(error.name).toBe('ConfidexError');
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Test error');
      expect(error.cause).toBe(cause);
      expect(error.context).toEqual({ key: 'value' });
      expect(error.isRetryable).toBe(true);
      expect(error.severity).toBe('warning');
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('serializes to JSON', () => {
      const error = new ConfidexError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
      });

      const json = error.toJSON();

      expect(json.name).toBe('ConfidexError');
      expect(json.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(json.message).toBe('Test error');
      expect(json.timestamp).toBeDefined();
    });

    it('can add context via withContext', () => {
      const error = new ConfidexError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        context: { existing: 'value' },
      });

      const enhanced = error.withContext({ additional: 'data' });

      expect(enhanced.context).toEqual({
        existing: 'value',
        additional: 'data',
      });
    });
  });

  describe('NetworkError', () => {
    it('creates connection timeout error', () => {
      const error = NetworkError.connectionTimeout({ endpoint: 'api.example.com' });

      expect(error.name).toBe('NetworkError');
      expect(error.code).toBe(ErrorCode.CONNECTION_TIMEOUT);
      expect(error.isRetryable).toBe(true);
      expect(error.context.endpoint).toBe('api.example.com');
    });

    it('creates connection reset error', () => {
      const error = NetworkError.connectionReset();

      expect(error.code).toBe(ErrorCode.CONNECTION_RESET);
      expect(error.isRetryable).toBe(true);
    });

    it('creates DNS lookup failed error', () => {
      const error = NetworkError.dnsLookupFailed('example.com');

      expect(error.code).toBe(ErrorCode.DNS_LOOKUP_FAILED);
      expect(error.context.hostname).toBe('example.com');
    });

    it('creates socket hang up error', () => {
      const error = NetworkError.socketHangUp();

      expect(error.code).toBe(ErrorCode.SOCKET_HANG_UP);
      expect(error.isRetryable).toBe(true);
    });
  });

  describe('BlockchainError', () => {
    it('creates blockhash not found error (retryable)', () => {
      const error = BlockchainError.blockhashNotFound('abc123');

      expect(error.name).toBe('BlockchainError');
      expect(error.code).toBe(ErrorCode.BLOCKHASH_NOT_FOUND);
      expect(error.isRetryable).toBe(true);
      expect(error.context.blockhash).toBe('abc123');
    });

    it('creates insufficient funds error (not retryable)', () => {
      const error = BlockchainError.insufficientFunds(1000, 500);

      expect(error.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);
      expect(error.isRetryable).toBe(false);
      expect(error.context.required).toBe(1000);
      expect(error.context.available).toBe(500);
    });

    it('creates program error with hex code', () => {
      const error = BlockchainError.programError('Abc123', 0x1782);

      expect(error.code).toBe(ErrorCode.PROGRAM_ERROR);
      expect(error.message).toContain('0x1782');
      expect(error.context.errorCode).toBe(0x1782);
    });

    it('creates instruction error with index', () => {
      const error = BlockchainError.instructionError(2, 'Invalid account');

      expect(error.code).toBe(ErrorCode.INSTRUCTION_ERROR);
      expect(error.context.instructionIndex).toBe(2);
    });
  });

  describe('MpcError', () => {
    it('creates MPC timeout error', () => {
      const error = MpcError.timeout('comp123', 30000);

      expect(error.name).toBe('MpcError');
      expect(error.code).toBe(ErrorCode.MPC_TIMEOUT);
      expect(error.isRetryable).toBe(true);
      expect(error.context.computationId).toBe('comp123');
      expect(error.context.timeoutMs).toBe(30000);
    });

    it('creates MPC computation failed error', () => {
      const error = MpcError.computationFailed('comp123', 'Node offline');

      expect(error.code).toBe(ErrorCode.MPC_COMPUTATION_FAILED);
      expect(error.message).toContain('Node offline');
    });

    it('creates MPC cluster unavailable error', () => {
      const error = MpcError.clusterUnavailable(456);

      expect(error.code).toBe(ErrorCode.MPC_CLUSTER_UNAVAILABLE);
      expect(error.context.clusterOffset).toBe(456);
    });

    it('creates encryption failed error (not retryable)', () => {
      const error = MpcError.encryptionFailed('Invalid key format');

      expect(error.code).toBe(ErrorCode.MPC_ENCRYPTION_FAILED);
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('RateLimitError', () => {
    it('creates rate limit error with retry delay', () => {
      const error = new RateLimitError('Too many requests', 5000);

      expect(error.name).toBe('RateLimitError');
      expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
      expect(error.isRetryable).toBe(true);
      expect(error.retryAfterMs).toBe(5000);
    });

    it('creates from HTTP response', () => {
      const error = RateLimitError.fromResponse(429, '60');

      expect(error.retryAfterMs).toBe(60000);
      expect(error.context.statusCode).toBe(429);
    });
  });

  describe('ValidationError', () => {
    it('creates invalid input error', () => {
      const error = ValidationError.invalidInput('email', 'Invalid format');

      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(error.isRetryable).toBe(false);
      expect(error.context.field).toBe('email');
    });

    it('creates missing required error', () => {
      const error = ValidationError.missingRequired('username');

      expect(error.message).toContain('username');
    });

    it('creates out of range error', () => {
      const error = ValidationError.outOfRange('amount', 0, 100, 150);

      expect(error.context.min).toBe(0);
      expect(error.context.max).toBe(100);
      expect(error.context.actual).toBe(150);
    });
  });
});

describe('classifyError', () => {
  it('returns ConfidexError as-is', () => {
    const original = new ConfidexError({
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Test',
    });

    const classified = classifyError(original);

    expect(classified).toBe(original);
  });

  it('classifies timeout errors as NetworkError', () => {
    const error = classifyError(new Error('Connection timeout'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.code).toBe(ErrorCode.CONNECTION_TIMEOUT);
    expect(error.isRetryable).toBe(true);
  });

  it('classifies ETIMEDOUT as NetworkError', () => {
    const error = classifyError(new Error('ETIMEDOUT'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.code).toBe(ErrorCode.CONNECTION_TIMEOUT);
  });

  it('classifies ECONNRESET as NetworkError', () => {
    const error = classifyError(new Error('ECONNRESET'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.code).toBe(ErrorCode.CONNECTION_RESET);
  });

  it('classifies ENOTFOUND as NetworkError', () => {
    const error = classifyError(new Error('ENOTFOUND'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.code).toBe(ErrorCode.DNS_LOOKUP_FAILED);
  });

  it('classifies DNS errors as NetworkError', () => {
    const error = classifyError(new Error('DNS resolution failed'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.code).toBe(ErrorCode.DNS_LOOKUP_FAILED);
  });

  it('classifies socket hang up as NetworkError', () => {
    const error = classifyError(new Error('Socket hang up'));

    expect(error).toBeInstanceOf(NetworkError);
    expect(error.code).toBe(ErrorCode.SOCKET_HANG_UP);
    expect(error.isRetryable).toBe(true);
  });

  it('classifies blockhash not found as BlockchainError', () => {
    const error = classifyError(new Error('Blockhash not found'));

    expect(error).toBeInstanceOf(BlockchainError);
    expect(error.code).toBe(ErrorCode.BLOCKHASH_NOT_FOUND);
    expect(error.isRetryable).toBe(true);
  });

  it('classifies blockhash expired as BlockchainError', () => {
    const error = classifyError(new Error('Transaction blockhash has expired'));

    expect(error).toBeInstanceOf(BlockchainError);
    expect(error.code).toBe(ErrorCode.BLOCKHASH_EXPIRED);
    expect(error.isRetryable).toBe(true);
  });

  it('classifies insufficient funds as BlockchainError', () => {
    const error = classifyError(new Error('Insufficient funds for transaction'));

    expect(error).toBeInstanceOf(BlockchainError);
    expect(error.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);
    expect(error.isRetryable).toBe(false);
  });

  it('classifies custom program error as BlockchainError', () => {
    const error = classifyError(new Error('Custom program error: 0x1782'));

    expect(error).toBeInstanceOf(BlockchainError);
    expect(error.code).toBe(ErrorCode.PROGRAM_ERROR);
  });

  it('classifies account not found as BlockchainError', () => {
    const error = classifyError(new Error('Account not found'));

    expect(error).toBeInstanceOf(BlockchainError);
    expect(error.code).toBe(ErrorCode.ACCOUNT_NOT_FOUND);
  });

  it('classifies invalid account owner as BlockchainError', () => {
    const error = classifyError(new Error('Invalid account owner'));

    expect(error).toBeInstanceOf(BlockchainError);
    expect(error.code).toBe(ErrorCode.INVALID_ACCOUNT_OWNER);
  });

  it('classifies instruction error as BlockchainError', () => {
    const error = classifyError(new Error('Instruction error in transaction'));

    expect(error).toBeInstanceOf(BlockchainError);
    expect(error.code).toBe(ErrorCode.INSTRUCTION_ERROR);
  });

  it('classifies rate limit errors', () => {
    const error = classifyError(new Error('Rate limit exceeded'));

    expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
    expect(error.isRetryable).toBe(true);
  });

  it('classifies 429 errors', () => {
    const error = classifyError(new Error('Error 429: Too many requests'));

    expect(error.code).toBe(ErrorCode.RATE_LIMIT_EXCEEDED);
  });

  it('classifies 503 errors as service unavailable', () => {
    const error = classifyError(new Error('503 Service Unavailable'));

    expect(error.code).toBe(ErrorCode.SERVICE_UNAVAILABLE);
    expect(error.isRetryable).toBe(true);
  });

  it('classifies MPC/Arcium errors', () => {
    const error = classifyError(new Error('MPC computation failed'));

    expect(error).toBeInstanceOf(MpcError);
  });

  it('converts non-Error to ConfidexError', () => {
    const error = classifyError('string error');

    expect(error).toBeInstanceOf(ConfidexError);
    expect(error.message).toBe('string error');
  });

  it('defaults unknown errors to internal error', () => {
    const error = classifyError(new Error('Unknown random error'));

    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.isRetryable).toBe(false);
  });
});

describe('utility functions', () => {
  describe('isRetryable', () => {
    it('returns true for retryable errors', () => {
      expect(isRetryable(new Error('Connection timeout'))).toBe(true);
      expect(isRetryable(NetworkError.connectionTimeout())).toBe(true);
      expect(isRetryable(BlockchainError.blockhashNotFound())).toBe(true);
    });

    it('returns false for non-retryable errors', () => {
      expect(isRetryable(new Error('Insufficient funds'))).toBe(false);
      expect(isRetryable(BlockchainError.insufficientFunds())).toBe(false);
      expect(isRetryable(ValidationError.invalidInput('field', 'reason'))).toBe(false);
    });
  });

  describe('getErrorCode', () => {
    it('returns code from ConfidexError', () => {
      const error = new ConfidexError({
        code: ErrorCode.MPC_TIMEOUT,
        message: 'Test',
      });

      expect(getErrorCode(error)).toBe(ErrorCode.MPC_TIMEOUT);
    });

    it('classifies and returns code for regular errors', () => {
      expect(getErrorCode(new Error('Connection timeout'))).toBe(ErrorCode.CONNECTION_TIMEOUT);
    });
  });

  describe('getErrorSeverity', () => {
    it('returns severity from ConfidexError', () => {
      const error = new ConfidexError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test',
        severity: 'critical',
      });

      expect(getErrorSeverity(error)).toBe('critical');
    });

    it('classifies and returns severity for regular errors', () => {
      // Network errors default to 'warning'
      expect(getErrorSeverity(new Error('Connection timeout'))).toBe('warning');
    });
  });
});
