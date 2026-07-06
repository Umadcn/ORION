/**
 * Bounded Planner Agent orchestration (Phase 6). READ-ONLY analysis assistance.
 *
 * Flow: context → plan (LlmRunner real OR deterministic) → validate/safety-gate →
 * bounded execution + Agentic RAG → deterministic grounded analysis → validate →
 * audit. Uses LlmRunner ONLY (no direct provider calls). Never mutates mission
 * state; the deterministic RCA is preserved exactly. Fallback is never labeled real.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config, isRealLlmConfigured } from '../config.js';
import { NotFoundError, InvalidTransitionError } from '../services/investigationService.js';
import { LlmRunner, llmRunner } from '../llm/runner.js';
import { resolveCitation } from '../knowledge/retrievalService.js';
import { PLAN_SCHEMA, PLAN_SCHEMA_NAME } from './schemas.js';
import { PLAN_VERSION, PLANNER_SYSTEM_PROMPT, buildPlannerUserPrompt } from './prompt.js';
import { buildPlannerContext } from './plannerContext.js';
import { buildDeterministicPlan } from './deterministicPlanner.js';
import { validatePlan } from './planValidator.js';
import { executePlan } from './planExecutor.js';
import { buildPlannerAnalysis } from './analysisBuilder.js';
import { validateAnalysis } from './plannerValidators.js';
import { createPlannerExecution, createRefinements, createStepExecutions } from './plannerAuditRepository.js';
import type { InvestigationPlan, PlannerExecutionResult } from './types.js';
import type { ToolContext } from '../copilot/types.js';
import type { Role } from '../auth/users.js';

export interface PlannerDeps { runner?: LlmRunner; realProviderAvailable?: boolean }

export class PlannerService {
  private runner: LlmRunner;
  private realAvailable: boolean;
  constructor(deps: PlannerDeps = {}) {
    this.runner = deps.runner ?? llmRunner;
    this.realAvailable = deps.realProviderAvailable ?? isRealLlmConfigured();
  }

  async analyze(params: { investigationId: number; userId: string; role: Role }): Promise<PlannerExecutionResult> {
    const started = Date.now();
    const correlationId = crypto.randomUUID();
    const ctx = buildPlannerContext(params.investigationId);
    if (!ctx) throw new NotFoundError(`Investigation ${params.investigationId} not found`);
    if (ctx.investigation.root_cause === null) throw new InvalidTransitionError('Planner analysis requires a completed root-cause analysis');

    const rootCause = ctx.investigation.root_cause;
    const expected = { investigationId: ctx.investigation.id, satelliteId: ctx.investigation.satellite_id };

    // --- Plan generation: real (LlmRunner) then validate/safety-gate, else deterministic. ---
    const deterministicPlan = buildDeterministicPlan(ctx);
    let plan: InvestigationPlan = deterministicPlan;
    let executionMode: PlannerExecutionResult['executionMode'] = 'DETERMINISTIC_FALLBACK';
    let fallbackReason: string | null = null;
    let provider: string | null = null;
    let model: string | null = null;

    if (this.realAvailable) {
      const resp = await this.runner.run<InvestigationPlan>({
        requestType: 'investigation-planner', promptVersion: PLAN_VERSION,
        messages: [{ role: 'system', content: PLANNER_SYSTEM_PROMPT }, { role: 'user', content: buildPlannerUserPrompt(ctx) }],
        structuredOutput: { name: PLAN_SCHEMA_NAME, schema: PLAN_SCHEMA },
        fallbackSeed: deterministicPlan, correlationId, investigationId: ctx.investigation.id,
      });
      provider = resp.provider; model = resp.model;
      if (resp.executionMode === 'REAL_PROVIDER' && resp.structured) {
        const v = validatePlan(resp.structured, expected);
        if (v.valid) { plan = resp.structured; executionMode = 'REAL_PROVIDER'; }
        else { fallbackReason = `REAL_PLAN_REJECTED:${v.errors[0] ?? 'invalid'}`; }
      } else {
        fallbackReason = 'NO_REAL_PROVIDER';
      }
    }

    // Safety net: the chosen plan MUST pass validation (deterministic always does).
    const chosenValidation = validatePlan(plan, expected);
    if (!chosenValidation.valid) { plan = deterministicPlan; executionMode = 'DETERMINISTIC_FALLBACK'; fallbackReason = fallbackReason ?? 'PLAN_INVALID'; }

    // --- Bounded execution + Agentic RAG. ---
    const execCtx: ToolContext = { userId: params.userId, role: params.role, correlationId };
    const exec = await executePlan(plan, ctx, execCtx);

    // --- Deterministic grounded analysis + validation. ---
    const analysis = buildPlannerAnalysis(ctx, exec.observations, exec.gaps);
    const validation = validateAnalysis(analysis, exec.grounding, rootCause);
    const groundingOk = validation.citationValid && validation.evidenceValid && validation.groundingValid && validation.policyValid;

    // Resolve citations for the response.
    const citeIds = new Set<string>(analysis.findings.flatMap((f) => f.citation_ids));
    const citations: PlannerExecutionResult['citations'] = [];
    for (const id of citeIds) { const r = resolveCitation(id); if (r) citations.push({ citationId: id, documentId: r.document.id, title: r.citation.title }); }
    const evidenceIds = Array.from(new Set(analysis.findings.flatMap((f) => f.evidence_ids)));

    const completed = exec.results.filter((r) => r.status === 'SUCCESS' || r.status === 'INTERNAL').length;
    const failed = exec.results.filter((r) => r.status === 'ERROR' || r.status === 'REJECTED').length;
    const latencyMs = Date.now() - started;
    const llmIds = (db.prepare('SELECT id FROM llm_executions WHERE correlation_id = ?').all(correlationId) as { id: number }[]).map((r) => r.id);

    // --- Audit. ---
    const plannerExecutionId = createPlannerExecution({
      correlation_id: correlationId, investigation_id: ctx.investigation.id, user_id: params.userId, execution_mode: executionMode,
      plan_version: plan.plan_version, plan_status: exec.planStatus, objective_summary: plan.objective.slice(0, 300),
      step_count: plan.steps.length, completed_step_count: completed, failed_step_count: failed, iteration_count: exec.iterationCount,
      tool_call_count: exec.toolCallCount, retrieval_call_count: exec.retrievalCallCount, knowledge_gap_count: exec.gaps.filter((g) => !g.sufficient).length,
      llm_execution_ids: llmIds, retrieval_execution_ids: exec.retrievalExecutionIds, citation_count: citations.length, evidence_count: evidenceIds.length,
      grounding_status: groundingOk ? 'GROUNDED' : 'INSUFFICIENT', latency_ms: latencyMs, fallback_reason: fallbackReason, failure_reason: null,
    });
    createStepExecutions(plannerExecutionId, exec.results);
    createRefinements(plannerExecutionId, exec.refinements);

    return {
      investigationId: ctx.investigation.id, plannerExecutionId, correlationId, executionMode, planStatus: exec.planStatus,
      provider, model, plan,
      stepSummaries: exec.results.map((r) => ({ stepId: r.stepId, stepType: r.stepType, status: r.status, toolName: r.toolName, outputSummary: r.outputSummary.slice(0, 200) })),
      retrievalRefinements: exec.refinements, analysis, citations, evidenceIds,
      knowledgeGaps: exec.gaps,
      diagnostics: {
        stepCount: plan.steps.length, completedStepCount: completed, failedStepCount: failed, iterationCount: exec.iterationCount,
        toolCallCount: exec.toolCallCount, retrievalCallCount: exec.retrievalCallCount, knowledgeGapCount: exec.gaps.filter((g) => !g.sufficient).length,
        citationCount: citations.length, evidenceCount: evidenceIds.length, groundingValid: groundingOk, policyValid: validation.policyValid,
        averageGroundingSupport: validation.averageSupport, terminationReason: exec.terminationReason,
      },
      fallbackReason, advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY',
    };
  }
}

export const plannerService = new PlannerService();
