/**
 * AI Observability dashboard types + pure presentation helpers (Phase 8).
 *
 * Read-only. Mirrors the backend `/api/observability/*` response shapes. Helpers
 * NEVER label deterministic fallback as real AI, and NEVER label ranking/quality
 * scores as confidence.
 */
export type ObsRange = '24H' | '7D' | '30D' | 'ALL';
export const OBS_RANGES: { value: ObsRange; label: string }[] = [
  { value: '24H', label: '24 Hours' },
  { value: '7D', label: '7 Days' },
  { value: '30D', label: '30 Days' },
  { value: 'ALL', label: 'All Time' },
];

export interface ObsDistributionItem { key: string; count: number; rate: number }
export interface ObsLatency { count: number; averageMs: number | null; p50Ms: number | null; p95Ms: number | null; p99Ms: number | null; minMs: number | null; maxMs: number | null }

export interface ObsOverview {
  timeRange: ObsRange;
  generatedAt: string;
  totalAiExecutions: number;
  realProviderRate: number;
  deterministicFallbackRate: number;
  groundedOutputAcceptanceRate: number;
  retrievalNdcgAtK: number | null;
  criticAcceptanceRate: number;
  governanceAlertCount: number;
  offlineMode: boolean;
  llmOperatingMode: 'REAL_PROVIDER_CONFIGURED' | 'DETERMINISTIC_FALLBACK';
  embeddingOperatingMode: 'REAL_EMBEDDING_PROVIDER' | 'LOCAL_HASH_FALLBACK';
}

export interface ObsGovernanceAlert {
  alertId: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; category: string; metric: string;
  observedValue: number; threshold: number; comparison: 'GREATER_THAN' | 'LESS_THAN';
  description: string; recommendedReviewAction: string; timeRange: ObsRange;
}
export interface ObsGovernance { timeRange: ObsRange; alertCount: number; criticalCount: number; warningCount: number; infoCount: number; alerts: ObsGovernanceAlert[]; advisory: true }

export interface ObsEvaluationResult { retrievalMode: string; kValue: number; precisionAtK: number; recallAtK: number; mrr: number; hitRateAtK: number; ndcgAtK: number | null; queryCount: number; createdAt: string }

export interface ObsLlm { totalExecutions: number; realProviderRate: number; deterministicFallbackRate: number; failedRate: number; structuredOutputValidRate: number; fallbackReasonDistribution: ObsDistributionItem[]; errorCodeDistribution: ObsDistributionItem[]; providerDistribution: ObsDistributionItem[]; latency: ObsLatency; totalTokenCount: number }
export interface ObsRetrieval { totalExecutions: number; retrievalModeDistribution: ObsDistributionItem[]; embeddingModeDistribution: ObsDistributionItem[]; zeroResultRate: number; latency: ObsLatency; latestEvaluationsByMode: ObsEvaluationResult[]; evaluationHistory: ObsEvaluationResult[] }
export interface ObsGeneration { totalGenerations: number; statusDistribution: ObsDistributionItem[]; groundingValidRate: number; citationValidRate: number; averageGroundingSupport: number | null; injectionFlagCount: number; latency: ObsLatency }
export interface ObsCopilot { conversationCount: number; messageCount: number; executionCount: number; executionModeDistribution: ObsDistributionItem[]; toolUsageDistribution: ObsDistributionItem[]; toolStatusDistribution: ObsDistributionItem[]; toolLatency: ObsLatency; groundingValidRate: number }
export interface ObsPlanner { totalExecutions: number; statusDistribution: ObsDistributionItem[]; executionModeDistribution: ObsDistributionItem[]; groundedAnalysisRate: number; latency: ObsLatency }
export interface ObsCritic { totalExecutions: number; finalDecisionDistribution: ObsDistributionItem[]; initialDecisionDistribution: ObsDistributionItem[]; acceptRate: number; reviseRate: number; rejectRate: number; revisedAcceptedRate: number; severityDistribution: ObsDistributionItem[]; averageContradictionCount: number | null; coveragePassRate: number; revisionSuccessRate: number; latency: ObsLatency }
export interface ObsLinkage { plannerToCriticReviewRate: number; orphanCriticCount: number; groundedOutputAcceptanceRate: number; revisionSuccessRate: number; humanReviewRequiredCount: number; deterministicFallbackDependencyRate: number; linkedRetrievalCount: number; linkedLlmCount: number }
export interface ObsSnapshot {
  timeRange: ObsRange; generatedAt: string; overview: ObsOverview;
  llm: ObsLlm; retrieval: ObsRetrieval; generation: ObsGeneration; copilot: ObsCopilot;
  planner: ObsPlanner; critic: ObsCritic; linkage: ObsLinkage; governance: ObsGovernance;
  grounding: { averageGroundingSupport: number | null; groundingValidRate: number; policyValidRate: number };
  citation: { citationValidRate: number; totalCitationsSurfaced: number; totalEvidenceReferenced: number };
}
export interface ObsTimeseriesPoint { bucketStart: string; value: number; count: number }
export interface ObsTimeseries { metric: string; range: ObsRange; points: ObsTimeseriesPoint[] }

// --- Pure presentation helpers --------------------------------------------

/** Format a [0,1] rate as a percentage string. NOT a confidence value. */
export function pct(rate: number | null | undefined, digits = 1): string {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return '—';
  return `${(rate * 100).toFixed(digits)}%`;
}

/** Format a millisecond latency (nullable). */
export function ms(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${Math.round(v)} ms`;
}

/** Compact integer formatting. */
export function count(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return Intl.NumberFormat('en-US').format(v);
}

/** nDCG / evaluation metric formatting — a ranking-quality score, NOT confidence. */
export function score(v: number | null | undefined, digits = 3): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return v.toFixed(digits);
}

/**
 * Execution-mode label. Deterministic fallback is NEVER labeled as real AI /
 * "AI Model"; failed is distinct. Returns a tone for badge coloring.
 */
export function executionModeLabel(mode: string): { label: string; tone: 'green' | 'orange' | 'red' | 'slate' } {
  switch (mode) {
    case 'REAL_PROVIDER': return { label: 'Real Provider', tone: 'green' };
    case 'DETERMINISTIC_FALLBACK': return { label: 'Deterministic Fallback', tone: 'orange' };
    case 'FAILED': return { label: 'Failed', tone: 'red' };
    default: return { label: mode, tone: 'slate' };
  }
}

/** Governance severity → badge classes + label. */
export function governanceSeverityClasses(sev: string): { label: string; bg: string; text: string; border: string } {
  switch (sev) {
    case 'CRITICAL': return { label: 'Critical', bg: 'bg-accent-red/10', text: 'text-accent-red', border: 'border-accent-red/30' };
    case 'WARNING': return { label: 'Warning', bg: 'bg-accent-orange/10', text: 'text-accent-orange', border: 'border-accent-orange/30' };
    default: return { label: 'Info', bg: 'bg-accent-cyan/10', text: 'text-accent-cyan', border: 'border-accent-cyan/30' };
  }
}

/** Human label for the LLM operating mode (offline vs configured). */
export function operatingModeLabel(mode: ObsOverview['llmOperatingMode']): string {
  return mode === 'REAL_PROVIDER_CONFIGURED' ? 'Real provider configured' : 'Deterministic fallback (offline)';
}
