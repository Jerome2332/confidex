import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { generateEligibilityProof } from '../lib/prover.js';
import { fetchBlacklistRoot, getMerkleProof } from '../lib/blacklist.js';
import { rateLimiters } from '../middleware/rate-limit.js';

export const proveRouter: RouterType = Router();

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
    console.log(`Generating proof for address: ${address}`);
    const startTime = Date.now();

    const proof = await generateEligibilityProof({
      address,
      blacklistRoot: root,
      merklePath: merkleProof.path,
      pathIndices: merkleProof.indices,
    });

    const duration = Date.now() - startTime;
    console.log(`Proof generated in ${duration}ms`);

    return res.json({
      success: true,
      proof: proof.toString('base64'),
      proofHex: proof.toString('hex'),
      blacklistRoot: root,
      generatedAt: new Date().toISOString(),
      durationMs: duration,
    });
  } catch (error) {
    console.error('Proof generation error:', error);
    return res.status(500).json({
      error: 'Proof generation failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
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

    const root = await fetchBlacklistRoot();
    const merkleProof = await getMerkleProof(address, root);

    return res.json({
      eligible: merkleProof.isEligible,
      address,
      blacklistRoot: root,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Eligibility check error:', error);
    return res.status(500).json({
      error: 'Eligibility check failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});
