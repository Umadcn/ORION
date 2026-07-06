/**
 * Password hashing with Node's built-in scrypt (no external dependency).
 * Stored format: "<saltHex>:<keyHex>". Verification is constant-time.
 */
import crypto from 'node:crypto';

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, KEYLEN);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  // Lengths must match for timingSafeEqual; they always will here.
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
