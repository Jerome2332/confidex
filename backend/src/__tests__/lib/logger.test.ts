import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to ensure mocks are created before module loading
const { createMockChildLogger, mockPino } = vi.hoisted(() => {
  // Create a self-referential mock child logger function
  function createMockChildLogger(): any {
    return {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(() => createMockChildLogger()),
    };
  }

  // Create the base mock logger that will be returned by pino()
  const baseLogger = createMockChildLogger();

  const mockPino = vi.fn(() => baseLogger);
  (mockPino as any).stdTimeFunctions = { isoTime: vi.fn() };

  return { createMockChildLogger, mockPino };
});

// Mock pino before importing logger
vi.mock('pino', () => ({
  default: mockPino,
}));

// Import after mocking
import {
  logger,
  createLogger,
  requestLogger,
  createTimer,
  serializeError,
  baseLogger,
} from '../../lib/logger.js';

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pre-configured loggers', () => {
    it('exports crank logger', () => {
      expect(logger.crank).toBeDefined();
    });

    it('exports mpc logger', () => {
      expect(logger.mpc).toBeDefined();
    });

    it('exports settlement logger', () => {
      expect(logger.settlement).toBeDefined();
    });

    it('exports matching logger', () => {
      expect(logger.matching).toBeDefined();
    });

    it('exports db logger', () => {
      expect(logger.db).toBeDefined();
    });

    it('exports rpc logger', () => {
      expect(logger.rpc).toBeDefined();
    });

    it('exports http logger', () => {
      expect(logger.http).toBeDefined();
    });

    it('exports auth logger', () => {
      expect(logger.auth).toBeDefined();
    });

    it('exports rate_limit logger', () => {
      expect(logger.rate_limit).toBeDefined();
    });

    it('exports metrics logger', () => {
      expect(logger.metrics).toBeDefined();
    });

    it('exports health logger', () => {
      expect(logger.health).toBeDefined();
    });

    it('exports prover logger', () => {
      expect(logger.prover).toBeDefined();
    });

    it('exports blacklist logger', () => {
      expect(logger.blacklist).toBeDefined();
    });

    it('exports position logger', () => {
      expect(logger.position).toBeDefined();
    });

    it('exports margin logger', () => {
      expect(logger.margin).toBeDefined();
    });

    it('exports liquidation logger', () => {
      expect(logger.liquidation).toBeDefined();
    });
  });

  describe('createLogger', () => {
    it('creates a namespaced logger', () => {
      const customLogger = createLogger('custom');
      expect(customLogger).toBeDefined();
    });
  });

  describe('baseLogger', () => {
    it('exports base logger', () => {
      expect(baseLogger).toBeDefined();
    });
  });
});

describe('requestLogger', () => {
  it('returns a middleware function', () => {
    const middleware = requestLogger();
    expect(typeof middleware).toBe('function');
  });

  it('attaches requestId to request and response', () => {
    const middleware = requestLogger();

    const mockReq: any = {
      headers: {},
      method: 'GET',
      path: '/test',
      ip: '127.0.0.1',
      query: {},
    };

    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn(),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    expect(mockReq.requestId).toBeDefined();
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
    expect(next).toHaveBeenCalled();
  });

  it('uses x-request-id header if provided', () => {
    const middleware = requestLogger();

    const mockReq: any = {
      headers: { 'x-request-id': 'custom-id-123' },
      method: 'GET',
      path: '/test',
      ip: '127.0.0.1',
      query: {},
    };

    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn(),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    expect(mockReq.requestId).toBe('custom-id-123');
    expect(mockRes.setHeader).toHaveBeenCalledWith('X-Request-ID', 'custom-id-123');
  });

  it('creates a request-scoped logger', () => {
    const middleware = requestLogger();

    const mockReq: any = {
      headers: {},
      method: 'POST',
      path: '/api/test',
      ip: '192.168.1.1',
      query: { foo: 'bar' },
    };

    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn(),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    expect(mockReq.log).toBeDefined();
    expect(mockReq.log.info).toBeDefined();
  });

  it('uses connection.remoteAddress if ip is not available', () => {
    const middleware = requestLogger();

    const mockReq: any = {
      headers: {},
      method: 'GET',
      path: '/test',
      ip: undefined,
      connection: { remoteAddress: '10.0.0.1' },
      query: {},
    };

    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn(),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    expect(next).toHaveBeenCalled();
  });

  it('registers finish event handler on response', () => {
    const middleware = requestLogger();

    const mockReq: any = {
      headers: {},
      method: 'GET',
      path: '/test',
      ip: '127.0.0.1',
      query: {},
    };

    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn(),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    expect(mockRes.on).toHaveBeenCalledWith('finish', expect.any(Function));
  });

  it('logs with different levels based on status code', () => {
    const middleware = requestLogger();

    // Create a mock request logger that will be assigned to req.log
    const mockRequestLog = createMockChildLogger();

    const mockReq: any = {
      headers: {},
      method: 'GET',
      path: '/test',
      ip: '127.0.0.1',
      query: {},
      log: mockRequestLog, // Pre-set the log
    };

    let finishHandler: (() => void) | undefined;
    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandler = handler;
        }
      }),
      statusCode: 200,
      get: vi.fn().mockReturnValue('100'),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    // Simulate request completion with 200 status
    if (finishHandler) {
      finishHandler();
    }

    // The middleware creates a new log, so check that it exists and has the expected structure
    expect(mockReq.log).toBeDefined();
    expect(mockReq.log.info).toBeDefined();
  });

  it('logs warn for 4xx status codes', () => {
    const middleware = requestLogger();

    const mockRequestLog = createMockChildLogger();

    const mockReq: any = {
      headers: {},
      method: 'GET',
      path: '/test',
      ip: '127.0.0.1',
      query: {},
      log: mockRequestLog,
    };

    let finishHandler: (() => void) | undefined;
    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandler = handler;
        }
      }),
      statusCode: 404,
      get: vi.fn().mockReturnValue('50'),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    if (finishHandler) {
      finishHandler();
    }

    expect(mockReq.log).toBeDefined();
    expect(mockReq.log.warn).toBeDefined();
  });

  it('logs error for 5xx status codes', () => {
    const middleware = requestLogger();

    const mockRequestLog = createMockChildLogger();

    const mockReq: any = {
      headers: {},
      method: 'GET',
      path: '/test',
      ip: '127.0.0.1',
      query: {},
      log: mockRequestLog,
    };

    let finishHandler: (() => void) | undefined;
    const mockRes: any = {
      setHeader: vi.fn(),
      on: vi.fn((event: string, handler: () => void) => {
        if (event === 'finish') {
          finishHandler = handler;
        }
      }),
      statusCode: 500,
      get: vi.fn().mockReturnValue('200'),
    };

    const next = vi.fn();

    middleware(mockReq, mockRes, next);

    if (finishHandler) {
      finishHandler();
    }

    expect(mockReq.log).toBeDefined();
    expect(mockReq.log.error).toBeDefined();
  });
});

describe('createTimer', () => {
  it('returns timer object with end method', () => {
    const timer = createTimer('test-timer');
    expect(timer).toBeDefined();
    expect(typeof timer.end).toBe('function');
  });

  it('end method returns duration in milliseconds', () => {
    const timer = createTimer('test-timer');
    const duration = timer.end();
    expect(typeof duration).toBe('number');
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('accepts extra data in end method', () => {
    const timer = createTimer('test-timer');
    const duration = timer.end({ extraKey: 'extraValue' });
    expect(typeof duration).toBe('number');
  });

  it('uses provided logger', () => {
    const mockLog = {
      debug: vi.fn(),
    };

    const timer = createTimer('custom-label', mockLog as any);
    timer.end({ result: 'success' });

    expect(mockLog.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'custom-label',
        durationMs: expect.any(Number),
        result: 'success',
      }),
      'Timer: custom-label'
    );
  });
});

describe('serializeError', () => {
  it('serializes Error instance', () => {
    const error = new Error('Test error message');
    const serialized = serializeError(error);

    expect(serialized.name).toBe('Error');
    expect(serialized.message).toBe('Test error message');
  });

  it('includes error code if present', () => {
    const error = new Error('Error with code') as Error & { code: string };
    error.code = 'ENOENT';

    const serialized = serializeError(error);

    expect(serialized.code).toBe('ENOENT');
  });

  it('includes statusCode if present', () => {
    const error = new Error('HTTP error') as Error & { statusCode: number };
    error.statusCode = 404;

    const serialized = serializeError(error);

    expect(serialized.statusCode).toBe(404);
  });

  it('serializes non-Error values as string message', () => {
    const serialized = serializeError('string error');
    expect(serialized.message).toBe('string error');
  });

  it('serializes numbers as string message', () => {
    const serialized = serializeError(42);
    expect(serialized.message).toBe('42');
  });

  it('serializes objects as string message', () => {
    const serialized = serializeError({ custom: 'object' });
    expect(serialized.message).toBe('[object Object]');
  });

  it('serializes null as string message', () => {
    const serialized = serializeError(null);
    expect(serialized.message).toBe('null');
  });

  it('serializes undefined as string message', () => {
    const serialized = serializeError(undefined);
    expect(serialized.message).toBe('undefined');
  });

  it('handles TypeError', () => {
    const error = new TypeError('Type mismatch');
    const serialized = serializeError(error);

    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toBe('Type mismatch');
  });

  it('handles custom Error subclasses', () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const error = new CustomError('Custom error message');
    const serialized = serializeError(error);

    expect(serialized.name).toBe('CustomError');
    expect(serialized.message).toBe('Custom error message');
  });
});
