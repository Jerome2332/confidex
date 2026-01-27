import express from 'express';
import cors from 'cors';
import { config } from 'dotenv';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { generateEligibilityProof, getProverStatus, isProverAvailable } from './prover.js';
import { fetchBlacklistRoot, getMerkleProof, isAddressBlacklisted } from './blacklist.js';

config();

const app = express();
const PORT = process.env.PORT || 3002;

// Parse allowed origins from env
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

// Add localhost for development
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000');
}

// Optional API key for backend-to-prover auth
const PROVER_API_KEY = process.env.PROVER_API_KEY;

// CORS configuration
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      // Allow no-origin requests in development (curl, Postman)
      if (process.env.NODE_ENV === 'production') {
        callback(new Error('Origin header required'), false);
      } else {
        callback(null, true);
      }
      return;
    }

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS] Rejected request from: ${origin}`);
      callback(new Error(`Origin ${origin} not allowed`), false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Prover-Key', 'X-Request-ID'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));

// Optional API key middleware
const checkApiKey: express.RequestHandler = (req, res, next) => {
  if (!PROVER_API_KEY) {
    return next();
  }

  const providedKey = req.headers['x-prover-key'];
  if (providedKey !== PROVER_API_KEY) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }
  next();
};

// Request validation schema
const ProveRequestSchema = z.object({
  address: z.string().refine((val) => {
    try {
      new PublicKey(val);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid Solana address'),
  signature: z.string(),
  message: z.string(),
  blacklistRoot: z.string().optional(),
});

// Health check
app.get('/health', (_req, res) => {
  const status = getProverStatus();
  res.json({
    status: status.available ? 'healthy' : 'degraded',
    prover: status,
    timestamp: new Date().toISOString(),
  });
});

// Prover status
app.get('/status', (_req, res) => {
  res.json(getProverStatus());
});

// Generate proof
app.post('/api/prove', checkApiKey, async (req, res) => {
  try {
    const parsed = ProveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues,
      });
      return;
    }

    const { address, signature, message, blacklistRoot } = parsed.data;

    // Verify signature
    const publicKey = new PublicKey(address);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );

    if (!isValid) {
      res.status(401).json({
        error: 'Invalid signature',
        message: 'The provided signature does not match the address',
      });
      return;
    }

    // Verify message is recent (within 5 minutes)
    const timestampMatch = message.match(/:\s*(\d+)$/);
    if (timestampMatch) {
      const timestamp = parseInt(timestampMatch[1], 10);
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (Math.abs(now - timestamp) > fiveMinutes) {
        res.status(400).json({
          error: 'Expired message',
          message: 'The signed message is too old. Please sign a new message.',
        });
        return;
      }
    }

    // Get blacklist root
    const root = blacklistRoot || await fetchBlacklistRoot();

    // Get merkle proof
    const merkleProof = await getMerkleProof(address, root);

    if (!merkleProof.isEligible) {
      res.status(403).json({
        error: 'Address is blacklisted',
        message: 'This address is not eligible for trading on Confidex',
        blacklistRoot: root,
      });
      return;
    }

    // Generate proof
    console.log(`[Prover] Generating proof for: ${address}`);
    const startTime = Date.now();

    const proof = await generateEligibilityProof({
      address,
      blacklistRoot: root,
      merklePath: merkleProof.path,
      pathIndices: merkleProof.indices,
    });

    const duration = Date.now() - startTime;
    console.log(`[Prover] Proof generated in ${duration}ms`);

    res.json({
      success: true,
      proof: proof.toString('base64'),
      proofHex: proof.toString('hex'),
      blacklistRoot: root,
      generatedAt: new Date().toISOString(),
      durationMs: duration,
    });
  } catch (error) {
    console.error('[Prover] Error:', error);
    res.status(500).json({
      error: 'Proof generation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Check eligibility
app.get('/api/prove/check/:address', async (req, res) => {
  try {
    const { address } = req.params;

    try {
      new PublicKey(address);
    } catch {
      res.status(400).json({ error: 'Invalid Solana address' });
      return;
    }

    const isBlacklisted = await isAddressBlacklisted(address);
    const root = await fetchBlacklistRoot();

    res.json({
      eligible: !isBlacklisted,
      address,
      blacklistRoot: root,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Prover] Eligibility check error:', error);
    res.status(500).json({
      error: 'Eligibility check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\n${'='.repeat(60)}`);
  console.log('  Confidex Prover Service');
  console.log(`${'='.repeat(60)}`);
  console.log(`  Port:          ${PORT}`);
  console.log(`  Environment:   ${process.env.NODE_ENV || 'development'}`);
  console.log(`  CORS origins:  ${ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS.join(', ') : '(all in dev)'}`);
  console.log(`  API key auth:  ${PROVER_API_KEY ? 'enabled' : 'disabled'}`);
  console.log(`${'='.repeat(60)}`);

  const status = getProverStatus();
  console.log('\n  Prover Status:');
  console.log(`    Available:     ${status.available ? '✓' : '✗'}`);
  console.log(`    Strict mode:   ${status.strictMode ? 'enabled' : 'disabled'}`);
  console.log(`    Sunspot:       ${status.sunspotFound ? '✓' : '✗'} ${status.sunspotPath}`);
  console.log(`    Nargo:         ${status.nargoAvailable ? '✓' : '✗'} ${status.nargoVersion || 'not found'}`);
  console.log(`    Circuit dir:   ${status.circuitDir}`);
  console.log(`    Artifacts:`);
  console.log(`      - json:      ${status.artifacts.json ? '✓' : '✗'}`);
  console.log(`      - ccs:       ${status.artifacts.ccs ? '✓' : '✗'}`);
  console.log(`      - pk:        ${status.artifacts.pk ? '✓' : '✗'}`);
  console.log(`      - vk:        ${status.artifacts.vk ? '✓' : '✗'}`);
  console.log(`${'='.repeat(60)}\n`);

  if (!status.available && status.strictMode) {
    console.warn('⚠️  WARNING: Prover not available but strict mode enabled!');
    console.warn('   Proof requests will fail. Install nargo + sunspot and build circuits.\n');
  }
});
