/**
 * Crank Admin Routes
 *
 * API endpoints for controlling and monitoring the crank service.
 * All routes require admin authentication via X-API-Key header.
 */

import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { CrankService } from '../../crank/index.js';
import { adminAuth } from '../../middleware/auth.js';
import { rateLimiters } from '../../middleware/rate-limit.js';

const router: RouterType = Router();

// Apply admin authentication and rate limiting to all crank routes
router.use(adminAuth);
router.use(rateLimiters.strict);

// Singleton crank service instance
let crankService: CrankService | null = null;

/**
 * Initialize the crank service
 * Called from main server startup
 */
export function initializeCrankService(service: CrankService): void {
  crankService = service;
}

/**
 * GET /admin/crank/status
 *
 * Get current crank service status and metrics
 */
router.get('/status', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Crank service not initialized',
      status: 'unavailable',
    });
  }

  try {
    const status = await crankService.getStatus();
    return res.json(status);
  } catch (error) {
    console.error('[CrankRoutes] Error getting status:', error);
    return res.status(500).json({
      error: 'Failed to get crank status',
    });
  }
});

/**
 * POST /admin/crank/start
 *
 * Start the crank service
 */
router.post('/start', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Crank service not initialized',
    });
  }

  try {
    await crankService.start();
    const status = await crankService.getStatus();
    return res.json({
      message: 'Crank service started',
      ...status,
    });
  } catch (error) {
    console.error('[CrankRoutes] Error starting crank:', error);
    return res.status(500).json({
      error: 'Failed to start crank service',
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

/**
 * POST /admin/crank/stop
 *
 * Stop the crank service
 */
router.post('/stop', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Crank service not initialized',
    });
  }

  try {
    crankService.stop();
    const status = await crankService.getStatus();
    return res.json({
      message: 'Crank service stopped',
      ...status,
    });
  } catch (error) {
    console.error('[CrankRoutes] Error stopping crank:', error);
    return res.status(500).json({
      error: 'Failed to stop crank service',
    });
  }
});

/**
 * POST /admin/crank/pause
 *
 * Pause the crank service (stops polling but keeps state)
 */
router.post('/pause', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Crank service not initialized',
    });
  }

  try {
    crankService.pause();
    const status = await crankService.getStatus();
    return res.json({
      message: 'Crank service paused',
      ...status,
    });
  } catch (error) {
    console.error('[CrankRoutes] Error pausing crank:', error);
    return res.status(500).json({
      error: 'Failed to pause crank service',
    });
  }
});

/**
 * POST /admin/crank/resume
 *
 * Resume the crank service after pause
 */
router.post('/resume', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Crank service not initialized',
    });
  }

  try {
    crankService.resume();
    const status = await crankService.getStatus();
    return res.json({
      message: 'Crank service resumed',
      ...status,
    });
  } catch (error) {
    console.error('[CrankRoutes] Error resuming crank:', error);
    return res.status(500).json({
      error: 'Failed to resume crank service',
    });
  }
});

/**
 * POST /admin/crank/skip-pending-mpc
 *
 * Skip all pending MPC computations (mark them as failed to stop polling)
 */
router.post('/skip-pending-mpc', async (_req: Request, res: Response) => {
  if (!crankService) {
    return res.status(503).json({
      error: 'Crank service not initialized',
    });
  }

  try {
    const skipped = await crankService.skipPendingMpcComputations();
    return res.json({
      message: `Skipped ${skipped} pending MPC computations`,
      skipped,
    });
  } catch (error) {
    console.error('[CrankRoutes] Error skipping pending MPC:', error);
    return res.status(500).json({
      error: 'Failed to skip pending MPC computations',
    });
  }
});

export const crankRouter: RouterType = router;
