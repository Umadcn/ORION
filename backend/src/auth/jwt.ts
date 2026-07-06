/**
 * Minimal JWT (HS256) implementation using Node's built-in crypto.
 * Avoids external dependencies. Signs and verifies compact JWTs with expiry.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: string;
  display_name: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function signToken(
  claims: Omit<JwtPayload, 'iat' | 'exp'>,
  secret = config.jwtSecret,
  expiresInSec = config.jwtExpiresInSec,
): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload: JwtPayload = { ...claims, iat: now, exp: now + expiresInSec };
  const encHeader = b64url(JSON.stringify(header));
  const encPayload = b64url(JSON.stringify(payload));
  const signature = sign(`${encHeader}.${encPayload}`, secret);
  return `${encHeader}.${encPayload}.${signature}`;
}

export class TokenError extends Error {}

export function verifyToken(token: string, secret = config.jwtSecret): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new TokenError('Malformed token');
  const [encHeader, encPayload, signature] = parts;
  const expected = sign(`${encHeader}.${encPayload}`, secret);
  // Constant-time signature comparison.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new TokenError('Invalid signature');
  }
  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf-8'));
  } catch {
    throw new TokenError('Invalid payload');
  }
  if (typeof payload.exp !== 'number' || Math.floor(Date.now() / 1000) >= payload.exp) {
    throw new TokenError('Token expired');
  }
  return payload;
}
