/**
 * Read-only AI Observability, Evaluation & Governance domain model (Phase 8).
 *
 * All metrics are computed deterministically by aggregating the EXISTING Phase
 * 1–7 audit tables (the source of truth). This subsystem is strictly READ-ONLY:
 * it never mutates configuration, mission state, agents, investigations, or
 * provider selection, and it never introduces a new event-logging pipeline.
 *
 * IMPORTANT SEMANTICS: retrieval similarity, rerank scores, grounding support,
 * coverage ratios, and evaluation metrics (Precision/Recall/MRR/nDCG) are
 * ranking / quality signals — they are NEVER "confidence". Deterministic-fallback
 * output is never represented as real model output.
 */

/** Bounded observability query windows. `ALL` = no lower time bound. */
export type ObservabilityTimeRange = '24H' | '7D' | '30D' | 'ALL';
export const OBSERVABILITY_TIME_RANGES: ObservabilityTimeRange[] = ['24H', '7D', '30D', 'ALL'];

/** A single categorical bucket: how many rows had `key`, and the share of the total. */
export interface DistributionItem {
  key: string;
  count: number;
  /** count / total for the population, in [0,1]. 0 when the population is empty. */
  rate: number;
}

/**
 * Latency summary over a set of `latency_ms` samples. Percentiles use the
 * nearest-rank method on the ascending-sorted samples (mathematically exact,
 * unit-tested). All values are milliseconds; null when there are no samples.
 */
export interface LatencyDistribution {
  count: number;
  averageMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
}

/** Execution-mode buckets (keys are e.g. REAL_PROVIDER / DETERMINISTIC_FALLBACK / FAILED). */
export type ExecutionModeDistribution = DistributionItem[];
/** Failure/fallback-reason buckets (bounded to the configured max distribution items). */
export type FailureReasonDistribution = DistributionItem[];

/** One point in a bucketed time series (bucketStart is an ISO-8601 UTC instant). */
export interface TimeSeriesPoint {
  bucketStart: string;
  value: number;
  count: number;
}

// --- LLM (llm_executions) --------------------------------------------------

export interface LlmMetrics {
  totalExecutions: number;
  realProviderCount: number;
  realProviderRate: number;
  deterministicFallbackCount: number;
  deterministicFallbackRate: number;
  failedCount: number;
  failedRate: number;
  providerDistribution: DistributionItem[];
  modelDistribution: DistributionItem[];
  requestTypeDistribution: DistributionItem[];
  structuredOutputRequestedRate: number;
  /** Valid structured outputs / structured outputs requested, in [0,1]. */
  structuredOutputValidRate: number;
  retryCountDistribution: DistributionItem[];
  fallbackReasonDistribution: FailureReasonDistribution;
  errorCodeDistribution: FailureReasonDistribution;
  inputTokenCount: number;
  outputTokenCount: number;
  totalTokenCount: number;
  latency: LatencyDistribution;
}

// --- Retrieval (retrieval_executions + retrieval_evaluation_runs) ----------

export interface RetrievalEvaluationResult {
  retrievalMode: string;
  datasetVersion: string;
  kValue: number;
  /** Precision@K — NOT confidence. */
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
  hitRateAtK: number;
  ndcgAtK: number | null;
  averageLatencyMs: number;
  queryCount: number;
  createdAt: string;
}

export interface RetrievalMetrics {
  totalExecutions: number;
  retrievalModeDistribution: DistributionItem[];
  embeddingModeDistribution: DistributionItem[];
  /** Executions whose embedding mode is a real provider (not LOCAL_HASH_FALLBACK), in [0,1]. */
  embeddingUsedRate: number;
  averageVectorCandidateCount: number | null;
  averageBm25CandidateCount: number | null;
  averageFusedCandidateCount: number | null;
  averageRerankedCandidateCount: number | null;
  zeroResultRate: number;
  latency: LatencyDistribution;
  /** Most-recent evaluation run per retrieval mode. */
  latestEvaluationsByMode: RetrievalEvaluationResult[];
  evaluationHistory: RetrievalEvaluationResult[];
}

// --- Grounded generation (grounded_generation_executions) ------------------

export interface GenerationMetrics {
  totalGenerations: number;
  statusDistribution: DistributionItem[];
  realProviderAcceptedRate: number;
  deterministicFallbackAcceptedRate: number;
  rejectedSchemaCount: number;
  rejectedCitationCount: number;
  rejectedEvidenceCount: number;
  rejectedGroundingCount: number;
  rejectedPolicyCount: number;
  rejectedContextCount: number;
  failureRate: number;
  /** Average lexical grounding support — a ranking signal, NOT confidence. */
  averageGroundingSupport: number | null;
  groundingValidRate: number;
  citationValidRate: number;
  evidenceValidRate: number;
  policyValidRate: number;
  injectionFlagCount: number;
  injectionFlagRate: number;
  averageClaimCount: number | null;
  latency: LatencyDistribution;
}

// --- Copilot (copilot_* tables) --------------------------------------------

export interface CopilotMetrics {
  conversationCount: number;
  messageCount: number;
  executionCount: number;
  executionModeDistribution: DistributionItem[];
  insufficientEvidenceRate: number;
  failedRate: number;
  averageIterations: number | null;
  averageToolCalls: number | null;
  toolUsageDistribution: DistributionItem[];
  toolStatusDistribution: DistributionItem[];
  toolLatency: LatencyDistribution;
  groundingValidRate: number;
  citationUsageCount: number;
  evidenceUsageCount: number;
  fallbackReasonDistribution: FailureReasonDistribution;
}

// --- Planner (planner_* tables) --------------------------------------------

export interface PlannerMetrics {
  totalExecutions: number;
  executionModeDistribution: DistributionItem[];
  statusDistribution: DistributionItem[];
  completedRate: number;
  partialRate: number;
  timedOutRate: number;
  iterationLimitRate: number;
  averageStepCount: number | null;
  averageToolCalls: number | null;
  averageRetrievalCalls: number | null;
  averageRetrievalRefinements: number | null;
  knowledgeGapFrequency: number;
  groundedAnalysisRate: number;
  averageCitations: number | null;
  averageEvidenceReferences: number | null;
  fallbackReasonDistribution: FailureReasonDistribution;
  latency: LatencyDistribution;
}

// --- Critic (critic_* tables) ----------------------------------------------

export interface CriticMetrics {
  totalExecutions: number;
  executionModeDistribution: DistributionItem[];
  initialDecisionDistribution: DistributionItem[];
  finalDecisionDistribution: DistributionItem[];
  acceptRate: number;
  reviseRate: number;
  rejectRate: number;
  revisedAcceptedRate: number;
  revisionLimitReachedRate: number;
  averageIssueCount: number | null;
  severityDistribution: DistributionItem[];
  categoryDistribution: DistributionItem[];
  averageContradictionCount: number | null;
  coveragePassRate: number;
  averageRevisionAttempts: number | null;
  /** Revised executions that ended REVISED_ACCEPTED / all executions that entered revision. */
  revisionSuccessRate: number;
  repeatedAnalysisStopCount: number;
  repeatedReviewStopCount: number;
  fallbackReasonDistribution: FailureReasonDistribution;
  latency: LatencyDistribution;
}

// --- Grounding + citation roll-ups (across generation/copilot/planner) -----

export interface GroundingMetrics {
  /** Average lexical grounding support across grounded subsystems — NOT confidence. */
  averageGroundingSupport: number | null;
  groundingValidRate: number;
  policyValidRate: number;
  sampleCount: number;
}
export interface CitationMetrics {
  citationValidRate: number;
  totalCitationsSurfaced: number;
  totalEvidenceReferenced: number;
  sampleCount: number;
}

// --- End-to-end linkage (correlation-aware; explicit IDs only) -------------

export interface PipelineLinkageMetrics {
  /** Distinct correlation IDs seen in llm_executions within range. */
  llmCorrelationCount: number;
  /** retrieval executions referenced by planner/critic via persisted IDs. */
  linkedRetrievalCount: number;
  /** llm executions referenced by planner/critic via persisted correlation IDs. */
  linkedLlmCount: number;
  /** planner executions that have at least one critic review (persisted planner_execution_id). */
  plannerToCriticReviewedCount: number;
  plannerToCriticReviewRate: number;
  /** critic executions with no resolvable planner_execution_id (orphans). */
  orphanCriticCount: number;
  /** planner executions with zero linked llm executions (deterministic-only plans). */
  plannerWithoutLlmCount: number;
  groundedOutputAcceptanceRate: number;
  revisionSuccessRate: number;
  humanReviewRequiredCount: number;
  /** Share of AI executions (llm) produced by the deterministic fallback, in [0,1]. */
  deterministicFallbackDependencyRate: number;
}

// --- Governance ------------------------------------------------------------

export type GovernanceSeverity = 'INFO' | 'WARNING' | 'CRITICAL';
export type GovernanceComparison = 'GREATER_THAN' | 'LESS_THAN';

export interface GovernanceAlert {
  alertId: string;
  severity: GovernanceSeverity;
  category: string;
  metric: string;
  observedValue: number;
  threshold: number;
  comparison: GovernanceComparison;
  description: string;
  recommendedReviewAction: string;
  timeRange: ObservabilityTimeRange;
}

export interface GovernanceStatus {
  timeRange: ObservabilityTimeRange;
  alertCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  alerts: GovernanceAlert[];
  /** Advisory-only: governance never mutates anything. */
  advisory: true;
}

// --- Overview + snapshot ---------------------------------------------------

export interface AiSystemOverview {
  timeRange: ObservabilityTimeRange;
  generatedAt: string;
  totalAiExecutions: number;
  realProviderRate: number;
  deterministicFallbackRate: number;
  groundedOutputAcceptanceRate: number;
  retrievalNdcgAtK: number | null;
  criticAcceptanceRate: number;
  governanceAlertCount: number;
  /** True when no real LLM provider is configured (offline deterministic mode). */
  offlineMode: boolean;
  llmOperatingMode: 'REAL_PROVIDER_CONFIGURED' | 'DETERMINISTIC_FALLBACK';
  embeddingOperatingMode: 'REAL_EMBEDDING_PROVIDER' | 'LOCAL_HASH_FALLBACK';
}

export interface EvaluationSummary {
  latestByMode: RetrievalEvaluationResult[];
  history: RetrievalEvaluationResult[];
  bestNdcgMode: string | null;
}

export interface AiObservabilitySnapshot {
  timeRange: ObservabilityTimeRange;
  generatedAt: string;
  overview: AiSystemOverview;
  llm: LlmMetrics;
  retrieval: RetrievalMetrics;
  generation: GenerationMetrics;
  copilot: CopilotMetrics;
  planner: PlannerMetrics;
  critic: CriticMetrics;
  grounding: GroundingMetrics;
  citation: CitationMetrics;
  linkage: PipelineLinkageMetrics;
  /** Phase 9 provider observability (real provider/embedding, spaces, verification, comparison). */
  providers: import('./providerMetrics.js').ProviderObservability;
  /** Phase 10 ORION AI Assistant observability. */
  assistant: import('./assistantMetrics.js').AssistantObservability;
  governance: GovernanceStatus;
}
