/**
 * Bounded Critic Agent orchestration + Reflection/Revision loop (Phase 7).
 * READ-ONLY analysis-quality review of a Planner analysis before human review.
 *
 * Flow: build context → critique (LlmRunner real OR deterministic) → validate +
 * deterministic coverage/contradiction/decision verification → ACCEPT/REVISE/
 * REJECT. On REVISE: a SEPARATE bounded RevisionService produces a revised
 * analysis, which passes the full validation pipeline before the Critic
 * re-evaluates it. The loop is strictly bounded (attempts, calls, time, repeated
 * review/analysis detection). Uses LlmRunner ONLY (no direct provider calls).
 * Never mutates mission state; the deterministic RCA is preserved exactly.
 * Deterministic-fallback output is never labeled real.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config, isRealLlmConfigured } from '../config.js';
import { NotFoundError } from '../services/investigationService.js';
import { LlmRunner, llmRunner } from '../llm/runner.js';
import { plannerService as defaultPlannerService, PlannerService } from '../planner/plannerService.js';
import type { CopilotGroundingContext } from '../copilot/types.js';
import type { Role } from '../auth/users.js';
import type { PlannerAnalysis } from '../planner/types.js';
import { CRITIC_REVIEW_SCHEMA, CRITIC_REVIEW_SCHEMA_NAME } from './schemas.js';
import { CRITIC_VERSION, CRITIC_SYSTEM_PROMPT, buildCriticUserPrompt } from './prompt.js';
import { buildCriticContext } from './criticContextBuilder.js';
import { buildCriticGroundingContext, stableHash } from './criticGrounding.js';
import { deterministicCritic, issueSeverities } from './deterministicCritic.js';
import { validateCriticReview, validateRevisedAnalysis } from './criticValidators.js';
import { reviseAnalysis } from './revisionService.js';
import { createCriticExecution, createCriticIssues, createCriticRevisionAttempts } from './criticAuditRepository.js';
import type {
  ContradictionFinding, CoverageResult, CriticContext, CriticDecision, CriticExecutionMode,
  CriticExecutionResult, CriticReview, CriticStatus, RevisionAttempt,
} from './types.js';

export interface CriticDeps {
  runner?: LlmRunner;
  realProviderAvailable?: boolean;
  plannerService?: PlannerService;
}

interface CritiqueOutcome {
  review: CriticReview;
  mode: CriticExecutionMode;
  fallbackReason: string | null;
  coverage: CoverageResult;
  contradictions: ContradictionFinding[];
  averageGroundingSupport: number | null;
}

export class CriticService {
  private runner: LlmRunner;
  private realAvailable: boolean;
  private planner: PlannerService;

  constructor(deps: CriticDeps = {}) {
    this.runner = deps.runner ?? llmRunner;
    this.realAvailable = deps.realProviderAvailable ?? isRealLlmConfigured();
    this.planner = deps.plannerService ?? defaultPlannerService;
  }

  /**
   * Produce a critique for one analysis. Always computes the deterministic
   * critique; when a real provider is available it also runs the LLM and adopts
   * the real review ONLY if it passes schema + safety + decision-consistency
   * validation AND does not disagree with a deterministic CRITICAL finding.
   */
  private async critique(ctx: CriticContext, grounding: CopilotGroundingContext, correlationId: string): Promise<CritiqueOutcome> {
    const det = deterministicCritic(ctx, grounding);
    if (!this.realAvailable) {
      return { review: det.review, mode: 'DETERMINISTIC_FALLBACK', fallbackReason: 'NO_REAL_PROVIDER', coverage: det.coverage, contradictions: det.contradictions, averageGroundingSupport: det.averageGroundingSupport };
    }

    const resp = await this.runner.run<CriticReview>({
      requestType: 'planner-critic-review',
      promptVersion: CRITIC_VERSION,
      messages: [{ role: 'system', content: CRITIC_SYSTEM_PROMPT }, { role: 'user', content: buildCriticUserPrompt(ctx) }],
      structuredOutput: { name: CRITIC_REVIEW_SCHEMA_NAME, schema: CRITIC_REVIEW_SCHEMA },
      fallbackSeed: det.review,
      correlationId,
      investigationId: ctx.investigationId,
    });

    if (resp.executionMode === 'REAL_PROVIDER' && resp.structured) {
      const v = validateCriticReview(resp.structured, ctx, grounding);
      // Deterministic safety cross-check: a real ACCEPT/REVISE must not hide a
      // deterministic CRITICAL contradiction.
      const detCritical = det.contradictions.some((c) => c.severity === 'CRITICAL');
      const realHidesCritical = detCritical && resp.structured.decision !== 'REJECT';
      if (v.valid && !realHidesCritical) {
        return { review: resp.structured, mode: 'REAL_PROVIDER', fallbackReason: null, coverage: det.coverage, contradictions: det.contradictions, averageGroundingSupport: det.averageGroundingSupport };
      }
      return { review: det.review, mode: 'DETERMINISTIC_FALLBACK', fallbackReason: `REAL_REVIEW_REJECTED:${realHidesCritical ? 'HIDES_CRITICAL' : v.errors[0] ?? 'invalid'}`, coverage: det.coverage, contradictions: det.contradictions, averageGroundingSupport: det.averageGroundingSupport };
    }
    return { review: det.review, mode: 'DETERMINISTIC_FALLBACK', fallbackReason: 'NO_REAL_PROVIDER', coverage: det.coverage, contradictions: det.contradictions, averageGroundingSupport: det.averageGroundingSupport };
  }

  async review(params: { plannerExecutionId: number; userId: string; role: Role }): Promise<CriticExecutionResult> {
    const started = Date.now();
    const correlationId = crypto.randomUUID();
    const ctx = await buildCriticContext({ plannerExecutionId: params.plannerExecutionId, userId: params.userId, role: params.role }, { plannerService: this.planner });
    if (!ctx) throw new NotFoundError(`Planner execution ${params.plannerExecutionId} not found`);

    const grounding = buildCriticGroundingContext(ctx);

    // --- Initial critique. ---
    let outcome = await this.critique(ctx, grounding, correlationId);
    let criticCalls = 1;
    const initialDecision = outcome.review.decision;

    let currentAnalysis: PlannerAnalysis = ctx.analysis;
    let review = outcome.review;
    let mode = outcome.mode;
    let fallbackReason = outcome.fallbackReason;
    let finalCoverage = outcome.coverage;
    let finalContradictions = outcome.contradictions;
    let avgSupport = outcome.averageGroundingSupport;

    const attempts: RevisionAttempt[] = [];
    let status: CriticStatus;
    let terminationReason: string;
    let finalDecision: CriticDecision = review.decision;

    if (review.decision === 'ACCEPT') {
      status = 'ACCEPTED';
      terminationReason = 'ACCEPTED_INITIAL';
    } else if (review.decision === 'REJECT') {
      status = 'REJECTED';
      terminationReason = 'REJECTED_INITIAL';
    } else {
      // --- Bounded Reflection/Revision loop. ---
      status = 'REVISION_REQUIRED';
      terminationReason = 'REVISION_LIMIT';
      let prevAnalysisHash = stableHash(currentAnalysis);
      let prevCritiqueHash = stableHash(review);

      for (let attempt = 1; attempt <= config.critic.maxRevisionAttempts; attempt++) {
        if (Date.now() - started > config.critic.maxExecutionMs) { status = 'TIMED_OUT'; terminationReason = 'TIMEOUT'; break; }
        if (criticCalls >= config.critic.maxCalls) { terminationReason = 'CALL_LIMIT'; break; }
        const attemptStart = Date.now();

        const candidate = reviseAnalysis(currentAnalysis, review, ctx);
        const candHash = stableHash(candidate);
        const validation = validateRevisedAnalysis(candidate, ctx, grounding);

        if (!validation.valid) {
          attempts.push({ attemptNumber: attempt, inputAnalysisHash: prevAnalysisHash, critiqueHash: prevCritiqueHash, outputAnalysisHash: candHash, validationStatus: 'INVALID', criticDecisionAfter: review.decision, issueCountAfter: review.issues.length, latencyMs: Date.now() - attemptStart, failureReason: validation.errors[0] ?? 'INVALID' });
          terminationReason = 'REVISION_VALIDATION_FAILED';
          break;
        }
        if (candHash === prevAnalysisHash) {
          attempts.push({ attemptNumber: attempt, inputAnalysisHash: prevAnalysisHash, critiqueHash: prevCritiqueHash, outputAnalysisHash: candHash, validationStatus: 'NO_PROGRESS', criticDecisionAfter: review.decision, issueCountAfter: review.issues.length, latencyMs: Date.now() - attemptStart, failureReason: 'REPEATED_ANALYSIS' });
          terminationReason = 'REPEATED_ANALYSIS';
          break;
        }

        // Re-evaluate the revised candidate.
        const ctx2: CriticContext = { ...ctx, analysis: candidate };
        const next = await this.critique(ctx2, grounding, correlationId);
        criticCalls++;
        mode = next.mode;
        fallbackReason = next.fallbackReason ?? fallbackReason;
        finalCoverage = next.coverage;
        finalContradictions = next.contradictions;
        avgSupport = next.averageGroundingSupport;
        const critiqueHash = stableHash(next.review);

        attempts.push({ attemptNumber: attempt, inputAnalysisHash: prevAnalysisHash, critiqueHash, outputAnalysisHash: candHash, validationStatus: 'VALID', criticDecisionAfter: next.review.decision, issueCountAfter: next.review.issues.length, latencyMs: Date.now() - attemptStart, failureReason: null });

        currentAnalysis = candidate;
        review = next.review;
        finalDecision = next.review.decision;

        if (next.review.decision === 'ACCEPT') { status = 'REVISED_ACCEPTED'; terminationReason = 'REVISED_ACCEPTED'; break; }
        if (next.review.decision === 'REJECT') { status = 'REJECTED'; terminationReason = 'REJECTED_AFTER_REVISION'; break; }

        // Still REVISE — repeated-review detection (no new critique signal).
        if (critiqueHash === prevCritiqueHash) { status = 'REVISION_LIMIT_REACHED'; terminationReason = 'REPEATED_REVIEW'; break; }
        prevAnalysisHash = candHash;
        prevCritiqueHash = critiqueHash;
      }

      if (status === 'REVISION_REQUIRED') status = attempts.length > 0 ? 'REVISION_LIMIT_REACHED' : 'REVISION_REQUIRED';
    }

    // --- Diagnostics + audit. ---
    const sev = issueSeverities(review);
    const latencyMs = Date.now() - started;
    const llmIds = (db.prepare('SELECT id FROM llm_executions WHERE correlation_id = ?').all(correlationId) as { id: number }[]).map((r) => r.id);

    const criticExecutionId = createCriticExecution({
      correlation_id: correlationId, investigation_id: ctx.investigationId, planner_execution_id: ctx.plannerExecutionId, user_id: params.userId,
      execution_mode: mode, review_version: CRITIC_VERSION, critic_status: status, initial_decision: initialDecision, final_decision: finalDecision,
      issue_count: review.issues.length, warning_count: sev.warningCount, error_count: sev.errorCount, critical_count: sev.criticalCount,
      coverage_pass_count: finalCoverage.passCount, coverage_fail_count: finalCoverage.failCount, contradiction_count: finalContradictions.length,
      revision_attempt_count: attempts.length, llm_execution_ids: llmIds, latency_ms: latencyMs, fallback_reason: fallbackReason, failure_reason: null,
      human_review_required: true,
    });
    createCriticIssues(criticExecutionId, review, attempts.length, false);
    createCriticRevisionAttempts(criticExecutionId, attempts);

    return {
      criticExecutionId,
      plannerExecutionId: ctx.plannerExecutionId,
      investigationId: ctx.investigationId,
      correlationId,
      executionMode: mode,
      criticStatus: status,
      initialDecision,
      finalDecision,
      review,
      revisionAttempts: attempts,
      finalAnalysis: currentAnalysis,
      coverage: review.coverage,
      contradictions: finalContradictions,
      diagnostics: {
        issueCount: review.issues.length, warningCount: sev.warningCount, errorCount: sev.errorCount, criticalCount: sev.criticalCount,
        coveragePassCount: finalCoverage.passCount, coverageFailCount: finalCoverage.failCount, contradictionCount: finalContradictions.length,
        revisionAttemptCount: attempts.length, criticCallCount: criticCalls, averageGroundingSupport: avgSupport, terminationReason,
      },
      fallbackReason,
      advisoryLabel: 'ANALYSIS_ASSISTANCE_ONLY',
      humanReviewRequired: true,
    };
  }
}

export const criticService = new CriticService();
