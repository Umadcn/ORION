/**
 * Deterministic, context-sensitive coverage evaluation (Phase 7). No LLM judge.
 *
 * Assesses whether the Planner analysis appropriately represents each source
 * category. Coverage is CONTEXT-SENSITIVE: an absent source that was inspected
 * and correctly represented (or disclosed via a limitation) does NOT fail. The
 * result is explainable and bounded.
 */
import type { CoverageAssessment, CoverageResult, CriticContext } from './types.js';
import type { PlannerAnalysis } from '../planner/types.js';

/** All searchable text in the analysis (summary + claims + gaps + limitations), lowercased. */
function analysisText(a: PlannerAnalysis): string {
  return [a.title, a.analysis_summary, ...a.findings.map((f) => f.claim), ...a.knowledge_gaps, ...a.limitations, ...a.recommended_review_items]
    .join('\n')
    .toLowerCase();
}

function mentionsAny(text: string, terms: string[]): boolean {
  return terms.some((t) => text.includes(t.toLowerCase()));
}

export function evaluateCoverage(ctx: CriticContext): CoverageResult {
  const a = ctx.analysis;
  const text = analysisText(a);
  const hasLimitations = a.limitations.length > 0;
  const rcTokens = ctx.authoritativeRootCause.replace(/_/g, ' ').toLowerCase().split(/\s+/).filter((w) => w.length >= 4);

  const assessment: CoverageAssessment = {
    // Investigation context: the analysis must anchor to the real satellite and root cause.
    investigation_context: mentionsAny(text, [ctx.satelliteId]) && (rcTokens.length === 0 || rcTokens.some((t) => text.includes(t))),
    // Deterministic evidence: if evidence exists, at least one finding must be evidence-grounded.
    deterministic_evidence: ctx.evidence.length === 0 ? true : a.findings.some((f) => f.evidence_ids.length > 0),
    // Telemetry: relevant only when present; absence/relevance disclosed via reference or a limitation.
    telemetry: !ctx.telemetryPresent ? true : mentionsAny(text, ['telemetry', 'battery', 'temperature', 'signal', 'power']) || hasLimitations,
    // Alerts: active alerts must be referenced or disclosed; no active alerts passes (absence is representable).
    alerts: ctx.alertsActiveCount === 0 ? true : mentionsAny(text, ['alert']) || hasLimitations,
    // Mission knowledge: if citations were retrieved, at least one finding must be citation-grounded.
    mission_knowledge: ctx.citations.length === 0 ? true : a.findings.some((f) => f.citation_ids.length > 0),
    // Historical incidents: relevant only when found; disclosure via reference or a limitation.
    historical_incidents: ctx.historicalCount === 0 ? true : mentionsAny(text, ['historical', 'past incident', 'similar', 'previous investigation']) || hasLimitations,
    // Limitations must be explicit.
    limitations: hasLimitations,
    // Knowledge gaps: if the Planner reported unmet gaps, the analysis must surface at least one.
    knowledge_gaps: ctx.plannerKnowledgeGaps.length === 0 ? true : a.knowledge_gaps.length > 0,
  };

  const CATEGORY: Record<keyof CoverageAssessment, CoverageResult['failures'][number]['category']> = {
    investigation_context: 'COVERAGE',
    deterministic_evidence: 'EVIDENCE',
    telemetry: 'TELEMETRY_COVERAGE',
    alerts: 'ALERT_COVERAGE',
    mission_knowledge: 'KNOWLEDGE_COVERAGE',
    historical_incidents: 'HISTORICAL_COVERAGE',
    limitations: 'LIMITATION',
    knowledge_gaps: 'KNOWLEDGE_GAP',
  };
  const REASON: Record<keyof CoverageAssessment, string> = {
    investigation_context: 'Analysis does not anchor to the authoritative satellite/root cause.',
    deterministic_evidence: 'Deterministic evidence exists but no finding is evidence-grounded.',
    telemetry: 'Telemetry is present/relevant but neither referenced nor disclosed as a limitation.',
    alerts: 'Active alerts exist but are neither referenced nor disclosed.',
    mission_knowledge: 'Mission-knowledge citations were retrieved but no finding is citation-grounded.',
    historical_incidents: 'Historical incidents exist but are neither referenced nor disclosed.',
    limitations: 'Analysis is missing explicit limitations.',
    knowledge_gaps: 'Unmet knowledge gaps were reported but the analysis surfaces none.',
  };

  const failures: CoverageResult['failures'] = [];
  let passCount = 0;
  (Object.keys(assessment) as (keyof CoverageAssessment)[]).forEach((k) => {
    if (assessment[k]) passCount++;
    else failures.push({ key: k, category: CATEGORY[k], reason: REASON[k] });
  });

  return { assessment, failures, passCount, failCount: failures.length };
}
