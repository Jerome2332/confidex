import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { proveRouter } from './routes/prove.js';
import { healthRouter } from './routes/health.js';
import { blacklistRouter } from './routes/admin/blacklist.js';
import { crankRouter, initializeCrankService } from './routes/admin/crank.js';
import { CrankService, loadCrankConfig } from './crank/index.js';

config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3003',
  process.env.FRONTEND_URL,
].filter(Boolean) as string[];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'DELETE'],
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/api/prove', proveRouter);
app.use('/api/admin/blacklist', blacklistRouter);
app.use('/api/admin/crank', crankRouter);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, async () => {
  console.log(`Confidex proof server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Prove endpoint: http://localhost:${PORT}/api/prove`);
  console.log(`Blacklist admin: http://localhost:${PORT}/api/admin/blacklist`);
  console.log(`Crank admin: http://localhost:${PORT}/api/admin/crank`);

  // Initialize and optionally start crank service
  const crankConfig = loadCrankConfig();
  const crankService = new CrankService(crankConfig);
  initializeCrankService(crankService);

  if (crankConfig.enabled) {
    try {
      await crankService.start();
      console.log('Crank service started automatically');
    } catch (error) {
      console.error('Failed to start crank service:', error);
      console.log('Crank service available but not running - start via API');
    }
  } else {
    console.log('Crank service initialized but not enabled (CRANK_ENABLED=false)');
  }
});
