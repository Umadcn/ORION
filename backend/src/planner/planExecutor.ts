/**
 * Bounded, dependency-aware plan executor with Agentic RAG (Phase 6).
 *
 * Executes read-only steps in validated (DAG) order, reusing the Phase 5 tool
 * executor (validation, timeout, output bounds, audit). Internal steps assess
 * knowledge gaps and drive bounded iterative retrieval (deterministic queries,
 * duplicate-query prevention, refinement + retrieval limits). All budgets are
 * enforced; there are no infinite loops.
 */
import { config } from '../config.js';
import { executeToolCall, type ToolAuditRef } from '../copilot/toolExecutor.js';
import { accumulate, createGroundingContext } from '../copilot/copilotContextBuilder.js';
import type { CopilotGroundingContext, ToolContext, ToolExecutionResult } from '../copilot/types.js';
import { toolForStep, isInternalStep } from './actionRegistry.js';
import { detectKnowledgeGap } from './knowledgeGapDetector.js';
import { buildRetrievalQuery } from './retrievalQueryBuilder.js';
import type { PlannerContext } from './plannerContext.js';
import type { InvestigationPlan, KnowledgeGap, PlanStatus, PlanStepResult, RetrievalRefinement } from './types.js';

export interface ExecutorObservations {
  investigation: Record<string, unknown> | null;
  evidence: { evidence_id: string; summary: string; supports_root_cause: boolean }[];
  telemetryLatest: Record<string, unknown> | null;
  alertsCount: number;
  knowledge: { citation_id: string; text: string }[];
  historical: { investigation_id: number; root_cause: string }[];
}

export interface ExecutorResult {
  results: PlanStepResult[];
  grounding: CopilotGroundingContext;
  observations: ExecutorObservations;
  refinements: RetrievalRefinement[];
  gaps: KnowledgeGap[];
  toolCallCount: number;
  retrievalCallCount: number;
  iterationCount: number;
  retrievalExecutionIds: number[];
  planStatus: PlanStatus;
  terminationReason: string;
}

export async function executePlan(plan: InvestigationPlan, ctx: PlannerContext, execCtx: ToolContext): Promise<ExecutorResult> {
  const started = Date.now();
  const grounding = createGroundingContext();
  const results: PlanStepResult[] = [];
  const refinements: RetrievalRefinement[] = [];
  const gaps: KnowledgeGap[] = [];
  const retrievalExecutionIds: number[] = [];
  const seenQueries = new Set<string>();
  const obs: ExecutorObservations = { investigation: null, evidence: [], telemetryLatest: null, alertsCount: 0, knowledge: [], historical: [] };

  let toolCallCount = 0;
  let retrievalCallCount = 0;
  let iterationCount = 0;
  let planStatus: PlanStatus = 'RUNNING';
  let terminationReason = 'COMPLETED';
  let budgetExhausted = false;

  const auditRef: ToolAuditRef = { correlationId: execCtx.correlationId, conversationId: `planner:${execCtx.correlationId}`, messageId: null, executionMode: 'DETERMINISTIC_FALLBACK' };

  const runTool = async (toolName: string, args: Record<string, unknown>, isRetrieval: boolean): Promise<ToolExecutionResult | null> => {
    if (toolCallCount >= config.planner.maxToolCalls) { budgetExhausted = true; return null; }
    if (isRetrieval && retrievalCallCount >= config.planner.maxRetrievalCalls) { budgetExhausted = true; return null; }
    toolCallCount++;
    if (isRetrieval) retrievalCallCount++;
    const res = await executeToolCall({ tool_call_id: `p${toolCallCount}`, tool_name: toolName, arguments: args }, execCtx, auditRef);
    accumulate(grounding, res);
    if (res.retrievalExecutionId) retrievalExecutionIds.push(res.retrievalExecutionId);
    captureObservation(obs, toolName, res);
    return res;
  };

  const gapInputs = () => ({
    evidenceCount: obs.evidence.length,
    hasTelemetry: obs.telemetryLatest !== null,
    citationCount: grounding.allowedCitationIds.size,
    historicalCount: obs.historical.length,
    subsystem: ctx.subsystem,
    anomalyTypes: ctx.anomalyTypes,
    rootCauseLabel: (ctx.investigation.root_cause ?? '').replace(/_/g, ' ').toLowerCase(),
  });

  for (const step of plan.steps) {
    if (Date.now() - started > config.planner.maxExecutionMs) { planStatus = 'TIMED_OUT'; terminationReason = 'TIMEOUT'; break; }
    if (iterationCount >= config.planner.maxIterations) { planStatus = 'ITERATION_LIMIT'; terminationReason = 'ITERATION_LIMIT'; break; }
    iterationCount++;
    const order = results.length + 1;

    if (isInternalStep(step.step_type)) {
      if (step.step_type === 'ASSESS_KNOWLEDGE_GAP') {
        // --- Agentic RAG: bounded iterative retrieval until sufficient. ---
        let gap = detectKnowledgeGap(gapInputs());
        gaps.push(gap);
        let iteration = 0;
        while (!gap.sufficient && iteration < config.planner.maxQueryRefinements && retrievalCallCount < config.planner.maxRetrievalCalls) {
          if (Date.now() - started > config.planner.maxExecutionMs) break;
          const evidenceTerms = obs.evidence.slice(0, 2).flatMap((e) => e.summary.split(/\s+/)).slice(0, 8);
          const built = buildRetrievalQuery({ satelliteId: ctx.investigation.satellite_id, subsystem: ctx.subsystem, anomalyTypes: ctx.anomalyTypes, rootCauseLabel: gapInputs().rootCauseLabel, evidenceTerms }, gap, iteration, seenQueries);
          if (!built) break; // duplicate query -> stop refining
          const before = grounding.allowedCitationIds.size;
          const res = await runTool('searchMissionKnowledge', { query: built.query, topK: 5 }, true);
          const after = grounding.allowedCitationIds.size;
          const g2 = detectKnowledgeGap(gapInputs());
          refinements.push({ iteration: iteration + 1, gapType: gap.type, queryHash: built.hash, querySummary: built.query.slice(0, 160), retrievalExecutionId: res?.retrievalExecutionId ?? null, resultCount: (res?.citations?.length ?? 0), newCitationCount: after - before, sufficiencyAfter: g2.sufficient });
          gap = g2;
          gaps.push(gap);
          iteration++;
          if (budgetExhausted) break;
        }
        results.push({ stepId: step.step_id, stepType: step.step_type, order, status: 'INTERNAL', toolName: null, toolExecutionId: null, retrievalExecutionId: null, inputSummary: '', outputSummary: `gap=${gap.type} sufficient=${gap.sufficient} refinements=${iteration}`, latencyMs: 0, errorCode: null, sanitizedError: null, output: gap });
      } else {
        // BUILD_FINAL_ANALYSIS is composed by the service after execution.
        results.push({ stepId: step.step_id, stepType: step.step_type, order, status: 'INTERNAL', toolName: null, toolExecutionId: null, retrievalExecutionId: null, inputSummary: '', outputSummary: 'final analysis composed post-execution', latencyMs: 0, errorCode: null, sanitizedError: null, output: null });
      }
      continue;
    }

    const toolName = toolForStep(step.step_type);
    if (!toolName) {
      results.push({ stepId: step.step_id, stepType: step.step_type, order, status: 'REJECTED', toolName: null, toolExecutionId: null, retrievalExecutionId: null, inputSummary: '', outputSummary: '', latencyMs: 0, errorCode: 'UNMAPPED_STEP', sanitizedError: 'no read-only action for step type', output: null });
      continue;
    }
    const isRetrieval = step.step_type === 'SEARCH_MISSION_KNOWLEDGE';
    const res = await runTool(toolName, step.parameters ?? {}, isRetrieval);
    if (!res) {
      results.push({ stepId: step.step_id, stepType: step.step_type, order, status: 'SKIPPED', toolName, toolExecutionId: null, retrievalExecutionId: null, inputSummary: '', outputSummary: 'skipped (budget exhausted)', latencyMs: 0, errorCode: 'BUDGET', sanitizedError: null, output: null });
      continue;
    }
    results.push({ stepId: step.step_id, stepType: step.step_type, order, status: res.status, toolName, toolExecutionId: null, retrievalExecutionId: res.retrievalExecutionId ?? null, inputSummary: res.inputSummary, outputSummary: res.outputSummary.slice(0, 500), latencyMs: res.latencyMs, errorCode: res.errorCode, sanitizedError: res.sanitizedError, output: res.output });
  }

  if (planStatus === 'RUNNING') {
    const skipped = results.some((r) => r.status === 'SKIPPED');
    planStatus = budgetExhausted || skipped ? 'PARTIAL' : 'COMPLETED';
    terminationReason = budgetExhausted ? 'BUDGET_EXHAUSTED' : 'COMPLETED';
  }

  return { results, grounding, observations: obs, refinements, gaps, toolCallCount, retrievalCallCount, iterationCount, retrievalExecutionIds, planStatus, terminationReason };
}

function captureObservation(obs: ExecutorObservations, toolName: string, res: ToolExecutionResult): void {
  if (res.status !== 'SUCCESS' || !res.output) return;
  const out = res.output as Record<string, unknown>;
  if (toolName === 'getInvestigation' && out.found) obs.investigation = out;
  else if (toolName === 'getEvidence' && Array.isArray(out.evidence)) obs.evidence = out.evidence as ExecutorObservations['evidence'];
  else if (toolName === 'getTelemetry' && out.latest) obs.telemetryLatest = out.latest as Record<string, unknown>;
  else if (toolName === 'getAlerts' && typeof out.count === 'number') obs.alertsCount = out.count;
  else if (toolName === 'searchMissionKnowledge' && Array.isArray(out.results)) {
    for (const r of out.results as { citation_id: string; text: string }[]) if (!obs.knowledge.some((k) => k.citation_id === r.citation_id)) obs.knowledge.push({ citation_id: r.citation_id, text: r.text });
  } else if (toolName === 'searchHistoricalInvestigations' && Array.isArray(out.results)) {
    obs.historical = out.results as ExecutorObservations['historical'];
  }
}
