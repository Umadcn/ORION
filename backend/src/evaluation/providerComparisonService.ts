/**
 * Real-vs-fallback comparison harness (Phase 9). Director/Admin, opt-in, bounded,
 * reproducible. Exercises the EXISTING Planner + Critic services through their
 * LlmRunner path in two arms (real vs deterministic fallback) over fixed
 * scenarios. Persists only bounded metrics. Never fabricates real results:
 * offline, the real arm degrades to fallback and is recorded as such.
 */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { config, isRealLlmConfigured, redactSecrets } from '../config.js';
import { PlannerService } from '../planner/plannerService.js';
import { CriticService } from '../critic/criticService.js';
import { createComparisonRun, createComparisonResult, msSinceLastVerification } from '../providers/providerRepository.js';
import type { Role } from '../auth/users.js';
import { COMPARISON_DATASET_VERSION, type ComparisonArm, type ComparisonResultRecord, type ComparisonRunResult, type ComparisonUseCase } from './providerComparisonTypes.js';

const USE_CASES: ComparisonUseCase[] = ['PLANNER', 'CRITIC'];

export class ProviderComparisonCooldownError extends Error {
  constructor() { super('Provider comparison cooldown active'); this.name = 'ProviderComparisonCooldownError'; }
}

/** Fixed, deterministic scenarios: seeded investigations that have an authoritative RCA. */
function scenarios(max: number): number[] {
  const rows = db.prepare('SELECT id FROM investigations WHERE root_cause IS NOT NULL ORDER BY id ASC LIMIT ?').all(Math.max(1, Math.min(max, config.providers.comparisonMaxScenarios))) as { id: number }[];
  return rows.map((r) => r.id);
}

function avg(nums: number[]): number | null {
  return nums.length ? Number((nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(2)) : null;
}
function rateOf(records: ComparisonResultRecord[], pred: (r: ComparisonResultRecord) => boolean): number | null {
  if (records.length === 0) return null;
  return Number((records.filter(pred).length / records.length).toFixed(4));
}

async function runPlanner(investigationId: number, arm: ComparisonArm, userId: string, role: Role): Promise<ComparisonResultRecord> {
  const started = Date.now();
  const svc = new PlannerService({ realProviderAvailable: arm === 'REAL_PROVIDER' });
  try {
    const r = await svc.analyze({ investigationId, userId, role });
    return {
      scenarioKey: `inv-${investigationId}`, arm, useCase: 'PLANNER', executionMode: r.executionMode,
      structuredOutputValid: r.executionMode === 'REAL_PROVIDER' ? true : null,
      groundingValid: r.diagnostics.groundingValid, citationValid: r.citations.length > 0 ? true : null,
      evidenceValid: r.evidenceIds.length > 0 ? true : null, policyValid: r.diagnostics.policyValid,
      fallbackOccurred: r.executionMode === 'DETERMINISTIC_FALLBACK', failed: r.executionMode === 'FAILED',
      averageGroundingSupport: r.diagnostics.averageGroundingSupport, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null,
    };
  } catch {
    return { scenarioKey: `inv-${investigationId}`, arm, useCase: 'PLANNER', executionMode: 'FAILED', structuredOutputValid: null, groundingValid: null, citationValid: null, evidenceValid: null, policyValid: null, fallbackOccurred: false, failed: true, averageGroundingSupport: null, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null };
  }
}

async function runCritic(investigationId: number, arm: ComparisonArm, userId: string, role: Role): Promise<ComparisonResultRecord | null> {
  // Obtain a planner execution to review (deterministic, reproducible).
  const plannerExec = await new PlannerService({ realProviderAvailable: false }).analyze({ investigationId, userId, role });
  if (!plannerExec.plannerExecutionId) return null;
  const started = Date.now();
  const svc = new CriticService({ realProviderAvailable: arm === 'REAL_PROVIDER' });
  try {
    const r = await svc.review({ plannerExecutionId: plannerExec.plannerExecutionId, userId, role });
    return {
      scenarioKey: `inv-${investigationId}`, arm, useCase: 'CRITIC', executionMode: r.executionMode,
      structuredOutputValid: r.executionMode === 'REAL_PROVIDER' ? true : null,
      groundingValid: r.diagnostics.criticalCount === 0 ? true : false, citationValid: null, evidenceValid: null,
      policyValid: r.finalDecision !== 'REJECT' ? true : false,
      fallbackOccurred: r.executionMode === 'DETERMINISTIC_FALLBACK', failed: r.executionMode === 'FAILED',
      averageGroundingSupport: r.diagnostics.averageGroundingSupport, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null,
    };
  } catch {
    return { scenarioKey: `inv-${investigationId}`, arm, useCase: 'CRITIC', executionMode: 'FAILED', structuredOutputValid: null, groundingValid: null, citationValid: null, evidenceValid: null, policyValid: null, fallbackOccurred: false, failed: true, averageGroundingSupport: null, latencyMs: Date.now() - started, inputTokens: null, outputTokens: null };
  }
}

export interface ComparisonParams {
  userId: string;
  role: Role;
  maxScenarios?: number;
  nowMs?: () => number;
}

export async function runComparison(params: ComparisonParams): Promise<ComparisonRunResult> {
  const nowMs = params.nowMs ?? (() => Date.now());
  // Cooldown guard shared with verification (comparison consumes provider quota).
  const since = msSinceLastVerification('LLM', nowMs());
  if (since !== null && since < config.providers.comparisonCooldownMs && isRealLlmConfigured()) {
    throw new ProviderComparisonCooldownError();
  }

  const correlationId = crypto.randomUUID();
  const realAvailable = isRealLlmConfigured();
  const ids = scenarios(params.maxScenarios ?? config.providers.comparisonMaxScenarios);
  const results: ComparisonResultRecord[] = [];
  let status: 'COMPLETED' | 'FAILED' = 'COMPLETED';
  let errMsg: string | null = null;

  try {
    for (const id of ids) {
      for (const arm of ['REAL_PROVIDER', 'DETERMINISTIC_FALLBACK'] as ComparisonArm[]) {
        for (const uc of USE_CASES) {
          const rec = uc === 'PLANNER' ? await runPlanner(id, arm, params.userId, params.role) : await runCritic(id, arm, params.userId, params.role);
          if (rec) results.push(rec);
        }
      }
    }
  } catch (err) {
    status = 'FAILED';
    errMsg = redactSecrets((err as Error).message).slice(0, 300);
  }

  const realArm = results.filter((r) => r.arm === 'REAL_PROVIDER');
  const fbArm = results.filter((r) => r.arm === 'DETERMINISTIC_FALLBACK');
  const realAcceptedCount = realArm.filter((r) => r.executionMode === 'REAL_PROVIDER').length;
  const realFailedCount = realArm.filter((r) => r.failed).length;
  const fallbackCount = realArm.filter((r) => r.fallbackOccurred).length;
  const realGroundingValidRate = rateOf(realArm, (r) => r.groundingValid === true);
  const fallbackGroundingValidRate = rateOf(fbArm, (r) => r.groundingValid === true);
  const realAvgLatencyMs = avg(realArm.map((r) => r.latencyMs));
  const fallbackAvgLatencyMs = avg(fbArm.map((r) => r.latencyMs));

  const runId = createComparisonRun({
    correlation_id: correlationId, dataset_version: COMPARISON_DATASET_VERSION, scenario_count: ids.length, real_available: realAvailable,
    real_accepted_count: realAcceptedCount, real_failed_count: realFailedCount, fallback_count: fallbackCount,
    real_grounding_valid_rate: realGroundingValidRate, fallback_grounding_valid_rate: fallbackGroundingValidRate,
    real_avg_latency_ms: realAvgLatencyMs, fallback_avg_latency_ms: fallbackAvgLatencyMs, status, created_by: params.userId, sanitized_error_message: errMsg,
  });
  for (const r of results) {
    createComparisonResult(runId, {
      scenario_key: r.scenarioKey, arm: r.arm, use_case: r.useCase, execution_mode: r.executionMode,
      structured_output_valid: r.structuredOutputValid, grounding_valid: r.groundingValid, citation_valid: r.citationValid,
      evidence_valid: r.evidenceValid, policy_valid: r.policyValid, fallback_occurred: r.fallbackOccurred, failed: r.failed,
      average_grounding_support: r.averageGroundingSupport, latency_ms: r.latencyMs, input_tokens: r.inputTokens, output_tokens: r.outputTokens,
    });
  }

  return {
    comparisonRunId: runId, correlationId, datasetVersion: COMPARISON_DATASET_VERSION, scenarioCount: ids.length, realAvailable,
    realAcceptedCount, realFailedCount, fallbackCount, realGroundingValidRate, fallbackGroundingValidRate, realAvgLatencyMs, fallbackAvgLatencyMs, status, results,
  };
}
