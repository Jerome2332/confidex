import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Use vi.hoisted for mocks that need to be available before vi.mock hoisting
const mockBlacklistFns = vi.hoisted(() => ({
  addToBlacklist: vi.fn().mockResolvedValue('0xnewroot'),
  removeFromBlacklist: vi.fn().mockResolvedValue('0xnewroot'),
  isBlacklisted: vi.fn().mockResolvedValue(false),
  getBlacklistedAddresses: vi.fn().mockResolvedValue([]),
  getMerkleRoot: vi.fn().mockResolvedValue('0xlocalroot'),
  fetchBlacklistRoot: vi.fn().mockResolvedValue('0xonchainroot'),
  syncToOnChain: vi.fn().mockResolvedValue('txsignature123'),
}));

// Mock dependencies first
vi.mock('../../../middleware/auth.js', () => ({
  adminAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../../middleware/rate-limit.js', () => ({
  rateLimiters: {
    strict: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  },
}));

vi.mock('../../../lib/blacklist.js', () => mockBlacklistFns);

// Import after mocks
import { blacklistRouter } from '../../../routes/admin/blacklist.js';

// Valid test addresses (real Solana address format)
const VALID_ADDRESS_1 = '63bxUBrBd1W5drU5UMYWwAfkMX7Qr17AZiTrm3aqfArB';
const VALID_ADDRESS_2 = '4pdgnqNQLxocJNo6MrSHKqieUpQ8zx3sxbsTANJFtSNi';
const INVALID_ADDRESS = 'not-a-valid-address';

describe('Blacklist Admin Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/admin/blacklist', blacklistRouter);

    // Reset mock defaults
    mockBlacklistFns.isBlacklisted.mockResolvedValue(false);
    mockBlacklistFns.getBlacklistedAddresses.mockResolvedValue([]);
    mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocalroot');
    mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchainroot');
  });

  describe('GET /', () => {
    it('returns blacklist with count and sync status', async () => {
      mockBlacklistFns.getBlacklistedAddresses.mockResolvedValue([VALID_ADDRESS_1, VALID_ADDRESS_2]);
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xroot123');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xroot123');

      const response = await request(app).get('/api/admin/blacklist');

      expect(response.status).toBe(200);
      expect(response.body.addresses).toHaveLength(2);
      expect(response.body.count).toBe(2);
      expect(response.body.localMerkleRoot).toBe('0xroot123');
      expect(response.body.onChainMerkleRoot).toBe('0xroot123');
      expect(response.body.inSync).toBe(true);
    });

    it('shows inSync as false when roots differ', async () => {
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocal');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchain');

      const response = await request(app).get('/api/admin/blacklist');

      expect(response.status).toBe(200);
      expect(response.body.inSync).toBe(false);
    });

    it('returns 500 on error', async () => {
      mockBlacklistFns.getBlacklistedAddresses.mockRejectedValue(new Error('DB error'));

      const response = await request(app).get('/api/admin/blacklist');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to retrieve blacklist');
    });
  });

  describe('GET /status', () => {
    it('returns sync status', async () => {
      mockBlacklistFns.getBlacklistedAddresses.mockResolvedValue([VALID_ADDRESS_1]);
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocal');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchain');

      const response = await request(app).get('/api/admin/blacklist/status');

      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.localMerkleRoot).toBe('0xlocal');
      expect(response.body.onChainMerkleRoot).toBe('0xonchain');
      expect(response.body.inSync).toBe(false);
    });

    it('returns 500 on error', async () => {
      mockBlacklistFns.getMerkleRoot.mockRejectedValue(new Error('Error'));

      const response = await request(app).get('/api/admin/blacklist/status');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to get status');
    });
  });

  describe('GET /check/:address', () => {
    it('returns blacklisted status for valid address', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(true);

      const response = await request(app).get(`/api/admin/blacklist/check/${VALID_ADDRESS_1}`);

      expect(response.status).toBe(200);
      expect(response.body.address).toBe(VALID_ADDRESS_1);
      expect(response.body.isBlacklisted).toBe(true);
    });

    it('returns 400 for invalid address', async () => {
      const response = await request(app).get(`/api/admin/blacklist/check/${INVALID_ADDRESS}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid Solana address');
    });

    it('returns 500 on error', async () => {
      mockBlacklistFns.isBlacklisted.mockRejectedValue(new Error('Check failed'));

      const response = await request(app).get(`/api/admin/blacklist/check/${VALID_ADDRESS_1}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to check address');
    });
  });

  describe('POST /', () => {
    it('adds address to blacklist', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(false);
      mockBlacklistFns.addToBlacklist.mockResolvedValue('0xnewroot');

      const response = await request(app)
        .post('/api/admin/blacklist')
        .send({ address: VALID_ADDRESS_1 });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.address).toBe(VALID_ADDRESS_1);
      expect(response.body.newMerkleRoot).toBe('0xnewroot');
      expect(mockBlacklistFns.addToBlacklist).toHaveBeenCalledWith(VALID_ADDRESS_1);
    });

    it('returns 409 if address already blacklisted', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(true);

      const response = await request(app)
        .post('/api/admin/blacklist')
        .send({ address: VALID_ADDRESS_1 });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe('Address is already blacklisted');
    });

    it('returns 400 for invalid address', async () => {
      const response = await request(app)
        .post('/api/admin/blacklist')
        .send({ address: INVALID_ADDRESS });

      expect(response.status).toBe(400);
    });

    it('returns 400 for missing address', async () => {
      const response = await request(app)
        .post('/api/admin/blacklist')
        .send({});

      expect(response.status).toBe(400);
    });

    it('returns 500 on error', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(false);
      mockBlacklistFns.addToBlacklist.mockRejectedValue(new Error('Add failed'));

      const response = await request(app)
        .post('/api/admin/blacklist')
        .send({ address: VALID_ADDRESS_1 });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to add address to blacklist');
    });
  });

  describe('DELETE /:address', () => {
    it('removes address from blacklist', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(true);
      mockBlacklistFns.removeFromBlacklist.mockResolvedValue('0xnewroot');

      const response = await request(app).delete(`/api/admin/blacklist/${VALID_ADDRESS_1}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.address).toBe(VALID_ADDRESS_1);
      expect(mockBlacklistFns.removeFromBlacklist).toHaveBeenCalledWith(VALID_ADDRESS_1);
    });

    it('returns 404 if address not blacklisted', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(false);

      const response = await request(app).delete(`/api/admin/blacklist/${VALID_ADDRESS_1}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Address is not blacklisted');
    });

    it('returns 400 for invalid address', async () => {
      const response = await request(app).delete(`/api/admin/blacklist/${INVALID_ADDRESS}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid Solana address');
    });

    it('returns 500 on error', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(true);
      mockBlacklistFns.removeFromBlacklist.mockRejectedValue(new Error('Remove failed'));

      const response = await request(app).delete(`/api/admin/blacklist/${VALID_ADDRESS_1}`);

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to remove address from blacklist');
    });
  });

  describe('POST /sync', () => {
    // Valid test private key (base58 encoded)
    const VALID_BASE58_KEY = '46b6YjgTMti6bLxtpwWcMpBzjDb369Wx8ryDdUEy6xDeMHe3eF5HecjR8aNtPjTqAaQzQFFuEDzUkQ3Phks5dRzp';
    // Same key as JSON array
    const VALID_JSON_KEY = '[154,222,167,238,201,17,165,204,155,194,35,16,215,28,199,184,25,93,204,96,146,226,126,248,19,80,106,194,196,94,9,231,253,147,35,194,231,169,52,130,199,73,176,214,211,130,192,46,159,179,240,164,108,135,140,120,238,69,239,204,207,203,194,89]';

    it('returns 400 when no admin key provided even when roots match', async () => {
      // Even when in sync, the endpoint still validates the request body first
      // and requires admin key (or env var) to proceed
      const originalEnv = process.env.ADMIN_PRIVATE_KEY;
      delete process.env.ADMIN_PRIVATE_KEY;

      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xsameroot');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xsameroot');

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({});

      // Without admin key, it returns 400 before even checking sync status
      expect(response.status).toBe(400);

      if (originalEnv) process.env.ADMIN_PRIVATE_KEY = originalEnv;
    });

    it('returns 400 when no admin private key provided', async () => {
      // Make sure env var is not set
      const originalEnv = process.env.ADMIN_PRIVATE_KEY;
      delete process.env.ADMIN_PRIVATE_KEY;

      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocal');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchain');

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Admin private key required');

      // Restore
      if (originalEnv) process.env.ADMIN_PRIVATE_KEY = originalEnv;
    });

    it('returns 400 for invalid private key format', async () => {
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocal');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchain');

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({ adminPrivateKey: 'invalid-key-format' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid admin private key format');
    });

    it('returns success when roots already match with base58 key', async () => {
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xsameroot');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xsameroot');

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({ adminPrivateKey: VALID_BASE58_KEY });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Blacklist already in sync');
      expect(response.body.merkleRoot).toBe('0xsameroot');
    });

    it('syncs successfully with base58 private key', async () => {
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocalroot');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchainroot');
      mockBlacklistFns.syncToOnChain.mockResolvedValue('tx-signature-abc123');

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({ adminPrivateKey: VALID_BASE58_KEY });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Blacklist synced to on-chain');
      expect(response.body.signature).toBe('tx-signature-abc123');
      expect(response.body.previousRoot).toBe('0xonchainroot');
      expect(response.body.newRoot).toBe('0xlocalroot');
      expect(mockBlacklistFns.syncToOnChain).toHaveBeenCalled();
    });

    it('syncs successfully with JSON array private key', async () => {
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocalroot');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchainroot');
      mockBlacklistFns.syncToOnChain.mockResolvedValue('tx-signature-json');

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({ adminPrivateKey: VALID_JSON_KEY });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Blacklist synced to on-chain');
      expect(response.body.signature).toBe('tx-signature-json');
    });

    it('uses ADMIN_PRIVATE_KEY env var when not provided in body', async () => {
      const originalEnv = process.env.ADMIN_PRIVATE_KEY;
      process.env.ADMIN_PRIVATE_KEY = VALID_BASE58_KEY;

      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xsameroot');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xsameroot');

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Blacklist already in sync');

      // Restore
      if (originalEnv) {
        process.env.ADMIN_PRIVATE_KEY = originalEnv;
      } else {
        delete process.env.ADMIN_PRIVATE_KEY;
      }
    });

    it('returns 500 on syncToOnChain error', async () => {
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xlocalroot');
      mockBlacklistFns.fetchBlacklistRoot.mockResolvedValue('0xonchainroot');
      mockBlacklistFns.syncToOnChain.mockRejectedValue(new Error('Sync failed'));

      const response = await request(app)
        .post('/api/admin/blacklist/sync')
        .send({ adminPrivateKey: VALID_BASE58_KEY });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to sync blacklist to on-chain');
      expect(response.body.details).toBe('Sync failed');
    });
  });

  describe('POST /bulk', () => {
    it('adds multiple addresses', async () => {
      mockBlacklistFns.isBlacklisted.mockResolvedValue(false);
      mockBlacklistFns.addToBlacklist.mockResolvedValue('0xnewroot');
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xfinalroot');

      const response = await request(app)
        .post('/api/admin/blacklist/bulk')
        .send({ addresses: [VALID_ADDRESS_1, VALID_ADDRESS_2] });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.addedCount).toBe(2);
      expect(response.body.skippedCount).toBe(0);
      expect(response.body.results).toHaveLength(2);
    });

    it('skips already blacklisted addresses', async () => {
      // First address already blacklisted, second is not
      mockBlacklistFns.isBlacklisted
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);
      mockBlacklistFns.getMerkleRoot.mockResolvedValue('0xfinalroot');

      const response = await request(app)
        .post('/api/admin/blacklist/bulk')
        .send({ addresses: [VALID_ADDRESS_1, VALID_ADDRESS_2] });

      expect(response.status).toBe(200);
      expect(response.body.addedCount).toBe(1);
      expect(response.body.skippedCount).toBe(1);
      expect(response.body.results[0].added).toBe(false);
      expect(response.body.results[0].reason).toBe('Already blacklisted');
      expect(response.body.results[1].added).toBe(true);
    });

    it('returns 400 for empty addresses array', async () => {
      const response = await request(app)
        .post('/api/admin/blacklist/bulk')
        .send({ addresses: [] });

      expect(response.status).toBe(400);
    });

    it('returns 400 for invalid address in array', async () => {
      const response = await request(app)
        .post('/api/admin/blacklist/bulk')
        .send({ addresses: [VALID_ADDRESS_1, INVALID_ADDRESS] });

      expect(response.status).toBe(400);
    });

    it('returns 500 on error', async () => {
      mockBlacklistFns.isBlacklisted.mockRejectedValue(new Error('Bulk error'));

      const response = await request(app)
        .post('/api/admin/blacklist/bulk')
        .send({ addresses: [VALID_ADDRESS_1] });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Failed to bulk add addresses to blacklist');
    });
  });

  describe('router structure', () => {
    it('exports a valid Express router', () => {
      expect(blacklistRouter).toBeDefined();
    });
  });
});
