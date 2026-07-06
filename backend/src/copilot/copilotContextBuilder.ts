/**
 * Copilot grounding-context assembly (Phase 5).
 *
 * Accumulates the trusted grounding surface from executed tool results:
 * resolvable citations (with text) from knowledge search, evidence IDs from
 * evidence/investigation lookups, and the set of KNOWN deterministic IDs
 * (satellites, investigations, reports, alerts) used to detect fabrication.
 */
import { db } from '../db.js';
import { tokenize } from '../retrieval/tokenize.js';
import type { CopilotGroundingContext, ToolExecutionResult } from './types.js';

export function createGroundingContext(): CopilotGroundingContext {
  const sats = (db.prepare('SELECT id FROM satellites').all() as { id: string }[]).map((r) => r.id.toUpperCase());
  const invs = (db.prepare('SELECT id FROM investigations').all() as { id: number }[]).map((r) => r.id);
  const reports = (db.prepare('SELECT id FROM reports').all() as { id: number }[]).map((r) => r.id);
  const alerts = (db.prepare('SELECT id FROM alerts').all() as { id: number }[]).map((r) => r.id);
  return {
    citationText: new Map(),
    allowedCitationIds: new Set(),
    toolFactTokens: new Set(),
    allowedEvidenceIds: new Set(),
    accessedInvestigationIds: new Set(),
    knownSatelliteIds: new Set(sats),
    knownInvestigationIds: new Set(invs),
    knownReportIds: new Set(reports),
    knownAlertIds: new Set(alerts),
  };
}

/** Fold a successful tool result into the grounding context. */
export function accumulate(ctx: CopilotGroundingContext, result: ToolExecutionResult): void {
  if (result.status !== 'SUCCESS') return;

  // Tool-output tokens ground deterministic tool-fact claims (e.g. telemetry).
  for (const t of tokenize(result.outputSummary, { maxTokens: 4096 })) {
    ctx.toolFactTokens.add(t);
    for (const p of t.split(/[-_]/).filter(Boolean)) ctx.toolFactTokens.add(p);
  }

  // Citations surfaced by knowledge search.
  for (const c of result.citations ?? []) {
    ctx.allowedCitationIds.add(c.citationId);
    ctx.citationText.set(c.citationId, c.text);
  }

  const out = result.output as Record<string, unknown> | null;
  if (!out) return;

  if (result.toolName === 'getEvidence' && Array.isArray(out.evidence)) {
    const invId = Math.floor(Number(out.investigationId));
    if (Number.isFinite(invId)) ctx.accessedInvestigationIds.add(invId);
    for (const e of out.evidence as { evidence_id?: string }[]) {
      if (e && typeof e.evidence_id === 'string') ctx.allowedEvidenceIds.add(e.evidence_id);
    }
  }
  if (result.toolName === 'getInvestigation' && out.found === true && typeof out.id === 'number') {
    ctx.accessedInvestigationIds.add(out.id);
  }
}
