import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { proveRouter } from './routes/prove.js';
import { healthRouter } from './routes/health.js';

config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());

// Routes
app.use('/health', healthRouter);
app.use('/api/prove', proveRouter);

// Error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Confidex proof server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Prove endpoint: http://localhost:${PORT}/api/prove`);
});
