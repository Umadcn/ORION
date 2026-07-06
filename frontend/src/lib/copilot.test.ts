import { describe, it, expect } from 'vitest';
import { copilotModeBadge } from './format';

describe('copilotModeBadge (Mission Copilot mode badges)', () => {
  it('labels REAL_PROVIDER as an AI Model badge', () => {
    expect(copilotModeBadge('REAL_PROVIDER').label).toBe('AI Model');
  });
  it('labels DETERMINISTIC_FALLBACK distinctly (not real)', () => {
    const b = copilotModeBadge('DETERMINISTIC_FALLBACK');
    expect(b.label).toBe('Deterministic');
    expect(b.label).not.toMatch(/model/i);
  });
  it('labels INSUFFICIENT_EVIDENCE and FAILED', () => {
    expect(copilotModeBadge('INSUFFICIENT_EVIDENCE').label).toBe('Insufficient Evidence');
    expect(copilotModeBadge('FAILED').label).toBe('Failed');
  });
});
