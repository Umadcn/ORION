/**
 * Phase 6 Planner Agent unit + service tests. Offline + deterministic.
 * Real-provider plan generation is exercised with a queued mock provider.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema } from '../src/db.js';
import { seedIfEmpty } from '../src/seed/seedData.js';
import { seedKnowledgeIfEmpty } from '../src/knowledge/seed.js';
import { getInvestigation } from '../src/services/investigationService.js';
import { config } from '../src/config.js';
import { validateJsonSchema } from '../src/llm/schema.js';
import { PLAN_SCHEMA } from '../src/planner/schemas.js';
import { validatePlan } from '../src/planner/planValidator.js';
import { buildDeterministicPlan } from '../src/planner/deterministicPlanner.js';
import { buildPlannerContext } from '../src/planner/plannerContext.js';
import { detectKnowledgeGap } from '../src/planner/knowledgeGapDetector.js';
import { buildRetrievalQuery } from '../src/planner/retrievalQueryBuilder.js';
import { toolForStep, isInternalStep, isKnownStepType } from '../src/planner/actionRegistry.js';
import { PlannerService } from '../src/planner/plannerService.js';
import { getPlannerExecution } from '../src/planner/plannerAuditRepository.js';
import { LlmRunner } from '../src/llm/runner.js';
import type { LlmProvider } from '../src/llm/provider.js';
import type { RawCompletion } from '../src/llm/types.js';
import type { InvestigationPlan } from '../src/planner/types.js';

const EXPECTED = { investigationId: 1, satelliteId: 'ORION-5' };

beforeAll(() => {
  initSchema();
  seedIfEmpty();
  seedKnowledgeIfEmpty();
});

// ==========================================================================
// Plan schema + validator
// ==========================================================================
describe('plan schema + validator', () => {
  const plan = () => buildDeterministicPlan(buildPlannerContext(1)!);

  it('1-3. schema accepts a valid plan; rejects missing fields + extra props', () => {
    expect(validateJsonSchema(PLAN_SCHEMA, plan()).valid).toBe(true);
    const p = plan() as Record<string, unknown>;
    delete p.steps;
    expect(validateJsonSchema(PLAN_SCHEMA, p).valid).toBe(false);
    expect(validateJsonSchema(PLAN_SCHEMA, { ...plan(), hacked: true }).valid).toBe(false);
  });
  it('4-6. validator: step bounds, unique IDs, allowlisted step types', () => {
    expect(validatePlan(plan(), EXPECTED).valid).toBe(true);
    const dup = plan(); dup.steps[1].step_id = dup.steps[0].step_id;
    expect(validatePlan(dup, EXPECTED).valid).toBe(false);
    const bad = plan(); (bad.steps[0] as { step_type: string }).step_type = 'DELETE_EVERYTHING';
    expect(validatePlan(bad, EXPECTED).valid).toBe(false);
  });
  it('7-8. rejects invalid dependency + forward/cycle dependency', () => {
    const fwd = plan(); fwd.steps[0].depends_on = ['STEP-999'];
    expect(validatePlan(fwd, EXPECTED).valid).toBe(false);
    const cyc = plan(); cyc.steps[0].depends_on = [cyc.steps[1].step_id]; // depends on a later step
    expect(validatePlan(cyc, EXPECTED).valid).toBe(false);
  });
  it('9-16. rejects fabricated IDs, write/SQL/URL/path/operational content', () => {
    const fabInv = plan(); fabInv.steps[0].parameters = { investigationId: 999 };
    expect(validatePlan(fabInv, EXPECTED).valid).toBe(false);
    const fabSat = plan(); fabSat.steps[2].parameters = { satelliteId: 'ORION-999' };
    expect(validatePlan(fabSat, EXPECTED).valid).toBe(false);
    const sql = plan(); sql.steps[0].reason = 'select * from users where 1=1';
    expect(validatePlan(sql, EXPECTED).valid).toBe(false);
    const url = plan(); url.steps[0].parameters = { note: 'http://evil.example/x' };
    expect(validatePlan(url, EXPECTED).valid).toBe(false);
    const write = plan(); write.objective = 'approve and resolve the investigation';
    expect(validatePlan(write, EXPECTED).valid).toBe(false);
    const path = plan(); path.steps[0].parameters = { file: '../../etc/passwd' };
    expect(validatePlan(path, EXPECTED).valid).toBe(false);
  });
});

// ==========================================================================
// Deterministic planner + action registry
// ==========================================================================
describe('deterministic planner + action registry', () => {
  it('17-19. deterministic + adapts to context', () => {
    const ctx = buildPlannerContext(1)!;
    expect(buildDeterministicPlan(ctx)).toEqual(buildDeterministicPlan(ctx));
    const plan = buildDeterministicPlan(ctx);
    expect(plan.steps.some((s) => s.step_type === 'BUILD_FINAL_ANALYSIS')).toBe(true);
    expect(plan.steps.length).toBeLessThanOrEqual(config.planner.maxSteps);
    expect(plan.plan_version).toBe('orion-investigation-planner-v1');
  });
  it('26-28. action registry: fixed mapping, internal steps, reuse copilot tools', () => {
    expect(toolForStep('INSPECT_TELEMETRY')).toBe('getTelemetry');
    expect(toolForStep('SEARCH_MISSION_KNOWLEDGE')).toBe('searchMissionKnowledge');
    expect(toolForStep('ASSESS_KNOWLEDGE_GAP')).toBeNull();
    expect(isInternalStep('BUILD_FINAL_ANALYSIS')).toBe(true);
    expect(isKnownStepType('DROP_TABLE')).toBe(false);
  });
});

// ==========================================================================
// Knowledge gap + retrieval query
// ==========================================================================
describe('knowledge gap detector + query builder', () => {
  it('44-48. deterministic gap detection', () => {
    const base = { hasTelemetry: true, historicalCount: 1, subsystem: 'POWER', anomalyTypes: ['BATTERY_DEGRADATION'], rootCauseLabel: 'battery degradation' };
    expect(detectKnowledgeGap({ ...base, evidenceCount: 2, citationCount: 2 }).sufficient).toBe(true);
    expect(detectKnowledgeGap({ ...base, evidenceCount: 0, citationCount: 2 }).type).toBe('MISSING_EVIDENCE');
    expect(detectKnowledgeGap({ ...base, evidenceCount: 2, citationCount: 0 }).type).toBe('MISSING_KNOWLEDGE');
    const g = detectKnowledgeGap({ ...base, evidenceCount: 0, citationCount: 0, hasTelemetry: false, historicalCount: 0 });
    expect(g.missingSourceCategories.length).toBeGreaterThan(0);
  });
  it('49-53. deterministic bounded query + duplicate prevention', () => {
    const seen = new Set<string>();
    const gap = detectKnowledgeGap({ evidenceCount: 0, hasTelemetry: false, citationCount: 0, historicalCount: 0, subsystem: 'POWER', anomalyTypes: ['BATTERY_DEGRADATION'], rootCauseLabel: 'battery degradation' });
    const q1 = buildRetrievalQuery({ satelliteId: 'ORION-5', subsystem: 'POWER', anomalyTypes: ['BATTERY_DEGRADATION'], rootCauseLabel: 'battery degradation', evidenceTerms: [] }, gap, 0, seen);
    expect(q1).not.toBeNull();
    expect(q1!.query.length).toBeLessThanOrEqual(config.retrieval.maxQueryChars);
    // same iteration+inputs => duplicate => null
    const dup = buildRetrievalQuery({ satelliteId: 'ORION-5', subsystem: 'POWER', anomalyTypes: ['BATTERY_DEGRADATION'], rootCauseLabel: 'battery degradation', evidenceTerms: [] }, gap, 0, seen);
    expect(dup).toBeNull();
  });
});

// ==========================================================================
// Planner service (deterministic + real mock)
// ==========================================================================
class QueuedProvider implements LlmProvider {
  name = 'mock-real'; model = 'mock-1'; i = 0;
  constructor(private queue: string[]) {}
  capabilities() { return { structuredOutput: true, streaming: false }; }
  isAvailable() { return true; }
  async generate(): Promise<RawCompletion> { const c = this.queue[Math.min(this.i, this.queue.length - 1)]; this.i++; return { content: c, finishReason: 'stop' }; }
}
const realSvc = (queue: string[]) => new PlannerService({ realProviderAvailable: true, runner: new LlmRunner({ realProvider: new QueuedProvider(queue), config: { fallbackEnabled: true, maxRetries: 0 } }) });

describe('planner service', () => {
  it('20/24/25/62/69. deterministic analysis is grounded, advisory, RCA-preserving', async () => {
    const svc = new PlannerService({ realProviderAvailable: false });
    const r = await svc.analyze({ investigationId: 1, userId: 'u1', role: 'MISSION_ANALYST' });
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
    expect(r.advisoryLabel).toBe('ANALYSIS_ASSISTANCE_ONLY');
    expect(r.analysis!.authoritative_root_cause).toBe('COMMUNICATION_SUBSYSTEM_FAILURE');
    expect(r.diagnostics.groundingValid).toBe(true);
    expect(r.citations.length + r.evidenceIds.length).toBeGreaterThan(0);
    expect(['COMPLETED', 'PARTIAL']).toContain(r.planStatus);
  });
  it('70. never mutates the investigation', async () => {
    await new PlannerService({ realProviderAvailable: false }).analyze({ investigationId: 1, userId: 'u1', role: 'MISSION_ANALYST' });
    expect(getInvestigation(1)!.status).toBe('RESOLVED');
    expect(getInvestigation(1)!.root_cause).toBe('COMMUNICATION_SUBSYSTEM_FAILURE');
  });
  it('21. accepts a valid real-provider plan (REAL_PROVIDER)', async () => {
    const validPlan = JSON.stringify(buildDeterministicPlan(buildPlannerContext(1)!));
    const r = await realSvc([validPlan]).analyze({ investigationId: 1, userId: 'u1', role: 'MISSION_ANALYST' });
    expect(r.executionMode).toBe('REAL_PROVIDER');
  });
  it('22-23. rejects an unsafe/invalid real plan and falls back (never labeled real)', async () => {
    const badPlan = buildDeterministicPlan(buildPlannerContext(1)!);
    badPlan.steps[0].parameters = { satelliteId: 'ORION-999' }; // fabricated id
    const r = await realSvc([JSON.stringify(badPlan)]).analyze({ investigationId: 1, userId: 'u1', role: 'MISSION_ANALYST' });
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
    expect(r.fallbackReason).toMatch(/REAL_PLAN_REJECTED/);
  });
  it('35-42. bounded execution: tool-call budget yields PARTIAL, never unbounded', async () => {
    const original = config.planner.maxToolCalls;
    config.planner.maxToolCalls = 1;
    const r = await new PlannerService({ realProviderAvailable: false }).analyze({ investigationId: 1, userId: 'u1', role: 'MISSION_ANALYST' });
    config.planner.maxToolCalls = original;
    expect(r.diagnostics.toolCallCount).toBeLessThanOrEqual(1);
    expect(r.planStatus).toBe('PARTIAL');
  });
  it('54-57. agentic RAG refinement is bounded', async () => {
    const origMinC = config.planner.minCitations;
    config.planner.minCitations = 99; // force perpetual gap
    const r = await new PlannerService({ realProviderAvailable: false }).analyze({ investigationId: 1, userId: 'u1', role: 'MISSION_ANALYST' });
    config.planner.minCitations = origMinC;
    expect(r.retrievalRefinements.length).toBeLessThanOrEqual(config.planner.maxQueryRefinements);
  });
  it('74-80. persists planner + step + refinement audit with no secrets', async () => {
    const r = await new PlannerService({ realProviderAvailable: false }).analyze({ investigationId: 1, userId: 'u1', role: 'MISSION_ANALYST' });
    const rec = getPlannerExecution(r.plannerExecutionId!)!;
    expect((rec.execution as { plan_status: string }).plan_status).toBe(r.planStatus);
    expect(Array.isArray(rec.steps)).toBe(true);
    expect((rec.steps as unknown[]).length).toBeGreaterThan(0);
    const s = JSON.stringify(rec);
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"(prompt|chain_of_thought|reasoning)"\s*:/i);
  });
});
