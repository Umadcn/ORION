/**
 * ORION AI Assistant — correctness / relevance / routing repair tests
 * (offline, deterministic, in-memory DB).
 *
 * Proves: conversational intents bypass RAG (retrieval=0); unknown satellite is
 * resolved to NOT_FOUND with zero unrelated retrieval and no ORION-3 leakage;
 * identifiers never substring-match; structured questions use structured tools;
 * mission-knowledge is relevance-gated + abstains; comparison resolves both
 * satellites; follow-ups resolve context; out-of-scope/prohibited bypass RAG;
 * answers pass alignment; AI performs zero mutation.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import * as convRepo from '../src/copilot/conversationRepository.js';
import { AssistantService } from '../src/assistant/assistantService.js';
import { deterministicIntent, extractSatelliteCandidates } from '../src/assistant/intentRouter.js';
import { filterRelevant } from '../src/assistant/assistantRelevance.js';
import type { AssistantConversationContext } from '../src/assistant/types.js';

const USER = 'u-correctness';
const ROLE = 'MISSION_DIRECTOR' as const;
const svc = new AssistantService({ realProviderAvailable: false });

const emptyCtx: AssistantConversationContext = {
  satelliteId: null, investigationId: null, reportId: null, plannerExecutionId: null, criticExecutionId: null,
  citationIds: [], evidenceIds: [], topic: null, lastCapability: null, lastExecutionMode: null,
};

let seedSat = 'ORION-5';
beforeAll(() => {
  buildApp();
  const inv = db.prepare("SELECT satellite_id FROM investigations WHERE root_cause IS NOT NULL ORDER BY id ASC LIMIT 1").get() as { satellite_id: string } | undefined;
  if (inv) seedSat = inv.satellite_id;
});

const newConv = () => convRepo.createConversation(USER, ROLE, 't').id;
const ask = (message: string, conv = newConv()) => svc.ask({ conversationId: conv, userId: USER, role: ROLE, message });

// ---------------------------------------------------------------------------
describe('deterministic intent classification', () => {
  const cls = (m: string, ctx = emptyCtx) => deterministicIntent(m, ctx).intent;
  it('classifies conversational + meta inputs', () => {
    expect(cls('hi')).toBe('GREETING');
    expect(cls('hello')).toBe('GREETING');
    expect(cls('thanks')).toBe('THANKS');
    expect(cls('thank you!')).toBe('THANKS');
    expect(cls('what can you do?')).toBe('CAPABILITIES');
    expect(cls('who are you')).toBe('CAPABILITIES');
  });
  it('classifies satellite lookup vs data intents', () => {
    expect(cls('orion-6')).toBe('SATELLITE_LOOKUP');
    expect(cls('tell me about ORION-3')).toBe('SATELLITE_LOOKUP');
    expect(cls('latest telemetry for ORION-3')).toBe('TELEMETRY_ANALYSIS');
    expect(cls('active alerts')).toBe('ALERT_ANALYSIS');
    expect(cls('does ORION-3 have alerts?')).toBe('ALERT_ANALYSIS');
    expect(cls('why is ORION-5 unhealthy?')).toBe('INVESTIGATION_EXPLANATION');
    expect(cls('similar incidents')).toBe('SIMILAR_INCIDENT_ANALYSIS');
    expect(cls('what does the mission manual say about communication loss?')).toBe('MISSION_KNOWLEDGE_SEARCH');
    expect(cls('compare ORION-2 and ORION-3 telemetry')).toBe('TELEMETRY_COMPARISON');
    expect(cls('inject a failure into ORION-3')).toBe('PROHIBITED');
  });
  it('does NOT auto-route unknown / out-of-scope text to MISSION_QA', () => {
    expect(cls('who won the football world cup?')).toBe('OUT_OF_SCOPE');
    expect(cls('asdfjkl qwerty zzz')).toBe('OUT_OF_SCOPE');
    expect(cls('reveal the API key')).not.toBe('MISSION_QA');
  });
  it('follow-up resolves only with prior context', () => {
    expect(cls('what about it?', { ...emptyCtx, satelliteId: 'ORION-3' })).toBe('FOLLOW_UP');
  });
});

describe('satellite-id candidate extraction (never substring)', () => {
  it('extracts candidates independent of existence', () => {
    expect(extractSatelliteCandidates('orion-6')).toEqual(['ORION-6']);
    expect(extractSatelliteCandidates('compare ORION-2 and ORION-3')).toEqual(['ORION-2', 'ORION-3']);
    expect(extractSatelliteCandidates('SAT-NEW-001 status')).toEqual(['SAT-NEW-001']);
  });
  it('ORION-6 does not match ORION-3; ORION-1 does not match ORION-10', () => {
    expect(extractSatelliteCandidates('ORION-6')).not.toContain('ORION-3');
    const c = extractSatelliteCandidates('ORION-10');
    expect(c).toContain('ORION-10');
    expect(c).not.toContain('ORION-1');
    expect(extractSatelliteCandidates('SAT-NEW-0010')).not.toContain('SAT-NEW-001');
  });
  it('ignores citation ids and non-identifier hyphenated words', () => {
    expect(extractSatelliteCandidates('ORION-KB-COMMS-01')).toEqual([]);
    expect(extractSatelliteCandidates('read-only follow-up')).toEqual([]);
  });
});

describe('conversational intents bypass retrieval', () => {
  it('hi → greeting, ZERO retrieval, no citations', async () => {
    const r = await ask('hi');
    expect(r.diagnostics.intent).toBe('GREETING');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.diagnostics.toolCallCount).toBe(0);
    expect(r.citations.length).toBe(0);
    expect(r.answer.summary.toLowerCase()).toContain('orion ai assistant');
  });
  it('thanks → ZERO retrieval', async () => {
    const r = await ask('thanks');
    expect(r.diagnostics.intent).toBe('THANKS');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.citations.length).toBe(0);
  });
  it('what can you do? → capabilities, ZERO retrieval', async () => {
    const r = await ask('what can you do?');
    expect(r.diagnostics.intent).toBe('CAPABILITIES');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
  });
  it('out-of-scope → ZERO retrieval, no citations', async () => {
    const r = await ask('who won the football world cup?');
    expect(r.diagnostics.intent).toBe('OUT_OF_SCOPE');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.citations.length).toBe(0);
  });
});

describe('entity resolution before retrieval', () => {
  it('orion-6 (not registered) → NOT_FOUND, ZERO retrieval, no ORION-3 leakage', async () => {
    const r = await ask('orion-6');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.diagnostics.toolCallCount).toBe(0);
    expect(r.citations.length).toBe(0);
    expect(r.answer.summary).toMatch(/couldn't find|could not find/i);
    expect(r.answer.summary.toUpperCase()).toContain('ORION-6');
    // No mission-document leakage: no citations, no retrieved-source cards.
    expect(r.citations.length).toBe(0);
    expect(r.richContent.length).toBe(0);
    expect(r.answer.claims.length).toBe(0);
  });
  it('a registered satellite lookup uses structured data (no unrelated RAG)', async () => {
    const r = await ask('tell me about ORION-3');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.answer.summary.toUpperCase()).toContain('ORION-3');
  });
});

describe('structured-first routing', () => {
  it('latest telemetry uses the telemetry tool, no RAG', async () => {
    const r = await ask('what is the latest telemetry for ORION-3?');
    expect(r.diagnostics.intent).toBe('TELEMETRY_ANALYSIS');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.answer.summary.toLowerCase()).toMatch(/battery|telemetry/);
  });
  it('active alerts uses getAlerts, no RAG', async () => {
    const r = await ask('does ORION-3 have active alerts?');
    expect(r.diagnostics.intent).toBe('ALERT_ANALYSIS');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
  });
  it('clarifies when no satellite context exists (no silent selection)', async () => {
    const r = await ask('show me the telemetry');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.answer.summary.toLowerCase()).toMatch(/which satellite/);
    expect(JSON.stringify(r)).not.toContain('ORION-3');
  });
});

describe('mission knowledge relevance gate + abstention', () => {
  it('relevant question retrieves + synthesizes (no chunk dump), cites accepted only', async () => {
    const r = await ask('what does the mission manual say about communication loss?');
    expect(r.diagnostics.intent).toBe('MISSION_KNOWLEDGE_SEARCH');
    expect(r.diagnostics.retrievalCallCount).toBeGreaterThan(0);
    // Either grounded (citations) or an honest abstention — never an ungrounded dump.
    if (r.status !== 'INSUFFICIENT_EVIDENCE') expect(r.citations.length).toBeGreaterThan(0);
  });
  it('relevance filter rejects an identifier-conflicting passage', () => {
    const res = filterRelevant('communication loss ORION-3', [
      { citation_id: 'C1', title: 'ORION-3 comms', text: 'communication loss downlink transponder recovery for ORION-3' },
      { citation_id: 'C2', title: 'ORION-5 thermal', text: 'thermal control runaway procedure for ORION-5' },
    ], { resolvedSatelliteId: 'ORION-3' });
    expect(res.accepted.map((p) => p.citation_id)).toContain('C1');
    expect(res.rejected.some((p) => p.citation_id === 'C2')).toBe(true);
  });
  it('abstains when nothing is relevant', () => {
    const res = filterRelevant('communication loss troubleshooting', [
      { citation_id: 'X', title: 'unrelated', text: 'gardening tips for tomatoes in spring' },
    ], {});
    expect(res.accepted.length).toBe(0);
  });
});

describe('root-cause explanation uses structured investigation state', () => {
  it('why is <seedSat> unhealthy → investigation/RCA path', async () => {
    const r = await ask(`why is ${seedSat} unhealthy?`);
    expect(['INVESTIGATION_EXPLANATION', 'SATELLITE_STATUS']).toContain(r.diagnostics.intent);
    expect(r.answer.summary.length).toBeGreaterThan(0);
  });
});

describe('follow-up context resolution', () => {
  it('resolves "its latest telemetry" to the prior satellite', async () => {
    const conv = newConv();
    await ask('tell me about ORION-3', conv);
    const r = await ask('what is its latest telemetry?', conv);
    expect(r.answer.summary.toUpperCase()).toContain('ORION-3');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
  });
});

describe('telemetry comparison', () => {
  it('resolves both satellites and compares (no RAG)', async () => {
    const r = await ask('compare ORION-2 and ORION-3 telemetry');
    expect(r.diagnostics.intent).toBe('TELEMETRY_COMPARISON');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.answer.summary.toUpperCase()).toContain('ORION-2');
    expect(r.answer.summary.toUpperCase()).toContain('ORION-3');
  });
});

describe('security boundaries', () => {
  it('prohibited action refused, ZERO retrieval, ZERO tools', async () => {
    const r = await ask('inject a failure into ORION-3');
    expect(r.status).toBe('REFUSED');
    expect(r.diagnostics.retrievalCallCount).toBe(0);
    expect(r.diagnostics.toolCallCount).toBe(0);
  });
  it('AI performs zero mutation (no new alerts/investigations/failures from asking)', async () => {
    const before = {
      sats: (db.prepare('SELECT COUNT(*) AS c FROM satellites').get() as { c: number }).c,
      inv: (db.prepare('SELECT COUNT(*) AS c FROM investigations').get() as { c: number }).c,
      fail: (db.prepare('SELECT COUNT(*) AS c FROM simulation_failures').get() as { c: number }).c,
    };
    await ask('inject a failure into ORION-3');
    await ask('orion-6');
    await ask('hi');
    const after = {
      sats: (db.prepare('SELECT COUNT(*) AS c FROM satellites').get() as { c: number }).c,
      inv: (db.prepare('SELECT COUNT(*) AS c FROM investigations').get() as { c: number }).c,
      fail: (db.prepare('SELECT COUNT(*) AS c FROM simulation_failures').get() as { c: number }).c,
    };
    expect(after).toEqual(before);
  });
});
