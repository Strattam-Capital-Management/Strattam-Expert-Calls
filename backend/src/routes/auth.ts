import { Router } from 'express';
import { CONFIG } from '../config';
import { safeCompare, isAuthRequired } from '../auth';

export const authRouter = Router();

authRouter.post('/auth/check', (req, res) => {
  const authRequired = isAuthRequired();
  const code = typeof req.body?.code === 'string' ? req.body.code : '';

  if (!authRequired) {
    res.status(200).json({ ok: true, authRequired: false });
    return;
  }

  if (code && safeCompare(code, CONFIG.accessCode)) {
    res.status(200).json({ ok: true, authRequired: true });
    return;
  }

  res.status(401).json({ ok: false });
});
