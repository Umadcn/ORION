/**
 * Deterministic metric builders (Phase 8). Each consumes bounded rows from the
 * observability repository and produces a strongly-typed metric object using the
 * pure aggregation helpers. No mutation, no network, no LLM.
 *
 * Scores here are ranking/quality signals (grounding support, coverage rates,
 * evaluation metrics) — NEVER confidence. Deterministic fallback is counted and
 * labeled as such, never as real provider output.
 */
import { config } from '../config.js';
import { average, countWhere, distribution, latencyDistribution, rate, sum } from './aggregation.js';
import { fetchRows, countRows, distinctCount, jsonArrayLength, num, type RepoContext } from './observabilityRepository.js';
import type {
  CitationMetrics, CopilotMetrics, CriticMetrics, GenerationMetrics, GroundingMetrics,
  LlmMetrics, PipelineLinkageMetrics, PlannerMetrics, RetrievalEvaluationResult, RetrievalMetrics,
} from './types.js';

const D = () => config.observability.maxDistributionItems;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

// --- LLM -------------------------------------------------------------------

export function buildLlmMetrics(ctx: RepoContext): LlmMetrics {
  const rows = fetchRows('llm_executions', ctx);
  const total = rows.length;
  const real = countWhere(rows, (r) => r.execution_mode === 'REAL_PROVIDER');
  const fallback = countWhere(rows, (r) => r.execution_mode === 'DETERMINISTIC_FALLBACK');
  const failed = countWhere(rows, (r) => r.execution_mode === 'FAILED');
  const requested = countWhere(rows, (r) => num(r.structured_output_requested) === 1);
  const validStructured = countWhere(rows, (r) => num(r.structured_output_requested) === 1 && num(r.structured_output_valid) === 1);
  return {
    totalExecutions: total,
    realProviderCount: real, realProviderRate: rate(real, total),
    deterministicFallbackCount: fallback, deterministicFallbackRate: rate(fallback, total),
    failedCount: failed, failedRate: rate(failed, total),
    providerDistribution: distribution(rows.map((r) => s(r.provider)), D()),
    modelDistribution: distribution(rows.map((r) => s(r.model)), D()),
    requestTypeDistribution: distribution(rows.map((r) => s(r.request_type)), D()),
    structuredOutputRequestedRate: rate(requested, total),
    structuredOutputValidRate: rate(validStructured, requested),
    retryCountDistribution: distribution(rows.map((r) => String(num(r.retry_count))), D()),
    fallbackReasonDistribution: distribution(rows.map((r) => s(r.fallback_reason)), D(), 'NONE'),
    errorCodeDistribution: distribution(rows.map((r) => s(r.error_code)), D(), 'NONE'),
    inputTokenCount: sum(rows.map((r) => num(r.input_token_count))),
    outputTokenCount: sum(rows.map((r) => num(r.output_token_count))),
    totalTokenCount: sum(rows.map((r) => num(r.total_token_count))),
    latency: latencyDistribution(rows.map((r) => num(r.latency_ms))),
  };
}

// --- Retrieval -------------------------------------------------------------

function mapEval(r: Record<string, unknown>): RetrievalEvaluationResult {
  return {
    retrievalMode: String(r.retrieval_mode), datasetVersion: String(r.dataset_version), kValue: num(r.k_value),
    precisionAtK: num(r.precision_at_k), recallAtK: num(r.recall_at_k), mrr: num(r.mrr), hitRateAtK: num(r.hit_rate_at_k),
    ndcgAtK: r.ndcg_at_k === null || r.ndcg_at_k === undefined ? null : num(r.ndcg_at_k),
    averageLatencyMs: num(r.average_latency_ms), queryCount: num(r.query_count), createdAt: String(r.created_at),
  };
}

export function buildRetrievalMetrics(ctx: RepoContext): RetrievalMetrics {
  const rows = fetchRows('retrieval_executions', ctx);
  const total = rows.length;
  const embeddingUsed = countWhere(rows, (r) => typeof r.embedding_mode === 'string' && r.embedding_mode !== 'LOCAL_HASH_FALLBACK');
  const zeroResults = countWhere(rows, (r) => num(r.returned_count) === 0);
  const withVal = (col: string) => rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined).map((v) => num(v));

  const evalRows = fetchRows('retrieval_evaluation_runs', ctx).filter((r) => r.status === 'SUCCESS' || r.status === 'COMPLETED' || r.status === undefined || true).map(mapEval);
  const latestByMode = new Map<string, RetrievalEvaluationResult>();
  for (const e of evalRows) if (!latestByMode.has(e.retrievalMode)) latestByMode.set(e.retrievalMode, e); // rows are newest-first

  return {
    totalExecutions: total,
    retrievalModeDistribution: distribution(rows.map((r) => s(r.retrieval_mode)), D()),
    embeddingModeDistribution: distribution(rows.map((r) => s(r.embedding_mode)), D()),
    embeddingUsedRate: rate(embeddingUsed, total),
    averageVectorCandidateCount: average(withVal('vector_candidate_count')),
    averageBm25CandidateCount: average(withVal('bm25_candidate_count')),
    averageFusedCandidateCount: average(withVal('fused_candidate_count')),
    averageRerankedCandidateCount: average(withVal('reranked_candidate_count')),
    zeroResultRate: rate(zeroResults, total),
    latency: latencyDistribution(rows.map((r) => num(r.latency_ms))),
    latestEvaluationsByMode: [...latestByMode.values()].sort((a, b) => a.retrievalMode.localeCompare(b.retrievalMode)),
    evaluationHistory: evalRows.slice(0, config.observability.maxEvaluationHistory),
  };
}

// --- Grounded generation ---------------------------------------------------

export function buildGenerationMetrics(ctx: RepoContext): GenerationMetrics {
  const rows = fetchRows('grounded_generation_executions', ctx);
  const total = rows.length;
  const accepted = (mode: string) => countWhere(rows, (r) => String(r.generation_status).includes(mode));
  const rejectedReason = (reason: string) => countWhere(rows, (r) => typeof r.rejection_reason === 'string' && r.rejection_reason.toUpperCase().includes(reason));
  const flags = sum(rows.map((r) => num(r.injection_flag_count)));
  return {
    totalGenerations: total,
    statusDistribution: distribution(rows.map((r) => s(r.generation_status)), D()),
    realProviderAcceptedRate: rate(accepted('REAL_PROVIDER'), total),
    deterministicFallbackAcceptedRate: rate(accepted('DETERMINISTIC_FALLBACK'), total),
    rejectedSchemaCount: rejectedReason('SCHEMA'),
    rejectedCitationCount: rejectedReason('CITATION'),
    rejectedEvidenceCount: rejectedReason('EVIDENCE'),
    rejectedGroundingCount: rejectedReason('GROUNDING'),
    rejectedPolicyCount: rejectedReason('POLICY'),
    rejectedContextCount: rejectedReason('CONTEXT'),
    failureRate: rate(countWhere(rows, (r) => String(r.generation_status).includes('FAILED')), total),
    averageGroundingSupport: average(rows.map((r) => r.average_grounding_support).filter((v) => v !== null && v !== undefined).map((v) => num(v))),
    groundingValidRate: rate(countWhere(rows, (r) => num(r.grounding_valid) === 1), total),
    citationValidRate: rate(countWhere(rows, (r) => num(r.citation_valid) === 1), total),
    evidenceValidRate: rate(countWhere(rows, (r) => num(r.evidence_valid) === 1), total),
    policyValidRate: rate(countWhere(rows, (r) => num(r.policy_valid) === 1), total),
    injectionFlagCount: flags,
    injectionFlagRate: rate(countWhere(rows, (r) => num(r.injection_flag_count) > 0), total),
    averageClaimCount: average(rows.map((r) => num(r.claim_count))),
    latency: latencyDistribution(rows.map((r) => num(r.latency_ms))),
  };
}

// --- Copilot ---------------------------------------------------------------

export function buildCopilotMetrics(ctx: RepoContext): CopilotMetrics {
  const execs = fetchRows('copilot_executions', ctx);
  const tools = fetchRows('copilot_tool_executions', ctx);
  const total = execs.length;
  return {
    conversationCount: countRows('copilot_conversations', ctx),
    messageCount: countRows('copilot_messages', ctx),
    executionCount: total,
    executionModeDistribution: distribution(execs.map((r) => s(r.execution_mode)), D()),
    insufficientEvidenceRate: rate(countWhere(execs, (r) => r.generation_status === 'INSUFFICIENT_EVIDENCE'), total),
    failedRate: rate(countWhere(execs, (r) => r.generation_status === 'FAILED'), total),
    averageIterations: average(execs.map((r) => num(r.iteration_count))),
    averageToolCalls: average(execs.map((r) => num(r.tool_call_count))),
    toolUsageDistribution: distribution(tools.map((r) => s(r.tool_name)), D()),
    toolStatusDistribution: distribution(tools.map((r) => s(r.status)), D()),
    toolLatency: latencyDistribution(tools.map((r) => num(r.latency_ms))),
    groundingValidRate: rate(countWhere(execs, (r) => r.grounding_status === 'GROUNDED'), total),
    citationUsageCount: sum(execs.map((r) => num(r.citation_count))),
    evidenceUsageCount: sum(execs.map((r) => num(r.evidence_count))),
    fallbackReasonDistribution: distribution(execs.map((r) => s(r.fallback_reason)), D(), 'NONE'),
  };
}

// --- Planner ---------------------------------------------------------------

export function buildPlannerMetrics(ctx: RepoContext): PlannerMetrics {
  const rows = fetchRows('planner_executions', ctx);
  const total = rows.length;
  const statusRate = (st: string) => rate(countWhere(rows, (r) => r.plan_status === st), total);
  const refinements = countRows('planner_retrieval_refinements', ctx);
  return {
    totalExecutions: total,
    executionModeDistribution: distribution(rows.map((r) => s(r.execution_mode)), D()),
    statusDistribution: distribution(rows.map((r) => s(r.plan_status)), D()),
    completedRate: statusRate('COMPLETED'),
    partialRate: statusRate('PARTIAL'),
    timedOutRate: statusRate('TIMED_OUT'),
    iterationLimitRate: statusRate('ITERATION_LIMIT'),
    averageStepCount: average(rows.map((r) => num(r.step_count))),
    averageToolCalls: average(rows.map((r) => num(r.tool_call_count))),
    averageRetrievalCalls: average(rows.map((r) => num(r.retrieval_call_count))),
    averageRetrievalRefinements: total ? Number((refinements / total).toFixed(4)) : null,
    knowledgeGapFrequency: rate(countWhere(rows, (r) => num(r.knowledge_gap_count) > 0), total),
    groundedAnalysisRate: rate(countWhere(rows, (r) => r.grounding_status === 'GROUNDED'), total),
    averageCitations: average(rows.map((r) => num(r.citation_count))),
    averageEvidenceReferences: average(rows.map((r) => num(r.evidence_count))),
    fallbackReasonDistribution: distribution(rows.map((r) => s(r.fallback_reason)), D(), 'NONE'),
    latency: latencyDistribution(rows.map((r) => num(r.latency_ms))),
  };
}

// --- Critic ----------------------------------------------------------------

export function buildCriticMetrics(ctx: RepoContext): CriticMetrics {
  const rows = fetchRows('critic_executions', ctx);
  const issues = fetchRows('critic_issues', ctx);
  const attempts = fetchRows('critic_revision_attempts', ctx);
  const total = rows.length;
  const finalRate = (d: string) => rate(countWhere(rows, (r) => r.final_decision === d), total);
  const enteredRevision = countWhere(rows, (r) => r.initial_decision === 'REVISE');
  const revisedAccepted = countWhere(rows, (r) => r.critic_status === 'REVISED_ACCEPTED');
  const passSum = sum(rows.map((r) => num(r.coverage_pass_count)));
  const failSum = sum(rows.map((r) => num(r.coverage_fail_count)));
  return {
    totalExecutions: total,
    executionModeDistribution: distribution(rows.map((r) => s(r.execution_mode)), D()),
    initialDecisionDistribution: distribution(rows.map((r) => s(r.initial_decision)), D()),
    finalDecisionDistribution: distribution(rows.map((r) => s(r.final_decision)), D()),
    acceptRate: finalRate('ACCEPT'),
    reviseRate: finalRate('REVISE'),
    rejectRate: finalRate('REJECT'),
    revisedAcceptedRate: rate(revisedAccepted, total),
    revisionLimitReachedRate: rate(countWhere(rows, (r) => r.critic_status === 'REVISION_LIMIT_REACHED'), total),
    averageIssueCount: average(rows.map((r) => num(r.issue_count))),
    severityDistribution: distribution(issues.map((r) => s(r.severity)), D()),
    categoryDistribution: distribution(issues.map((r) => s(r.category)), D()),
    averageContradictionCount: average(rows.map((r) => num(r.contradiction_count))),
    coveragePassRate: rate(passSum, passSum + failSum),
    averageRevisionAttempts: average(rows.map((r) => num(r.revision_attempt_count))),
    revisionSuccessRate: rate(revisedAccepted, enteredRevision),
    repeatedAnalysisStopCount: countWhere(attempts, (r) => r.failure_reason === 'REPEATED_ANALYSIS'),
    repeatedReviewStopCount: countWhere(attempts, (r) => typeof r.failure_reason === 'string' && r.failure_reason.includes('REPEATED_REVIEW')),
    fallbackReasonDistribution: distribution(rows.map((r) => s(r.fallback_reason)), D(), 'NONE'),
    latency: latencyDistribution(rows.map((r) => num(r.latency_ms))),
  };
}

// --- Grounding + citation roll-ups -----------------------------------------

export function buildGroundingMetrics(ctx: RepoContext): GroundingMetrics {
  const gen = fetchRows('grounded_generation_executions', ctx);
  const planner = fetchRows('planner_executions', ctx);
  const sample = gen.length + planner.length;
  const supports = [
    ...gen.map((r) => r.average_grounding_support),
  ].filter((v) => v !== null && v !== undefined).map((v) => num(v));
  const groundedValid = countWhere(gen, (r) => num(r.grounding_valid) === 1) + countWhere(planner, (r) => r.grounding_status === 'GROUNDED');
  const policyValid = countWhere(gen, (r) => num(r.policy_valid) === 1);
  return {
    averageGroundingSupport: average(supports),
    groundingValidRate: rate(groundedValid, sample),
    policyValidRate: rate(policyValid, gen.length),
    sampleCount: sample,
  };
}

export function buildCitationMetrics(ctx: RepoContext): CitationMetrics {
  const gen = fetchRows('grounded_generation_executions', ctx);
  const planner = fetchRows('planner_executions', ctx);
  const copilot = fetchRows('copilot_executions', ctx);
  const citationValid = countWhere(gen, (r) => num(r.citation_valid) === 1);
  return {
    citationValidRate: rate(citationValid, gen.length),
    totalCitationsSurfaced: sum(gen.map((r) => num(r.included_citation_count))) + sum(planner.map((r) => num(r.citation_count))) + sum(copilot.map((r) => num(r.citation_count))),
    totalEvidenceReferenced: sum(gen.map((r) => num(r.included_evidence_count))) + sum(planner.map((r) => num(r.evidence_count))) + sum(copilot.map((r) => num(r.evidence_count))),
    sampleCount: gen.length + planner.length + copilot.length,
  };
}

// --- End-to-end linkage (explicit IDs only) --------------------------------

export function buildLinkageMetrics(ctx: RepoContext): PipelineLinkageMetrics {
  const planner = fetchRows('planner_executions', ctx);
  const critic = fetchRows('critic_executions', ctx);
  const gen = fetchRows('grounded_generation_executions', ctx);
  const llm = fetchRows('llm_executions', ctx);

  const plannerTotal = planner.length;
  const plannerWithRetrieval = countWhere(planner, (r) => jsonArrayLength(r.retrieval_execution_ids_json) > 0);
  const plannerWithLlm = countWhere(planner, (r) => jsonArrayLength(r.llm_execution_ids_json) > 0);
  const criticWithLlm = countWhere(critic, (r) => jsonArrayLength(r.llm_execution_ids_json) > 0);

  const plannerIdsWithCritic = new Set(critic.map((r) => r.planner_execution_id).filter((v) => v !== null && v !== undefined).map((v) => num(v)));
  const plannerIdsInRange = new Set(planner.map((r) => num(r.id)));
  const reviewedPlanners = [...plannerIdsWithCritic].filter((id) => plannerIdsInRange.has(id)).length;
  const orphanCritic = countWhere(critic, (r) => r.planner_execution_id === null || r.planner_execution_id === undefined);

  const genAccepted = countWhere(gen, (r) => num(r.grounding_valid) === 1 && !String(r.generation_status).includes('FAILED'));
  const plannerGrounded = countWhere(planner, (r) => r.grounding_status === 'GROUNDED');
  const groundedDenom = gen.length + plannerTotal;

  const enteredRevision = countWhere(critic, (r) => r.initial_decision === 'REVISE');
  const revisedAccepted = countWhere(critic, (r) => r.critic_status === 'REVISED_ACCEPTED');
  const llmFallback = countWhere(llm, (r) => r.execution_mode === 'DETERMINISTIC_FALLBACK');

  return {
    llmCorrelationCount: distinctCount('llm_executions', 'correlation_id', ctx),
    linkedRetrievalCount: plannerWithRetrieval,
    linkedLlmCount: plannerWithLlm + criticWithLlm,
    plannerToCriticReviewedCount: reviewedPlanners,
    plannerToCriticReviewRate: rate(reviewedPlanners, plannerTotal),
    orphanCriticCount: orphanCritic,
    plannerWithoutLlmCount: plannerTotal - plannerWithLlm,
    groundedOutputAcceptanceRate: rate(genAccepted + plannerGrounded, groundedDenom),
    revisionSuccessRate: rate(revisedAccepted, enteredRevision),
    humanReviewRequiredCount: countWhere(critic, (r) => num(r.human_review_required) === 1),
    deterministicFallbackDependencyRate: rate(llmFallback, llm.length),
  };
}
