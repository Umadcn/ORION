import { describe, it, expect } from 'vitest';
import { answerKind, shouldShowSources, SOURCES_DEFAULT_OPEN, scoreLabel } from './assistantAnswer';
import type { AssistantResult } from '../api/client';

const mk = (over: Partial<AssistantResult>): AssistantResult => ({
  conversationId: 'c', messageId: 1, correlationId: 'x', executionMode: 'DETERMINISTIC_FALLBACK', status: 'DETERMINISTIC',
  provider: null, model: null,
  answer: { answer_version: 'v', title: 'T', summary: 's', sections: [], claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: [], suggested_followups: [], rich_content: [] },
  citations: [], evidenceIds: [], workflowResults: [], toolActivity: [], richContent: [], suggestedFollowups: [], context: {},
  diagnostics: { intent: 'MISSION_QA', capability: null, iterationCount: 0, toolCallCount: 0, retrievalCallCount: 0, workflowCallCount: 0, claimCount: 0, supportedClaimCount: 0, citationCount: 0, evidenceCount: 0, groundingValid: true, policyValid: true, averageGroundingSupport: null, contextResolved: false, terminationReason: 'DONE', qualityGate: 'OK' },
  disclaimer: 'd', ...over,
} as AssistantResult);

describe('assistant answer rendering helpers', () => {
  it('classifies conversational answers and hides sources', () => {
    for (const intent of ['GREETING', 'THANKS', 'CAPABILITIES', 'OUT_OF_SCOPE']) {
      const r = mk({ diagnostics: { ...mk({}).diagnostics, intent } });
      expect(answerKind(r)).toBe('CONVERSATIONAL');
      expect(shouldShowSources(r)).toBe(false);
    }
  });
  it('classifies a not-found satellite answer', () => {
    const r = mk({ diagnostics: { ...mk({}).diagnostics, intent: 'SATELLITE_LOOKUP' }, answer: { ...mk({}).answer, title: 'Satellite ORION-6 not found' } });
    expect(answerKind(r)).toBe('NOT_FOUND');
    expect(shouldShowSources(r)).toBe(false);
  });
  it('classifies clarification + insufficient + refusal', () => {
    expect(answerKind(mk({ answer: { ...mk({}).answer, title: 'Clarification needed' } }))).toBe('CLARIFICATION');
    expect(answerKind(mk({ status: 'INSUFFICIENT_EVIDENCE' }))).toBe('INSUFFICIENT');
    expect(answerKind(mk({ status: 'REFUSED', diagnostics: { ...mk({}).diagnostics, intent: 'PROHIBITED' } }))).toBe('REFUSAL');
  });
  it('grounded answers show a collapsed-by-default sources panel', () => {
    const r = mk({ citations: [{ citationId: 'ORION-KB-1', documentId: 1, title: 'Comms' }], diagnostics: { ...mk({}).diagnostics, intent: 'MISSION_KNOWLEDGE_SEARCH' } });
    expect(answerKind(r)).toBe('GROUNDED');
    expect(shouldShowSources(r)).toBe(true);
    expect(SOURCES_DEFAULT_OPEN).toBe(false);
  });
  it('never labels a score as confidence', () => {
    expect(scoreLabel('relevance')).toBe('relevance');
    expect(scoreLabel('grounding')).toBe('grounding support');
    expect(scoreLabel('relevance')).not.toContain('confidence');
  });
});
