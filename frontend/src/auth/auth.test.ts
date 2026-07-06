import { describe, it, expect, beforeEach } from 'vitest';
import { canAccess, validateCredentials, baseKey } from './permissions';
import { saveToken, loadToken, clearToken } from './storage';

describe('validateCredentials (login form validation)', () => {
  it('flags missing username and password', () => {
    const e = validateCredentials('', '');
    expect(e.username).toBeTruthy();
    expect(e.password).toBeTruthy();
  });
  it('flags a too-short password', () => {
    const e = validateCredentials('director', '1');
    expect(e.password).toBeTruthy();
  });
  it('accepts valid credentials', () => {
    const e = validateCredentials('director', 'Orion@123');
    expect(e.username).toBeUndefined();
    expect(e.password).toBeUndefined();
  });
});

describe('baseKey', () => {
  it('reduces detail routes to their top-level key', () => {
    expect(baseKey('/satellites/ORION-3')).toBe('/satellites');
    expect(baseKey('/investigations/2')).toBe('/investigations');
    expect(baseKey('/')).toBe('/');
  });
});

describe('canAccess (role-based route access)', () => {
  it('gives the Mission Director full access', () => {
    for (const p of ['/', '/satellites', '/simulation', '/settings', '/reports']) {
      expect(canAccess('MISSION_DIRECTOR', p)).toBe(true);
    }
  });
  it('restricts the Analyst from settings but allows simulation VIEW', () => {
    expect(canAccess('MISSION_ANALYST', '/')).toBe(true);
    expect(canAccess('MISSION_ANALYST', '/investigations')).toBe(true);
    // Simulation is view-for-all (mutations are gated backend-side + in the UI).
    expect(canAccess('MISSION_ANALYST', '/simulation')).toBe(true);
    expect(canAccess('MISSION_ANALYST', '/settings')).toBe(false);
  });
  it('limits the Admin to dashboard, settings and simulation', () => {
    expect(canAccess('SYSTEM_ADMIN', '/')).toBe(true);
    expect(canAccess('SYSTEM_ADMIN', '/settings')).toBe(true);
    expect(canAccess('SYSTEM_ADMIN', '/satellites')).toBe(false);
    // Admin may control simulation.
    expect(canAccess('SYSTEM_ADMIN', '/simulation')).toBe(true);
  });
  it('denies access when there is no authenticated role', () => {
    expect(canAccess(null, '/')).toBe(false);
  });
});

describe('token storage (session restoration + logout)', () => {
  beforeEach(() => clearToken());

  it('persists with remember-me (localStorage) and restores', () => {
    saveToken('tok-remember', true);
    expect(loadToken()).toBe('tok-remember');
    expect(localStorage.getItem('orion.auth.token')).toBe('tok-remember');
  });
  it('uses sessionStorage without remember-me', () => {
    saveToken('tok-session', false);
    expect(loadToken()).toBe('tok-session');
    expect(localStorage.getItem('orion.auth.token')).toBeNull();
  });
  it('clears the token on logout', () => {
    saveToken('tok', true);
    clearToken();
    expect(loadToken()).toBeNull();
  });
});
