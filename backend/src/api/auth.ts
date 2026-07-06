import { Router } from 'express';
import { config } from '../config.js';
import { signToken } from '../auth/jwt.js';
import { verifyPassword } from '../auth/passwords.js';
import { findById, findByUsername, toPublic } from '../auth/users.js';
import { authenticate, rateLimiter, type AuthedRequest } from '../auth/middleware.js';

const router = Router();

// Rate-limit login attempts: 10 per minute per IP.
const loginLimiter = rateLimiter(10, 60_000);

// POST /api/auth/login — public.
router.post('/login', loginLimiter, (req, res) => {
  const { username, password } = (req.body ?? {}) as { username?: string; password?: string };
  if (!username || !password) {
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'Username and password are required' });
  }
  const user = findByUsername(String(username));
  // Generic error message — do not reveal whether the username exists.
  const invalid = () => res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
  if (!user) return invalid();
  if (!verifyPassword(String(password), user.password_hash)) return invalid();

  const token = signToken({ sub: user.id, username: user.username, role: user.role, display_name: user.display_name });
  return res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: config.jwtExpiresInSec,
    user: toPublic(user),
  });
});

// GET /api/auth/me — requires a valid token.
router.get('/me', authenticate, (req: AuthedRequest, res) => {
  const user = req.user && findById(req.user.sub);
  if (!user) return res.status(401).json({ error: 'UNAUTHORIZED', message: 'User not found' });
  return res.json({ user: toPublic(user) });
});

// POST /api/auth/logout — stateless JWT; client discards the token.
router.post('/logout', authenticate, (_req, res) => {
  res.json({ ok: true, message: 'Logged out. Discard the access token on the client.' });
});

export default router;
