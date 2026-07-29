import { Router } from 'express';
import { getCacheStats } from '../db';

export const cacheRouter = Router();

cacheRouter.get('/cache/stats', (_req, res) => {
  res.json(getCacheStats());
});
