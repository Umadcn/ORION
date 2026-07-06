import type { Role } from '../types';

/**
 * Role-based route access. Mirrors the required permission matrix. Backend
 * still enforces authorization independently — this only shapes the UI.
 *
 *  MISSION_DIRECTOR : full access
 *  MISSION_ANALYST  : dashboard, satellites, orbit, telemetry, alerts,
 *                     ai-insights, investigations, reports (read/monitor)
 *  SYSTEM_ADMIN     : dashboard, settings (+ System Diagnostics via profile)
 */
const ALL: Role[] = ['MISSION_DIRECTOR', 'MISSION_ANALYST', 'SYSTEM_ADMIN'];
const OPS: Role[] = ['MISSION_DIRECTOR', 'MISSION_ANALYST'];

export const ROUTE_ROLES: Record<string, Role[]> = {
  '/': ALL,
  '/satellites': OPS,
  '/orbit': OPS,
  '/telemetry': OPS,
  '/alerts': OPS,
  '/ai-insights': OPS,
  '/ai-assistant': ALL,
  '/ai-evaluation': ['MISSION_DIRECTOR', 'SYSTEM_ADMIN'],
  '/investigations': OPS,
  '/reports': OPS,
  '/simulation': ALL, // any authenticated role may VIEW; mutation is Director/Admin (enforced backend-side + in the UI)
  '/settings': ['MISSION_DIRECTOR', 'SYSTEM_ADMIN'],
};

/** Reduce any path (incl. detail routes) to its top-level key. */
export function baseKey(path: string): string {
  const seg = path.split('/')[1] ?? '';
  return `/${seg}`;
}

export function canAccess(role: Role | null | undefined, path: string): boolean {
  if (!role) return false;
  const allowed = ROUTE_ROLES[baseKey(path)];
  if (!allowed) return true; // unmapped routes require auth only
  return allowed.includes(role);
}

/** Credential validation used by the login form (pure — unit tested). */
export interface CredentialErrors {
  username?: string;
  password?: string;
}
export function validateCredentials(username: string, password: string): CredentialErrors {
  const errors: CredentialErrors = {};
  if (!username.trim()) errors.username = 'Username or email is required.';
  if (!password) errors.password = 'Password is required.';
  else if (password.length < 4) errors.password = 'Password is too short.';
  return errors;
}
