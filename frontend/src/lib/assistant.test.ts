import { describe, it, expect } from 'vitest';
import {
  executionModeBadge, isRealAccepted, statusLabel, providerModeBanner,
  richContentTitle, groundingSupportLabel, criticDecisionLabel,
} from './assistant';

describe('assistant execution-mode labeling (honesty guarantees)', () => {
  it('never labels deterministic fallback as real AI', () => {
    expect(executionModeBadge('DETERMINISTIC_FALLBACK').label.toLowerCase()).not.toContain('real');
    expect(executionModeBadge('DETERMINISTIC_FALLBACK').label).toMatch(/deterministic/i);
    expect(executionModeBadge('INSUFFICIENT_EVIDENCE').label.toLowerCase()).not.toContain('real');
    expect(executionModeBadge('FAILED').label.toLowerCase()).not.toContain('real');
  });
  it('labels a genuine real provider explicitly', () => {
    expect(executionModeBadge('REAL_PROVIDER').label).toMatch(/real/i);
  });
  it('isRealAccepted is true only for accepted real-provider answers', () => {
    expect(isRealAccepted('REAL_PROVIDER', 'ACCEPTED')).toBe(true);
    expect(isRealAccepted('REAL_PROVIDER', 'REAL_REJECTED')).toBe(false);
    expect(isRealAccepted('DETERMINISTIC_FALLBACK', 'DETERMINISTIC')).toBe(false);
    expect(isRealAccepted('DETERMINISTIC_FALLBACK', 'ACCEPTED')).toBe(false);
  });
});

describe('status + provider banners', () => {
  it('labels statuses', () => {
    expect(statusLabel('REFUSED')).toMatch(/read-only/i);
    expect(statusLabel('REAL_REJECTED')).toMatch(/fallback/i);
    expect(statusLabel('ACCEPTED')).toBe('Accepted');
  });
  it('offline banner never claims real AI is active', () => {
    const b = providerModeBanner(true, 'DETERMINISTIC_FALLBACK');
    expect(b.tone).toBe('offline');
    expect(b.label.toLowerCase()).toContain('not real ai');
    const b2 = providerModeBanner(false, 'DETERMINISTIC_FALLBACK');
    expect(b2.tone).toBe('offline');
  });
  it('configured banner does not claim active real AI', () => {
    const b = providerModeBanner(false, 'REAL_PROVIDER_CONFIGURED');
    expect(b.tone).toBe('configured');
    expect(b.label.toLowerCase()).toContain('configured');
  });
});

describe('rich content + signals', () => {
  it('titles rich content and marks Planner/Critic as advisory', () => {
    expect(richContentTitle('PLANNER_ANALYSIS_CARD')).toMatch(/advisory/i);
    expect(richContentTitle('CRITIC_REVIEW_CARD')).toMatch(/advisory/i);
    expect(richContentTitle('SATELLITE_STATUS_CARD')).toBe('Satellite status');
    expect(richContentTitle('UNKNOWN_X')).toBe('UNKNOWN_X');
  });
  it('grounding support is labeled as a signal, never confidence', () => {
    expect(groundingSupportLabel(0.5)).toMatch(/support/i);
    expect(groundingSupportLabel(0.5).toLowerCase()).not.toContain('confidence');
    expect(groundingSupportLabel(null)).toBe('—');
  });
  it('critic decision is analysis-quality review, not a mission decision', () => {
    expect(criticDecisionLabel('ACCEPT')).toMatch(/quality review/i);
    expect(criticDecisionLabel('REJECT')).toMatch(/quality review/i);
    expect(criticDecisionLabel(null)).toBe('—');
  });
});
