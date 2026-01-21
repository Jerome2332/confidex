import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import {
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
  getBlacklistedAddresses,
  getMerkleRoot,
  fetchBlacklistRoot,
  syncToOnChain,
} from '../../lib/blacklist.js';
import { adminAuth } from '../../middleware/auth.js';
import { rateLimiters } from '../../middleware/rate-limit.js';

// Validation schemas
const AddressSchema = z.string().refine((val) => {
  try {
    new PublicKey(val);
    return true;
  } catch {
    return false;
  }
}, 'Invalid Solana address');

const AddAddressSchema = z.object({
  address: AddressSchema,
});

const SyncSchema = z.object({
  adminPrivateKey: z.string().optional(),
});

import type { Router as RouterType } from 'express';
export const blacklistRouter: RouterType = Router();

// Apply admin authentication and rate limiting to all routes
blacklistRouter.use(adminAuth);
blacklistRouter.use(rateLimiters.strict);

/**
 * GET /api/admin/blacklist
 * List all blacklisted addresses
 */
blacklistRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const addresses = await getBlacklistedAddresses();
    const localRoot = await getMerkleRoot();
    const onChainRoot = await fetchBlacklistRoot();

    res.json({
      addresses,
      count: addresses.length,
      localMerkleRoot: localRoot,
      onChainMerkleRoot: onChainRoot,
      inSync: localRoot === onChainRoot,
    });
  } catch (error) {
    console.error('Failed to list blacklist:', error);
    res.status(500).json({ error: 'Failed to retrieve blacklist' });
  }
});

/**
 * GET /api/admin/blacklist/status
 * Get blacklist sync status
 */
blacklistRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const addresses = await getBlacklistedAddresses();
    const localRoot = await getMerkleRoot();
    const onChainRoot = await fetchBlacklistRoot();

    res.json({
      count: addresses.length,
      localMerkleRoot: localRoot,
      onChainMerkleRoot: onChainRoot,
      inSync: localRoot === onChainRoot,
    });
  } catch (error) {
    console.error('Failed to get blacklist status:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * GET /api/admin/blacklist/check/:address
 * Check if a specific address is blacklisted
 */
blacklistRouter.get('/check/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    // Validate address
    const parsed = AddressSchema.safeParse(address);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid Solana address' });
      return;
    }

    const blacklisted = await isBlacklisted(address);

    res.json({
      address,
      isBlacklisted: blacklisted,
    });
  } catch (error) {
    console.error('Failed to check address:', error);
    res.status(500).json({ error: 'Failed to check address' });
  }
});

/**
 * POST /api/admin/blacklist
 * Add an address to the blacklist
 */
blacklistRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = AddAddressSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { address } = parsed.data;

    // Check if already blacklisted
    if (await isBlacklisted(address)) {
      res.status(409).json({ error: 'Address is already blacklisted' });
      return;
    }

    const newRoot = await addToBlacklist(address);

    res.json({
      success: true,
      address,
      newMerkleRoot: newRoot,
      message: `Address ${address} added to blacklist. Call /sync to update on-chain.`,
    });
  } catch (error) {
    console.error('Failed to add to blacklist:', error);
    res.status(500).json({ error: 'Failed to add address to blacklist' });
  }
});

/**
 * DELETE /api/admin/blacklist/:address
 * Remove an address from the blacklist
 */
blacklistRouter.delete('/:address', async (req: Request, res: Response) => {
  try {
    const { address } = req.params;

    // Validate address
    const parsed = AddressSchema.safeParse(address);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid Solana address' });
      return;
    }

    // Check if blacklisted
    if (!(await isBlacklisted(address))) {
      res.status(404).json({ error: 'Address is not blacklisted' });
      return;
    }

    const newRoot = await removeFromBlacklist(address);

    res.json({
      success: true,
      address,
      newMerkleRoot: newRoot,
      message: `Address ${address} removed from blacklist. Call /sync to update on-chain.`,
    });
  } catch (error) {
    console.error('Failed to remove from blacklist:', error);
    res.status(500).json({ error: 'Failed to remove address from blacklist' });
  }
});

/**
 * POST /api/admin/blacklist/sync
 * Sync the local merkle root to on-chain
 * Requires admin private key (base58 encoded)
 */
blacklistRouter.post('/sync', async (req: Request, res: Response) => {
  try {
    const parsed = SyncSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    // Get admin keypair from env or request body
    let adminKeypair: Keypair;

    const privateKeyStr = parsed.data.adminPrivateKey || process.env.ADMIN_PRIVATE_KEY;

    if (!privateKeyStr) {
      res.status(400).json({
        error: 'Admin private key required',
        hint: 'Set ADMIN_PRIVATE_KEY env var or pass adminPrivateKey in request body',
      });
      return;
    }

    try {
      // Try to decode as base58
      const privateKeyBytes = bs58.decode(privateKeyStr);
      adminKeypair = Keypair.fromSecretKey(privateKeyBytes);
    } catch {
      try {
        // Try to parse as JSON array
        const privateKeyArray = JSON.parse(privateKeyStr);
        adminKeypair = Keypair.fromSecretKey(new Uint8Array(privateKeyArray));
      } catch {
        res.status(400).json({ error: 'Invalid admin private key format' });
        return;
      }
    }

    // Check current sync status
    const localRoot = await getMerkleRoot();
    const onChainRoot = await fetchBlacklistRoot();

    if (localRoot === onChainRoot) {
      res.json({
        success: true,
        message: 'Blacklist already in sync',
        merkleRoot: localRoot,
      });
      return;
    }

    // Sync to on-chain
    const signature = await syncToOnChain(adminKeypair);

    res.json({
      success: true,
      message: 'Blacklist synced to on-chain',
      signature,
      previousRoot: onChainRoot,
      newRoot: localRoot,
    });
  } catch (error) {
    console.error('Failed to sync blacklist:', error);
    res.status(500).json({
      error: 'Failed to sync blacklist to on-chain',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/admin/blacklist/bulk
 * Add multiple addresses to the blacklist at once
 */
blacklistRouter.post('/bulk', async (req: Request, res: Response) => {
  try {
    const BulkSchema = z.object({
      addresses: z.array(AddressSchema).min(1).max(100),
    });

    const parsed = BulkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0].message });
      return;
    }

    const { addresses } = parsed.data;
    const results: { address: string; added: boolean; reason?: string }[] = [];

    for (const address of addresses) {
      if (await isBlacklisted(address)) {
        results.push({ address, added: false, reason: 'Already blacklisted' });
      } else {
        await addToBlacklist(address);
        results.push({ address, added: true });
      }
    }

    const newRoot = await getMerkleRoot();
    const addedCount = results.filter((r) => r.added).length;

    res.json({
      success: true,
      results,
      addedCount,
      skippedCount: addresses.length - addedCount,
      newMerkleRoot: newRoot,
      message: `Added ${addedCount} addresses to blacklist. Call /sync to update on-chain.`,
    });
  } catch (error) {
    console.error('Failed to bulk add to blacklist:', error);
    res.status(500).json({ error: 'Failed to bulk add addresses to blacklist' });
  }
});
