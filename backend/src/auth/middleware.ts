/**
 * Authentication + role-based authorization middleware.
 * 401 for missing/invalid tokens, 403 for insufficient role.
 */
import type { NextFunction, Request, Response } from 'express';
import { TokenError, verifyToken, type JwtPayload } from './jwt.js';
import type { Role } from './users.js';

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

export function authenticate(req: AuthedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    const message = err instanceof TokenError ? err.message : 'Invalid token';
    res.status(401).json({ error: 'UNAUTHORIZED', message });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
      return;
    }
    if (!roles.includes(req.user.role as Role)) {
      res.status(403).json({ error: 'FORBIDDEN', message: 'Insufficient permissions for this action' });
      return;
    }
    next();
  };
}

/** Very small in-memory fixed-window rate limiter (per key). */
export function rateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const nowMs = Date.now();
    const entry = hits.get(key);
    if (!entry || nowMs > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: nowMs + windowMs });
      next();
      return;
    }
    entry.count += 1;
    if (entry.count > maxRequests) {
      res.status(429).json({ error: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' });
      return;
    }
    next();
  };
}
