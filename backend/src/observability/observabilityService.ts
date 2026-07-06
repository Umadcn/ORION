/**
 * Read-only observability service (Phase 8). Assembles the snapshot, overview,
 * time-series, evaluation summary, and governance status from the metric
 * builders. Deterministic; `now` is injected for tests. Never mutates state.
 */
import { now as dbNow } from '../db.js';
import { config, isRealLlmConfigured, isRealEmbeddingConfigured, describeObservabilityConfig } from '../config.js';
import { fetchRows, makeRepoContext, num, type RepoContext } from './observabilityRepository.js';
import {
  buildCitationMetrics, buildCopilotMetrics, buildCriticMetrics, buildGenerationMetrics,
  buildGroundingMetrics, buildLinkageMetrics, buildLlmMetrics, buildPlannerMetrics, buildRetrievalMetrics,
} from './metrics.js';
import { evaluateGovernance } from './governance.js';
import { buildProviderObservability, evaluateProviderGovernance } from './providerMetrics.js';
import { buildAssistantObservability, evaluateAssistantGovernance } from './assistantMetrics.js';
import { rangeWindowMs } from './aggregation.js';
import type {
  AiObservabilitySnapshot, AiSystemOverview, EvaluationSummary, GovernanceStatus,
  ObservabilityTimeRange, TimeSeriesPoint,
} from './types.js';

/** Allowlisted time-series metrics → (table, per-bucket reducer). */
const TIMESERIES: Record<string, { table: string; reduce: (rows: Record<string, unknown>[]) => number }> = {
  ai_executions: { table: 'llm_executions', reduce: (r) => r.length },
  llm_real_provider_rate: { table: 'llm_executions', reduce: (r) => (r.length ? Number((r.filter((x) => x.execution_mode === 'REAL_PROVIDER').length / r.length).toFixed(4)) : 0) },
  llm_fallback_rate: { table: 'llm_executions', reduce: (r) => (r.length ? Number((r.filter((x) => x.execution_mode === 'DETERMINISTIC_FALLBACK').length / r.length).toFixed(4)) : 0) },
  llm_latency_avg: { table: 'llm_executions', reduce: (r) => (r.length ? Number((r.reduce((s, x) => s + num(x.latency_ms), 0) / r.length).toFixed(2)) : 0) },
  retrieval_executions: { table: 'retrieval_executions', reduce: (r) => r.length },
  generation_executions: { table: 'grounded_generation_executions', reduce: (r) => r.length },
  copilot_executions: { table: 'copilot_executions', reduce: (r) => r.length },
  planner_executions: { table: 'planner_executions', reduce: (r) => r.length },
  critic_executions: { table: 'critic_executions', reduce: (r) => r.length },
  assistant_executions: { table: 'assistant_executions', reduce: (r) => r.length },
  assistant_real_provider_rate: { table: 'assistant_executions', reduce: (r) => (r.length ? Number((r.filter((x) => x.execution_mode === 'REAL_PROVIDER').length / r.length).toFixed(4)) : 0) },
};

export const TIMESERIES_METRICS = Object.keys(TIMESERIES);
export function isValidTimeseriesMetric(m: unknown): m is string {
  return typeof m === 'string' && Object.prototype.hasOwnProperty.call(TIMESERIES, m);
}

export class ObservabilityService {
  private nowIso: () => string;
  constructor(nowFn?: () => string) {
    this.nowIso = nowFn ?? dbNow;
  }

  status() {
    return {
      read_only: true,
      config: describeObservabilityConfig(),
      llm_operating_mode: isRealLlmConfigured() ? 'REAL_PROVIDER_CONFIGURED' : 'DETERMINISTIC_FALLBACK',
      embedding_operating_mode: isRealEmbeddingConfigured() ? 'REAL_EMBEDDING_PROVIDER' : 'LOCAL_HASH_FALLBACK',
      offline_mode: !isRealLlmConfigured(),
      time_series_metrics: TIMESERIES_METRICS,
      time_ranges: ['24H', '7D', '30D', 'ALL'],
    };
  }

  private ctx(range: ObservabilityTimeRange): RepoContext {
    return makeRepoContext(range, this.nowIso());
  }

  buildSnapshot(range: ObservabilityTimeRange): AiObservabilitySnapshot {
    const ctx = this.ctx(range);
    const llm = buildLlmMetrics(ctx);
    const retrieval = buildRetrievalMetrics(ctx);
    const generation = buildGenerationMetrics(ctx);
    const copilot = buildCopilotMetrics(ctx);
    const planner = buildPlannerMetrics(ctx);
    const critic = buildCriticMetrics(ctx);
    const grounding = buildGroundingMetrics(ctx);
    const citation = buildCitationMetrics(ctx);
    const linkage = buildLinkageMetrics(ctx);
    const providers = buildProviderObservability(ctx);
    const assistant = buildAssistantObservability(ctx);
    const governance = evaluateGovernance({ range, llm, retrieval, generation, copilot, planner, critic, linkage, realProviderConfigured: isRealLlmConfigured() });
    // Merge Phase 9 provider + Phase 10 assistant governance alerts into the advisory status.
    const providerAlerts = evaluateProviderGovernance(range, providers, governance.alerts.length);
    const assistantAlerts = evaluateAssistantGovernance(range, assistant, assistant.totalAssistantResponses, governance.alerts.length + providerAlerts.length);
    const extraAlerts = [...providerAlerts, ...assistantAlerts];
    if (extraAlerts.length) {
      governance.alerts = [...governance.alerts, ...extraAlerts].sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || a.alertId.localeCompare(b.alertId));
      governance.alertCount = governance.alerts.length;
      governance.criticalCount = governance.alerts.filter((a) => a.severity === 'CRITICAL').length;
      governance.warningCount = governance.alerts.filter((a) => a.severity === 'WARNING').length;
      governance.infoCount = governance.alerts.filter((a) => a.severity === 'INFO').length;
    }
    const overview = this.composeOverview(range, { llm, retrieval, generation, copilot, planner, critic, linkage, governance });
    return { timeRange: range, generatedAt: this.nowIso(), overview, llm, retrieval, generation, copilot, planner, critic, grounding, citation, linkage, providers, assistant, governance };
  }

  getOverview(range: ObservabilityTimeRange): AiSystemOverview {
    return this.buildSnapshot(range).overview;
  }

  private composeOverview(
    range: ObservabilityTimeRange,
    m: Pick<AiObservabilitySnapshot, 'llm' | 'retrieval' | 'generation' | 'copilot' | 'planner' | 'critic' | 'linkage' | 'governance'>,
  ): AiSystemOverview {
    const totalAiExecutions = m.llm.totalExecutions + m.retrieval.totalExecutions + m.generation.totalGenerations + m.copilot.executionCount + m.planner.totalExecutions + m.critic.totalExecutions;
    const bestNdcg = m.retrieval.latestEvaluationsByMode.reduce<number | null>((best, e) => (e.ndcgAtK !== null && (best === null || e.ndcgAtK > best) ? e.ndcgAtK : best), null);
    const criticAcceptance = m.critic.totalExecutions > 0 ? Number(((m.critic.acceptRate * m.critic.totalExecutions + m.critic.revisedAcceptedRate * m.critic.totalExecutions) / m.critic.totalExecutions).toFixed(4)) : 0;
    return {
      timeRange: range,
      generatedAt: this.nowIso(),
      totalAiExecutions,
      realProviderRate: m.llm.realProviderRate,
      deterministicFallbackRate: m.llm.deterministicFallbackRate,
      groundedOutputAcceptanceRate: m.linkage.groundedOutputAcceptanceRate,
      retrievalNdcgAtK: bestNdcg,
      criticAcceptanceRate: criticAcceptance,
      governanceAlertCount: m.governance.alertCount,
      offlineMode: !isRealLlmConfigured(),
      llmOperatingMode: isRealLlmConfigured() ? 'REAL_PROVIDER_CONFIGURED' : 'DETERMINISTIC_FALLBACK',
      embeddingOperatingMode: isRealEmbeddingConfigured() ? 'REAL_EMBEDDING_PROVIDER' : 'LOCAL_HASH_FALLBACK',
    };
  }

  getGovernance(range: ObservabilityTimeRange): GovernanceStatus {
    return this.buildSnapshot(range).governance;
  }

  getEvaluations(): EvaluationSummary {
    const ctx = this.ctx('ALL');
    const retrieval = buildRetrievalMetrics(ctx);
    const bestNdcgMode = retrieval.latestEvaluationsByMode.reduce<{ mode: string | null; ndcg: number }>((best, e) => (e.ndcgAtK !== null && e.ndcgAtK > best.ndcg ? { mode: e.retrievalMode, ndcg: e.ndcgAtK } : best), { mode: null, ndcg: -1 }).mode;
    return { latestByMode: retrieval.latestEvaluationsByMode, history: retrieval.evaluationHistory, bestNdcgMode };
  }

  /** Bucketed time series for an allowlisted metric over the range window. */
  getTimeseries(metric: string, range: ObservabilityTimeRange): { metric: string; range: ObservabilityTimeRange; points: TimeSeriesPoint[] } {
    const spec = TIMESERIES[metric];
    if (!spec) throw new Error(`observability: metric not allowlisted: ${metric}`);
    const ctx = this.ctx(range);
    const rows = fetchRows(spec.table, ctx);

    const nowMs = new Date(this.nowIso()).getTime();
    const win = rangeWindowMs(range);
    let startMs: number;
    if (win !== null) startMs = nowMs - win;
    else {
      // ALL: span from the earliest fetched row (or default to 30D if none).
      const times = rows.map((r) => new Date(String(r.created_at)).getTime()).filter((t) => Number.isFinite(t));
      startMs = times.length ? Math.min(...times) : nowMs - 30 * 24 * 60 * 60 * 1000;
    }
    const buckets = Math.max(2, Math.min(config.observability.timeSeriesBucketLimit, 500));
    const span = Math.max(1, nowMs - startMs);
    const bucketMs = span / buckets;

    const points: TimeSeriesPoint[] = [];
    for (let i = 0; i < buckets; i++) {
      const bStart = startMs + i * bucketMs;
      const bEnd = i === buckets - 1 ? nowMs + 1 : bStart + bucketMs;
      const inBucket = rows.filter((r) => {
        const t = new Date(String(r.created_at)).getTime();
        return Number.isFinite(t) && t >= bStart && t < bEnd;
      });
      points.push({ bucketStart: new Date(bStart).toISOString(), value: spec.reduce(inBucket), count: inBucket.length });
    }
    return { metric, range, points };
  }
}

function sevRank(s: 'INFO' | 'WARNING' | 'CRITICAL'): number {
  return s === 'CRITICAL' ? 3 : s === 'WARNING' ? 2 : 1;
}

export const observabilityService = new ObservabilityService();
