/**
 * Bounded Planner Agent domain model (Phase 6). READ-ONLY analysis assistance.
 *
 * The Planner dynamically builds + executes a bounded, read-only investigation
 * ANALYSIS plan (Agentic RAG). It never mutates mission state and never replaces
 * the authoritative deterministic RCA. Deterministic-fallback output is never
 * labeled real. Grounding/retrieval scores are not confidence.
 */

export type PlannerUseCase = 'INVESTIGATION_ANALYSIS';

export type PlannerExecutionMode = 'REAL_PROVIDER' | 'DETERMINISTIC_FALLBACK' | 'FAILED';

export type PlanStatus =
  | 'CREATED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'REJECTED'
  | 'FAILED' | 'TIMED_OUT' | 'ITERATION_LIMIT' | 'STEP_LIMIT' | 'BUDGET_EXHAUSTED';

export type PlanStepType =
  | 'INSPECT_SATELLITE'
  | 'INSPECT_TELEMETRY'
  | 'INSPECT_ALERTS'
  | 'INSPECT_INVESTIGATION'
  | 'INSPECT_EVIDENCE'
  | 'SEARCH_MISSION_KNOWLEDGE'
  | 'SEARCH_HISTORICAL_INVESTIGATIONS'
  | 'INSPECT_REPORT'
  | 'ASSESS_KNOWLEDGE_GAP'
  | 'BUILD_FINAL_ANALYSIS';

export const PLAN_STEP_TYPES: PlanStepType[] = [
  'INSPECT_SATELLITE', 'INSPECT_TELEMETRY', 'INSPECT_ALERTS', 'INSPECT_INVESTIGATION',
  'INSPECT_EVIDENCE', 'SEARCH_MISSION_KNOWLEDGE', 'SEARCH_HISTORICAL_INVESTIGATIONS',
  'INSPECT_REPORT', 'ASSESS_KNOWLEDGE_GAP', 'BUILD_FINAL_ANALYSIS',
];

/** Step types that map to a read-only Copilot tool (vs internal operations). */
export const TOOL_STEP_TYPES: PlanStepType[] = [
  'INSPECT_SATELLITE', 'INSPECT_TELEMETRY', 'INSPECT_ALERTS', 'INSPECT_INVESTIGATION',
  'INSPECT_EVIDENCE', 'SEARCH_MISSION_KNOWLEDGE', 'SEARCH_HISTORICAL_INVESTIGATIONS', 'INSPECT_REPORT',
];

export interface InvestigationPlanStep {
  step_id: string;
  step_type: PlanStepType;
  reason: string;
  depends_on: string[];
  parameters: Record<string, unknown>;
}
export interface InvestigationPlan {
  plan_version: string;
  objective: string;
  steps: InvestigationPlanStep[];
  completion_criteria: string[];
}

export type StepStatus = 'SUCCESS' | 'REJECTED' | 'ERROR' | 'SKIPPED' | 'INTERNAL';

export interface PlanStepResult {
  stepId: string;
  stepType: PlanStepType;
  order: number;
  status: StepStatus;
  toolName: string | null;
  toolExecutionId: number | null;
  retrievalExecutionId: number | null;
  inputSummary: string;
  outputSummary: string;
  latencyMs: number;
  errorCode: string | null;
  sanitizedError: string | null;
  output: unknown | null;
}

export type KnowledgeGapType = 'NONE' | 'MISSING_EVIDENCE' | 'MISSING_TELEMETRY' | 'MISSING_KNOWLEDGE' | 'MISSING_HISTORICAL';

export interface KnowledgeGap {
  type: KnowledgeGapType;
  description: string;
  missingSourceCategories: string[];
  suggestedTerms: string[];
  sufficient: boolean;
}

export interface RetrievalRefinement {
  iteration: number;
  gapType: KnowledgeGapType;
  queryHash: string;
  querySummary: string;
  retrievalExecutionId: number | null;
  resultCount: number;
  newCitationCount: number;
  sufficiencyAfter: boolean;
}

export type FindingSourceType = 'TOOL_FACT' | 'EVIDENCE' | 'MISSION_KNOWLEDGE';

export interface PlannerFinding {
  claim: string;
  source_types: FindingSourceType[];
  citation_ids: string[];
  evidence_ids: string[];
}
export interface PlannerAnalysis {
  title: string;
  objective: string;
  authoritative_root_cause: string;
  analysis_summary: string;
  findings: PlannerFinding[];
  knowledge_gaps: string[];
  recommended_review_items: string[];
  limitations: string[];
}

export interface PlannerDiagnostics {
  stepCount: number;
  completedStepCount: number;
  failedStepCount: number;
  iterationCount: number;
  toolCallCount: number;
  retrievalCallCount: number;
  knowledgeGapCount: number;
  citationCount: number;
  evidenceCount: number;
  groundingValid: boolean;
  policyValid: boolean;
  averageGroundingSupport: number | null; // NOT confidence
  terminationReason: string;
}

export interface PlannerExecutionResult {
  investigationId: number;
  plannerExecutionId: number | null;
  correlationId: string;
  executionMode: PlannerExecutionMode;
  planStatus: PlanStatus;
  provider: string | null;
  model: string | null;
  plan: InvestigationPlan;
  stepSummaries: { stepId: string; stepType: PlanStepType; status: StepStatus; toolName: string | null; outputSummary: string }[];
  retrievalRefinements: RetrievalRefinement[];
  analysis: PlannerAnalysis | null;
  citations: { citationId: string; documentId: number; title: string }[];
  evidenceIds: string[];
  knowledgeGaps: KnowledgeGap[];
  diagnostics: PlannerDiagnostics;
  fallbackReason: string | null;
  advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY';
}
