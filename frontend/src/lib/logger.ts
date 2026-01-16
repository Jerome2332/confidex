/**
 * Structured logging utility for Confidex
 *
 * Features:
 * - Environment-aware (silent in production by default)
 * - Namespaced loggers for different modules
 * - Structured data support
 * - Configurable log levels
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  namespace: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp: string;
}

// Environment configuration
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const LOG_LEVEL = (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) || (IS_PRODUCTION ? 'error' : 'debug');

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[LOG_LEVEL];
}

function formatLogEntry(entry: LogEntry): string {
  const { level, namespace, message, data, timestamp } = entry;
  const prefix = `[${timestamp}] [${level.toUpperCase()}] [${namespace}]`;

  if (data && Object.keys(data).length > 0) {
    return `${prefix} ${message} ${JSON.stringify(data)}`;
  }
  return `${prefix} ${message}`;
}

class Logger {
  private namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  private log(level: LogLevel, message: string, data?: Record<string, unknown>) {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      level,
      namespace: this.namespace,
      message,
      data,
      timestamp: new Date().toISOString(),
    };

    const formatted = formatLogEntry(entry);

    switch (level) {
      case 'debug':
        // eslint-disable-next-line no-console
        console.debug(formatted);
        break;
      case 'info':
        // eslint-disable-next-line no-console
        console.info(formatted);
        break;
      case 'warn':
        // eslint-disable-next-line no-console
        console.warn(formatted);
        break;
      case 'error':
        // eslint-disable-next-line no-console
        console.error(formatted);
        break;
    }
  }

  debug(message: string, data?: Record<string, unknown>) {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>) {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>) {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>) {
    this.log('error', message, data);
  }
}

// Pre-configured loggers for common namespaces
const loggers: Map<string, Logger> = new Map();

export function createLogger(namespace: string): Logger {
  if (!loggers.has(namespace)) {
    loggers.set(namespace, new Logger(namespace));
  }
  return loggers.get(namespace)!;
}

// Common namespace loggers
export const logger = {
  pnp: createLogger('pnp'),
  trading: createLogger('trading'),
  settlement: createLogger('settlement'),
  helius: createLogger('helius'),
  proof: createLogger('proof'),
  encryption: createLogger('encryption'),
  balance: createLogger('balance'),
  api: createLogger('api'),
  hooks: createLogger('hooks'),
  ui: createLogger('ui'),
};

export default logger;
