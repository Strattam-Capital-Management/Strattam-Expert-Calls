import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { CONFIG } from './config';

// Routes that never require the access code, per the API contract.
const OPEN_PATHS = new Set(['/', '/health', '/auth/check']);

/**
 * Constant-time string comparison that also avoids leaking length via timing:
 * crypto.timingSafeEqual throws if the two buffers differ in length, and comparing
 * raw variable-length strings directly would leak length information through the
 * exception path timing. Hashing both inputs to a fixed-length digest first sidesteps
 * that entirely, then timingSafeEqual compares the (always equal-length) digests.
 */
export function safeCompare(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function isAuthRequired(): boolean {
  return CONFIG.accessCode.length > 0;
}

export function accessCodeMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (OPEN_PATHS.has(req.path)) {
    next();
    return;
  }

  // No-op (open) if ACCESS_CODE is empty - local dev only, never leave unset in production.
  if (!isAuthRequired()) {
    next();
    return;
  }

  const headerCode = req.header('X-Access-Code') ?? '';
  const queryCode = typeof req.query.code === 'string' ? req.query.code : '';
  const provided = headerCode || queryCode;

  if (provided && safeCompare(provided, CONFIG.accessCode)) {
    next();
    return;
  }

  res.status(401).json({ ok: false, error: 'Unauthorized: missing or invalid access code' });
}
