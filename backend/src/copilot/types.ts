/**
 * Mission Copilot domain contracts (Phase 5).
 *
 * READ-ONLY conversational RAG with controlled, allowlisted, read-only tool
 * calling. The deterministic RCA and all Phase 0–4 systems remain authoritative.
 * Grounding support is lexical — NOT confidence. Deterministic fallback output
 * is never labeled as real model output.
 */
import type { JsonSchema } from '../llm/schema.js';
import type { Role } from '../auth/users.js';

export type CopilotExecutionMode = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK';

/** Final outcome badge surfaced to the caller. */
export type CopilotAnswerStatus = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' | 'INSUFFICIENT_EVIDENCE' | 'FAILED';

// --- Controlled tool model -------------------------------------------------

export interface ToolContext {
  userId: string;
  role: Role;
  correlationId: string;
}

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;
  /** Roles allowed to invoke this tool; omitted = any authenticated role. */
  readonly requiredRoles?: Role[];
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
  readonly readOnly: true;
  /** Deterministic, read-only execution over existing services/repositories. */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> | unknown;
  /** Optional: surface citations / retrieval id from this tool's output for grounding. */
  extractGrounding?(output: unknown): { citations?: { citationId: string; text: string; documentId: number; title: string }[]; retrievalExecutionId?: number | null };
}

export interface ToolCall {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

export type ToolExecStatus = 'SUCCESS' | 'REJECTED' | 'ERROR';
export type ToolValidationStatus = 'VALID' | 'UNKNOWN_TOOL' | 'INPUT_INVALID' | 'OUTPUT_INVALID' | 'FORBIDDEN';

export interface ToolExecutionResult {
  toolCallId: string;
  toolName: string;
  toolVersion: string;
  status: ToolExecStatus;
  validationStatus: ToolValidationStatus;
  /** Sanitized, bounded output surfaced to the next reasoning iteration. */
  output: unknown | null;
  outputSummary: string;
  inputSummary: string;
  latencyMs: number;
  errorCode: string | null;
  sanitizedError: string | null;
  /** Citations surfaced by this tool (for grounding), if any. */
  citations?: { citationId: string; text: string; documentId: number; title: string }[];
  /** Retrieval execution id, if this tool ran a retrieval. */
  retrievalExecutionId?: number | null;
}

// --- Structured LLM step (union discriminated by `type`) -------------------

export interface CopilotClaim {
  claim: string;
  citation_ids: string[];
  evidence_ids: string[];
}
export interface CopilotToolRequest {
  type: 'TOOL_REQUEST';
  reasoning_summary?: string;
  tool_calls: ToolCall[];
}
export interface CopilotFinalAnswer {
  type: 'FINAL_ANSWER';
  answer: string;
  claims: CopilotClaim[];
  citations: string[];
  evidence_ids: string[];
  limitations: string[];
  suggested_followups: string[];
}
export type CopilotStep = CopilotToolRequest | CopilotFinalAnswer;

// --- Grounding context assembled from tool results -------------------------

export interface CopilotGroundingContext {
  /** citationId -> chunk text (from searchMissionKnowledge results). */
  citationText: Map<string, string>;
  allowedCitationIds: Set<string>;
  /** Tokens from executed tool outputs — grounds deterministic tool-fact claims. */
  toolFactTokens: Set<string>;
  /** evidence ids surfaced this turn (from getEvidence/getInvestigation). */
  allowedEvidenceIds: Set<string>;
  /** investigation ids whose evidence was accessed this turn. */
  accessedInvestigationIds: Set<number>;
  knownSatelliteIds: Set<string>;
  knownInvestigationIds: Set<number>;
  knownReportIds: Set<number>;
  knownAlertIds: Set<number>;
}

// --- Diagnostics + result --------------------------------------------------

export interface ToolActivity {
  toolName: string;
  status: ToolExecStatus;
  validationStatus: ToolValidationStatus;
  summary: string;
}

export interface CopilotDiagnostics {
  iterationCount: number;
  toolCallCount: number;
  claimCount: number;
  supportedClaimCount: number;
  citationCount: number;
  evidenceCount: number;
  groundingValid: boolean;
  policyValid: boolean;
  averageGroundingSupport: number | null; // NOT confidence
  terminationReason: string;
}

export interface CopilotResult {
  conversationId: string;
  messageId: number | null;
  correlationId: string;
  executionMode: CopilotExecutionMode;
  status: CopilotAnswerStatus;
  provider: string | null;
  model: string | null;
  answer: string;
  claims: CopilotClaim[];
  citations: { citationId: string; documentId: number; title: string }[];
  evidenceIds: string[];
  limitations: string[];
  suggestedFollowups: string[];
  toolActivity: ToolActivity[];
  diagnostics: CopilotDiagnostics;
  disclaimer: string;
}

// --- Persistence row shapes ------------------------------------------------

export interface ConversationRow {
  id: string;
  user_id: string;
  role: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
export interface MessageRow {
  id: number;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  execution_mode: string | null;
  correlation_id: string | null;
  created_at: string;
}
