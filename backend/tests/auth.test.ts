/**
 * Authentication + authorization tests: unit (jwt, passwords) and HTTP-level
 * (login, protected routes, RBAC) against the real Express app on an ephemeral
 * port with an in-memory database.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import { buildApp } from '../src/app.js';
import { signToken, verifyToken, TokenError } from '../src/auth/jwt.js';
import { hashPassword, verifyPassword } from '../src/auth/passwords.js';

let server: Server;
let base: string;

beforeAll(async () => {
  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server?.close();
});

async function post(path: string, body: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function get(path: string, token?: string) {
  const res = await fetch(`${base}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const login = async (username: string, password: string) => post('/api/auth/login', { username, password });

describe('password hashing', () => {
  it('verifies a correct password and rejects a wrong one', () => {
    const h = hashPassword('Orion@123');
    expect(h).not.toContain('Orion@123'); // no plaintext
    expect(verifyPassword('Orion@123', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
  });
});

describe('jwt', () => {
  it('signs and verifies a token', () => {
    const t = signToken({ sub: 'u1', username: 'director', role: 'MISSION_DIRECTOR', display_name: 'D' });
    const p = verifyToken(t);
    expect(p.username).toBe('director');
    expect(p.role).toBe('MISSION_DIRECTOR');
  });
  it('rejects a tampered token', () => {
    const t = signToken({ sub: 'u1', username: 'd', role: 'MISSION_DIRECTOR', display_name: 'D' });
    expect(() => verifyToken(t + 'x')).toThrow(TokenError);
  });
  it('rejects an expired token', () => {
    const t = signToken({ sub: 'u1', username: 'd', role: 'MISSION_DIRECTOR', display_name: 'D' }, undefined, -10);
    expect(() => verifyToken(t)).toThrow(/expired/i);
  });
});

describe('POST /api/auth/login', () => {
  it('succeeds with valid credentials and returns a token + user (no hash)', async () => {
    const { status, body } = await login('director', 'Orion@123');
    expect(status).toBe(200);
    expect(body.access_token).toBeTruthy();
    expect(body.user.role).toBe('MISSION_DIRECTOR');
    expect(JSON.stringify(body)).not.toContain('password');
  });
  it('rejects an invalid password with 401', async () => {
    const { status } = await login('director', 'wrong');
    expect(status).toBe(401);
  });
  it('rejects an unknown user with 401 (generic message)', async () => {
    const { status, body } = await login('nobody', 'Orion@123');
    expect(status).toBe(401);
    expect(body.message).toMatch(/invalid/i);
  });
  it('rejects missing credentials with 400', async () => {
    const { status } = await post('/api/auth/login', { username: 'director' });
    expect(status).toBe(400);
  });
});

describe('protected endpoints', () => {
  it('rejects a request with no token (401)', async () => {
    const { status } = await get('/api/satellites');
    expect(status).toBe(401);
  });
  it('rejects an invalid token (401)', async () => {
    const { status } = await get('/api/satellites', 'not-a-real-token');
    expect(status).toBe(401);
  });
  it('allows a request with a valid token (200)', async () => {
    const { body } = await login('analyst', 'Orion@123');
    const { status } = await get('/api/satellites', body.access_token);
    expect(status).toBe(200);
  });
  it('GET /api/auth/me returns the current user with a valid token', async () => {
    const { body } = await login('admin', 'Orion@123');
    const me = await get('/api/auth/me', body.access_token);
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('admin');
  });
});

describe('role-based authorization', () => {
  it('forbids an analyst from creating a simulation session (403)', async () => {
    const { body } = await login('analyst', 'Orion@123');
    const { status } = await post('/api/simulation/sessions', { satelliteId: 'ORION-3' }, body.access_token);
    expect(status).toBe(403);
  });
  it('allows a director to control the simulation (create session)', async () => {
    const { body } = await login('director', 'Orion@123');
    const { status } = await post('/api/simulation/sessions', { satelliteId: 'ORION-3' }, body.access_token);
    expect(status).toBe(201);
  });
  it('forbids an analyst from editing settings (403) but allows reading them', async () => {
    const { body } = await login('analyst', 'Orion@123');
    const read = await get('/api/settings/thresholds', body.access_token);
    expect(read.status).toBe(200);
    const write = await post('/api/settings/thresholds/reset', {}, body.access_token);
    expect(write.status).toBe(403);
  });
  it('allows an admin to edit settings', async () => {
    const { body } = await login('admin', 'Orion@123');
    const write = await post('/api/settings/thresholds/reset', {}, body.access_token);
    expect(write.status).toBe(200);
  });
});
