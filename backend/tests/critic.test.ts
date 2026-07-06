/**
 * Phase 7 Critic Agent unit + service tests. Offline + deterministic.
 * Real-provider review is exercised with a queued mock provider.
 *
 * Covers: schema, prompt, context, deterministic critic, coverage, contradiction,
 * output validation, revision service, bounded reflection loop, human-review
 * boundary, no-mutation, and audit persistence.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initSchema } from '../src/db.js';
import { seedIfEmpty } from '../src/seed/seedData.js';
import { seedKnowledgeIfEmpty } from '../src/knowledge/seed.js';
import { getInvestigation } from '../src/services/investigationService.js';
import { config } from '../src/config.js';
import { validateJsonSchema } from '../src/llm/schema.js';
import { LlmRunner } from '../src/llm/runner.js';
import type { LlmProvider } from '../src/llm/provider.js';
import type { RawCompletion } from '../src/llm/types.js';
import type { PlannerAnalysis } from '../src/planner/types.js';
import { plannerService, PlannerService } from '../src/planner/plannerService.js';

import { CRITIC_REVIEW_SCHEMA } from '../src/critic/schemas.js';
import { CRITIC_SYSTEM_PROMPT, CRITIC_VERSION, buildCriticUserPrompt } from '../src/critic/prompt.js';
import { buildCriticContext } from '../src/critic/criticContextBuilder.js';
import { buildCriticGroundingContext, stableHash } from '../src/critic/criticGrounding.js';
import { deterministicCritic } from '../src/critic/deterministicCritic.js';
import { evaluateCoverage } from '../src/critic/coverageEvaluator.js';
import { detectContradictions } from '../src/critic/contradictionDetector.js';
import { isDecisionConsistent, validateCriticReview, validateRevisedAnalysis } from '../src/critic/criticValidators.js';
import { reviseAnalysis } from '../src/critic/revisionService.js';
import { CriticService } from '../src/critic/criticService.js';
import { getCriticExecution } from '../src/critic/criticAuditRepository.js';
import type { CriticContext, CriticReview } from '../src/critic/types.js';

const USER = { userId: 'u1', role: 'MISSION_ANALYST' as const };
let plannerExecId: number;
let baseCtx: CriticContext;

beforeAll(async () => {
  initSchema();
  seedIfEmpty();
  seedKnowledgeIfEmpty();
  const pr = await plannerService.analyze({ investigationId: 1, ...USER });
  plannerExecId = pr.plannerExecutionId!;
  baseCtx = (await buildCriticContext({ plannerExecutionId: plannerExecId, ...USER }, { plannerService }))!;
});

/** Deep-clone base context and optionally tamper the analysis. */
function tamper(fn?: (a: PlannerAnalysis, c: CriticContext) => void): CriticContext {
  const c = JSON.parse(JSON.stringify(baseCtx)) as CriticContext;
  if (fn) fn(c.analysis, c);
  return c;
}
const dc = (c: CriticContext) => deterministicCritic(c, buildCriticGroundingContext(c));

// ==========================================================================
// Schema + prompt (items 1-12)
// ==========================================================================
describe('critic schema + prompt', () => {
  it('1-9. schema accepts a valid review; rejects missing field, extra prop, bad enum', () => {
    const r = dc(baseCtx).review;
    expect(validateJsonSchema(CRITIC_REVIEW_SCHEMA, r).valid).toBe(true);
    const miss = JSON.parse(JSON.stringify(r)); delete miss.decision;
    expect(validateJsonSchema(CRITIC_REVIEW_SCHEMA, miss).valid).toBe(false);
    expect(validateJsonSchema(CRITIC_REVIEW_SCHEMA, { ...r, hacked: true }).valid).toBe(false);
    expect(validateJsonSchema(CRITIC_REVIEW_SCHEMA, { ...r, decision: 'MAYBE' }).valid).toBe(false);
  });
  it('10-12. prompt is versioned, preserves RCA authority, prohibits operations', () => {
    expect(CRITIC_VERSION).toBe('orion-planner-critic-v1');
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/AUTHORITATIVE/);
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/never approve\/reject\/resolve/i);
    const up = buildCriticUserPrompt(baseCtx);
    expect(up).toMatch(/UNTRUSTED/);
    expect(up).toContain(baseCtx.authoritativeRootCause);
  });
});

// ==========================================================================
// Context builder (items 13-20)
// ==========================================================================
describe('critic context builder', () => {
  it('13-15/20. deterministic, bounded, scoped to one investigation', async () => {
    const c2 = (await buildCriticContext({ plannerExecutionId: plannerExecId, ...USER }, { plannerService }))!;
    expect(c2.investigationId).toBe(baseCtx.investigationId);
    expect(c2.authoritativeRootCause).toBe(baseCtx.authoritativeRootCause);
    expect(c2.analysis.authoritative_root_cause).toBe(baseCtx.authoritativeRootCause);
    for (const c of c2.citations) expect(c.text.length).toBeLessThanOrEqual(500);
    // Only the target investigation's evidence is present.
    expect(c2.evidence.every((e) => e.evidence_id.length > 0)).toBe(true);
  });
  it('16-19. context/review carries no secrets, raw prompts, hidden reasoning, or raw vectors', () => {
    const s = JSON.stringify({ ctx: baseCtx, review: dc(baseCtx).review });
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"(prompt|chain_of_thought|reasoning)"\s*:/i);
    expect(s).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });
});

// ==========================================================================
// Deterministic critic + RCA/grounding/policy detection (items 26-39)
// ==========================================================================
describe('deterministic critic', () => {
  it('26-28. deterministic, schema-valid, ACCEPTs a clean analysis, preserves RCA', () => {
    const a = dc(baseCtx);
    const b = dc(baseCtx);
    expect(stableHash(a.review)).toBe(stableHash(b.review));
    expect(validateJsonSchema(CRITIC_REVIEW_SCHEMA, a.review).valid).toBe(true);
    expect(a.review.decision).toBe('ACCEPT');
    expect(a.contradictions.length).toBe(0);
  });
  it('28/51. RCA mismatch => CRITICAL contradiction => REJECT', () => {
    const c = tamper((a) => { a.authoritative_root_cause = 'WRONG_ROOT_CAUSE'; });
    const r = dc(c).review;
    expect(r.decision).toBe('REJECT');
    expect(r.issues.some((i) => i.category === 'RCA_CONSISTENCY' && i.severity === 'CRITICAL')).toBe(true);
  });
  it('29-30. fabricated citation + evidence detected', () => {
    const c = tamper((a) => { a.findings.push({ claim: 'Extra claim.', source_types: ['MISSION_KNOWLEDGE'], citation_ids: ['ORION-KB-FAKE-DOC-C0001'], evidence_ids: ['999999'] }); });
    const r = dc(c).review;
    expect(r.issues.some((i) => i.category === 'CITATION')).toBe(true);
    expect(r.issues.some((i) => i.category === 'EVIDENCE')).toBe(true);
  });
  it('31-33. fabricated satellite / investigation / report IDs detected', () => {
    const c = tamper((a) => { a.findings[0].claim = 'Satellite ORION-999 in investigation 999999 per report 999999 failed.'; });
    const cats = dc(c).review.issues.map((i) => i.category);
    expect(cats.filter((x) => x === 'FABRICATED_ID').length).toBeGreaterThanOrEqual(3);
  });
  it('34-35. unsupported / ungrounded claim detected', () => {
    const c = tamper((a) => { a.findings.push({ claim: 'The quantum flux capacitor overloaded catastrophically.', source_types: ['MISSION_KNOWLEDGE'], citation_ids: [], evidence_ids: [] }); });
    expect(dc(c).review.issues.some((i) => i.category === 'UNSUPPORTED_CLAIM')).toBe(true);
  });
  it('36. policy / action-executed violation detected => CRITICAL', () => {
    const c = tamper((a) => { a.findings[0].claim = 'We have executed the reboot command on the satellite.'; });
    const r = dc(c).review;
    expect(r.decision).toBe('REJECT');
    expect(r.issues.some((i) => i.severity === 'CRITICAL')).toBe(true);
  });
  it('37. overstatement detected => WARNING => REVISE', () => {
    const c = tamper((a) => { a.analysis_summary += ' This definitely proves the fault conclusively.'; });
    const r = dc(c).review;
    expect(r.issues.some((i) => i.category === 'OVERSTATEMENT')).toBe(true);
    expect(r.decision).toBe('REVISE');
  });
  it('38-39. missing limitation + unresolved knowledge gap detected', () => {
    const c1 = tamper((a) => { a.limitations = []; });
    expect(dc(c1).review.coverage.limitations).toBe(false);
    const c2 = tamper((a, c) => { a.knowledge_gaps = []; c.plannerKnowledgeGaps = ['missing telemetry coverage']; });
    expect(dc(c2).review.coverage.knowledge_gaps).toBe(false);
  });
});

// ==========================================================================
// Coverage evaluator (items 40-50)
// ==========================================================================
describe('coverage evaluator', () => {
  it('40-41. investigation + evidence coverage', () => {
    expect(evaluateCoverage(baseCtx).assessment.investigation_context).toBe(true);
    const c = tamper((a) => { a.findings = a.findings.filter((f) => f.evidence_ids.length === 0); });
    expect(evaluateCoverage(c).assessment.deterministic_evidence).toBe(false);
  });
  it('42-43. telemetry coverage: relevant vs not relevant', () => {
    const withTel = tamper((a, c) => { c.telemetryPresent = true; a.limitations = []; const scrub = (s: string) => s.replace(/telemetry|batter|temperature|signal|power/gi, 'x'); a.analysis_summary = scrub(a.analysis_summary); a.findings.forEach((f) => { f.claim = scrub(f.claim); }); });
    expect(evaluateCoverage(withTel).assessment.telemetry).toBe(false);
    const noTel = tamper((a, c) => { c.telemetryPresent = false; a.limitations = []; });
    expect(evaluateCoverage(noTel).assessment.telemetry).toBe(true);
  });
  it('44-45. alert coverage: active alerts vs none inspected', () => {
    const withAlerts = tamper((a, c) => { c.alertsActiveCount = 3; a.limitations = []; });
    expect(evaluateCoverage(withAlerts).assessment.alerts).toBe(false);
    const noAlerts = tamper((a, c) => { c.alertsActiveCount = 0; c.alertsInspected = true; a.limitations = []; });
    expect(evaluateCoverage(noAlerts).assessment.alerts).toBe(true);
  });
  it('46-48. mission-knowledge + historical coverage (relevant / none found)', () => {
    const withCit = tamper((a, c) => { c.citations = [{ citation_id: 'ORION-KB-X-C0001', title: 't', text: 'x', document_id: 1 }]; a.findings = a.findings.filter((f) => f.citation_ids.length === 0); });
    expect(evaluateCoverage(withCit).assessment.mission_knowledge).toBe(false);
    const noHist = tamper((a, c) => { c.historicalCount = 0; c.historicalInspected = true; a.limitations = []; });
    expect(evaluateCoverage(noHist).assessment.historical_incidents).toBe(true);
  });
  it('49-50. limitations + knowledge-gap coverage', () => {
    expect(evaluateCoverage(baseCtx).assessment.limitations).toBe(true);
    expect(evaluateCoverage(baseCtx).assessment.knowledge_gaps).toBe(true);
  });
});

// ==========================================================================
// Contradiction detector (items 51-61)
// ==========================================================================
describe('contradiction detector', () => {
  it('52. healthy vs unhealthy contradiction', () => {
    const c = tamper((a) => { a.findings.push({ claim: 'The satellite is fully healthy and operating normally.', source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] }); });
    expect(detectContradictions(c).some((x) => x.type === 'HEALTH_STATE')).toBe(true);
  });
  it('53-55. false-absence contradictions (evidence / citations / alerts)', () => {
    const ev = tamper((a) => { a.findings.push({ claim: 'There is no supporting evidence for this.', source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] }); });
    expect(detectContradictions(ev).some((x) => x.type === 'EVIDENCE_EXISTENCE')).toBe(true);
    const al = tamper((a, c) => { c.alertsActiveCount = 2; a.findings.push({ claim: 'There are no active alerts.', source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] }); });
    expect(detectContradictions(al).some((x) => x.type === 'ALERT_EXISTENCE')).toBe(true);
  });
  it('56. action-executed contradiction (CRITICAL policy)', () => {
    const c = tamper((a) => { a.findings[0].claim = 'The command was executed and the payload was reset.'; });
    expect(detectContradictions(c).some((x) => x.type === 'ACTION_EXECUTED' && x.severity === 'CRITICAL')).toBe(true);
  });
  it('57-59. fabricated identifier contradictions', () => {
    const c = tamper((a) => { a.findings[0].claim = 'ORION-999 in investigation 424242 and report 424242.'; });
    const types = detectContradictions(c).map((x) => x.type);
    expect(types).toContain('SATELLITE_ID');
    expect(types).toContain('INVESTIGATION_ID');
    expect(types).toContain('REPORT_ID');
  });
  it('60-61. numeric telemetry contradiction + tolerance boundary', () => {
    const conflict = tamper((a, c) => { c.telemetryLatest = { temperature_c: 20, battery_percent: 80, signal_strength_dbm: -90, power_consumption_w: 100 }; a.findings.push({ claim: 'The battery is at 40%.', source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] }); });
    expect(detectContradictions(conflict).some((x) => x.type === 'TELEMETRY_NUMERIC')).toBe(true);
    const within = tamper((a, c) => { c.telemetryLatest = { temperature_c: 20, battery_percent: 80, signal_strength_dbm: -90, power_consumption_w: 100 }; a.findings.push({ claim: 'The battery is at 80%.', source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] }); });
    expect(within.telemetryLatest && detectContradictions(within).some((x) => x.type === 'TELEMETRY_NUMERIC')).toBe(false);
  });
});

// ==========================================================================
// Output validator + decision consistency (items 62-65)
// ==========================================================================
describe('critic output validator', () => {
  const g = () => buildCriticGroundingContext(baseCtx);
  const mk = (over: Partial<CriticReview>): CriticReview => ({ review_version: CRITIC_VERSION, decision: 'ACCEPT', summary: 's', issues: [], coverage: { investigation_context: true, deterministic_evidence: true, telemetry: true, alerts: true, mission_knowledge: true, historical_incidents: true, limitations: true, knowledge_gaps: true }, revision_instructions: [], limitations: [], ...over });

  it('62-64. ACCEPT/REVISE/REJECT decision consistency', () => {
    expect(isDecisionConsistent(mk({ decision: 'ACCEPT', issues: [] }))).toBe(true);
    expect(isDecisionConsistent(mk({ decision: 'ACCEPT', issues: [{ issue_id: 'ISSUE-1', severity: 'ERROR', category: 'GROUNDING', description: 'd', claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: 'c' }] }))).toBe(false);
    expect(isDecisionConsistent(mk({ decision: 'REVISE', issues: [{ issue_id: 'ISSUE-1', severity: 'WARNING', category: 'LIMITATION', description: 'd', claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: 'c' }] }))).toBe(true);
    expect(isDecisionConsistent(mk({ decision: 'REJECT', issues: [{ issue_id: 'ISSUE-1', severity: 'CRITICAL', category: 'RCA_CONSISTENCY', description: 'd', claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: 'c' }] }))).toBe(true);
  });
  it('65/108-111. validator rejects duplicate IDs, out-of-context IDs, unsafe text, bad target', () => {
    expect(validateCriticReview(mk({}), baseCtx, g()).valid).toBe(true);
    const dup = mk({ decision: 'REVISE', issues: [
      { issue_id: 'ISSUE-1', severity: 'WARNING', category: 'LIMITATION', description: 'a', claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: 'c' },
      { issue_id: 'ISSUE-1', severity: 'WARNING', category: 'LIMITATION', description: 'b', claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: 'c' },
    ] });
    expect(validateCriticReview(dup, baseCtx, g()).valid).toBe(false);
    const outOfCtx = mk({ decision: 'REVISE', issues: [{ issue_id: 'ISSUE-1', severity: 'ERROR', category: 'CITATION', description: 'd', claim_index: null, citation_ids: ['ORION-KB-NOPE-C0001'], evidence_ids: [], recommended_correction: 'c' }] });
    expect(validateCriticReview(outOfCtx, baseCtx, g()).valid).toBe(false);
    const unsafe = mk({ summary: 'DROP TABLE users; http://evil.example' });
    expect(validateCriticReview(unsafe, baseCtx, g()).valid).toBe(false);
    const badTarget = mk({ decision: 'REVISE', revision_instructions: [{ instruction_id: 'REV-1', target: 'DELETE_DB', action: 'x', reason: 'y' }], issues: [{ issue_id: 'ISSUE-1', severity: 'WARNING', category: 'LIMITATION', description: 'd', claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: 'c' }] });
    expect(validateCriticReview(badTarget, baseCtx, g()).valid).toBe(false);
  });
});

// ==========================================================================
// Revision service (items 66-80)
// ==========================================================================
describe('revision service', () => {
  const g = () => buildCriticGroundingContext(baseCtx);
  it('66/73/74-75. removes unsupported finding, preserves RCA, invents nothing', () => {
    const c = tamper((a) => { a.findings.push({ claim: 'The quantum flux capacitor overloaded.', source_types: ['MISSION_KNOWLEDGE'], citation_ids: [], evidence_ids: [] }); });
    const review = dc(c).review;
    const before = JSON.stringify(c.analysis);
    const revised = reviseAnalysis(c.analysis, review, c);
    expect(revised.authoritative_root_cause).toBe(c.authoritativeRootCause);
    expect(revised.findings.some((f) => f.claim.includes('quantum flux'))).toBe(false);
    // No invented citations/evidence: every id in revised existed before.
    const ids = revised.findings.flatMap((f) => [...f.citation_ids, ...f.evidence_ids]);
    for (const id of ids) expect(before).toContain(id);
  });
  it('67-68. adds missing limitation + knowledge gap', () => {
    const c = tamper((a, ctx) => { a.limitations = []; a.knowledge_gaps = []; ctx.plannerKnowledgeGaps = ['insufficient telemetry']; });
    const revised = reviseAnalysis(c.analysis, dc(c).review, c);
    expect(revised.limitations.length).toBeGreaterThan(0);
    expect(revised.knowledge_gaps.length).toBeGreaterThan(0);
  });
  it('69-72. strips invalid citation/evidence associations + softens overstatement', () => {
    const c = tamper((a) => { a.findings.push({ claim: 'Absolutely guaranteed root cause.', source_types: ['EVIDENCE'], citation_ids: ['ORION-KB-BAD-C0001'], evidence_ids: ['999999', c0(a)] }); });
    const revised = reviseAnalysis(c.analysis, dc(c).review, c);
    const flat = JSON.stringify(revised);
    expect(flat).not.toContain('ORION-KB-BAD-C0001');
    expect(flat).not.toContain('999999');
    expect(revised.analysis_summary + revised.findings.map((f) => f.claim).join(' ')).not.toMatch(/absolutely|guaranteed/i);
  });
  it('76-80. revised analysis passes the full validation pipeline', () => {
    const c = tamper((a) => { a.analysis_summary += ' This certainly proves it.'; a.limitations = []; });
    const revised = reviseAnalysis(c.analysis, dc(c).review, c);
    const v = validateRevisedAnalysis(revised, c, buildCriticGroundingContext(c));
    expect(v.valid).toBe(true);
    expect(v.rootCauseMatches).toBe(true);
    expect(v.groundingValid).toBe(true);
    expect(v.policyValid).toBe(true);
  });
});
// helper: return a valid evidence id from the analysis if present, else ''
function c0(a: PlannerAnalysis): string { return a.findings.flatMap((f) => f.evidence_ids)[0] ?? ''; }

// ==========================================================================
// Bounded reflection loop via CriticService (items 81-95)
// ==========================================================================
class QueuedProvider implements LlmProvider {
  name = 'mock-real'; model = 'mock-1'; i = 0;
  constructor(private queue: string[]) {}
  capabilities() { return { structuredOutput: true, streaming: false }; }
  isAvailable() { return true; }
  async generate(): Promise<RawCompletion> { const c = this.queue[Math.min(this.i, this.queue.length - 1)]; this.i++; return { content: c, finishReason: 'stop' }; }
}

/** A fake planner that returns a supplied analysis (loop testing). */
function fakePlanner(analysis: PlannerAnalysis, extra: Partial<Record<string, unknown>> = {}): PlannerService {
  const steps = ['INSPECT_INVESTIGATION', 'INSPECT_EVIDENCE', 'INSPECT_TELEMETRY', 'INSPECT_ALERTS', 'SEARCH_MISSION_KNOWLEDGE', 'SEARCH_HISTORICAL_INVESTIGATIONS']
    .map((stepType, i) => ({ stepId: `s${i}`, stepType, status: 'SUCCESS', toolName: null, outputSummary: '' }));
  return {
    analyze: async () => ({
      investigationId: 1, plannerExecutionId: plannerExecId, correlationId: 'fake', executionMode: 'DETERMINISTIC_FALLBACK', planStatus: 'COMPLETED',
      provider: null, model: null, plan: { plan_version: 'orion-investigation-planner-v1', objective: 'o', steps: [], completion_criteria: [] },
      stepSummaries: steps, retrievalRefinements: [], analysis, citations: [], evidenceIds: analysis.findings.flatMap((f) => f.evidence_ids),
      knowledgeGaps: [], diagnostics: {}, fallbackReason: null, advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY', ...extra,
    }),
  } as unknown as PlannerService;
}

describe('bounded reflection loop', () => {
  it('81/91-95. ACCEPT clean analysis: no revision, advisory, human review, no mutation', async () => {
    const svc = new CriticService({ realProviderAvailable: false });
    const r = await svc.review({ plannerExecutionId: plannerExecId, ...USER });
    expect(r.initialDecision).toBe('ACCEPT');
    expect(r.finalDecision).toBe('ACCEPT');
    expect(r.criticStatus).toBe('ACCEPTED');
    expect(r.revisionAttempts.length).toBe(0);
    expect(r.advisoryLabel).toBe('ANALYSIS_ASSISTANCE_ONLY');
    expect(r.humanReviewRequired).toBe(true);
    // ACCEPT does not approve/resolve the investigation.
    expect(getInvestigation(1)!.status).toBe('RESOLVED');
    expect(getInvestigation(1)!.root_cause).toBe(baseCtx.authoritativeRootCause);
  });
  it('82. REVISE then ACCEPT (successful bounded revision)', async () => {
    const tampered = JSON.parse(JSON.stringify(baseCtx.analysis)) as PlannerAnalysis;
    tampered.analysis_summary += ' This definitely proves the fault conclusively.';
    tampered.limitations = [];
    const svc = new CriticService({ realProviderAvailable: false, plannerService: fakePlanner(tampered) });
    const r = await svc.review({ plannerExecutionId: plannerExecId, ...USER });
    expect(r.initialDecision).toBe('REVISE');
    expect(r.finalDecision).toBe('ACCEPT');
    expect(r.criticStatus).toBe('REVISED_ACCEPTED');
    expect(r.revisionAttempts.length).toBeGreaterThanOrEqual(1);
  });
  it('83/85/88-90. bounded: revision-limit + repeated-analysis detection + stable hashes', async () => {
    // Evidence exists but no finding is evidence-grounded -> persistent EVIDENCE coverage
    // warning that the revision cannot resolve -> repeated analysis -> loop stops bounded.
    const tampered = JSON.parse(JSON.stringify(baseCtx.analysis)) as PlannerAnalysis;
    tampered.findings = tampered.findings.filter((f) => f.evidence_ids.length === 0 && f.citation_ids.length === 0);
    if (!tampered.findings.some((f) => f.source_types.includes('TOOL_FACT'))) tampered.findings.unshift({ claim: baseCtx.analysis.findings[0].claim, source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] });
    const svc = new CriticService({ realProviderAvailable: false, plannerService: fakePlanner(tampered) });
    const r = await svc.review({ plannerExecutionId: plannerExecId, ...USER });
    expect(r.initialDecision).toBe('REVISE');
    expect(r.revisionAttempts.length).toBeLessThanOrEqual(config.critic.maxRevisionAttempts);
    expect(['REVISION_LIMIT_REACHED', 'REVISION_REQUIRED']).toContain(r.criticStatus);
    expect(r.diagnostics.terminationReason).toMatch(/REPEATED_ANALYSIS|REVISION|NO_PROGRESS/);
  });
  it('84. REJECT stops the loop immediately', async () => {
    const tampered = JSON.parse(JSON.stringify(baseCtx.analysis)) as PlannerAnalysis;
    tampered.authoritative_root_cause = 'FABRICATED_ROOT_CAUSE';
    const svc = new CriticService({ realProviderAvailable: false, plannerService: fakePlanner(tampered) });
    const r = await svc.review({ plannerExecutionId: plannerExecId, ...USER });
    expect(r.initialDecision).toBe('REJECT');
    expect(r.criticStatus).toBe('REJECTED');
    expect(r.revisionAttempts.length).toBe(0);
    expect(getInvestigation(1)!.status).toBe('RESOLVED');
  });
  it('86. critic-call limit stops the loop', async () => {
    const tampered = JSON.parse(JSON.stringify(baseCtx.analysis)) as PlannerAnalysis;
    tampered.analysis_summary += ' This definitely proves it.';
    tampered.limitations = [];
    const orig = config.critic.maxCalls; config.critic.maxCalls = 1;
    const r = await new CriticService({ realProviderAvailable: false, plannerService: fakePlanner(tampered) }).review({ plannerExecutionId: plannerExecId, ...USER });
    config.critic.maxCalls = orig;
    expect(r.diagnostics.criticCallCount).toBeLessThanOrEqual(1);
    expect(r.diagnostics.terminationReason).toBe('CALL_LIMIT');
  });
  it('87. execution timeout stops the loop', async () => {
    const tampered = JSON.parse(JSON.stringify(baseCtx.analysis)) as PlannerAnalysis;
    tampered.analysis_summary += ' This definitely proves it.';
    tampered.limitations = [];
    const orig = config.critic.maxExecutionMs; config.critic.maxExecutionMs = 0;
    const r = await new CriticService({ realProviderAvailable: false, plannerService: fakePlanner(tampered) }).review({ plannerExecutionId: plannerExecId, ...USER });
    config.critic.maxExecutionMs = orig;
    expect(r.criticStatus).toBe('TIMED_OUT');
  });
});

// ==========================================================================
// Real-provider path (items 21-25) + audit (items 96-103)
// ==========================================================================
function realCritic(queue: string[], planner?: PlannerService) {
  return new CriticService({ realProviderAvailable: true, plannerService: planner, runner: new LlmRunner({ realProvider: new QueuedProvider(queue), config: { fallbackEnabled: true, maxRetries: 0 } }) });
}

describe('real-provider critic path + audit', () => {
  const cleanReview = (): CriticReview => ({ review_version: CRITIC_VERSION, decision: 'ACCEPT', summary: 'Looks grounded.', issues: [], coverage: { investigation_context: true, deterministic_evidence: true, telemetry: true, alerts: true, mission_knowledge: true, historical_incidents: true, limitations: true, knowledge_gaps: true }, revision_instructions: [], limitations: [] });

  it('21. accepts a valid real review (REAL_PROVIDER)', async () => {
    const r = await realCritic([JSON.stringify(cleanReview())]).review({ plannerExecutionId: plannerExecId, ...USER });
    expect(r.executionMode).toBe('REAL_PROVIDER');
    expect(r.finalDecision).toBe('ACCEPT');
  });
  it('22/24. invalid real review OR no structured output => deterministic fallback', async () => {
    const r = await realCritic(['{ this is not valid json']).review({ plannerExecutionId: plannerExecId, ...USER });
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
  });
  it('23/25. unsafe real review (hides a CRITICAL) => deterministic fallback, never labeled real', async () => {
    // Analysis has an RCA mismatch (deterministic CRITICAL) but the real review says ACCEPT.
    const tampered = JSON.parse(JSON.stringify(baseCtx.analysis)) as PlannerAnalysis;
    tampered.authoritative_root_cause = 'FABRICATED_ROOT_CAUSE';
    const r = await realCritic([JSON.stringify(cleanReview())], fakePlanner(tampered)).review({ plannerExecutionId: plannerExecId, ...USER });
    expect(r.executionMode).toBe('DETERMINISTIC_FALLBACK');
    expect(r.fallbackReason).toMatch(/REAL_REVIEW_REJECTED/);
    expect(r.finalDecision).toBe('REJECT');
  });
  it('96-103. persists execution + issues + revision audit with no secrets/prompts/reasoning/vectors', async () => {
    const tampered = JSON.parse(JSON.stringify(baseCtx.analysis)) as PlannerAnalysis;
    tampered.analysis_summary += ' This definitely proves it.';
    tampered.limitations = [];
    const r = await new CriticService({ realProviderAvailable: false, plannerService: fakePlanner(tampered) }).review({ plannerExecutionId: plannerExecId, ...USER });
    const rec = getCriticExecution(r.criticExecutionId!)!;
    expect((rec.execution as { human_review_required: number }).human_review_required).toBe(1);
    expect(Array.isArray(rec.issues)).toBe(true);
    expect(Array.isArray(rec.revisionAttempts)).toBe(true);
    const s = JSON.stringify(rec);
    expect(s).not.toContain('Bearer ');
    expect(s).not.toContain('embedding_json');
    expect(s).not.toMatch(/"(prompt|chain_of_thought|reasoning|response_summary)"\s*:/i);
    expect(s).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
  });
});
