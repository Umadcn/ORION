/**
 * Deterministic PlannerAnalysis builder (Phase 6). Composes a grounded, read-only
 * investigation analysis from executed observations. The authoritative
 * deterministic root cause is preserved EXACTLY. Findings are grounded via
 * tool-facts, deterministic evidence, and resolvable mission-knowledge citations.
 * No operational commands, no decisions, no mutation, no invented IDs.
 */
import { PLAN_VERSION } from './prompt.js';
import type { PlannerContext } from './plannerContext.js';
import type { ExecutorObservations } from './planExecutor.js';
import type { KnowledgeGap, PlannerAnalysis, PlannerFinding } from './types.js';

function excerpt(text: string, n: number): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : flat.slice(0, n).replace(/\s\S*$/, '');
}

export function buildPlannerAnalysis(ctx: PlannerContext, obs: ExecutorObservations, gaps: KnowledgeGap[]): PlannerAnalysis {
  const invId = ctx.investigation.id;
  const satId = ctx.investigation.satellite_id;
  const rc = ctx.investigation.root_cause ?? 'UNKNOWN_ANOMALY';
  const rcLabel = rc.replace(/_/g, ' ').toLowerCase();

  const findings: PlannerFinding[] = [];
  // Root-cause finding (tool-fact grounded from getInvestigation).
  findings.push({ claim: `The authoritative deterministic root cause for investigation ${invId} on ${satId} is ${rcLabel}.`, source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] });
  // Evidence findings (evidence-grounded).
  const supporting = obs.evidence.filter((e) => e.supports_root_cause).slice(0, 3);
  for (const e of (supporting.length ? supporting : obs.evidence.slice(0, 3))) {
    findings.push({ claim: excerpt(e.summary, 160), source_types: ['EVIDENCE'], citation_ids: [], evidence_ids: [e.evidence_id] });
  }
  // Mission-knowledge findings (citation-grounded via chunk excerpt).
  for (const k of obs.knowledge.slice(0, 2)) {
    findings.push({ claim: excerpt(k.text, 180), source_types: ['MISSION_KNOWLEDGE'], citation_ids: [k.citation_id], evidence_ids: [] });
  }
  // Historical finding (tool-fact grounded).
  if (obs.historical.length > 0) {
    const h = obs.historical[0];
    findings.push({ claim: `A similar past incident is investigation ${h.investigation_id}, attributed to ${(h.root_cause ?? '').replace(/_/g, ' ').toLowerCase()}.`, source_types: ['TOOL_FACT'], citation_ids: [], evidence_ids: [] });
  }

  const recommended = ((obs.investigation?.recommended_review_actions as { action: string }[] | undefined) ?? [])
    .slice(0, 4)
    .map((a) => `For human review: ${a.action}`);

  const unmetGaps = gaps.filter((g) => !g.sufficient);
  const knowledge_gaps = unmetGaps.length ? Array.from(new Set(unmetGaps.map((g) => g.description))) : [];

  return {
    title: `Investigation Analysis: ${satId} — ${rcLabel}`,
    objective: `Read-only analysis of investigation ${invId} on ${satId}.`,
    authoritative_root_cause: rc,
    analysis_summary: `${satId} is associated with ${rcLabel} (investigation ${invId}). This advisory analysis summarizes the authoritative deterministic findings, supporting evidence, and relevant mission knowledge for human review; it does not change the root-cause analysis.`,
    findings,
    knowledge_gaps,
    recommended_review_items: recommended,
    limitations: [
      'Analysis assistance only — advisory and read-only. The deterministic root-cause analysis remains authoritative.',
      `Generated offline in deterministic mode (${PLAN_VERSION}); grounding support is lexical and is not a confidence score.`,
    ],
  };
}
