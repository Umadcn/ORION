/**
 * PlannerAnalysis grounding/policy validation (Phase 6). Reuses the Phase 5
 * copilot validators by mapping analysis findings onto the shared grounded-claim
 * model (citation / evidence / tool-fact). Also enforces that the authoritative
 * root cause is preserved exactly. No score is labeled confidence.
 */
import { validateCopilotAnswer } from '../copilot/copilotValidators.js';
import type { CopilotFinalAnswer, CopilotGroundingContext } from '../copilot/types.js';
import type { PlannerAnalysis } from './types.js';

export interface PlannerValidation {
  citationValid: boolean;
  evidenceValid: boolean;
  groundingValid: boolean;
  policyValid: boolean;
  rootCauseMatches: boolean;
  averageSupport: number | null;
  supportedClaimCount: number;
  claimCount: number;
}

/** Map a PlannerAnalysis to the shared copilot answer shape for validation. */
function toCopilotAnswer(a: PlannerAnalysis): CopilotFinalAnswer {
  return {
    type: 'FINAL_ANSWER',
    answer: a.analysis_summary,
    claims: a.findings.map((f) => ({ claim: f.claim, citation_ids: f.citation_ids, evidence_ids: f.evidence_ids })),
    citations: Array.from(new Set(a.findings.flatMap((f) => f.citation_ids))),
    evidence_ids: Array.from(new Set(a.findings.flatMap((f) => f.evidence_ids))),
    limitations: a.limitations,
    suggested_followups: [],
  };
}

export function validateAnalysis(a: PlannerAnalysis, ctx: CopilotGroundingContext, authoritativeRootCause: string): PlannerValidation {
  const v = validateCopilotAnswer(toCopilotAnswer(a), ctx);
  const rootCauseMatches = a.authoritative_root_cause === authoritativeRootCause;
  return {
    citationValid: v.citationValid,
    evidenceValid: v.evidenceValid,
    groundingValid: v.groundingValid && rootCauseMatches,
    policyValid: v.policyValid,
    rootCauseMatches,
    averageSupport: v.averageSupport,
    supportedClaimCount: v.supportedClaimCount,
    claimCount: v.claims.length,
  };
}
