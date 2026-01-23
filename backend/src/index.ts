import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { proveRouter } from './routes/prove.js';
import { healthRouter, setCrankServiceRef } from './routes/health.js';
import { blacklistRouter } from './routes/admin/blacklist.js';
import { crankRouter, initializeCrankService } from './routes/admin/crank.js';
import { metricsRouter, metricsMiddleware } from './routes/metrics.js';
import { CrankService, loadCrankConfig } from './crank/index.js';
import { validateEnv } from './config/env.js';
import { logger, requestLogger } from './lib/logger.js';
import { initSentry, setupSentryForExpress, flushSentry, captureException } from './lib/sentry.js';
import { initRedisRateLimiter, closeRedisRateLimiter } from './middleware/rate-limit-redis.js';

config();

// Validate environment variables early
validateEnv();

// Initialize Sentry error tracking
const sentryInitialized = initSentry();

const log = logger.http;

const app = express();
const PORT = process.env.PORT || 3001;

// Strict CORS whitelist
const ALLOWED_ORIGINS = [
  // Production
  'https://www.confidex.xyz',
  'https://confidex.xyz',
  // Staging
  'https://staging.confidex.exchange',
  // Custom frontend URL from env
  process.env.FRONTEND_URL,
  // Development only
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3003', 'http://127.0.0.1:3000']
    : []),
].filter(Boolean) as string[];

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin in development (curl, Postman)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        // In production, reject requests without origin
        callback(new Error('Origin header required'), false);
      } else {
        callback(null, true);
      }
      return;
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      log.warn({ origin }, 'CORS rejected request from unknown origin');
      callback(new Error(`Origin ${origin} not allowed`), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining', 'X-RateLimit-Limit', 'X-RateLimit-Reset'],
  maxAge: 86400, // 24 hours
};

// Request logging and correlation IDs
app.use(requestLogger());

// Metrics middleware (before routes)
app.use(metricsMiddleware());

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // Limit body size

// CORS error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err.message.includes('not allowed') || err.message.includes('Origin header required')) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Cross-origin request not allowed',
    });
    return;
  }
  next(err);
});

// Routes
app.use('/health', healthRouter);
app.use('/metrics', metricsRouter);
app.use('/api/prove', proveRouter);
app.use('/api/admin/blacklist', blacklistRouter);
app.use('/api/admin/crank', crankRouter);

// Sentry error handler (must be after routes but before other error handlers)
if (sentryInitialized) {
  setupSentryForExpress(app);
}

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Capture error in Sentry
  captureException(err, {
    tags: {
      path: req.path,
      method: req.method,
    },
    extra: {
      query: req.query,
      body: req.body,
    },
  });

  log.error({ err, path: req.path, method: req.method }, 'Unhandled request error');
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown handler
async function gracefulShutdown(signal: string) {
  log.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  // Close Redis rate limiter
  await closeRedisRateLimiter();

  // Flush Sentry events
  await flushSentry();

  log.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.fatal({ error }, 'Uncaught exception');
  captureException(error, { level: 'fatal' });
  flushSentry().then(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  log.error({ reason }, 'Unhandled rejection');
  captureException(reason as Error, { level: 'error' });
});

app.listen(PORT, async () => {
  log.info({ port: PORT, env: process.env.NODE_ENV }, 'Confidex backend server started');

  // Initialize Redis rate limiter (falls back to in-memory if unavailable)
  await initRedisRateLimiter().catch((err) => {
    log.warn({ err }, 'Redis rate limiter initialization failed, using in-memory fallback');
  });
  log.info({ endpoints: {
    health: `/health`,
    metrics: `/metrics`,
    prove: `/api/prove`,
    blacklist: `/api/admin/blacklist`,
    crank: `/api/admin/crank`,
  }}, 'Available endpoints');

  // Initialize and optionally start crank service
  const crankConfig = loadCrankConfig();
  const crankService = new CrankService(crankConfig);
  initializeCrankService(crankService);

  // Wire up crank service for health checks
  setCrankServiceRef(crankService);

  if (crankConfig.enabled) {
    try {
      await crankService.start();
      log.info('Crank service started automatically');
    } catch (error) {
      log.error({ error }, 'Failed to start crank service');
      captureException(error as Error, {
        tags: { component: 'crank' },
        level: 'error',
      });
      log.info('Crank service available but not running - start via API');
    }
  } else {
    log.info('Crank service initialized but not enabled (CRANK_ENABLED=false)');
  }
});
