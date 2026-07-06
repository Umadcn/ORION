/**
 * Bounded Critic Agent domain model (Phase 7). READ-ONLY analysis assistance.
 *
 * The Critic independently evaluates a Phase 6 Planner analysis BEFORE human
 * review. It never mutates mission state, never approves/rejects/resolves, never
 * changes the authoritative deterministic RCA, and never triggers operational
 * actions. It may return ACCEPT / REVISE / REJECT; on REVISE a separate bounded
 * RevisionService produces a revised analysis that must pass the full validation
 * pipeline before the Critic re-evaluates it. Deterministic-fallback output is
 * never labeled real. Grounding/coverage scores are NOT RCA confidence.
 */
import type { PlannerAnalysis } from '../planner/types.js';

export type CriticUseCase = 'PLANNER_ANALYSIS_REVIEW';

export type CriticExecutionMode = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' | 'FAILED';

export type CriticDecision = 'ACCEPT' | 'REVISE' | 'REJECT';

export type CriticStatus =
  | 'CREATED'
  | 'RUNNING'
  | 'ACCEPTED'
  | 'REVISION_REQUIRED'
  | 'REVISED_ACCEPTED'
  | 'REJECTED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'REVISION_LIMIT_REACHED';

export type CritiqueSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export type CritiqueCategory =
  | 'GROUNDING'
  | 'CITATION'
  | 'EVIDENCE'
  | 'RCA_CONSISTENCY'
  | 'COVERAGE'
  | 'TELEMETRY_COVERAGE'
  | 'ALERT_COVERAGE'
  | 'KNOWLEDGE_COVERAGE'
  | 'HISTORICAL_COVERAGE'
  | 'CONTRADICTION'
  | 'UNSUPPORTED_CLAIM'
  | 'OVERSTATEMENT'
  | 'POLICY'
  | 'FABRICATED_ID'
  | 'LIMITATION'
  | 'KNOWLEDGE_GAP';

export const CRITIQUE_SEVERITIES: CritiqueSeverity[] = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'];
export const CRITIQUE_CATEGORIES: CritiqueCategory[] = [
  'GROUNDING', 'CITATION', 'EVIDENCE', 'RCA_CONSISTENCY', 'COVERAGE', 'TELEMETRY_COVERAGE',
  'ALERT_COVERAGE', 'KNOWLEDGE_COVERAGE', 'HISTORICAL_COVERAGE', 'CONTRADICTION',
  'UNSUPPORTED_CLAIM', 'OVERSTATEMENT', 'POLICY', 'FABRICATED_ID', 'LIMITATION', 'KNOWLEDGE_GAP',
];

/** Allowlisted, bounded, SAFE revision actions the RevisionService understands. */
export type RevisionTarget =
  | 'REMOVE_FINDING'
  | 'STRIP_CITATION'
  | 'STRIP_EVIDENCE'
  | 'ADD_LIMITATION'
  | 'ADD_KNOWLEDGE_GAP'
  | 'SOFTEN_OVERSTATEMENT'
  | 'ADD_UNCERTAINTY';

export const REVISION_TARGETS: RevisionTarget[] = [
  'REMOVE_FINDING', 'STRIP_CITATION', 'STRIP_EVIDENCE', 'ADD_LIMITATION',
  'ADD_KNOWLEDGE_GAP', 'SOFTEN_OVERSTATEMENT', 'ADD_UNCERTAINTY',
];

// --- Structured Critic output ---------------------------------------------

export interface CritiqueIssue {
  issue_id: string;
  severity: CritiqueSeverity;
  category: CritiqueCategory;
  description: string;
  claim_index: number | null;
  citation_ids: string[];
  evidence_ids: string[];
  recommended_correction: string;
}

export interface CoverageAssessment {
  investigation_context: boolean;
  deterministic_evidence: boolean;
  telemetry: boolean;
  alerts: boolean;
  mission_knowledge: boolean;
  historical_incidents: boolean;
  limitations: boolean;
  knowledge_gaps: boolean;
}

export interface RevisionInstruction {
  instruction_id: string;
  target: string; // one of RevisionTarget (validated); bounded string in schema
  action: string;
  reason: string;
}

export interface CriticReview {
  review_version: string;
  decision: CriticDecision;
  summary: string;
  issues: CritiqueIssue[];
  coverage: CoverageAssessment;
  revision_instructions: RevisionInstruction[];
  limitations: string[];
}

// --- Deterministic analysis inputs -----------------------------------------

export interface CriticEvidenceItem {
  evidence_id: string;
  summary: string;
  supports_root_cause: boolean;
  reliability_score: number;
}

export interface CriticCitation {
  citation_id: string;
  title: string;
  text: string;
  document_id: number;
}

/** Bounded, deterministic, read-only context assembled for a review. */
export interface CriticContext {
  investigationId: number;
  satelliteId: string;
  authoritativeRootCause: string;
  /** Deterministic RCA confidence — labeled as DETERMINISTIC confidence ONLY. Never a Critic score. */
  deterministicConfidence: number | null;
  investigationStatus: string;
  severity: string | null;
  subsystem: string | null;
  anomalyTypes: string[];
  evidence: CriticEvidenceItem[];
  telemetryPresent: boolean;
  telemetryInspected: boolean;
  telemetryLatest: Record<string, number> | null;
  alertsActiveCount: number;
  alertsInspected: boolean;
  missionKnowledgeInspected: boolean;
  historicalInspected: boolean;
  historicalCount: number;
  citations: CriticCitation[];
  knownSatelliteIdsUpper: string[];
  knownInvestigationIds: number[];
  knownReportIds: number[];
  plannerExecutionId: number | null;
  plannerCorrelationId: string;
  plannerExecutionMode: string;
  plannerPlanStatus: string;
  plannerKnowledgeGaps: string[];
  analysis: PlannerAnalysis;
}

export interface ContradictionFinding {
  type:
    | 'RCA_MISMATCH'
    | 'HEALTH_STATE'
    | 'EVIDENCE_EXISTENCE'
    | 'CITATION_EXISTENCE'
    | 'ALERT_EXISTENCE'
    | 'ACTION_EXECUTED'
    | 'SATELLITE_ID'
    | 'INVESTIGATION_ID'
    | 'REPORT_ID'
    | 'TELEMETRY_NUMERIC';
  category: CritiqueCategory;
  severity: CritiqueSeverity;
  claimIndex: number | null;
  description: string;
}

export interface CoverageResult {
  assessment: CoverageAssessment;
  failures: { key: keyof CoverageAssessment; category: CritiqueCategory; reason: string }[];
  passCount: number;
  failCount: number;
}

// --- Reflection loop + result ----------------------------------------------

export interface RevisionAttempt {
  attemptNumber: number;
  inputAnalysisHash: string;
  critiqueHash: string;
  outputAnalysisHash: string;
  validationStatus: string;
  criticDecisionAfter: CriticDecision;
  issueCountAfter: number;
  latencyMs: number;
  failureReason: string | null;
}

export interface CriticDiagnostics {
  issueCount: number;
  warningCount: number;
  errorCount: number;
  criticalCount: number;
  coveragePassCount: number;
  coverageFailCount: number;
  contradictionCount: number;
  revisionAttemptCount: number;
  criticCallCount: number;
  averageGroundingSupport: number | null; // NOT confidence
  terminationReason: string;
}

export interface CriticExecutionResult {
  criticExecutionId: number | null;
  plannerExecutionId: number | null;
  investigationId: number;
  correlationId: string;
  executionMode: CriticExecutionMode;
  criticStatus: CriticStatus;
  initialDecision: CriticDecision;
  finalDecision: CriticDecision;
  review: CriticReview;
  revisionAttempts: RevisionAttempt[];
  finalAnalysis: PlannerAnalysis;
  coverage: CoverageAssessment;
  contradictions: ContradictionFinding[];
  diagnostics: CriticDiagnostics;
  fallbackReason: string | null;
  advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY';
  humanReviewRequired: true;
}
