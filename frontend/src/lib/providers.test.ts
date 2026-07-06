import { describe, it, expect } from 'vitest';
import { operatingModeLabel, isRealAvailable, verificationStatusLabel, providerBanner, pctOrDash } from './providers';

describe('provider presentation helpers (Phase 9)', () => {
  it('operating-mode labels NEVER call offline/configured "real AI"', () => {
    expect(operatingModeLabel('OFFLINE').label).toMatch(/offline/i);
    expect(operatingModeLabel('OFFLINE').label).not.toMatch(/real provider available/i);
    expect(operatingModeLabel('CONFIGURED').label).toBe('Configured — Not Verified');
    expect(operatingModeLabel('CONFIGURED').label).not.toMatch(/available/i);
    expect(operatingModeLabel('AVAILABLE').label).toBe('Real Provider Available');
    expect(operatingModeLabel('UNAVAILABLE').tone).toBe('red');
  });

  it('isRealAvailable is true ONLY for AVAILABLE', () => {
    expect(isRealAvailable('AVAILABLE')).toBe(true);
    for (const m of ['OFFLINE', 'CONFIGURED', 'DEGRADED', 'UNAVAILABLE'] as const) expect(isRealAvailable(m)).toBe(false);
  });

  it('verification status labels; fallback/degraded distinct from real', () => {
    expect(verificationStatusLabel('REAL_PROVIDER_VERIFIED')).toBe('Real Provider Verified');
    expect(verificationStatusLabel('DEGRADED')).toBe('Reached — Degraded');
    expect(verificationStatusLabel('NOT_CONFIGURED')).toBe('Not Configured');
    expect(verificationStatusLabel('COOLDOWN')).toBe('Cooldown');
    expect(verificationStatusLabel('anything')).toBe('Failed');
  });

  it('banner: offline shows deterministic fallback (not real AI)', () => {
    const b = providerBanner('OFFLINE', 'OFFLINE');
    expect(b.text).toMatch(/OFFLINE MODE/);
    expect(b.text).toMatch(/not real AI/i);
    expect(b.tone).toBe('cyan');
  });
  it('banner: configured-not-verified + unavailable + real-active', () => {
    expect(providerBanner('CONFIGURED', 'OFFLINE').text).toMatch(/NOT VERIFIED/);
    expect(providerBanner('UNAVAILABLE', 'OFFLINE').text).toMatch(/DEGRADED TO DETERMINISTIC FALLBACK/);
    expect(providerBanner('AVAILABLE', 'AVAILABLE').text).toMatch(/REAL PROVIDER ACTIVE/);
    expect(providerBanner('AVAILABLE', 'AVAILABLE').tone).toBe('green');
  });

  it('pctOrDash formats rates and is null-safe (not confidence)', () => {
    expect(pctOrDash(0.5)).toBe('50.0%');
    expect(pctOrDash(null)).toBe('—');
    expect(pctOrDash(undefined)).toBe('—');
  });
});
