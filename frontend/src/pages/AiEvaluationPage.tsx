import { useCallback, useEffect, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, Bot, Brain, CheckCircle2, Gauge, Radio, ShieldCheck, Sparkles,
} from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '../api/client';
import { Panel, StatCard, LoadingState, ErrorState, EmptyState } from '../components/ui';
import { ProviderPanel } from '../components/ProviderPanel';
import {
  OBS_RANGES, count, executionModeLabel, governanceSeverityClasses, ms, operatingModeLabel, pct, score,
  type ObsDistributionItem, type ObsRange, type ObsSnapshot, type ObsTimeseries,
} from '../lib/observability';

const AXIS = { tick: { fill: '#64748b', fontSize: 11 }, stroke: '#273349' } as const;
const TOOLTIP = { contentStyle: { background: '#0d1220', border: '1px solid #273349', borderRadius: 8, fontSize: 12 }, labelStyle: { color: '#94a3b8' } } as const;
const PALETTE = ['#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ef4444', '#64748b'];

function DistBar({ data, height = 220, color = '#3b82f6' }: { data: ObsDistributionItem[]; height?: number; color?: string }) {
  if (!data || data.length === 0) return <EmptyState message="No data in this range." icon={<BarChart3 className="h-6 w-6" />} />;
  const rows = data.map((d) => ({ name: d.key, count: d.count, rate: d.rate }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
        <CartesianGrid stroke="#1b2436" vertical={false} />
        <XAxis dataKey="name" tick={AXIS.tick} stroke={AXIS.stroke} interval={0} angle={-18} textAnchor="end" height={54} />
        <YAxis tick={AXIS.tick} stroke={AXIS.stroke} allowDecimals={false} width={36} />
        <Tooltip {...TOOLTIP} formatter={(v: number) => [String(v), 'count']} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
          {rows.map((_, i) => <Cell key={i} fill={color} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function DistPie({ data, height = 220 }: { data: ObsDistributionItem[]; height?: number }) {
  if (!data || data.length === 0) return <EmptyState message="No data in this range." />;
  const rows = data.map((d) => ({ name: d.key, value: d.count }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={78} innerRadius={44} paddingAngle={2} isAnimationActive={false}>
          {rows.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip {...TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Grouped latency (p50/p95/p99) across subsystems. */
function LatencyBySubsystem({ snap }: { snap: ObsSnapshot }) {
  const rows = [
    { name: 'LLM', ...pick(snap.llm.latency) },
    { name: 'Retrieval', ...pick(snap.retrieval.latency) },
    { name: 'Generation', ...pick(snap.generation.latency) },
    { name: 'Copilot', ...pick(snap.copilot.toolLatency) },
    { name: 'Planner', ...pick(snap.planner.latency) },
    { name: 'Critic', ...pick(snap.critic.latency) },
  ];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
        <CartesianGrid stroke="#1b2436" vertical={false} />
        <XAxis dataKey="name" tick={AXIS.tick} stroke={AXIS.stroke} />
        <YAxis tick={AXIS.tick} stroke={AXIS.stroke} width={44} />
        <Tooltip {...TOOLTIP} formatter={(v: number) => [`${v} ms`, '']} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="p50" name="p50" fill="#3b82f6" radius={[3, 3, 0, 0]} />
        <Bar dataKey="p95" name="p95" fill="#f59e0b" radius={[3, 3, 0, 0]} />
        <Bar dataKey="p99" name="p99" fill="#ef4444" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
function pick(l: { p50Ms: number | null; p95Ms: number | null; p99Ms: number | null }) {
  return { p50: l.p50Ms ?? 0, p95: l.p95Ms ?? 0, p99: l.p99Ms ?? 0 };
}

export default function AiEvaluationPage() {
  const [range, setRange] = useState<ObsRange>('7D');
  const [snap, setSnap] = useState<ObsSnapshot | null>(null);
  const [series, setSeries] = useState<ObsTimeseries | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (r: ObsRange) => {
    setLoading(true);
    setError(null);
    try {
      const [s, ts] = await Promise.all([api.obsSnapshot(r), api.obsTimeseries('ai_executions', r)]);
      setSnap(s);
      setSeries(ts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load observability data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [range, load]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white"><Brain className="h-5 w-5 text-accent-purple" /> AI Evaluation &amp; Observability</h1>
          <p className="mt-1 text-xs text-slate-400">Read-only, deterministic metrics aggregated from existing audit trails. Advisory only — governance never changes mission state.</p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-space-700 bg-space-900 p-1" role="group" aria-label="Time range">
          {OBS_RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRange(r.value)}
              aria-pressed={range === r.value}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${range === r.value ? 'bg-accent-blue/20 text-accent-blue' : 'text-slate-400 hover:text-slate-200'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Offline / fallback banner */}
      {snap && (
        <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${snap.overview.offlineMode ? 'border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan' : 'border-accent-green/30 bg-accent-green/10 text-accent-green'}`}>
          <Radio className="h-4 w-4" />
          <span>
            LLM: {operatingModeLabel(snap.overview.llmOperatingMode)} · Embeddings: {snap.overview.embeddingOperatingMode === 'LOCAL_HASH_FALLBACK' ? 'LocalHashEmbedding (lexical, not neural)' : 'Real embedding provider'}
          </span>
          <span className="ml-auto text-slate-400">Deterministic fallback is not real model output. Scores are ranking/quality signals, not confidence.</span>
        </div>
      )}

      {/* Phase 9: providers + live AI evaluation surface (Director/Admin, controlled). */}
      <ProviderPanel />

      {loading && <LoadingState label="Aggregating AI observability metrics…" />}
      {error && !loading && <ErrorState message={error} onRetry={() => load(range)} />}

      {snap && !loading && !error && (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <StatCard label="Total AI Executions" value={count(snap.overview.totalAiExecutions)} icon={<Activity className="h-6 w-6" />} accent="blue" />
            <StatCard label="Real Provider Rate" value={pct(snap.overview.realProviderRate)} sub="LLM executions" icon={<Sparkles className="h-6 w-6" />} accent="green" />
            <StatCard label="Deterministic Fallback" value={pct(snap.overview.deterministicFallbackRate)} sub="not real model output" icon={<ShieldCheck className="h-6 w-6" />} accent="orange" />
            <StatCard label="Grounded Acceptance" value={pct(snap.overview.groundedOutputAcceptanceRate)} sub="generation + planner" icon={<CheckCircle2 className="h-6 w-6" />} accent="cyan" />
            <StatCard label="Retrieval nDCG@K" value={score(snap.overview.retrievalNdcgAtK)} sub="ranking quality · not confidence" icon={<Gauge className="h-6 w-6" />} accent="purple" />
            <StatCard label="Critic Acceptance" value={pct(snap.overview.criticAcceptanceRate)} sub="accept + revised-accept" icon={<Bot className="h-6 w-6" />} accent="blue" />
            <StatCard label="Governance Alerts" value={count(snap.overview.governanceAlertCount)} sub={`${snap.governance.criticalCount} critical`} icon={<AlertTriangle className="h-6 w-6" />} accent={snap.governance.criticalCount > 0 ? 'orange' : 'green'} />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="AI Executions Over Time">
              {series && series.points.some((p) => p.count > 0) ? (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={series.points.map((p) => ({ t: p.bucketStart.slice(5, 16).replace('T', ' '), value: p.value }))} margin={{ top: 10, right: 16, bottom: 0, left: -12 }}>
                    <CartesianGrid stroke="#1b2436" vertical={false} />
                    <XAxis dataKey="t" tick={AXIS.tick} stroke={AXIS.stroke} minTickGap={40} />
                    <YAxis tick={AXIS.tick} stroke={AXIS.stroke} allowDecimals={false} width={36} />
                    <Tooltip {...TOOLTIP} />
                    <Line type="monotone" dataKey="value" name="LLM executions" stroke="#3b82f6" dot={false} strokeWidth={2} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <EmptyState message="No AI executions in this range." />}
            </Panel>

            <Panel title="LLM Execution Mode">
              <DistPie data={[
                { key: 'Real Provider', count: Math.round(snap.overview.realProviderRate * snap.llm.totalExecutions), rate: snap.overview.realProviderRate },
                { key: 'Deterministic Fallback', count: Math.round(snap.overview.deterministicFallbackRate * snap.llm.totalExecutions), rate: snap.overview.deterministicFallbackRate },
                { key: 'Failed', count: Math.round(snap.llm.failedRate * snap.llm.totalExecutions), rate: snap.llm.failedRate },
              ].filter((d) => d.count > 0)} />
            </Panel>

            <Panel title="Retrieval Mode Distribution"><DistBar data={snap.retrieval.retrievalModeDistribution} color="#06b6d4" /></Panel>
            <Panel title="Generation Status Distribution"><DistBar data={snap.generation.statusDistribution} color="#22c55e" /></Panel>
            <Panel title="Copilot Tool Usage"><DistBar data={snap.copilot.toolUsageDistribution} color="#a855f7" /></Panel>
            <Panel title="Planner Status Distribution"><DistBar data={snap.planner.statusDistribution} color="#3b82f6" /></Panel>
            <Panel title="Critic Decision Distribution"><DistBar data={snap.critic.finalDecisionDistribution} color="#f59e0b" /></Panel>
            <Panel title="Latency p50 / p95 / p99 by Subsystem"><LatencyBySubsystem snap={snap} /></Panel>

            <Panel title="Grounding & Citation Validity">
              <DistBar
                data={[
                  { key: 'Gen grounding', count: Math.round(snap.generation.groundingValidRate * 100), rate: snap.generation.groundingValidRate },
                  { key: 'Gen citation', count: Math.round(snap.generation.citationValidRate * 100), rate: snap.generation.citationValidRate },
                  { key: 'Copilot grounding', count: Math.round(snap.copilot.groundingValidRate * 100), rate: snap.copilot.groundingValidRate },
                  { key: 'Planner grounded', count: Math.round(snap.planner.groundedAnalysisRate * 100), rate: snap.planner.groundedAnalysisRate },
                  { key: 'Critic coverage', count: Math.round(snap.critic.coveragePassRate * 100), rate: snap.critic.coveragePassRate },
                ]}
                color="#22c55e"
              />
              <p className="mt-2 text-[11px] text-slate-500">Values are validity rates (%). Lexical grounding/coverage signals — not confidence.</p>
            </Panel>

            <Panel title="Governance Alerts by Severity">
              <DistBar
                data={[
                  { key: 'Critical', count: snap.governance.criticalCount, rate: 0 },
                  { key: 'Warning', count: snap.governance.warningCount, rate: 0 },
                  { key: 'Info', count: snap.governance.infoCount, rate: 0 },
                ]}
                color="#ef4444"
              />
            </Panel>
          </div>

          {/* Panels */}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Panel title="Latest Retrieval Evaluation Results">
              {snap.retrieval.latestEvaluationsByMode.length === 0 ? <EmptyState message="No retrieval evaluation runs recorded." /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="pb-2">Mode</th><th className="pb-2">P@K</th><th className="pb-2">R@K</th><th className="pb-2">MRR</th><th className="pb-2">nDCG@K</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {snap.retrieval.latestEvaluationsByMode.map((e) => (
                        <tr key={e.retrievalMode} className="border-t border-space-800">
                          <td className="py-1.5 font-medium text-white">{e.retrievalMode}</td>
                          <td>{score(e.precisionAtK)}</td><td>{score(e.recallAtK)}</td><td>{score(e.mrr)}</td><td className="font-semibold text-accent-cyan">{score(e.ndcgAtK)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-2 text-[11px] text-slate-500">Evaluation metrics are retrieval-quality measures — not confidence.</p>
                </div>
              )}
            </Panel>

            <Panel title="Pipeline Health Summary">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Health label="Planner → Critic review" value={pct(snap.linkage.plannerToCriticReviewRate)} />
                <Health label="Revision success" value={pct(snap.linkage.revisionSuccessRate)} />
                <Health label="Grounded acceptance" value={pct(snap.linkage.groundedOutputAcceptanceRate)} />
                <Health label="Fallback dependency" value={pct(snap.linkage.deterministicFallbackDependencyRate)} />
                <Health label="Human review required" value={count(snap.linkage.humanReviewRequiredCount)} />
                <Health label="Orphan critic links" value={count(snap.linkage.orphanCriticCount)} />
                <Health label="Linked retrievals" value={count(snap.linkage.linkedRetrievalCount)} />
                <Health label="LLM latency p95" value={ms(snap.llm.latency.p95Ms)} />
              </dl>
            </Panel>

            <Panel title="Top Fallback Reasons (LLM)">
              <ReasonList items={snap.llm.fallbackReasonDistribution} empty="No fallbacks recorded." />
            </Panel>
            <Panel title="Top Failure / Error Codes (LLM)">
              <ReasonList items={snap.llm.errorCodeDistribution} empty="No errors recorded." />
            </Panel>

            <Panel title="Recent Governance Alerts" className="xl:col-span-2">
              {snap.governance.alerts.length === 0 ? (
                <EmptyState message="No governance alerts in this range." icon={<CheckCircle2 className="h-6 w-6 text-accent-green" />} />
              ) : (
                <ul className="space-y-2">
                  {snap.governance.alerts.map((a) => {
                    const c = governanceSeverityClasses(a.severity);
                    return (
                      <li key={a.alertId} className={`rounded-lg border ${c.border} ${c.bg} p-3`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${c.bg} ${c.text} border ${c.border}`}>{c.label}</span>
                          <span className="text-xs font-semibold text-slate-200">{a.category} · {a.metric}</span>
                          <span className="ml-auto font-mono text-[11px] text-slate-400">observed {a.observedValue} {a.comparison === 'GREATER_THAN' ? '>' : '<'} {a.threshold}</span>
                        </div>
                        <p className="mt-1 text-xs text-slate-300">{a.description}</p>
                        <p className="mt-1 text-[11px] text-slate-500">Review: {a.recommendedReviewAction}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-slate-500">Governance alerts are advisory only and never modify configuration, provider selection, or mission state.</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Health({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-space-800 bg-space-900/60 px-3 py-2">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold text-white">{value}</dd>
    </div>
  );
}

function ReasonList({ items, empty }: { items: ObsDistributionItem[]; empty: string }) {
  const shown = items.filter((i) => i.key !== 'NONE');
  if (shown.length === 0) return <EmptyState message={empty} icon={<CheckCircle2 className="h-6 w-6 text-accent-green" />} />;
  return (
    <ul className="space-y-1.5">
      {shown.map((i) => (
        <li key={i.key} className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate font-mono text-xs text-slate-300">{i.key}</span>
          <span className="flex items-center gap-2">
            <span className="text-slate-400">{pct(i.rate)}</span>
            <span className="rounded bg-space-800 px-2 py-0.5 text-xs font-semibold text-slate-200">{i.count}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
