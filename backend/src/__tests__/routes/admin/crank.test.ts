import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock dependencies first
vi.mock('../../../middleware/auth.js', () => ({
  adminAuth: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../../middleware/rate-limit.js', () => ({
  rateLimiters: {
    strict: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
  },
}));

// Mock CrankService
vi.mock('../../../crank/index.js', () => ({
  CrankService: class MockCrankService {
    async getStatus() {
      return { status: 'running' };
    }
    async start() {}
    stop() {}
    pause() {}
    resume() {}
    async skipPendingMpcComputations() {
      return 5;
    }
  },
}));

// Import after mocks
import { crankRouter, initializeCrankService } from '../../../routes/admin/crank.js';
import { CrankService } from '../../../crank/index.js';

describe('Crank Admin Routes', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/admin/crank', crankRouter);
  });

  describe('without initialized crank service', () => {
    beforeEach(() => {
      // Reset crank service to null by importing fresh
      initializeCrankService(null as any);
    });

    it('GET /status returns 503 when crank service not initialized', async () => {
      const response = await request(app).get('/admin/crank/status');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Crank service not initialized');
      expect(response.body.status).toBe('unavailable');
    });

    it('POST /start returns 503 when crank service not initialized', async () => {
      const response = await request(app).post('/admin/crank/start');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Crank service not initialized');
    });

    it('POST /stop returns 503 when crank service not initialized', async () => {
      const response = await request(app).post('/admin/crank/stop');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Crank service not initialized');
    });

    it('POST /pause returns 503 when crank service not initialized', async () => {
      const response = await request(app).post('/admin/crank/pause');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Crank service not initialized');
    });

    it('POST /resume returns 503 when crank service not initialized', async () => {
      const response = await request(app).post('/admin/crank/resume');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Crank service not initialized');
    });

    it('POST /skip-pending-mpc returns 503 when crank service not initialized', async () => {
      const response = await request(app).post('/admin/crank/skip-pending-mpc');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Crank service not initialized');
    });
  });

  describe('with initialized crank service', () => {
    let mockService: {
      getStatus: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      resume: ReturnType<typeof vi.fn>;
      skipPendingMpcComputations: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockService = {
        getStatus: vi.fn().mockResolvedValue({
          status: 'running',
          totalPolls: 100,
          successfulMatches: 50,
          failedMatches: 2,
        }),
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        skipPendingMpcComputations: vi.fn().mockResolvedValue(5),
      };

      initializeCrankService(mockService as unknown as CrankService);
    });

    describe('GET /status', () => {
      it('returns crank service status', async () => {
        const response = await request(app).get('/admin/crank/status');

        expect(response.status).toBe(200);
        expect(response.body.status).toBe('running');
        expect(response.body.totalPolls).toBe(100);
        expect(mockService.getStatus).toHaveBeenCalled();
      });

      it('returns 500 when getStatus throws', async () => {
        mockService.getStatus.mockRejectedValueOnce(new Error('Database error'));

        const response = await request(app).get('/admin/crank/status');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to get crank status');
      });
    });

    describe('POST /start', () => {
      it('starts the crank service and returns status', async () => {
        const response = await request(app).post('/admin/crank/start');

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Crank service started');
        expect(mockService.start).toHaveBeenCalled();
        expect(mockService.getStatus).toHaveBeenCalled();
      });

      it('returns 500 when start throws', async () => {
        mockService.start.mockRejectedValueOnce(new Error('Failed to connect'));

        const response = await request(app).post('/admin/crank/start');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to start crank service');
        expect(response.body.details).toBe('Failed to connect');
      });
    });

    describe('POST /stop', () => {
      it('stops the crank service and returns status', async () => {
        const response = await request(app).post('/admin/crank/stop');

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Crank service stopped');
        expect(mockService.stop).toHaveBeenCalled();
        expect(mockService.getStatus).toHaveBeenCalled();
      });

      it('returns 500 when stop throws', async () => {
        mockService.stop.mockImplementationOnce(() => {
          throw new Error('Stop failed');
        });

        const response = await request(app).post('/admin/crank/stop');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to stop crank service');
      });
    });

    describe('POST /pause', () => {
      it('pauses the crank service and returns status', async () => {
        const response = await request(app).post('/admin/crank/pause');

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Crank service paused');
        expect(mockService.pause).toHaveBeenCalled();
        expect(mockService.getStatus).toHaveBeenCalled();
      });

      it('returns 500 when pause throws', async () => {
        mockService.pause.mockImplementationOnce(() => {
          throw new Error('Pause failed');
        });

        const response = await request(app).post('/admin/crank/pause');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to pause crank service');
      });
    });

    describe('POST /resume', () => {
      it('resumes the crank service and returns status', async () => {
        const response = await request(app).post('/admin/crank/resume');

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Crank service resumed');
        expect(mockService.resume).toHaveBeenCalled();
        expect(mockService.getStatus).toHaveBeenCalled();
      });

      it('returns 500 when resume throws', async () => {
        mockService.resume.mockImplementationOnce(() => {
          throw new Error('Resume failed');
        });

        const response = await request(app).post('/admin/crank/resume');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to resume crank service');
      });
    });

    describe('POST /skip-pending-mpc', () => {
      it('skips pending MPC computations and returns count', async () => {
        const response = await request(app).post('/admin/crank/skip-pending-mpc');

        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Skipped 5 pending MPC computations');
        expect(response.body.skipped).toBe(5);
        expect(mockService.skipPendingMpcComputations).toHaveBeenCalled();
      });

      it('returns 500 when skipPendingMpcComputations throws', async () => {
        mockService.skipPendingMpcComputations.mockRejectedValueOnce(new Error('MPC error'));

        const response = await request(app).post('/admin/crank/skip-pending-mpc');

        expect(response.status).toBe(500);
        expect(response.body.error).toBe('Failed to skip pending MPC computations');
      });
    });
  });

  describe('initializeCrankService', () => {
    it('accepts crank service instance', () => {
      const mockService = {
        getStatus: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        skipPendingMpcComputations: vi.fn(),
      };

      expect(() => initializeCrankService(mockService as unknown as CrankService)).not.toThrow();
    });
  });

  describe('router structure', () => {
    it('exports a valid Express router', () => {
      expect(crankRouter).toBeDefined();
    });

    it('has expected route handlers', () => {
      const routerStack = (crankRouter as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack;
      const routes = routerStack
        .filter(layer => layer.route)
        .map(layer => ({
          path: layer.route?.path,
          methods: layer.route?.methods,
        }));

      // Find routes by path
      const statusRoute = routes.find(r => r.path === '/status');
      const startRoute = routes.find(r => r.path === '/start');
      const stopRoute = routes.find(r => r.path === '/stop');
      const pauseRoute = routes.find(r => r.path === '/pause');
      const resumeRoute = routes.find(r => r.path === '/resume');
      const skipMpcRoute = routes.find(r => r.path === '/skip-pending-mpc');

      expect(statusRoute?.methods?.get).toBe(true);
      expect(startRoute?.methods?.post).toBe(true);
      expect(stopRoute?.methods?.post).toBe(true);
      expect(pauseRoute?.methods?.post).toBe(true);
      expect(resumeRoute?.methods?.post).toBe(true);
      expect(skipMpcRoute?.methods?.post).toBe(true);
    });
  });
});
