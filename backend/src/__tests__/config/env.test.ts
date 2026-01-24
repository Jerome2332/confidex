import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Store original env
const originalEnv = { ...process.env };

// Import after setting up environment
import { validateEnv, getEnv, getEnvNumber, getEnvBoolean } from '../../config/env.js';

describe('Environment Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env to original state before each test
    process.env = { ...originalEnv };
    // Spy on console methods
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('validateEnv', () => {
    it('logs success message when all required vars are present in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.CONFIDEX_PROGRAM_ID = '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB';
      process.env.MXE_PROGRAM_ID = 'HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS';

      validateEnv();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Environment validation passed'));
    });

    it('warns about missing vars in development mode but continues', () => {
      process.env.NODE_ENV = 'development';
      delete process.env.CONFIDEX_PROGRAM_ID;
      delete process.env.MXE_PROGRAM_ID;

      validateEnv();

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Missing required environment variables'));
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Continuing in development mode'));
    });

    it('warns about insecure API key in development', () => {
      process.env.NODE_ENV = 'development';
      process.env.CONFIDEX_PROGRAM_ID = '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB';
      process.env.MXE_PROGRAM_ID = 'HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS';
      process.env.ADMIN_API_KEY = 'dev-admin-key-DO-NOT-USE-IN-PRODUCTION';

      validateEnv();

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('Using development API key'));
    });

    it('defaults to development mode when NODE_ENV is not set', () => {
      delete process.env.NODE_ENV;
      process.env.CONFIDEX_PROGRAM_ID = '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB';
      process.env.MXE_PROGRAM_ID = 'HrAjvetNk3UYzsrnbSEcybpQoTTSS8spZZFkiVWmWLbS';

      validateEnv();

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('development mode'));
    });
  });

  describe('getEnv', () => {
    it('returns environment variable value when set', () => {
      process.env.TEST_VAR = 'test-value';

      const result = getEnv('TEST_VAR');

      expect(result).toBe('test-value');
    });

    it('returns default value when env var is not set', () => {
      delete process.env.TEST_VAR;

      const result = getEnv('TEST_VAR', 'default-value');

      expect(result).toBe('default-value');
    });

    it('throws error when env var is not set and no default provided', () => {
      delete process.env.MISSING_VAR;

      expect(() => getEnv('MISSING_VAR')).toThrow('Missing required environment variable: MISSING_VAR');
    });

    it('returns empty string if env var is set to empty string', () => {
      process.env.EMPTY_VAR = '';

      const result = getEnv('EMPTY_VAR', 'default');

      expect(result).toBe('');
    });
  });

  describe('getEnvNumber', () => {
    it('returns parsed number when env var is valid integer', () => {
      process.env.PORT = '3000';

      const result = getEnvNumber('PORT');

      expect(result).toBe(3000);
    });

    it('returns default value when env var is not set', () => {
      delete process.env.PORT;

      const result = getEnvNumber('PORT', 8080);

      expect(result).toBe(8080);
    });

    it('throws error when env var is not set and no default provided', () => {
      delete process.env.MISSING_NUM;

      expect(() => getEnvNumber('MISSING_NUM')).toThrow('Missing required environment variable: MISSING_NUM');
    });

    it('throws error when env var is not a valid number', () => {
      process.env.INVALID_NUM = 'not-a-number';

      expect(() => getEnvNumber('INVALID_NUM')).toThrow('Environment variable INVALID_NUM must be a number');
    });

    it('handles negative numbers', () => {
      process.env.NEGATIVE = '-42';

      const result = getEnvNumber('NEGATIVE');

      expect(result).toBe(-42);
    });

    it('handles zero', () => {
      process.env.ZERO = '0';

      const result = getEnvNumber('ZERO');

      expect(result).toBe(0);
    });
  });

  describe('getEnvBoolean', () => {
    it('returns true for "true" string', () => {
      process.env.FEATURE_FLAG = 'true';

      const result = getEnvBoolean('FEATURE_FLAG');

      expect(result).toBe(true);
    });

    it('returns true for "TRUE" string (case insensitive)', () => {
      process.env.FEATURE_FLAG = 'TRUE';

      const result = getEnvBoolean('FEATURE_FLAG');

      expect(result).toBe(true);
    });

    it('returns true for "1" string', () => {
      process.env.FEATURE_FLAG = '1';

      const result = getEnvBoolean('FEATURE_FLAG');

      expect(result).toBe(true);
    });

    it('returns false for "false" string', () => {
      process.env.FEATURE_FLAG = 'false';

      const result = getEnvBoolean('FEATURE_FLAG');

      expect(result).toBe(false);
    });

    it('returns false for any other string', () => {
      process.env.FEATURE_FLAG = 'yes';

      const result = getEnvBoolean('FEATURE_FLAG');

      expect(result).toBe(false);
    });

    it('returns default value when env var is not set', () => {
      delete process.env.FEATURE_FLAG;

      const resultTrue = getEnvBoolean('FEATURE_FLAG', true);
      expect(resultTrue).toBe(true);

      const resultFalse = getEnvBoolean('FEATURE_FLAG', false);
      expect(resultFalse).toBe(false);
    });

    it('throws error when env var is not set and no default provided', () => {
      delete process.env.MISSING_BOOL;

      expect(() => getEnvBoolean('MISSING_BOOL')).toThrow('Missing required environment variable: MISSING_BOOL');
    });
  });
});
