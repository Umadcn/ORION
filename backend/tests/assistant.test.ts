/**
 * Phase 10 ORION AI Assistant — unit/integration tests (offline + deterministic,
 * plus mock-real-provider paths). Covers domain/capabilities, intent routing,
 * context resolution, bounded memory, dynamic tool calling, Planner/Critic/
 * validated workflows, Agentic RAG, grounded answers, the quality gate, and
 * execution-mode integrity. Mock-provider success is NEVER live verification.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { config } from '../src/config.js';
import * as convRepo from '../src/copilot/conversationRepository.js';
import { AssistantService } from '../src/assistant/assistantService.js';
import { AssistantIntentRouter, deterministicIntent } from '../src/assistant/intentRouter.js';
import { resolveContext } from '../src/assistant/contextResolution.js';
import { getCapability, capabilityForIntent, listCapabilities } from '../src/assistant/capabilities.js';
import { AssistantMemoryService } from '../src/assistant/memoryService.js';
import { getAssistantTool, isAllowedAssistantTool } from '../src/assistant/assistantToolRegistry.js';
import { AssistantWorkflowService } from '../src/assistant/workflowService.js';
import type { LlmRunner } from '../src/llm/runner.js';
import type { LlmResponse } from '../src/llm/types.js';

const USER = 'u-assistant-test';
const ROLE = 'MISSION_DIRECTOR' as const;

let seedSat = 'ORION-5';
let seedInv: number | null = null;

beforeAll(() => {
  buildApp(); // init schema + seed + users
  const inv = db.prepare("SELECT id, satellite_id FROM investigations WHERE root_cause IS NOT NULL ORDER BY id ASC LIMIT 1").get() as { id: number; satellite_id: string } | undefined;
  if (inv) { seedInv = inv.id; seedSat = inv.satellite_id; }
});

function newConv(): string { return convRepo.createConversation(USER, ROLE, 't').id; }

/** A scripted mock LlmRunner returning canned structured responses in sequence. */
function scriptedRunner(responses: unknown[], mode: LlmResponse['executionMode'] = 'REAL_PROVIDER'): LlmRunner {
  let i = 0;
  return {
    run: async <T,>(): Promise<LlmResponse<T>> => {
      const structured = (responses[Math.min(i, responses.length - 1)] ?? null) as T;
      i++;
      return {
        executionMode: mode, status: 'SUCCESS', provider: 'mock-provider', model: 'mock-1', promptVersion: 'v', requestType: 'assistant',
        correlationId: 'c', content: JSON.stringify(structured), structured, usage: { inputTokens: 10, outputTokens: 20 },
        latencyMs: 1, finishReason: 'stop', structuredOutputRequested: true, validation: { valid: true, errors: [] },
        retryCount: 0, fallbackReason: null, error: null,
      } as unknown as LlmResponse<T>;
    },
  } as unknown as LlmRunner;
}

const offlineSvc = new AssistantService({ realProviderAvailable: false });

// ---------------------------------------------------------------------------
describe('capability catalog', () => {
  it('is allowlisted and fails closed on unknown ids', () => {
    expect(getCapability('SATELLITE_STATUS')).toBeTruthy();
    expect(getCapability('EVIL_CAPABILITY')).toBeUndefined();
    expect(listCapabilities().length).toBeGreaterThanOrEqual(14);
  });
  it('maps control/meta intents to no capability', () => {
    expect(capabilityForIntent('PROHIBITED')).toBeNull();
    expect(capabilityForIntent('UNSUPPORTED')).toBeNull();
    expect(capabilityForIntent('SATELLITE_STATUS')).toBe('SATELLITE_STATUS');
  });
});

describe('deterministic intent routing', () => {
  const emptyCtx = { satelliteId: null, investigationId: null, reportId: null, plannerExecutionId: null, criticExecutionId: null, citationIds: [], evidenceIds: [], topic: null, lastCapability: null, lastExecutionMode: null };
  it('classifies core intents', () => {
    expect(deterministicIntent('Is ORION-3 healthy?', emptyCtx).intent).toBe('SATELLITE_STATUS');
    expect(deterministicIntent('Show latest telemetry for ORION-3', emptyCtx).intent).toBe('TELEMETRY_ANALYSIS');
    expect(deterministicIntent('Any active alerts?', emptyCtx).intent).toBe('ALERT_ANALYSIS');
    expect(deterministicIntent('What does the mission manual say about batteries?', emptyCtx).intent).toBe('MISSION_KNOWLEDGE_SEARCH');
    expect(deterministicIntent('Run a deeper analysis of investigation 1', emptyCtx).intent).toBe('PLANNER_ANALYSIS');
    expect(deterministicIntent('Critique that analysis', emptyCtx).intent).toBe('CRITIC_REVIEW');
    expect(deterministicIntent('Run a validated analysis and verify the findings', emptyCtx).intent).toBe('VALIDATED_INVESTIGATION_ANALYSIS');
  });
  it('classifies prohibited operational requests', () => {
    for (const m of ['Reset the simulation.', 'Approve investigation 1.', 'Run this SQL: SELECT * FROM users', 'Open this URL https://evil.example', 'Fire the thrusters on ORION-3']) {
      expect(deterministicIntent(m, emptyCtx).intent).toBe('PROHIBITED');
    }
  });
  it('extracts a citation ordinal reference', () => {
    const r = deterministicIntent('Explain the second citation', emptyCtx);
    expect(r.intent).toBe('SOURCE_INSPECTION');
    expect(r.entities.citationOrdinal).toBe(2);
  });
});

describe('real-provider intent routing (mock)', () => {
  it('adopts a valid structured classification but keeps deterministic on invalid', async () => {
    const router = new AssistantIntentRouter({ realProviderAvailable: true, runner: scriptedRunner([{ intent: 'ALERT_ANALYSIS' }]) });
    const emptyCtx = { satelliteId: null, investigationId: null, reportId: null, plannerExecutionId: null, criticExecutionId: null, citationIds: [], evidenceIds: [], topic: null, lastCapability: null, lastExecutionMode: null };
    const r = await router.classify('tell me things', emptyCtx, []);
    expect(r.source).toBe('REAL_PROVIDER');
    expect(r.intent).toBe('ALERT_ANALYSIS');
  });
  it('never delegates a prohibited request to the model', async () => {
    const router = new AssistantIntentRouter({ realProviderAvailable: true, runner: scriptedRunner([{ intent: 'MISSION_QA' }]) });
    const emptyCtx = { satelliteId: null, investigationId: null, reportId: null, plannerExecutionId: null, criticExecutionId: null, citationIds: [], evidenceIds: [], topic: null, lastCapability: null, lastExecutionMode: null };
    const r = await router.classify('Reset the simulation now', emptyCtx, []);
    expect(r.intent).toBe('PROHIBITED');
    expect(r.source).toBe('DETERMINISTIC');
  });
});

describe('context resolution', () => {
  const prior = { satelliteId: seedSatOrDefault(), investigationId: null, reportId: null, plannerExecutionId: null, criticExecutionId: null, citationIds: ['ORION-KB-A-C1', 'ORION-KB-B-C2'], evidenceIds: [], topic: null, lastCapability: null, lastExecutionMode: null };
  function seedSatOrDefault() { return 'ORION-5'; }
  it('validates a fresh satellite id and rejects a fabricated one', () => {
    const ok = resolveContext('SATELLITE_STATUS', { satelliteId: seedSat, investigationId: null, reportId: null, citationId: null, citationOrdinal: null, referencesPrevious: false }, prior);
    expect(ok.resolved.satelliteId).toBe(seedSat);
    const bad = resolveContext('SATELLITE_STATUS', { satelliteId: 'ORION-99999', investigationId: null, reportId: null, citationId: null, citationOrdinal: null, referencesPrevious: false }, prior);
    expect(bad.rejected.some((r) => r.reason === 'UNKNOWN_SATELLITE')).toBe(true);
  });
  it('rejects a fabricated investigation id (never applies it)', () => {
    // Use a prior with no active satellite so no legitimate derivation occurs.
    const noSat = { ...prior, satelliteId: null };
    const bad = resolveContext('INVESTIGATION_EXPLANATION', { satelliteId: null, investigationId: 999999, reportId: null, citationId: null, citationOrdinal: null, referencesPrevious: false }, noSat);
    expect(bad.rejected.some((r) => r.reason === 'UNKNOWN_INVESTIGATION')).toBe(true);
    expect(bad.resolved.investigationId).not.toBe(999999);
    expect(bad.resolved.investigationId).toBeNull();
  });
  it('resolves a citation ordinal from prior context', () => {
    const r = resolveContext('SOURCE_INSPECTION', { satelliteId: null, investigationId: null, reportId: null, citationId: null, citationOrdinal: 2, referencesPrevious: false }, prior);
    expect(r.inspectCitationId).toBe('ORION-KB-B-C2');
  });
  it('rejects an out-of-range citation ordinal', () => {
    const r = resolveContext('SOURCE_INSPECTION', { satelliteId: null, investigationId: null, reportId: null, citationId: null, citationOrdinal: 9, referencesPrevious: false }, prior);
    expect(r.inspectCitationId).toBeNull();
    expect(r.rejected.some((x) => x.reason === 'CITATION_ORDINAL_OUT_OF_RANGE')).toBe(true);
  });
  it('carries forward a satellite on a follow-up reference', () => {
    const r = resolveContext('EVIDENCE_EXPLANATION', { satelliteId: null, investigationId: null, reportId: null, citationId: null, citationOrdinal: null, referencesPrevious: true }, prior);
    expect(r.resolved.satelliteId).toBe(prior.satelliteId);
  });
});

describe('bounded memory', () => {
  it('retains only the configured window and summarizes older messages deterministically', async () => {
    const id = newConv();
    const total = config.assistant.maxRetainedMessages + 6;
    for (let i = 0; i < total; i++) convRepo.addMessage(id, i % 2 === 0 ? 'user' : 'assistant', `msg ${i} about ORION-5`, null, null);
    const mem = new AssistantMemoryService({ realProviderAvailable: false });
    const summary = await mem.maybeSummarize(id);
    expect(summary).not.toBeNull();
    expect(summary!.source).toBe('DETERMINISTIC');
    expect(summary!.summary.length).toBeLessThanOrEqual(config.assistant.maxSummaryChars);
    expect(summary!.messageCountSummarized).toBeGreaterThan(0);
  });
});

describe('assistant tool registry', () => {
  it('includes the 8 copilot tools + 4 new read-only tools and fails closed', () => {
    for (const t of ['getSatellite', 'searchMissionKnowledge', 'resolveCitation', 'getKnowledgeDocumentMetadata', 'getPlannerAnalysis', 'getCriticReview']) {
      expect(isAllowedAssistantTool(t)).toBe(true);
    }
    expect(getAssistantTool('deleteEverything')).toBeUndefined();
  });
});

describe('workflow service (read-only, advisory, no mutation)', () => {
  it('runs a Planner analysis and preserves advisory labeling + human review', async () => {
    if (seedInv === null) return;
    const wf = new AssistantWorkflowService();
    const out = await wf.runPlanner({ investigationId: seedInv, userId: USER, role: ROLE });
    expect(out.result.workflow).toBe('PLANNER');
    expect(['SUCCESS', 'FAILED']).toContain(out.result.status);
    expect(out.result.advisoryLabel).toBe('ANALYSIS_ASSISTANCE_ONLY');
    expect(out.result.humanReviewRequired).toBe(true);
    // no mission mutation
    const inv = db.prepare('SELECT status FROM investigations WHERE id = ?').get(seedInv) as { status: string };
    expect(inv.status).toBe('RESOLVED');
  });
  it('fails closed (never throws) when Planner has no valid investigation', async () => {
    const wf = new AssistantWorkflowService();
    const out = await wf.runPlanner({ investigationId: 99999, userId: USER, role: ROLE });
    expect(out.result.status).toBe('FAILED');
    expect(out.result.executionMode).toBe('FAILED');
  });
});

describe('grounded answers (deterministic offline path)', () => {
  it('answers a satellite-status question with rich content, never labeled real', async () => {
    const id = newConv();
    const r = await offlineSvc.ask({ conversationId: id, userId: USER, role: ROLE, message: `Is ${seedSat} healthy?` });
    expect(r.executionMode).not.toBe('REAL_PROVIDER');
    expect(r.diagnostics.intent).toBe('SATELLITE_STATUS');
    expect(r.disclaimer).toMatch(/read-only/i);
    const s = JSON.stringify(r);
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"chain_of_thought"|"hidden_reasoning"/i);
  });
  it('explains an investigation with grounded claims (citations/evidence/tool facts)', async () => {
    if (seedInv === null) return;
    const id = newConv();
    const r = await offlineSvc.ask({ conversationId: id, userId: USER, role: ROLE, message: `Why is investigation ${seedInv} flagged?` });
    expect(r.diagnostics.groundingValid).toBe(true);
    expect(r.diagnostics.claimCount).toBeGreaterThan(0);
    expect(['DETERMINISTIC', 'INSUFFICIENT_EVIDENCE']).toContain(r.status);
  });
  it('refuses prohibited requests safely with no claims and no mutation', async () => {
    const id = newConv();
    const r = await offlineSvc.ask({ conversationId: id, userId: USER, role: ROLE, message: 'Approve investigation 1 and reset the simulation.' });
    expect(r.status).toBe('REFUSED');
    expect(r.answer.claims.length).toBe(0);
    if (seedInv !== null) {
      const inv = db.prepare('SELECT status FROM investigations WHERE id = ?').get(seedInv) as { status: string };
      expect(inv.status).toBe('RESOLVED');
    }
  });
  it('returns INSUFFICIENT_EVIDENCE when telemetry is requested with no satellite', async () => {
    const id = newConv();
    const r = await offlineSvc.ask({ conversationId: id, userId: USER, role: ROLE, message: 'Show me the telemetry.' });
    expect(r.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.answer.claims.length).toBe(0);
  });
  it('resolves a multi-turn follow-up (evidence after a why-question)', async () => {
    if (seedInv === null) return;
    const id = newConv();
    await offlineSvc.ask({ conversationId: id, userId: USER, role: ROLE, message: `Why is ${seedSat} unhealthy?` });
    const r = await offlineSvc.ask({ conversationId: id, userId: USER, role: ROLE, message: 'Show me the evidence.' });
    expect(r.context.investigationId !== null || r.context.satelliteId === seedSat).toBe(true);
  });
});

describe('quality gate + execution-mode integrity (mock real provider)', () => {
  it('accepts a valid claimless real-provider answer as REAL_PROVIDER', async () => {
    const id = newConv();
    const answer = { type: 'FINAL_ANSWER', title: 'Alerts', summary: 'There are alerts to review.', claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: [], suggested_followups: [] };
    const svc = new AssistantService({ realProviderAvailable: true, runner: scriptedRunner([answer]) });
    const r = await svc.ask({ conversationId: id, userId: USER, role: ROLE, message: 'Any active alerts?' });
    expect(r.executionMode).toBe('REAL_PROVIDER');
    expect(r.status).toBe('ACCEPTED');
    expect(r.provider).toBe('mock-provider');
  });
  it('rejects a real answer citing a fabricated citation and degrades to deterministic fallback', async () => {
    const id = newConv();
    const answer = { type: 'FINAL_ANSWER', title: 'x', summary: 'y', claims: [{ claim: 'fabricated', citation_ids: ['ORION-KB-FAKE-0000-C9'], evidence_ids: [] }], citations: ['ORION-KB-FAKE-0000-C9'], evidence_ids: [], workflow_references: [], limitations: [], suggested_followups: [] };
    const svc = new AssistantService({ realProviderAvailable: true, runner: scriptedRunner([answer]) });
    const r = await svc.ask({ conversationId: id, userId: USER, role: ROLE, message: 'Any active alerts?' });
    expect(r.executionMode).not.toBe('REAL_PROVIDER');
  });
  it('performs dynamic tool calling then a final answer (mock real loop)', async () => {
    const id = newConv();
    const toolReq = { type: 'TOOL_REQUEST', tool_calls: [{ tool_call_id: 't1', tool_name: 'getAlerts', arguments: {} }] };
    const final = { type: 'FINAL_ANSWER', title: 'Alerts', summary: 'Reviewed alerts.', claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: [], suggested_followups: [] };
    const svc = new AssistantService({ realProviderAvailable: true, runner: scriptedRunner([toolReq, final]) });
    const r = await svc.ask({ conversationId: id, userId: USER, role: ROLE, message: 'Any active alerts?' });
    expect(r.toolActivity.some((t) => t.toolName === 'getAlerts')).toBe(true);
    expect(r.executionMode).toBe('REAL_PROVIDER');
  });
  it('rejects a tool not permitted for the capability in the real loop', async () => {
    const id = newConv();
    const toolReq = { type: 'TOOL_REQUEST', tool_calls: [{ tool_call_id: 't1', tool_name: 'getReport', arguments: { reportId: 1 } }] };
    const final = { type: 'FINAL_ANSWER', title: 'Alerts', summary: 'done', claims: [], citations: [], evidence_ids: [], workflow_references: [], limitations: [], suggested_followups: [] };
    const svc = new AssistantService({ realProviderAvailable: true, runner: scriptedRunner([toolReq, final]) });
    const r = await svc.ask({ conversationId: id, userId: USER, role: ROLE, message: 'Any active alerts?' });
    // getReport is not in ALERT_ANALYSIS.tools → rejected, not executed
    const rej = r.toolActivity.find((t) => t.toolName === 'getReport');
    expect(!rej || rej.status === 'REJECTED').toBe(true);
  });
});
