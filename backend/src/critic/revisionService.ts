/**
 * Bounded, deterministic RevisionService (Phase 7).
 *
 * SEPARATE from the Critic — the Critic never mutates the analysis directly.
 * Given a CriticReview, this produces a revised PlannerAnalysis candidate using
 * ONLY safe, deterministic transforms:
 *   - remove unsupported / contradicting findings;
 *   - strip invalid citation / evidence associations;
 *   - soften overstated language;
 *   - add missing limitations / knowledge gaps / explicit uncertainty.
 *
 * It NEVER invents facts, citations, or evidence IDs; NEVER changes the
 * authoritative RCA or deterministic confidence; NEVER produces operational
 * commands or write actions. The authoritative root cause is preserved EXACTLY.
 * The candidate must still pass the full validation pipeline before re-review.
 */
import type { CriticContext, CriticReview } from './types.js';
import type { PlannerAnalysis, PlannerFinding } from '../planner/types.js';

const SOFTEN: [RegExp, string][] = [
  [/\b(definitely|certainly|undoubtedly|absolutely|conclusively|beyond doubt)\b/gi, 'likely'],
  [/\bwithout a doubt\b/gi, 'likely'],
  [/\b(guaranteed|guarantee)\b/gi, 'suggested'],
  [/\b(proves|proven)\b/gi, 'indicates'],
  [/\b100%\b/gi, 'a high proportion of'],
  [/\balways\b/gi, 'often'],
  [/\bnever fails\b/gi, 'rarely fails'],
];

function soften(text: string): string {
  let out = text;
  for (const [re, rep] of SOFTEN) out = out.replace(re, rep);
  return out;
}

function clone(a: PlannerAnalysis): PlannerAnalysis {
  return JSON.parse(JSON.stringify(a)) as PlannerAnalysis;
}

export function reviseAnalysis(analysis: PlannerAnalysis, review: CriticReview, ctx: CriticContext): PlannerAnalysis {
  const a = clone(analysis);

  // Preserve the authoritative RCA EXACTLY (force to the deterministic value).
  a.authoritative_root_cause = ctx.authoritativeRootCause;

  const removeIndices = new Set<number>();
  const stripCitations = new Set<string>();
  const stripEvidence = new Set<string>();
  let addLimitation = false;
  let addKnowledgeGap = false;
  let softenOverstatement = false;

  for (const issue of review.issues) {
    switch (issue.category) {
      case 'UNSUPPORTED_CLAIM':
      case 'GROUNDING':
      case 'CONTRADICTION':
        if (issue.claim_index !== null) removeIndices.add(issue.claim_index);
        break;
      case 'CITATION':
        for (const c of issue.citation_ids) stripCitations.add(c);
        break;
      case 'EVIDENCE':
        for (const e of issue.evidence_ids) stripEvidence.add(e);
        break;
      case 'OVERSTATEMENT':
        softenOverstatement = true;
        break;
      case 'LIMITATION':
      case 'COVERAGE':
      case 'TELEMETRY_COVERAGE':
      case 'ALERT_COVERAGE':
      case 'KNOWLEDGE_COVERAGE':
      case 'HISTORICAL_COVERAGE':
        addLimitation = true;
        break;
      case 'KNOWLEDGE_GAP':
        addKnowledgeGap = true;
        break;
      default:
        break; // RCA_CONSISTENCY / FABRICATED_ID / POLICY are unfixable → not handled here
    }
  }

  // 1. Strip invalid citation/evidence associations.
  for (const f of a.findings) {
    if (stripCitations.size) f.citation_ids = f.citation_ids.filter((c) => !stripCitations.has(c));
    if (stripEvidence.size) f.evidence_ids = f.evidence_ids.filter((e) => !stripEvidence.has(e));
  }

  // 2. Remove flagged findings; also drop findings left ungrounded after stripping
  //    (no citation, no evidence, and not a deterministic tool-fact claim).
  a.findings = a.findings.filter((f, i) => {
    if (removeIndices.has(i)) return false;
    const grounded = f.citation_ids.length > 0 || f.evidence_ids.length > 0 || f.source_types.includes('TOOL_FACT');
    return grounded;
  });

  // Guarantee the analysis retains an authoritative, grounded root-cause finding.
  if (!a.findings.some((f) => f.source_types.includes('TOOL_FACT'))) {
    const rcLabel = ctx.authoritativeRootCause.replace(/_/g, ' ').toLowerCase();
    const rootFinding: PlannerFinding = { claim: `The authoritative deterministic root cause for investigation ${ctx.investigationId} on ${ctx.satelliteId} is ${rcLabel}.`, source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] };
    a.findings.unshift(rootFinding);
  }

  // 3. Soften overstatement in summary + findings.
  if (softenOverstatement) {
    a.analysis_summary = soften(a.analysis_summary);
    for (const f of a.findings) f.claim = soften(f.claim);
  }

  // 4. Add missing limitations (deterministic, no fabricated IDs).
  if (addLimitation) {
    const note = 'Coverage note: some source categories were reviewed and are represented as available/absent for human review; this is an advisory limitation, not a new finding.';
    if (!a.limitations.includes(note)) a.limitations.push(note);
    const base = 'Analysis assistance only — advisory and read-only. The deterministic root-cause analysis remains authoritative.';
    if (!a.limitations.some((l) => l.includes('advisory and read-only'))) a.limitations.push(base);
  }

  // 5. Add missing knowledge gaps (from the deterministic Planner gaps only — never invented).
  if (addKnowledgeGap) {
    const gaps = ctx.plannerKnowledgeGaps.length ? ctx.plannerKnowledgeGaps : ['Additional grounded context may strengthen this analysis; treat conclusions as advisory pending human review.'];
    for (const g of gaps) if (!a.knowledge_gaps.includes(g)) a.knowledge_gaps.push(g);
  }

  // 6. Always add an explicit uncertainty limitation if revisions occurred.
  const uncertainty = 'Revised by the bounded Critic reflection loop; conclusions are advisory and require human review. Grounding/coverage checks are lexical and are not RCA confidence.';
  if ((addLimitation || addKnowledgeGap || softenOverstatement || removeIndices.size || stripCitations.size || stripEvidence.size) && !a.limitations.includes(uncertainty)) {
    a.limitations.push(uncertainty);
  }

  return a;
}
