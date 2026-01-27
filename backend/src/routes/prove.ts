import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { generateEligibilityProof } from '../lib/prover.js';
import { fetchBlacklistRoot, getMerkleProof } from '../lib/blacklist.js';
import { rateLimiters } from '../middleware/rate-limit.js';
import { logger } from '../lib/logger.js';

const log = logger.prover;

export const proveRouter: RouterType = Router();

// External prover service URL (if configured, proxy requests there)
const PROVER_SERVICE_URL = process.env.PROVER_SERVICE_URL;
const PROVER_API_KEY = process.env.PROVER_API_KEY;

// ZK Proofs feature flag - when disabled, returns mock proofs for development/demo
// This allows the app to function without ZK infrastructure while clearly indicating demo mode
const ZK_PROOFS_ENABLED = process.env.ZK_PROOFS_ENABLED !== 'false';

// Groth16 proof size for Sunspot/gnark format
// Layout: A(64) + B(128) + C(64) + num_commitments(4) + commitment_pok(64) = 324 bytes
const GROTH16_PROOF_SIZE = 324;

// Demo blacklist root (empty tree)
const DEMO_BLACKLIST_ROOT = '0x' + '00'.repeat(32);

if (!ZK_PROOFS_ENABLED) {
  log.warn('ZK proofs DISABLED - running in demo mode. All proofs will be simulated.');
}

if (PROVER_SERVICE_URL) {
  log.info({ url: PROVER_SERVICE_URL }, 'Proof requests will be proxied to external prover service');
}

// Apply strict rate limiting for proof generation (computationally expensive)
proveRouter.use(rateLimiters.prove);

// Request validation schema
const ProveRequestSchema = z.object({
  // User's wallet address (base58)
  address: z.string().refine((val) => {
    try {
      new PublicKey(val);
      return true;
    } catch {
      return false;
    }
  }, 'Invalid Solana address'),

  // Signature proving wallet ownership
  // Message format: "Confidex eligibility proof request: <timestamp>"
  signature: z.string(),

  // The message that was signed
  message: z.string(),

  // Optional: specific blacklist root to use (defaults to on-chain value)
  blacklistRoot: z.string().optional(),
});

proveRouter.post('/', async (req, res) => {
  try {
    // Validate request body
    const parsed = ProveRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid request',
        details: parsed.error.issues,
      });
    }

    const { address, signature, message, blacklistRoot } = parsed.data;

    // If ZK proofs are disabled, return a simulated proof for demo purposes
    if (!ZK_PROOFS_ENABLED) {
      log.info({ address: address.slice(0, 8) }, 'Returning simulated proof (ZK disabled)');

      // Generate a deterministic but fake proof for demo mode
      // This proof won't verify on-chain but allows the UI flow to work
      const simulatedProof = Buffer.alloc(GROTH16_PROOF_SIZE, 0);
      // Add some structure to make it look like a real proof
      simulatedProof.write('DEMO', 0);

      return res.json({
        success: true,
        proof: simulatedProof.toString('base64'),
        proofHex: simulatedProof.toString('hex'),
        blacklistRoot: DEMO_BLACKLIST_ROOT,
        generatedAt: new Date().toISOString(),
        durationMs: 0,
        // Flag to indicate this is a simulated proof
        simulated: true,
        zkEnabled: false,
        message: 'ZK proofs are disabled in demo mode. This proof will not verify on-chain.',
      });
    }

    // If external prover service is configured, proxy the request
    if (PROVER_SERVICE_URL) {
      log.debug({ address: address.slice(0, 8) }, 'Proxying proof request to external service');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (PROVER_API_KEY) {
        headers['X-Prover-Key'] = PROVER_API_KEY;
      }

      const proxyResponse = await fetch(`${PROVER_SERVICE_URL}/api/prove`, {
        method: 'POST',
        headers,
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(60000), // 60s timeout for proof generation
      });

      const data = await proxyResponse.json();

      if (!proxyResponse.ok) {
        return res.status(proxyResponse.status).json(data);
      }

      return res.json(data);
    }

    // Local proof generation
    // Verify the signature
    const publicKey = new PublicKey(address);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes()
    );

    if (!isValid) {
      return res.status(401).json({
        error: 'Invalid signature',
        message: 'The provided signature does not match the address',
      });
    }

    // Verify message is recent (within 5 minutes)
    const timestampMatch = message.match(/:\s*(\d+)$/);
    if (timestampMatch) {
      const timestamp = parseInt(timestampMatch[1], 10);
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (Math.abs(now - timestamp) > fiveMinutes) {
        return res.status(400).json({
          error: 'Expired message',
          message: 'The signed message is too old. Please sign a new message.',
        });
      }
    }

    // Get blacklist root (from request or fetch from chain)
    const root = blacklistRoot || await fetchBlacklistRoot();

    // Get merkle proof for this address
    const merkleProof = await getMerkleProof(address, root);

    // Check if address is eligible (not blacklisted)
    if (!merkleProof.isEligible) {
      return res.status(403).json({
        error: 'Address is blacklisted',
        message: 'This address is not eligible for trading on Confidex',
        blacklistRoot: root,
      });
    }

    // Generate the ZK proof
    log.info({ address: address.slice(0, 8) }, 'Generating proof locally');
    const startTime = Date.now();

    const proof = await generateEligibilityProof({
      address,
      blacklistRoot: root,
      merklePath: merkleProof.path,
      pathIndices: merkleProof.indices,
    });

    const duration = Date.now() - startTime;
    log.info({ durationMs: duration }, 'Proof generated');

    return res.json({
      success: true,
      proof: proof.toString('base64'),
      proofHex: proof.toString('hex'),
      blacklistRoot: root,
      generatedAt: new Date().toISOString(),
      durationMs: duration,
    });
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Proof generation error');
    return res.status(500).json({
      error: 'Proof generation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET endpoint to check ZK prover status
proveRouter.get('/status', async (_req, res) => {
  return res.json({
    zkEnabled: ZK_PROOFS_ENABLED,
    proverServiceConfigured: !!PROVER_SERVICE_URL,
    mode: ZK_PROOFS_ENABLED
      ? (PROVER_SERVICE_URL ? 'external-prover' : 'local-prover')
      : 'demo',
    message: ZK_PROOFS_ENABLED
      ? 'ZK proofs are enabled and will be verified on-chain'
      : 'ZK proofs are disabled for demo mode. Proofs will be simulated.',
  });
});

// GET endpoint to check if an address is eligible (without generating proof)
proveRouter.get('/check/:address', async (req, res) => {
  try {
    const { address } = req.params;

    // Validate address
    try {
      new PublicKey(address);
    } catch {
      return res.status(400).json({ error: 'Invalid Solana address' });
    }

    // Proxy to external service if configured
    if (PROVER_SERVICE_URL) {
      const headers: Record<string, string> = {};
      if (PROVER_API_KEY) {
        headers['X-Prover-Key'] = PROVER_API_KEY;
      }

      const proxyResponse = await fetch(`${PROVER_SERVICE_URL}/api/prove/check/${address}`, {
        headers,
        signal: AbortSignal.timeout(5000),
      });

      const data = await proxyResponse.json();
      return res.status(proxyResponse.status).json(data);
    }

    const root = await fetchBlacklistRoot();
    const merkleProof = await getMerkleProof(address, root);

    return res.json({
      eligible: merkleProof.isEligible,
      address,
      blacklistRoot: root,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Eligibility check error');
    return res.status(500).json({
      error: 'Eligibility check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
