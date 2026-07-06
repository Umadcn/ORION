import { describe, it, expect } from 'vitest';
import { roleLabel, welcomeName, userInitials } from './format';

describe('roleLabel — one canonical role → label mapping', () => {
  it('maps the ORION roles', () => {
    expect(roleLabel('MISSION_DIRECTOR')).toBe('Mission Director');
    expect(roleLabel('MISSION_ANALYST')).toBe('Mission Analyst');
    expect(roleLabel('SYSTEM_ADMIN')).toBe('System Administrator');
  });
  it('normalizes casing, ROLE_ prefix, spaces and hyphens', () => {
    expect(roleLabel('mission_analyst')).toBe('Mission Analyst');
    expect(roleLabel('Mission Analyst')).toBe('Mission Analyst');
    expect(roleLabel('ROLE_MISSION_ANALYST')).toBe('Mission Analyst');
    expect(roleLabel('mission-analyst')).toBe('Mission Analyst');
  });
  it('returns neutral empty string for a missing role (no default identity)', () => {
    expect(roleLabel(null)).toBe('');
    expect(roleLabel(undefined)).toBe('');
    expect(roleLabel('')).toBe('');
  });
});

describe('welcomeName — derived only from the authenticated session', () => {
  it('uses the display name when present', () => {
    expect(welcomeName({ display_name: 'Mission Analyst', role: 'MISSION_ANALYST' })).toBe('Mission Analyst');
    expect(welcomeName({ display_name: 'Ada Lovelace', role: 'MISSION_DIRECTOR' })).toBe('Ada Lovelace');
  });
  it('falls back to the normalized role label when there is no display name', () => {
    expect(welcomeName({ display_name: '', role: 'MISSION_OPERATOR' })).toBe('Mission Operator');
    expect(welcomeName({ role: 'SYSTEM_ADMIN' })).toBe('System Administrator');
  });
  it('returns empty (no hardcoded default) when there is no user', () => {
    expect(welcomeName(null)).toBe('');
    expect(welcomeName(undefined)).toBe('');
  });

  // Explicit regression for the reported bug.
  it('REGRESSION: a Mission Analyst login never resolves to Mission Director', () => {
    const analyst = { id: 'usr_analyst', username: 'analyst', role: 'MISSION_ANALYST', display_name: 'Mission Analyst' };
    const name = welcomeName(analyst);
    expect(name).toBe('Mission Analyst');
    expect(name).not.toContain('Director');
    expect(`Welcome back, ${name} 👋`).toBe('Welcome back, Mission Analyst 👋');
  });
});

describe('userInitials', () => {
  it('derives up to two initials from the authenticated user only', () => {
    expect(userInitials('Mission Analyst')).toBe('MA');
    expect(userInitials('System Administrator')).toBe('SA');
    expect(userInitials('director')).toBe('D');
    expect(userInitials(null)).toBe('');
    expect(userInitials('')).toBe('');
  });
});
