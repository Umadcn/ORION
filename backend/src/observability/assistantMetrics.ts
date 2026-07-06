/**
 * Phase 10 ORION AI Assistant observability + governance (read-only extension of
 * Phase 8/9). Aggregates assistant_executions + assistant_feedback audits into
 * bounded metrics and derives advisory governance alerts. No prompts, no raw
 * provider responses, no hidden reasoning, no raw vectors, no secrets.
 */
import { config, isRealLlmConfigured } from '../config.js';
import { countWhere, distribution, latencyDistribution, rate } from './aggregation.js';
import { fetchRows, num, type RepoContext } from './observabilityRepository.js';
import type { GovernanceAlert, ObservabilityTimeRange, DistributionItem, LatencyDistribution } from './types.js';

export interface AssistantObservability {
  totalConversations: number;
  totalUserMessages: number;
  totalAssistantResponses: number;
  executionModeDistribution: DistributionItem[];
  realProviderAcceptedRate: number;
  deterministicFallbackRate: number;
  insufficientEvidenceRate: number;
  failureRate: number;
  refusalRate: number;
  intentDistribution: DistributionItem[];
  capabilityDistribution: DistributionItem[];
  contextResolutionSuccessRate: number;
  averageIterations: number;
  averageToolCalls: number;
  averageRetrievalCalls: number;
  plannerInvocationCount: number;
  criticInvocationCount: number;
  validatedWorkflowCount: number;
  groundingValidRate: number;
  averageGroundingSupport: number | null; // ranking signal, NOT confidence
  qualityGateDistribution: DistributionItem[];
  latency: LatencyDistribution;
  feedbackCount: number;
  feedbackPositiveRate: number;
  feedbackReasonDistribution: DistributionItem[];
  realRejectionRate: number;
  llmOperatingMode: string;
}

export function buildAssistantObservability(ctx: RepoContext): AssistantObservability {
  const execs = fetchRows('assistant_executions', ctx);
  const feedback = fetchRows('assistant_feedback', ctx);
  const convs = fetchRows('copilot_conversations', ctx);
  const messages = fetchRows('copilot_messages', ctx);

  const n = execs.length;
  const supportVals = execs.map((r) => r.average_grounding_support).filter((v): v is number => typeof v === 'number');
  const avgSupport = supportVals.length ? Number((supportVals.reduce((s, v) => s + v, 0) / supportVals.length).toFixed(4)) : null;

  const realCount = countWhere(execs, (r) => r.execution_mode === 'REAL_PROVIDER');
  const realRejections = countWhere(execs, (r) => typeof r.fallback_reason === 'string' && (r.fallback_reason as string).startsWith('REAL_REJECTED'));
  const positive = countWhere(feedback, (r) => r.rating === 'THUMBS_UP');

  return {
    totalConversations: convs.length,
    totalUserMessages: countWhere(messages, (r) => r.role === 'user'),
    totalAssistantResponses: countWhere(messages, (r) => r.role === 'assistant'),
    executionModeDistribution: distribution(execs.map((r) => (r.execution_mode ? String(r.execution_mode) : null)), config.observability.maxDistributionItems),
    realProviderAcceptedRate: rate(realCount, n),
    deterministicFallbackRate: rate(countWhere(execs, (r) => r.execution_mode === 'DETERMINISTIC_FALLBACK'), n),
    insufficientEvidenceRate: rate(countWhere(execs, (r) => r.execution_mode === 'INSUFFICIENT_EVIDENCE'), n),
    failureRate: rate(countWhere(execs, (r) => r.status === 'FAILED'), n),
    refusalRate: rate(countWhere(execs, (r) => r.status === 'REFUSED'), n),
    intentDistribution: distribution(execs.map((r) => (r.intent ? String(r.intent) : null)), config.observability.maxDistributionItems),
    capabilityDistribution: distribution(execs.map((r) => (r.capability ? String(r.capability) : null)), config.observability.maxDistributionItems),
    contextResolutionSuccessRate: rate(countWhere(execs, (r) => num(r.context_resolved) === 1), n),
    averageIterations: n ? Number((execs.reduce((s, r) => s + num(r.iteration_count), 0) / n).toFixed(2)) : 0,
    averageToolCalls: n ? Number((execs.reduce((s, r) => s + num(r.tool_call_count), 0) / n).toFixed(2)) : 0,
    averageRetrievalCalls: n ? Number((execs.reduce((s, r) => s + num(r.retrieval_call_count), 0) / n).toFixed(2)) : 0,
    plannerInvocationCount: countWhere(execs, (r) => r.planner_execution_id !== null && r.planner_execution_id !== undefined),
    criticInvocationCount: countWhere(execs, (r) => r.critic_execution_id !== null && r.critic_execution_id !== undefined),
    validatedWorkflowCount: countWhere(execs, (r) => r.capability === 'VALIDATED_INVESTIGATION_ANALYSIS'),
    groundingValidRate: rate(countWhere(execs, (r) => r.grounding_status === 'GROUNDED'), n),
    averageGroundingSupport: avgSupport,
    qualityGateDistribution: distribution(execs.map((r) => (r.quality_gate ? String(r.quality_gate) : null)), config.observability.maxDistributionItems),
    latency: latencyDistribution(execs.map((r) => num(r.latency_ms))),
    feedbackCount: feedback.length,
    feedbackPositiveRate: rate(positive, feedback.length),
    feedbackReasonDistribution: distribution(feedback.map((r) => (r.reason ? String(r.reason) : null)), config.observability.maxDistributionItems),
    realRejectionRate: rate(realRejections, n),
    llmOperatingMode: isRealLlmConfigured() ? 'REAL_PROVIDER_CONFIGURED' : 'DETERMINISTIC_FALLBACK',
  };
}

/**
 * Advisory assistant governance alerts. Guarded so an offline/quiet system
 * raises no noise (rates require a non-zero population; the fallback-rate rule
 * only fires when a real provider is configured — offline fallback is expected).
 */
export function evaluateAssistantGovernance(range: ObservabilityTimeRange, m: AssistantObservability, execCount: number, startSeq: number): GovernanceAlert[] {
  const alerts: GovernanceAlert[] = [];
  let seq = startSeq;
  const add = (a: Omit<GovernanceAlert, 'alertId' | 'timeRange'>) => alerts.push({ ...a, alertId: `GOV-${++seq}`, timeRange: range });
  const a = config.assistant;
  const realConfigured = isRealLlmConfigured();

  if (execCount > 0) {
    if (realConfigured && m.deterministicFallbackRate > a.govFallbackRateMax) {
      add({ severity: 'WARNING', category: 'ASSISTANT', metric: 'assistant.deterministicFallbackRate', observedValue: m.deterministicFallbackRate, threshold: a.govFallbackRateMax, comparison: 'GREATER_THAN', description: 'A real provider is configured but the Assistant falls back to deterministic mode for most turns.', recommendedReviewAction: 'Review provider verification, structured-output validity, and grounding rejections.' });
    }
    if (m.failureRate > a.govFailureRateMax) {
      add({ severity: 'CRITICAL', category: 'ASSISTANT', metric: 'assistant.failureRate', observedValue: m.failureRate, threshold: a.govFailureRateMax, comparison: 'GREATER_THAN', description: 'The Assistant failure rate is elevated.', recommendedReviewAction: 'Inspect assistant execution failures and tool errors.' });
    }
    if (m.insufficientEvidenceRate > a.govInsufficientRateMax) {
      add({ severity: 'WARNING', category: 'ASSISTANT', metric: 'assistant.insufficientEvidenceRate', observedValue: m.insufficientEvidenceRate, threshold: a.govInsufficientRateMax, comparison: 'GREATER_THAN', description: 'A high share of Assistant turns return insufficient evidence.', recommendedReviewAction: 'Review knowledge coverage and retrieval quality.' });
    }
    if (m.groundingValidRate < a.govGroundingValidRateMin) {
      add({ severity: 'WARNING', category: 'ASSISTANT', metric: 'assistant.groundingValidRate', observedValue: m.groundingValidRate, threshold: a.govGroundingValidRateMin, comparison: 'LESS_THAN', description: 'Assistant grounding-valid rate is below the advisory threshold.', recommendedReviewAction: 'Review grounding validators and knowledge coverage.' });
    }
    if (realConfigured && m.realRejectionRate > a.govRealRejectionRateMax) {
      add({ severity: 'WARNING', category: 'ASSISTANT', metric: 'assistant.realRejectionRate', observedValue: m.realRejectionRate, threshold: a.govRealRejectionRateMax, comparison: 'GREATER_THAN', description: 'Most real-provider Assistant answers are rejected by the quality gate and degraded to fallback.', recommendedReviewAction: 'Review real-provider prompt/grounding; verify provider wiring.' });
    }
  }
  if (m.feedbackCount > 0 && (1 - m.feedbackPositiveRate) > a.govNegativeFeedbackRateMax) {
    add({ severity: 'WARNING', category: 'ASSISTANT', metric: 'assistant.negativeFeedbackRate', observedValue: Number((1 - m.feedbackPositiveRate).toFixed(4)), threshold: a.govNegativeFeedbackRateMax, comparison: 'GREATER_THAN', description: 'Negative Assistant feedback exceeds the advisory threshold.', recommendedReviewAction: 'Review low-rated conversations for grounding/clarity issues.' });
  }
  return alerts;
}
