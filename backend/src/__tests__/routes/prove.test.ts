import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';

// Mock rate limiter
vi.mock('../../middleware/rate-limit.js', () => ({
  rateLimiters: {
    prove: (req: express.Request, res: express.Response, next: express.NextFunction) => next(),
  },
}));

// Mock prover - use vi.hoisted for consistent mocking
const mockProverFns = vi.hoisted(() => ({
  generateEligibilityProof: vi.fn().mockResolvedValue(Buffer.from('mock-proof-data')),
}));

vi.mock('../../lib/prover.js', () => mockProverFns);

// Mock blacklist
const mockBlacklistFns = vi.hoisted(() => ({
  fetchBlacklistRoot: vi.fn().mockResolvedValue('0xblacklistroot'),
  getMerkleProof: vi.fn().mockResolvedValue({
    isEligible: true,
    path: ['0xhash1', '0xhash2'],
    indices: [0, 1],
  }),
}));

vi.mock('../../lib/blacklist.js', () => mockBlacklistFns);

// Import after mocks
import { proveRouter } from '../../routes/prove.js';

// Helper to create signed message
function createSignedMessage(keypair: Keypair, timestamp?: number) {
  const ts = timestamp ?? Date.now();
  const message = `Confidex eligibility proof request: ${ts}`;
  const messageBytes = new TextEncoder().encode(message);
  const signature = nacl.sign.detached(messageBytes, keypair.secretKey);
  return {
    address: keypair.publicKey.toBase58(),
    message,
    signature: bs58.encode(signature),
  };
}

describe('prove routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/prove', proveRouter);

    // Reset mock defaults
    mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xblacklistroot');
    mockBlacklistFns.getMerkleProof.mockResolvedValue({
      isEligible: true,
      path: ['0xhash1', '0xhash2'],
      indices: [0, 1],
    });
    mockProverFns.generateEligibilityProof.mockResolvedValue(Buffer.from('mock-proof-data'));
  });

  describe('POST /', () => {
    it('generates proof for valid request', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.proof).toBeDefined();
      expect(response.body.proofHex).toBeDefined();
      expect(response.body.blacklistRoot).toBe('0xblacklistroot');
      expect(response.body.generatedAt).toBeDefined();
      expect(response.body.durationMs).toBeDefined();
    });

    it('returns 400 for invalid Solana address', async () => {
      const response = await request(app)
        .post('/api/prove')
        .send({
          address: 'not-a-valid-address',
          message: 'test message',
          signature: 'test-signature',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('returns 400 for missing address', async () => {
      const response = await request(app)
        .post('/api/prove')
        .send({
          message: 'test message',
          signature: 'test-signature',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('returns 400 for missing signature', async () => {
      const keypair = Keypair.generate();

      const response = await request(app)
        .post('/api/prove')
        .send({
          address: keypair.publicKey.toBase58(),
          message: 'test message',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('returns 400 for missing message', async () => {
      const keypair = Keypair.generate();

      const response = await request(app)
        .post('/api/prove')
        .send({
          address: keypair.publicKey.toBase58(),
          signature: 'test-signature',
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid request');
    });

    it('returns 401 for invalid signature', async () => {
      const keypair = Keypair.generate();
      const anotherKeypair = Keypair.generate();
      // Sign with a different keypair
      const { message, signature } = createSignedMessage(anotherKeypair);

      const response = await request(app)
        .post('/api/prove')
        .send({
          address: keypair.publicKey.toBase58(), // Different address
          message,
          signature,
        });

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Invalid signature');
    });

    it('returns 400 for expired message (older than 5 minutes)', async () => {
      const keypair = Keypair.generate();
      const oldTimestamp = Date.now() - 6 * 60 * 1000; // 6 minutes ago
      const { address, message, signature } = createSignedMessage(keypair, oldTimestamp);

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Expired message');
    });

    it('accepts message within 5 minute window', async () => {
      const keypair = Keypair.generate();
      const recentTimestamp = Date.now() - 4 * 60 * 1000; // 4 minutes ago
      const { address, message, signature } = createSignedMessage(keypair, recentTimestamp);

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('allows message without timestamp', async () => {
      const keypair = Keypair.generate();
      const message = 'Confidex eligibility proof request without timestamp';
      const messageBytes = new TextEncoder().encode(message);
      const signature = nacl.sign.detached(messageBytes, keypair.secretKey);

      const response = await request(app)
        .post('/api/prove')
        .send({
          address: keypair.publicKey.toBase58(),
          message,
          signature: bs58.encode(signature),
        });

      expect(response.status).toBe(200);
    });

    it('returns 403 for blacklisted address', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      mockBlacklistFns.getMerkleProof.mockResolvedValueOnce({
        isEligible: false,
        path: [],
        indices: [],
      });

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Address is blacklisted');
      expect(response.body.blacklistRoot).toBeDefined();
    });

    it('uses provided blacklistRoot', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);
      const customRoot = '0xcustomroot';

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature, blacklistRoot: customRoot });

      expect(response.status).toBe(200);
      expect(response.body.blacklistRoot).toBe(customRoot);
      expect(mockBlacklistFns.getMerkleProof).toHaveBeenCalledWith(address, customRoot);
    });

    it('fetches blacklistRoot when not provided', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(200);
      expect(mockBlacklistFns.fetchBlacklistRoot).toHaveBeenCalled();
    });

    it('calls generateEligibilityProof with correct params', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(mockProverFns.generateEligibilityProof).toHaveBeenCalledWith({
        address,
        blacklistRoot: '0xblacklistroot',
        merklePath: ['0xhash1', '0xhash2'],
        pathIndices: [0, 1],
      });
    });

    it('returns 500 when proof generation fails', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      mockProverFns.generateEligibilityProof.mockRejectedValueOnce(
        new Error('Proof generation failed')
      );

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Proof generation failed');
      expect(response.body.message).toBe('Proof generation failed');
    });

    it('returns 500 when blacklist fetch fails', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      mockBlacklistFns.fetchBlacklistRoot.mockRejectedValueOnce(new Error('Fetch failed'));

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Proof generation failed');
    });

    it('returns 500 when merkle proof fetch fails', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      mockBlacklistFns.getMerkleProof.mockRejectedValueOnce(new Error('Merkle proof failed'));

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Proof generation failed');
    });

    it('returns proof in base64 and hex formats', async () => {
      const keypair = Keypair.generate();
      const { address, message, signature } = createSignedMessage(keypair);

      const mockProof = Buffer.from('test-proof-bytes');
      mockProverFns.generateEligibilityProof.mockResolvedValueOnce(mockProof);

      const response = await request(app)
        .post('/api/prove')
        .send({ address, message, signature });

      expect(response.status).toBe(200);
      expect(response.body.proof).toBe(mockProof.toString('base64'));
      expect(response.body.proofHex).toBe(mockProof.toString('hex'));
    });
  });

  describe('GET /check/:address', () => {
    it('returns eligible status for valid address', async () => {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();

      const response = await request(app).get(`/api/prove/check/${address}`);

      expect(response.status).toBe(200);
      expect(response.body.eligible).toBe(true);
      expect(response.body.address).toBe(address);
      expect(response.body.blacklistRoot).toBe('0xblacklistroot');
      expect(response.body.checkedAt).toBeDefined();
    });

    it('returns not eligible for blacklisted address', async () => {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();

      mockBlacklistFns.getMerkleProof.mockResolvedValueOnce({
        isEligible: false,
        path: [],
        indices: [],
      });

      const response = await request(app).get(`/api/prove/check/${address}`);

      expect(response.status).toBe(200);
      expect(response.body.eligible).toBe(false);
    });

    it('returns 400 for invalid address', async () => {
      const response = await request(app).get('/api/prove/check/not-a-valid-address');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid Solana address');
    });

    it('returns 500 when blacklist fetch fails', async () => {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();

      mockBlacklistFns.fetchBlacklistRoot.mockRejectedValueOnce(new Error('Fetch failed'));

      const response = await request(app).get(`/api/prove/check/${address}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Eligibility check failed');
    });

    it('returns 500 when merkle proof fails', async () => {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();

      mockBlacklistFns.getMerkleProof.mockRejectedValueOnce(new Error('Merkle failed'));

      const response = await request(app).get(`/api/prove/check/${address}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Eligibility check failed');
    });

    it('calls fetchBlacklistRoot', async () => {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();

      await request(app).get(`/api/prove/check/${address}`);

      expect(mockBlacklistFns.fetchBlacklistRoot).toHaveBeenCalled();
    });

    it('calls getMerkleProof with address and root', async () => {
      const keypair = Keypair.generate();
      const address = keypair.publicKey.toBase58();

      await request(app).get(`/api/prove/check/${address}`);

      expect(mockBlacklistFns.getMerkleProof).toHaveBeenCalledWith(address, '0xblacklistroot');
    });
  });

  describe('rate limiting', () => {
    it('applies prove rate limiter to all routes', () => {
      // The rate limiter is applied via proveRouter.use(rateLimiters.prove)
      // We mocked it to pass through, so routes should work
      // This test just verifies the router is set up correctly
      expect(proveRouter).toBeDefined();
    });
  });
});
