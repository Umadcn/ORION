/**
 * ORION AI Assistant capability catalog (Phase 10).
 *
 * A fixed, allowlisted catalog. Each capability declares the tools/workflows it
 * may use, whether retrieval / deterministic RCA / grounding are required, RBAC,
 * and bounded call/timeout budgets. Unknown capabilities fail closed. The router
 * may only select a capability from this catalog; user input can NEVER inject an
 * arbitrary capability, tool, or workflow name.
 */
import { config } from '../config.js';
import type { AssistantCapability, AssistantCapabilityId, AssistantIntent } from './types.js';

/** Build the catalog from bounded config (so limits stay within global budgets). */
function catalog(): Record<AssistantCapabilityId, AssistantCapability> {
  const a = config.assistant;
  const T = a.toolTimeoutMs; // not used directly here; per-capability timeout below
  void T;
  const cap = (
    id: AssistantCapabilityId,
    description: string,
    o: Partial<AssistantCapability>,
  ): AssistantCapability => ({
    id,
    description,
    tools: o.tools ?? [],
    workflows: o.workflows ?? [],
    retrievalRequired: o.retrievalRequired ?? false,
    deterministicRcaRequired: o.deterministicRcaRequired ?? false,
    requiredRoles: o.requiredRoles,
    maxToolCalls: Math.min(o.maxToolCalls ?? a.maxToolCalls, a.maxToolCalls),
    maxRetrievalCalls: Math.min(o.maxRetrievalCalls ?? a.maxRetrievalCalls, a.maxRetrievalCalls),
    timeoutMs: Math.min(o.timeoutMs ?? a.maxExecutionMs, a.maxExecutionMs),
    outputType: o.outputType ?? 'TEXT',
    groundingRequired: o.groundingRequired ?? true,
  });

  return {
    MISSION_QA: cap('MISSION_QA', 'Answer a natural mission question using tools + knowledge.', {
      tools: ['getSatellite', 'getInvestigation', 'getEvidence', 'searchMissionKnowledge', 'getAlerts'],
      retrievalRequired: false, outputType: 'TEXT',
    }),
    SATELLITE_STATUS: cap('SATELLITE_STATUS', 'Report a satellite health status.', {
      tools: ['getSatellite', 'getAlerts', 'getTelemetry'], outputType: 'STATUS_CARD', groundingRequired: true,
    }),
    TELEMETRY_ANALYSIS: cap('TELEMETRY_ANALYSIS', 'Summarize latest telemetry for a satellite.', {
      tools: ['getTelemetry', 'getSatellite'], outputType: 'STATUS_CARD',
    }),
    TELEMETRY_COMPARISON: cap('TELEMETRY_COMPARISON', 'Compare latest telemetry across two satellites.', {
      tools: ['getTelemetry', 'getSatellite'], maxToolCalls: 4, outputType: 'STATUS_CARD',
    }),
    ALERT_ANALYSIS: cap('ALERT_ANALYSIS', 'Summarize alerts, optionally scoped to a satellite.', {
      tools: ['getAlerts', 'getSatellite'], outputType: 'LIST',
    }),
    INVESTIGATION_EXPLANATION: cap('INVESTIGATION_EXPLANATION', 'Explain an investigation root cause (RCA is authoritative).', {
      tools: ['getInvestigation', 'getEvidence', 'searchMissionKnowledge'], deterministicRcaRequired: true, outputType: 'ANALYSIS_CARD',
    }),
    EVIDENCE_EXPLANATION: cap('EVIDENCE_EXPLANATION', 'Explain the evidence supporting a root cause.', {
      tools: ['getInvestigation', 'getEvidence'], outputType: 'LIST',
    }),
    REPORT_EXPLANATION: cap('REPORT_EXPLANATION', 'Explain a mission report.', {
      tools: ['getReport'], outputType: 'ANALYSIS_CARD',
    }),
    MISSION_KNOWLEDGE_SEARCH: cap('MISSION_KNOWLEDGE_SEARCH', 'Search the offline mission knowledge base.', {
      tools: ['searchMissionKnowledge'], retrievalRequired: true, outputType: 'LIST',
    }),
    HISTORICAL_INCIDENT_SEARCH: cap('HISTORICAL_INCIDENT_SEARCH', 'Search historical investigations.', {
      tools: ['searchHistoricalInvestigations'], outputType: 'LIST',
    }),
    SIMILAR_INCIDENT_ANALYSIS: cap('SIMILAR_INCIDENT_ANALYSIS', 'Find and analyze similar historical incidents.', {
      tools: ['searchHistoricalInvestigations', 'getInvestigation', 'searchMissionKnowledge'], outputType: 'LIST',
    }),
    PLANNER_ANALYSIS: cap('PLANNER_ANALYSIS', 'Run an advisory Planner analysis for an investigation (read-only).', {
      tools: ['getInvestigation'], workflows: ['runPlannerAnalysis'], deterministicRcaRequired: true, outputType: 'ANALYSIS_CARD',
    }),
    CRITIC_REVIEW: cap('CRITIC_REVIEW', 'Run an advisory Critic review of a Planner analysis (read-only).', {
      workflows: ['runCriticReview'], outputType: 'ANALYSIS_CARD',
    }),
    VALIDATED_INVESTIGATION_ANALYSIS: cap('VALIDATED_INVESTIGATION_ANALYSIS', 'Run a validated Planner → Critic analysis (read-only, advisory).', {
      tools: ['getInvestigation'], workflows: ['runValidatedInvestigationAnalysis'], deterministicRcaRequired: true, outputType: 'ANALYSIS_CARD',
    }),
    SOURCE_INSPECTION: cap('SOURCE_INSPECTION', 'Inspect the exact source behind a citation.', {
      tools: ['resolveCitation', 'getKnowledgeDocumentMetadata'], groundingRequired: false, outputType: 'SOURCE_CARD',
    }),
  };
}

let CATALOG: Record<AssistantCapabilityId, AssistantCapability> | null = null;
function getCatalog(): Record<AssistantCapabilityId, AssistantCapability> {
  if (!CATALOG) CATALOG = catalog();
  return CATALOG;
}

/** Reset the memoized catalog (tests that mutate config). */
export function resetCapabilityCatalog(): void {
  CATALOG = null;
}

/** Resolve an allowlisted capability, or undefined (fail-closed) for unknown ids. */
export function getCapability(id: string): AssistantCapability | undefined {
  return (getCatalog() as Record<string, AssistantCapability>)[id];
}

export function listCapabilities(): AssistantCapability[] {
  return Object.values(getCatalog());
}

/** Map a resolved intent to its capability id (or null for control/meta intents). */
export function capabilityForIntent(intent: AssistantIntent): AssistantCapabilityId | null {
  switch (intent) {
    // Conversational / meta / lookup intents are handled directly by the service
    // (they never enter the capability executor and never touch retrieval).
    case 'GREETING':
    case 'THANKS':
    case 'CAPABILITIES':
    case 'OUT_OF_SCOPE':
    case 'CLARIFICATION_NEEDED':
    case 'SATELLITE_LOOKUP':
    case 'FOLLOW_UP':
    case 'PROHIBITED':
    case 'UNSUPPORTED':
      return null;
    default:
      return intent as AssistantCapabilityId;
  }
}
