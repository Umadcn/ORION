import { describe, it, expect } from 'vitest';
import {
  OBS_RANGES, count, executionModeLabel, governanceSeverityClasses, ms, operatingModeLabel, pct, score,
} from './observability';

describe('observability presentation helpers (Phase 8)', () => {
  it('range selector exposes the four allowlisted ranges', () => {
    expect(OBS_RANGES.map((r) => r.value)).toEqual(['24H', '7D', '30D', 'ALL']);
  });

  it('pct formats rates and is zero/undefined-safe', () => {
    expect(pct(0.3)).toBe('30.0%');
    expect(pct(0)).toBe('0.0%');
    expect(pct(null)).toBe('—');
    expect(pct(undefined)).toBe('—');
  });

  it('ms and count formatting handle nulls', () => {
    expect(ms(123.7)).toBe('124 ms');
    expect(ms(null)).toBe('—');
    expect(count(1500)).toBe('1,500');
    expect(count(null)).toBe('—');
  });

  it('score formats ranking metrics and never implies confidence', () => {
    expect(score(0.8234)).toBe('0.823');
    expect(score(null)).toBe('—');
  });

  it('NEVER labels deterministic fallback as real AI / model', () => {
    const fb = executionModeLabel('DETERMINISTIC_FALLBACK');
    expect(fb.label).toBe('Deterministic Fallback');
    expect(fb.label).not.toMatch(/real|model|ai model/i);
    expect(fb.tone).toBe('orange');
    expect(executionModeLabel('REAL_PROVIDER').label).toBe('Real Provider');
    expect(executionModeLabel('FAILED').tone).toBe('red');
  });

  it('operating-mode label distinguishes offline fallback from real provider', () => {
    expect(operatingModeLabel('DETERMINISTIC_FALLBACK')).toMatch(/offline/i);
    expect(operatingModeLabel('REAL_PROVIDER_CONFIGURED')).toMatch(/real provider/i);
  });

  it('governance severity classes map deterministically', () => {
    expect(governanceSeverityClasses('CRITICAL').label).toBe('Critical');
    expect(governanceSeverityClasses('CRITICAL').text).toContain('accent-red');
    expect(governanceSeverityClasses('WARNING').text).toContain('accent-orange');
    expect(governanceSeverityClasses('INFO').label).toBe('Info');
  });
});
