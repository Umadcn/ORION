/**
 * ORION AI Assistant multi-turn context resolution (Phase 10).
 *
 * Deterministic resolution of conversational references (satellite/investigation
 * /report/planner/critic ids, previous citations, "the second citation", "it",
 * "that investigation"). Every resolved id is validated against authoritative
 * data; fabricated / stale / out-of-context ids are rejected (never trusted).
 * Cross-user isolation is enforced at the conversation layer.
 */
import { db } from '../db.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import type { AssistantConversationContext, AssistantContextResolution, AssistantIntent } from './types.js';
import type { AssistantEntityRefs } from './intentRouter.js';

function satelliteExists(id: string): boolean {
  return !!db.prepare('SELECT 1 FROM satellites WHERE id = ?').get(id);
}
function investigationExists(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM investigations WHERE id = ?').get(id);
}
function reportExists(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM reports WHERE id = ?').get(id);
}
function plannerExists(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM planner_executions WHERE id = ?').get(id);
}
function criticExists(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM critic_executions WHERE id = ?').get(id);
}
function latestInvestigationForSatellite(satelliteId: string): number | null {
  const row = db.prepare('SELECT id FROM investigations WHERE satellite_id = ? ORDER BY id DESC LIMIT 1').get(satelliteId) as { id: number } | undefined;
  return row ? row.id : null;
}

/**
 * Resolve the effective context for this turn. Fresh, valid ids in the message
 * win; otherwise prior context is carried forward for follow-ups. Invalid ids
 * are rejected and NOT applied.
 */
export function resolveContext(intent: AssistantIntent, entities: AssistantEntityRefs, prior: AssistantConversationContext): AssistantContextResolution {
  const resolved: AssistantConversationContext = { ...prior, citationIds: [...prior.citationIds], evidenceIds: [...prior.evidenceIds] };
  const resolvedFromReference: string[] = [];
  const rejected: { field: string; value: string; reason: string }[] = [];

  // Satellite
  if (entities.satelliteId) {
    if (satelliteExists(entities.satelliteId)) resolved.satelliteId = entities.satelliteId;
    else rejected.push({ field: 'satelliteId', value: entities.satelliteId, reason: 'UNKNOWN_SATELLITE' });
  }

  // Investigation
  if (entities.investigationId !== null) {
    if (investigationExists(entities.investigationId)) resolved.investigationId = entities.investigationId;
    else rejected.push({ field: 'investigationId', value: String(entities.investigationId), reason: 'UNKNOWN_INVESTIGATION' });
  }

  // Report
  if (entities.reportId !== null) {
    if (reportExists(entities.reportId)) resolved.reportId = entities.reportId;
    else rejected.push({ field: 'reportId', value: String(entities.reportId), reason: 'UNKNOWN_REPORT' });
  }

  // Explicit citation id
  let inspectCitationId: string | null = null;
  if (entities.citationId) {
    if (resolveCitation(entities.citationId)) inspectCitationId = entities.citationId;
    else rejected.push({ field: 'citationId', value: entities.citationId, reason: 'UNRESOLVABLE_CITATION' });
  }

  // Citation ordinal ("the second citation") -> prior citation list
  if (entities.citationOrdinal !== null) {
    const idx = entities.citationOrdinal - 1;
    if (idx >= 0 && idx < prior.citationIds.length) {
      inspectCitationId = prior.citationIds[idx];
      resolvedFromReference.push('citationOrdinal');
    } else {
      rejected.push({ field: 'citationOrdinal', value: String(entities.citationOrdinal), reason: 'CITATION_ORDINAL_OUT_OF_RANGE' });
    }
  }

  // Follow-up references keep prior entities.
  if (entities.referencesPrevious) {
    if (prior.satelliteId) resolvedFromReference.push('satelliteId');
    if (prior.investigationId) resolvedFromReference.push('investigationId');
    if (prior.plannerExecutionId) resolvedFromReference.push('plannerExecutionId');
  }

  // Capability-specific derivation: workflows + investigation intents need an
  // investigation. Derive the latest one for the active satellite if absent.
  const needsInvestigation: AssistantIntent[] = ['INVESTIGATION_EXPLANATION', 'EVIDENCE_EXPLANATION', 'PLANNER_ANALYSIS', 'VALIDATED_INVESTIGATION_ANALYSIS'];
  if (needsInvestigation.includes(intent) && resolved.investigationId === null && resolved.satelliteId) {
    const derived = latestInvestigationForSatellite(resolved.satelliteId);
    if (derived !== null) { resolved.investigationId = derived; resolvedFromReference.push('investigationId'); }
  }

  // Critic needs a planner execution; validate the carried-forward one is real.
  if (intent === 'CRITIC_REVIEW' && resolved.plannerExecutionId !== null && !plannerExists(resolved.plannerExecutionId)) {
    rejected.push({ field: 'plannerExecutionId', value: String(resolved.plannerExecutionId), reason: 'STALE_PLANNER_EXECUTION' });
    resolved.plannerExecutionId = null;
  }
  if (resolved.criticExecutionId !== null && !criticExists(resolved.criticExecutionId)) {
    resolved.criticExecutionId = null;
  }

  return { resolved, resolvedFromReference: [...new Set(resolvedFromReference)], rejected, inspectCitationId };
}
