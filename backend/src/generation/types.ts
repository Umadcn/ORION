/**
 * Grounded generation domain model (Phase 4).
 *
 * This is the reusable subsystem underpinning ORION's first retrieval-augmented
 * LLM generation path. Load-bearing safety concepts:
 *  - The deterministic RCA remains AUTHORITATIVE; generation never replaces it.
 *  - Generation status is tracked SEPARATELY from the LLM provider execution
 *    mode (Phase 1). Deterministic fallback output is never labeled as real.
 *  - Grounding support is a lexical support score — NOT an RCA confidence and
 *    NOT an LLM confidence.
 */
import type { LlmExecutionMode } from '../llm/types.js';

export type GenerationUseCase = 'INVESTIGATION_BRIEFING';

/** Generation-level outcome, distinct from the provider execution mode. */
export type GenerationStatus =
  | 'REAL_PROVIDER_ACCEPTED'
  | 'DETERMINISTIC_FALLBACK_ACCEPTED'
  | 'REJECTED_UNGROUNDED'
  | 'REJECTED_INVALID_CITATION'
  | 'REJECTED_INVALID_EVIDENCE'
  | 'REJECTED_POLICY_VIOLATION'
  | 'REJECTED_SCHEMA_INVALID'
  | 'REJECTED_CONTEXT_INSUFFICIENT'
  | 'FAILED';

/** Quality-gate decision (internal); mapped to a GenerationStatus by the service. */
export type QualityDecision =
  | 'ACCEPT'
  | 'REJECT_SCHEMA'
  | 'REJECT_INVALID_CITATION'
  | 'REJECT_INVALID_EVIDENCE'
  | 'REJECT_UNGROUNDED'
  | 'REJECT_POLICY'
  | 'REJECT_CONTEXT_INSUFFICIENT';

export type GroundingFailureReason =
  | 'MISSING_CITATION'
  | 'CITATION_NOT_IN_CONTEXT'
  | 'INSUFFICIENT_LEXICAL_SUPPORT'
  | 'EVIDENCE_NOT_IN_CONTEXT'
  | 'ROOT_CAUSE_MISMATCH';

// --- Structured output (GeneratedBriefing) -------------------------------

export interface BriefingClaim {
  claim: string;
  citation_ids: string[];
}
export interface BriefingRootCause {
  authoritative_root_cause: string;
  explanation: string;
  citation_ids: string[];
}
export interface BriefingEvidenceItem {
  claim: string;
  evidence_ids: string[];
  citation_ids: string[];
}
export interface BriefingReviewItem {
  item: string;
  citation_ids: string[];
}
export interface GeneratedBriefing {
  title: string;
  summary: string;
  situation: BriefingClaim[];
  root_cause: BriefingRootCause;
  evidence_summary: BriefingEvidenceItem[];
  recommended_review_items: BriefingReviewItem[];
  limitations: string[];
}

// --- Context ------------------------------------------------------------

/** A retrieved knowledge chunk admitted into the grounding context. */
export interface GroundingSource {
  citationId: string;
  documentId: number;
  stableDocumentId: string;
  title: string;
  sourceType: string;
  /** Bounded, sanitized chunk text (never raw vectors / secrets). */
  text: string;
  /** Vector/BM25/RRF/rerank relevance (ranking signal only, NOT confidence). */
  relevance: number | null;
  injectionFlagged: boolean;
}

/** A deterministic evidence item admitted into the grounding context. */
export interface GroundingEvidence {
  evidenceId: string; // deterministic evidence row id, as a string
  sourceType: string;
  summary: string;
  text: string;
}

export interface GroundingCitation {
  citationId: string;
  documentId: number;
  title: string;
}

export interface ContextDiagnostics {
  includedEvidenceCount: number;
  includedCitationCount: number;
  includedSourceCount: number;
  excludedSourceCount: number;
  injectionFlagCount: number;
  totalContextChars: number;
  truncated: boolean;
}

/** System facts derived ONLY from deterministic investigation state. */
export interface SystemFacts {
  investigationId: number;
  title: string;
  satelliteId: string;
  satelliteName: string | null;
  subsystem: string | null;
  anomalyTypes: string[];
  authoritativeRootCause: string; // deterministic RCA root_cause (raw enum)
  authoritativeRootCauseLabel: string; // humanized
  hasDeterministicRca: boolean;
  severity: string | null;
  /** Deterministic RCA confidence — NOT grounding support. */
  rcaConfidence: number | null;
  status: string;
  explanation: string | null;
}

export interface GroundedGenerationContext {
  useCase: GenerationUseCase;
  investigationId: number;
  systemFacts: SystemFacts;
  evidence: GroundingEvidence[];
  sources: GroundingSource[];
  citations: GroundingCitation[];
  allowedCitationIds: string[];
  allowedEvidenceIds: string[];
  diagnostics: ContextDiagnostics;
}

// --- Validation results -------------------------------------------------

export interface CitationValidationResult {
  valid: boolean;
  invalidCitationIds: string[];
  reasons: string[];
}
export interface EvidenceValidationResult {
  valid: boolean;
  invalidEvidenceIds: string[];
  reasons: string[];
}
export interface PerClaimGrounding {
  claim: string;
  citationIds: string[];
  supportScore: number; // lexical support in [0,1]; NOT confidence
  supported: boolean;
  reasons: GroundingFailureReason[];
}
export interface GroundingValidationResult {
  valid: boolean;
  claims: PerClaimGrounding[];
  claimCount: number;
  supportedClaimCount: number;
  unsupportedClaimCount: number;
  averageSupport: number | null; // NOT confidence
  rootCauseMatches: boolean;
}
export interface PolicyViolation {
  code: string;
  detail: string;
}
export interface PolicyValidationResult {
  valid: boolean;
  violations: PolicyViolation[];
}
export interface SchemaValidationResult {
  valid: boolean;
  errors: string[];
}
export interface ContextSufficiencyResult {
  sufficient: boolean;
  reasons: string[];
}

export interface QualityGateResult {
  decision: QualityDecision;
  schema: SchemaValidationResult;
  citation: CitationValidationResult;
  evidence: EvidenceValidationResult;
  grounding: GroundingValidationResult;
  policy: PolicyValidationResult;
  sufficiency: ContextSufficiencyResult;
}

// --- Request / result ---------------------------------------------------

export interface GroundedGenerationRequest {
  useCase: GenerationUseCase;
  investigationId: number;
  correlationId: string;
  context: GroundedGenerationContext;
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
  /** Domain-specific deterministic output, used when the provider falls back. */
  deterministicFallback: GeneratedBriefing;
  retrievalExecutionId?: number | null;
  retrievalMode?: string | null;
  createdBy?: string | null;
}

export interface GenerationDiagnostics {
  contextSourceCount: number;
  includedEvidenceCount: number;
  includedCitationCount: number;
  excludedSourceCount: number;
  injectionFlagCount: number;
  claimCount: number;
  supportedClaimCount: number;
  unsupportedClaimCount: number;
  averageGroundingSupport: number | null;
  schemaValid: boolean;
  citationValid: boolean;
  evidenceValid: boolean;
  groundingValid: boolean;
  policyValid: boolean;
  contextSufficient: boolean;
  rejectionReason: string | null;
  policyViolations: PolicyViolation[];
}

export interface GroundedGenerationResult {
  status: GenerationStatus;
  useCase: GenerationUseCase;
  correlationId: string;
  investigationId: number;
  providerExecutionMode: LlmExecutionMode | null;
  provider: string | null;
  model: string | null;
  promptVersion: string;
  llmExecutionId: number | null;
  retrievalExecutionId: number | null;
  retrievalMode: string | null;
  briefing: GeneratedBriefing | null;
  diagnostics: GenerationDiagnostics;
  fallbackReason: string | null;
  latencyMs: number;
}
