import { Router, type Router as RouterType } from 'express';
import { isProverAvailable } from '../lib/prover.js';
import { getEmptyTreeRoot } from '../lib/blacklist.js';

export const healthRouter: RouterType = Router();

healthRouter.get('/', (req, res) => {
  const proverAvailable = isProverAvailable();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '0.1.0',
    prover: {
      available: proverAvailable,
      mode: proverAvailable ? 'real' : 'simulated',
    },
    circuit: {
      treeDepth: 20,
      hashFunction: 'poseidon2',
      emptyRoot: getEmptyTreeRoot(),
    },
  });
});
