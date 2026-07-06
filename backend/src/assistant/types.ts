/**
 * ORION AI Assistant domain model (Phase 10).
 *
 * The Assistant is the EXISTING Phase 5 Mission Copilot upgraded into a full
 * conversational, agentic, read-only assistant. It reuses the Copilot
 * conversation store, tool registry/executor, validators, deterministic
 * fallback, LlmRunner, provider architecture, active embedding-space retrieval,
 * and the Planner/Critic services — it does NOT duplicate them.
 *
 * Execution modes accurately represent real runtime behavior. There is no
 * ambiguous "AI"/"SMART_AI"/"GENAI_SUCCESS" label. Deterministic-fallback output
 * is never labeled real; LocalHash embedding retrieval is never labeled real
 * semantic execution; mock execution is never labeled live verification.
 */
import type { Role } from '../auth/users.js';

// --- Execution + status ----------------------------------------------------

/** Honest runtime execution mode of an assistant turn. */
export type AssistantExecutionMode = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';

/** Fine-grained lifecycle status for an execution. */
export type AssistantExecutionStatus =
  | 'ACCEPTED'
  | 'REAL_REJECTED'
  | 'DETERMINISTIC'
  | 'INSUFFICIENT_EVIDENCE'
  | 'REFUSED'
  | 'FAILED';

export type AssistantMessageRole = 'user' | 'assistant';

// --- Intent + capability ---------------------------------------------------

/** Allowlisted assistant intents. Unknown intent fails closed (UNSUPPORTED). */
export type AssistantIntent =
  // Conversational / meta (answered directly — NEVER routed to retrieval):
  | 'GREETING'
  | 'THANKS'
  | 'CAPABILITIES'
  | 'OUT_OF_SCOPE'
  | 'CLARIFICATION_NEEDED'
  | 'SATELLITE_LOOKUP'
  | 'TELEMETRY_COMPARISON'
  // Structured + knowledge:
  | 'MISSION_QA'
  | 'SATELLITE_STATUS'
  | 'TELEMETRY_ANALYSIS'
  | 'ALERT_ANALYSIS'
  | 'INVESTIGATION_EXPLANATION'
  | 'EVIDENCE_EXPLANATION'
  | 'REPORT_EXPLANATION'
  | 'MISSION_KNOWLEDGE_SEARCH'
  | 'HISTORICAL_INCIDENT_SEARCH'
  | 'SIMILAR_INCIDENT_ANALYSIS'
  | 'PLANNER_ANALYSIS'
  | 'CRITIC_REVIEW'
  | 'VALIDATED_INVESTIGATION_ANALYSIS'
  | 'SOURCE_INSPECTION'
  | 'FOLLOW_UP'
  | 'PROHIBITED'
  | 'UNSUPPORTED';

/** Allowlisted assistant capability identifiers (a subset of intents that map to a plan). */
export type AssistantCapabilityId =
  | 'MISSION_QA'
  | 'SATELLITE_STATUS'
  | 'TELEMETRY_ANALYSIS'
  | 'TELEMETRY_COMPARISON'
  | 'ALERT_ANALYSIS'
  | 'INVESTIGATION_EXPLANATION'
  | 'EVIDENCE_EXPLANATION'
  | 'REPORT_EXPLANATION'
  | 'MISSION_KNOWLEDGE_SEARCH'
  | 'HISTORICAL_INCIDENT_SEARCH'
  | 'SIMILAR_INCIDENT_ANALYSIS'
  | 'PLANNER_ANALYSIS'
  | 'CRITIC_REVIEW'
  | 'VALIDATED_INVESTIGATION_ANALYSIS'
  | 'SOURCE_INSPECTION';

export type AssistantOutputType = 'TEXT' | 'STATUS_CARD' | 'ANALYSIS_CARD' | 'SOURCE_CARD' | 'LIST';

/** A capability's fixed, bounded contract (allowlisted, fail-closed). */
export interface AssistantCapability {
  readonly id: AssistantCapabilityId;
  readonly description: string;
  /** Tool names this capability may use (must be a subset of the assistant registry). */
  readonly tools: string[];
  /** Workflow names this capability may invoke (planner/critic/validated). */
  readonly workflows: string[];
  readonly retrievalRequired: boolean;
  readonly deterministicRcaRequired: boolean;
  /** RBAC required to run this capability; omitted = any authenticated role. */
  readonly requiredRoles?: Role[];
  readonly maxToolCalls: number;
  readonly maxRetrievalCalls: number;
  readonly timeoutMs: number;
  readonly outputType: AssistantOutputType;
  readonly groundingRequired: boolean;
}

// --- Tool + workflow references --------------------------------------------

export interface AssistantToolCall {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface AssistantToolResult {
  toolCallId: string;
  toolName: string;
  status: 'SUCCESS' | 'REJECTED' | 'ERROR';
  validationStatus: string;
  summary: string;
  latencyMs: number;
}

export interface AssistantWorkflowInvocation {
  workflow: 'PLANNER' | 'CRITIC' | 'VALIDATED_ANALYSIS';
  investigationId?: number | null;
  plannerExecutionId?: number | null;
  criticExecutionId?: number | null;
}

export interface AssistantWorkflowResult {
  workflow: 'PLANNER' | 'CRITIC' | 'VALIDATED_ANALYSIS';
  status: 'SUCCESS' | 'FAILED';
  executionMode: string;
  investigationId: number | null;
  plannerExecutionId: number | null;
  criticExecutionId: number | null;
  /** Advisory only; analysis-quality review — NEVER a mission decision. */
  advisoryLabel: string;
  criticDecision?: 'ACCEPT' | 'REVISE' | 'REJECT' | null;
  humanReviewRequired: boolean;
  summary: string;
}

// --- Sources / citations / evidence ----------------------------------------

export interface AssistantCitation {
  citationId: string;
  documentId: number;
  title: string;
}

export interface AssistantEvidenceReference {
  evidenceId: string;
  investigationId?: number | null;
}

/** Exact source inspection payload (no vectors, no filesystem paths, no secrets). */
export interface AssistantSourceReference {
  citationId: string;
  documentId: number;
  documentTitle: string;
  documentStableId: string | null;
  documentVersion: string | null;
  sourceType: string | null;
  provenanceOrigin: string | null;
  ingestedBy: string | null;
  ingestedAt: string | null;
  chunkIndex: number | null;
  excerpt: string;
  embeddingSpaceKey: string | null;
  embeddingProvider: string | null;
  embeddingModel: string | null;
}

// --- Structured answer -----------------------------------------------------

export interface AssistantClaim {
  claim: string;
  citation_ids: string[];
  evidence_ids: string[];
}

export interface AssistantAnswerSection {
  heading: string;
  body: string;
}

/** Allowlisted rich-content card kinds. Rendered from validated structured data only. */
export type AssistantRichContentType =
  | 'SATELLITE_STATUS_CARD'
  | 'TELEMETRY_SUMMARY'
  | 'TELEMETRY_CHART'
  | 'ALERT_SUMMARY'
  | 'INVESTIGATION_SUMMARY'
  | 'EVIDENCE_LIST'
  | 'REPORT_SUMMARY'
  | 'KNOWLEDGE_SOURCE_LIST'
  | 'HISTORICAL_INCIDENT_LIST'
  | 'PLANNER_ANALYSIS_CARD'
  | 'CRITIC_REVIEW_CARD'
  | 'VALIDATED_ANALYSIS_CARD'
  | 'LIMITATIONS_CARD';

export interface AssistantRichContent {
  type: AssistantRichContentType;
  /** Bounded, sanitized, structured data — never raw payloads/vectors/secrets. */
  data: Record<string, unknown>;
}

export interface AssistantSuggestedFollowUp {
  label: string;
}

/** The strict structured answer produced by the real provider OR deterministic planner. */
export interface AssistantAnswer {
  answer_version: string;
  title: string;
  summary: string;
  sections: AssistantAnswerSection[];
  claims: AssistantClaim[];
  citations: string[];
  evidence_ids: string[];
  workflow_references: string[];
  limitations: string[];
  suggested_followups: string[];
  rich_content: AssistantRichContent[];
}

// --- Context resolution + memory -------------------------------------------

/** Active entity state carried across turns (bounded, per-conversation). */
export interface AssistantConversationContext {
  satelliteId: string | null;
  investigationId: number | null;
  reportId: number | null;
  plannerExecutionId: number | null;
  criticExecutionId: number | null;
  /** Ordered citation IDs surfaced in the previous assistant turn (for "the second citation"). */
  citationIds: string[];
  evidenceIds: string[];
  topic: string | null;
  lastCapability: AssistantCapabilityId | null;
  lastExecutionMode: AssistantExecutionMode | null;
}

export interface AssistantContextResolution {
  resolved: AssistantConversationContext;
  /** Which fields were resolved from a reference vs. explicitly present in the message. */
  resolvedFromReference: string[];
  /** IDs that were rejected because they were fabricated / stale / out-of-context. */
  rejected: { field: string; value: string; reason: string }[];
  /** A specific citation to inspect this turn (explicit id or resolved ordinal), if any. */
  inspectCitationId: string | null;
}

export interface AssistantContextSummary {
  summary: string;
  source: 'DETERMINISTIC' | 'REAL_PROVIDER';
  messageCountSummarized: number;
}

// --- Diagnostics + result --------------------------------------------------

export interface AssistantDiagnostics {
  intent: AssistantIntent;
  capability: AssistantCapabilityId | null;
  iterationCount: number;
  toolCallCount: number;
  retrievalCallCount: number;
  workflowCallCount: number;
  claimCount: number;
  supportedClaimCount: number;
  citationCount: number;
  evidenceCount: number;
  groundingValid: boolean;
  policyValid: boolean;
  /** Lexical support ratio — a grounding signal, NOT confidence. */
  averageGroundingSupport: number | null;
  contextResolved: boolean;
  terminationReason: string;
  qualityGate: string;
}

export interface AssistantExecutionResult {
  conversationId: string;
  messageId: number | null;
  correlationId: string;
  executionMode: AssistantExecutionMode;
  status: AssistantExecutionStatus;
  provider: string | null;
  model: string | null;
  answer: AssistantAnswer;
  citations: AssistantCitation[];
  evidenceIds: string[];
  workflowResults: AssistantWorkflowResult[];
  toolActivity: AssistantToolResult[];
  richContent: AssistantRichContent[];
  suggestedFollowups: string[];
  context: AssistantConversationContext;
  diagnostics: AssistantDiagnostics;
  disclaimer: string;
}

// --- Feedback --------------------------------------------------------------

export type AssistantFeedbackRating = 'THUMBS_UP' | 'THUMBS_DOWN';
export type AssistantFeedbackReason =
  | 'HELPFUL' | 'CORRECT' | 'WELL_GROUNDED' | 'CLEAR'
  | 'INCORRECT' | 'UNSUPPORTED' | 'MISSING_CONTEXT' | 'BAD_CITATION' | 'TOO_VERBOSE' | 'OTHER';

export interface AssistantFeedback {
  id: number;
  userId: string;
  conversationId: string;
  messageId: number;
  executionId: number | null;
  rating: AssistantFeedbackRating;
  reason: AssistantFeedbackReason | null;
  comment: string | null;
  createdAt: string;
}

// --- Streaming events ------------------------------------------------------

export type AssistantEventType =
  | 'ASSISTANT_STARTED'
  | 'CONTEXT_RESOLVED'
  | 'INTENT_CLASSIFIED'
  | 'TOOL_STARTED'
  | 'TOOL_COMPLETED'
  | 'RETRIEVAL_STARTED'
  | 'RETRIEVAL_COMPLETED'
  | 'PLANNER_STARTED'
  | 'PLANNER_COMPLETED'
  | 'CRITIC_STARTED'
  | 'CRITIC_COMPLETED'
  | 'VALIDATING_ANSWER'
  | 'ANSWER_READY'
  | 'FAILED';

export interface AssistantEvent {
  type: AssistantEventType;
  /** Bounded, sanitized detail — never raw prompts/responses/payloads/vectors/reasoning. */
  detail?: string;
  seq: number;
}

/** Sink for staged execution events (SSE stream or in-memory capture). */
export type AssistantEventSink = (event: Omit<AssistantEvent, 'seq'>) => void;
