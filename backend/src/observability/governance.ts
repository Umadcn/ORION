/**
 * Deterministic AI governance checks (Phase 8). ADVISORY ONLY.
 *
 * Each rule compares a computed metric against a bounded configuration threshold
 * and, if breached, emits a GovernanceAlert. Governance NEVER mutates
 * configuration, mission state, agents, investigations, or provider selection —
 * it only surfaces advisory review actions for a Director/Admin.
 *
 * Rules with an insufficient population (zero denominator) are skipped so an
 * empty/quiet system does not raise noise. The LLM-fallback rule fires only when
 * a real provider is configured (offline fallback is expected, not a defect).
 */
import { config } from '../config.js';
import type {
  CopilotMetrics, CriticMetrics, GenerationMetrics, GovernanceAlert, GovernanceStatus,
  LlmMetrics, ObservabilityTimeRange, PipelineLinkageMetrics, PlannerMetrics, RetrievalMetrics,
} from './types.js';
import { countWhere } from './aggregation.js';

export interface GovernanceInput {
  range: ObservabilityTimeRange;
  llm: LlmMetrics;
  retrieval: RetrievalMetrics;
  generation: GenerationMetrics;
  copilot: CopilotMetrics;
  planner: PlannerMetrics;
  critic: CriticMetrics;
  linkage: PipelineLinkageMetrics;
  realProviderConfigured: boolean;
}

export function evaluateGovernance(inp: GovernanceInput): GovernanceStatus {
  const g = config.observability.governance;
  const alerts: GovernanceAlert[] = [];
  let seq = 0;
  const add = (a: Omit<GovernanceAlert, 'alertId' | 'timeRange'>) => alerts.push({ ...a, alertId: `GOV-${++seq}`, timeRange: inp.range });
  const round = (n: number) => Number(n.toFixed(4));

  // --- LLM ---
  if (inp.realProviderConfigured && inp.llm.totalExecutions > 0 && inp.llm.deterministicFallbackRate > g.llmFallbackRateMax) {
    add({ severity: 'WARNING', category: 'LLM', metric: 'deterministicFallbackRate', observedValue: round(inp.llm.deterministicFallbackRate), threshold: g.llmFallbackRateMax, comparison: 'GREATER_THAN', description: 'A real LLM provider is configured but the deterministic fallback is used frequently.', recommendedReviewAction: 'Review provider connectivity, credentials, timeouts, and structured-output validity.' });
  }
  if (inp.llm.totalExecutions > 0 && inp.llm.failedRate > g.llmFailureRateMax) {
    add({ severity: 'CRITICAL', category: 'LLM', metric: 'failedRate', observedValue: round(inp.llm.failedRate), threshold: g.llmFailureRateMax, comparison: 'GREATER_THAN', description: 'LLM executions are failing above the acceptable threshold.', recommendedReviewAction: 'Inspect llm_executions error codes and provider health; fallback should still protect workflows.' });
  }
  const structuredRequested = inp.llm.structuredOutputRequestedRate > 0 && inp.llm.totalExecutions > 0;
  if (structuredRequested && inp.llm.structuredOutputValidRate < g.structuredValidRateMin) {
    add({ severity: 'WARNING', category: 'LLM', metric: 'structuredOutputValidRate', observedValue: round(inp.llm.structuredOutputValidRate), threshold: g.structuredValidRateMin, comparison: 'LESS_THAN', description: 'Structured-output validity is below the acceptable threshold.', recommendedReviewAction: 'Review prompt/schema alignment; invalid outputs are rejected and fall back deterministically.' });
  }

  // --- Retrieval ---
  if (inp.retrieval.totalExecutions > 0 && inp.retrieval.zeroResultRate > g.retrievalZeroResultRateMax) {
    add({ severity: 'WARNING', category: 'RETRIEVAL', metric: 'zeroResultRate', observedValue: round(inp.retrieval.zeroResultRate), threshold: g.retrievalZeroResultRateMax, comparison: 'GREATER_THAN', description: 'A high share of retrievals returned zero results.', recommendedReviewAction: 'Review the knowledge corpus coverage and query construction.' });
  }

  // --- Generation grounding / citation ---
  if (inp.generation.totalGenerations > 0) {
    const groundingRejection = round(1 - inp.generation.groundingValidRate);
    if (groundingRejection > g.groundingRejectionRateMax) {
      add({ severity: 'WARNING', category: 'GENERATION', metric: 'groundingRejectionRate', observedValue: groundingRejection, threshold: g.groundingRejectionRateMax, comparison: 'GREATER_THAN', description: 'Grounded-generation outputs are frequently failing grounding validation.', recommendedReviewAction: 'Review retrieval sufficiency and claim grounding; rejected outputs use the deterministic briefing fallback.' });
    }
    if (inp.generation.citationValidRate < g.citationValidRateMin) {
      add({ severity: 'WARNING', category: 'GENERATION', metric: 'citationValidRate', observedValue: round(inp.generation.citationValidRate), threshold: g.citationValidRateMin, comparison: 'LESS_THAN', description: 'Citation validity is below the acceptable threshold.', recommendedReviewAction: 'Review citation resolution and in-context citation enforcement.' });
    }
    if (inp.generation.injectionFlagCount > 0) {
      add({ severity: 'WARNING', category: 'SECURITY', metric: 'injectionFlagCount', observedValue: inp.generation.injectionFlagCount, threshold: 0, comparison: 'GREATER_THAN', description: 'Prompt-injection heuristics flagged one or more retrieved sources.', recommendedReviewAction: 'Review flagged sources; retrieved documents remain untrusted supporting context.' });
    }
  }

  // --- Copilot tools ---
  if (inp.copilot.executionCount > 0) {
    const toolTotal = inp.copilot.toolStatusDistribution.reduce((s, d) => s + d.count, 0);
    const toolErrors = inp.copilot.toolStatusDistribution.filter((d) => d.key === 'ERROR').reduce((s, d) => s + d.count, 0);
    const toolErrorRate = toolTotal > 0 ? Number((toolErrors / toolTotal).toFixed(4)) : 0;
    if (toolTotal > 0 && toolErrorRate > g.copilotToolErrorRateMax) {
      add({ severity: 'WARNING', category: 'COPILOT', metric: 'toolErrorRate', observedValue: toolErrorRate, threshold: g.copilotToolErrorRateMax, comparison: 'GREATER_THAN', description: 'Copilot read-only tool executions are erroring above the acceptable threshold.', recommendedReviewAction: 'Inspect copilot_tool_executions error codes; tools remain read-only and allowlisted.' });
    }
  }

  // --- Planner ---
  if (inp.planner.totalExecutions > 0) {
    const plannerFailure = round(inp.planner.partialRate + inp.planner.timedOutRate + inp.planner.iterationLimitRate);
    if (plannerFailure > g.plannerFailureRateMax) {
      add({ severity: 'WARNING', category: 'PLANNER', metric: 'partialOrFailureRate', observedValue: plannerFailure, threshold: g.plannerFailureRateMax, comparison: 'GREATER_THAN', description: 'Planner executions frequently end PARTIAL / TIMED_OUT / ITERATION_LIMIT.', recommendedReviewAction: 'Review planner bounds and tool availability; deterministic analysis still completes advisory output.' });
    }
  }

  // --- Critic ---
  if (inp.critic.totalExecutions > 0) {
    if ((inp.critic.averageContradictionCount ?? 0) > g.criticContradictionAvgMax) {
      add({ severity: 'WARNING', category: 'CRITIC', metric: 'averageContradictionCount', observedValue: round(inp.critic.averageContradictionCount ?? 0), threshold: g.criticContradictionAvgMax, comparison: 'GREATER_THAN', description: 'The Critic is detecting contradictions in analyses above the acceptable threshold.', recommendedReviewAction: 'Review planner analyses for authoritative-fact consistency.' });
    }
    if (inp.critic.revisionLimitReachedRate > g.revisionLimitRateMax) {
      add({ severity: 'WARNING', category: 'CRITIC', metric: 'revisionLimitReachedRate', observedValue: round(inp.critic.revisionLimitReachedRate), threshold: g.revisionLimitRateMax, comparison: 'GREATER_THAN', description: 'The bounded revision loop frequently reaches its limit without acceptance.', recommendedReviewAction: 'Review recurring critique categories; revision remains bounded and deterministic.' });
    }
  }

  // --- Linkage / audit gaps ---
  if (inp.linkage.orphanCriticCount > 0) {
    add({ severity: 'INFO', category: 'GOVERNANCE', metric: 'orphanCriticCount', observedValue: inp.linkage.orphanCriticCount, threshold: 0, comparison: 'GREATER_THAN', description: 'Some Critic executions have no resolvable Planner execution linkage.', recommendedReviewAction: 'Informational — verify audit linkage; no action required for advisory review.' });
  }

  alerts.sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.alertId.localeCompare(b.alertId));
  return {
    timeRange: inp.range,
    alertCount: alerts.length,
    criticalCount: countWhere(alerts, (a) => a.severity === 'CRITICAL'),
    warningCount: countWhere(alerts, (a) => a.severity === 'WARNING'),
    infoCount: countWhere(alerts, (a) => a.severity === 'INFO'),
    alerts,
    advisory: true,
  };
}

function severityRank(s: GovernanceAlert['severity']): number {
  return s === 'CRITICAL' ? 3 : s === 'WARNING' ? 2 : 1;
}
