/**
 * Deterministic, offline Critic (Phase 7). No network, no LLM judge.
 *
 * Independently evaluates a Planner analysis: RCA preservation, citation/evidence
 * validity, claim grounding, source coverage, contradictions, fabricated IDs,
 * policy violations, overstatement, and missing limitations/knowledge gaps. It
 * produces a strict, schema-valid CriticReview and derives a decision by a fixed,
 * documented precedence. Output is labeled DETERMINISTIC_FALLBACK by the service.
 *
 * Decision precedence (also enforced by criticValidators):
 *   1. Any CRITICAL issue (RCA mismatch, fabricated ID, policy violation,
 *      action-executed contradiction) → REJECT (unfixable).
 *   2. Else any ERROR or actionable WARNING (unsupported/contradiction/coverage/
 *      overstatement/missing limitation or knowledge gap) → REVISE.
 *   3. Else → ACCEPT.
 */
import { config } from '../config.js';
import { validateCopilotAnswer } from '../copilot/copilotValidators.js';
import type { CopilotGroundingContext } from '../copilot/types.js';
import { CRITIC_VERSION } from './prompt.js';
import { evaluateCoverage } from './coverageEvaluator.js';
import { detectContradictions } from './contradictionDetector.js';
import { analysisToAnswer, OVERSTATEMENT_RE } from './criticGrounding.js';
import type {
  ContradictionFinding, CoverageResult, CriticContext, CriticDecision, CriticReview,
  CritiqueIssue, CritiqueSeverity, RevisionInstruction, RevisionTarget,
} from './types.js';

export interface DeterministicCriticOutput {
  review: CriticReview;
  coverage: CoverageResult;
  contradictions: ContradictionFinding[];
  averageGroundingSupport: number | null;
}

function bounded(s: string, n = 400): string {
  const flat = (s ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}

/** Categories the deterministic RevisionService can safely address. */
const FIXABLE = new Set([
  'UNSUPPORTED_CLAIM', 'GROUNDING', 'CITATION', 'EVIDENCE', 'OVERSTATEMENT',
  'LIMITATION', 'KNOWLEDGE_GAP', 'COVERAGE', 'TELEMETRY_COVERAGE', 'ALERT_COVERAGE',
  'KNOWLEDGE_COVERAGE', 'HISTORICAL_COVERAGE', 'CONTRADICTION',
]);

export function deterministicCritic(ctx: CriticContext, grounding: CopilotGroundingContext): DeterministicCriticOutput {
  const a = ctx.analysis;
  const coverage = evaluateCoverage(ctx);
  const contradictions = detectContradictions(ctx);
  const cop = validateCopilotAnswer(analysisToAnswer(a), grounding);

  const raw: Omit<CritiqueIssue, 'issue_id'>[] = [];

  // Contradictions (includes RCA mismatch, fabricated IDs, action-executed, numeric).
  for (const c of contradictions) {
    raw.push({ severity: c.severity, category: c.category, description: bounded(c.description), claim_index: c.claimIndex, citation_ids: [], evidence_ids: [], recommended_correction: c.category === 'RCA_CONSISTENCY' ? 'Restore the authoritative deterministic root cause exactly.' : 'Remove or correct the contradicting claim.' });
  }

  // Ungrounded / unsupported claims.
  cop.claims.forEach((claim, i) => {
    if (!claim.supported) raw.push({ severity: 'ERROR', category: 'UNSUPPORTED_CLAIM', description: bounded(`Finding ${i} is not grounded (${claim.reason ?? 'no grounding'}).`), claim_index: i, citation_ids: a.findings[i]?.citation_ids ?? [], evidence_ids: a.findings[i]?.evidence_ids ?? [], recommended_correction: 'Remove the finding or ground it in a valid citation/evidence item.' });
  });

  // Invalid citation / evidence IDs.
  for (const id of cop.invalidCitationIds) raw.push({ severity: 'ERROR', category: 'CITATION', description: bounded(`Citation ${id} is not resolvable / not in review context.`), claim_index: null, citation_ids: [id], evidence_ids: [], recommended_correction: 'Remove the invalid citation association.' });
  for (const id of cop.invalidEvidenceIds) raw.push({ severity: 'ERROR', category: 'EVIDENCE', description: bounded(`Evidence ${id} does not belong to the investigation context.`), claim_index: null, citation_ids: [], evidence_ids: [id], recommended_correction: 'Remove the invalid evidence association.' });

  // Policy violations from grounding validator (dedup against contradictions later).
  for (const v of cop.policyViolations) {
    const category = v.code.startsWith('FABRICATED') ? 'FABRICATED_ID' : 'POLICY';
    raw.push({ severity: 'CRITICAL', category, description: bounded(`Policy violation (${v.code}).`), claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: 'Remove the offending text; the analysis must be advisory and read-only.' });
  }

  // Overstatement.
  const textParts = [a.analysis_summary, ...a.findings.map((f) => f.claim)];
  textParts.forEach((t, i) => {
    if (OVERSTATEMENT_RE.test(t)) raw.push({ severity: 'WARNING', category: 'OVERSTATEMENT', description: bounded('Overstated/absolute language for an advisory analysis.'), claim_index: i === 0 ? null : i - 1, citation_ids: [], evidence_ids: [], recommended_correction: 'Use measured, advisory language.' });
  });

  // Coverage failures.
  for (const f of coverage.failures) {
    raw.push({ severity: 'WARNING', category: f.category, description: bounded(f.reason), claim_index: null, citation_ids: [], evidence_ids: [], recommended_correction: coverageCorrection(f.key) });
  }

  // Deduplicate by (category, severity, claim_index, description) and bound count.
  const seen = new Set<string>();
  const issues: CritiqueIssue[] = [];
  for (const r of raw) {
    const key = `${r.category}|${r.severity}|${r.claim_index}|${r.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (issues.length >= config.critic.maxIssues) break;
    issues.push({ ...r, issue_id: `ISSUE-${issues.length + 1}` });
  }

  const criticalCount = issues.filter((i) => i.severity === 'CRITICAL').length;
  const actionable = issues.filter((i) => i.severity === 'ERROR' || i.severity === 'WARNING').length;

  let decision: CriticDecision;
  if (criticalCount > 0) decision = 'REJECT';
  else if (actionable > 0) decision = 'REVISE';
  else decision = 'ACCEPT';

  const revision_instructions: RevisionInstruction[] = decision === 'REVISE' ? buildInstructions(issues) : [];

  const review: CriticReview = {
    review_version: CRITIC_VERSION,
    decision,
    summary: bounded(summarize(decision, issues.length, coverage, contradictions.length)),
    issues,
    coverage: coverage.assessment,
    revision_instructions,
    limitations: [
      'Independent read-only analysis-quality review. ACCEPT is not mission approval; REJECT is not investigation rejection.',
      'Deterministic offline review; grounding/coverage checks are lexical and are not RCA confidence.',
    ],
  };

  return { review, coverage, contradictions, averageGroundingSupport: cop.averageSupport };
}

function coverageCorrection(key: string): string {
  switch (key) {
    case 'limitations': return 'Add an explicit limitations section.';
    case 'knowledge_gaps': return 'Surface the reported knowledge gap(s).';
    case 'deterministic_evidence': return 'Ground at least one finding in deterministic evidence.';
    case 'mission_knowledge': return 'Ground at least one finding in a retrieved citation.';
    default: return 'Reference the source or disclose its status as a limitation.';
  }
}

function buildInstructions(issues: CritiqueIssue[]): RevisionInstruction[] {
  const out: RevisionInstruction[] = [];
  let n = 1;
  const add = (target: RevisionTarget, action: string, reason: string) => out.push({ instruction_id: `REV-${n++}`, target, action, reason: reason.slice(0, 200) });
  for (const i of issues) {
    if (!FIXABLE.has(i.category)) continue;
    if (i.category === 'UNSUPPORTED_CLAIM' || i.category === 'GROUNDING' || i.category === 'CONTRADICTION') add('REMOVE_FINDING', `remove finding ${i.claim_index ?? ''}`.trim(), i.description);
    else if (i.category === 'CITATION') add('STRIP_CITATION', `strip citations ${i.citation_ids.join(',')}`, i.description);
    else if (i.category === 'EVIDENCE') add('STRIP_EVIDENCE', `strip evidence ${i.evidence_ids.join(',')}`, i.description);
    else if (i.category === 'OVERSTATEMENT') add('SOFTEN_OVERSTATEMENT', 'soften overstated language', i.description);
    else if (i.category === 'LIMITATION') add('ADD_LIMITATION', 'add explicit limitation', i.description);
    else if (i.category === 'KNOWLEDGE_GAP') add('ADD_KNOWLEDGE_GAP', 'add knowledge gap', i.description);
    else add('ADD_LIMITATION', 'disclose source coverage as a limitation', i.description);
  }
  return out;
}

function summarize(decision: CriticDecision, issueCount: number, coverage: CoverageResult, contradictionCount: number): string {
  return `Critic decision ${decision}: ${issueCount} issue(s), ${coverage.failCount} coverage gap(s), ${contradictionCount} contradiction(s). Advisory only — requires human review.`;
}

/** Severity ordering helper used by the validator + service. */
export function issueSeverities(review: CriticReview): { criticalCount: number; errorCount: number; warningCount: number; infoCount: number } {
  const s = { criticalCount: 0, errorCount: 0, warningCount: 0, infoCount: 0 };
  for (const i of review.issues) {
    if (i.severity === 'CRITICAL') s.criticalCount++;
    else if (i.severity === 'ERROR') s.errorCount++;
    else if (i.severity === 'WARNING') s.warningCount++;
    else s.infoCount++;
  }
  return s;
}
