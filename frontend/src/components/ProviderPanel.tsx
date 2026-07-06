import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Database, PlayCircle, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { api } from '../api/client';
import { Panel, LoadingState, ErrorState } from './ui';
import { ConfirmationModal } from './ConfirmationModal';
import {
  operatingModeLabel, providerBanner, verificationStatusLabel, isRealAvailable, pctOrDash,
  type ActiveSpaceInfo, type ComparisonRunResult, type ProvidersStatus, type ReindexResult, type VerificationResult,
} from '../lib/providers';

type ActionKey = 'verifyLlm' | 'verifyEmbedding' | 'reindex' | 'compare' | null;

const TONE: Record<string, string> = {
  slate: 'border-space-700 bg-space-900 text-slate-300',
  cyan: 'border-accent-cyan/30 bg-accent-cyan/10 text-accent-cyan',
  green: 'border-accent-green/30 bg-accent-green/10 text-accent-green',
  orange: 'border-accent-orange/30 bg-accent-orange/10 text-accent-orange',
  red: 'border-accent-red/30 bg-accent-red/10 text-accent-red',
};

export function ProviderPanel() {
  const [status, setStatus] = useState<ProvidersStatus | null>(null);
  const [active, setActive] = useState<ActiveSpaceInfo | null>(null);
  const [verifications, setVerifications] = useState<VerificationResult[]>([]);
  const [lastReindex, setLastReindex] = useState<ReindexResult | null>(null);
  const [lastComparison, setLastComparison] = useState<ComparisonRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<ActionKey>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, a, v] = await Promise.all([api.providersStatus(), api.activeEmbeddingSpace(), api.providerVerifications(8)]);
      setStatus(s);
      setActive(a);
      setVerifications(v.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load provider status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const confirmText: Record<Exclude<ActionKey, null>, { title: string; body: string; label: string }> = {
    verifyLlm: { title: 'Verify LLM Provider', body: 'This sends a single fixed, bounded verification request to the configured LLM provider (consuming provider quota). Continue?', label: 'Verify LLM' },
    verifyEmbedding: { title: 'Verify Embedding Provider', body: 'This sends a single fixed, bounded embedding request to the configured provider (consuming provider quota). Continue?', label: 'Verify Embedding' },
    reindex: { title: 'Re-embed Knowledge Corpus', body: 'This re-embeds the entire knowledge corpus into a new embedding space using the configured provider, then atomically activates it. Continue?', label: 'Start Re-embedding' },
    compare: { title: 'Run Real-vs-Fallback Evaluation', body: 'This runs a bounded set of fixed scenarios through the real-provider and deterministic-fallback arms (consuming provider quota when a real provider is configured). Continue?', label: 'Run Evaluation' },
  };

  const runAction = async () => {
    if (!action) return;
    setBusy(true);
    setNotice(null);
    try {
      if (action === 'verifyLlm') { const r = await api.verifyLlmProvider(); setNotice(`LLM verification: ${verificationStatusLabel(r.status)}`); }
      else if (action === 'verifyEmbedding') { const r = await api.verifyEmbeddingProvider(); setNotice(`Embedding verification: ${verificationStatusLabel(r.status)}`); }
      else if (action === 'reindex') { const r = await api.reindexEmbeddings(); setLastReindex(r); setNotice(`Re-embedding ${r.status}: ${r.processedDocuments}/${r.totalDocuments} documents.`); }
      else if (action === 'compare') { const r = await api.runProviderComparison(); setLastComparison(r); setNotice(`Comparison ${r.status}: real accepted ${r.realAcceptedCount}, fallback ${r.fallbackCount}.`); }
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusy(false);
      setAction(null);
    }
  };

  if (loading) return <Panel title="Provider Status"><LoadingState label="Loading provider status…" /></Panel>;
  if (error || !status || !active) return <Panel title="Provider Status"><ErrorState message={error ?? 'No provider status.'} onRetry={load} /></Panel>;

  const banner = providerBanner(status.llm.operatingMode, status.embedding.operatingMode);

  return (
    <Panel
      title={<span className="flex items-center gap-2"><Cpu className="h-4 w-4 text-accent-purple" /> Providers &amp; Live AI Evaluation</span>}
      action={<button className="btn-ghost !py-1 text-xs" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>}
    >
      {/* Banner */}
      <div className={`mb-4 rounded-lg border px-3 py-2 text-xs font-semibold ${TONE[banner.tone]}`}>{banner.text}</div>

      {notice && <div className="mb-4 rounded-lg border border-accent-blue/30 bg-accent-blue/10 px-3 py-2 text-xs text-accent-blue">{notice}</div>}

      {/* Provider status cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[status.llm, status.embedding].map((p) => {
          const m = operatingModeLabel(p.operatingMode);
          return (
            <div key={p.kind} className="rounded-lg border border-space-800 bg-space-900/60 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  {p.kind === 'LLM' ? <Zap className="h-4 w-4 text-accent-orange" /> : <Database className="h-4 w-4 text-accent-cyan" />}
                  {p.kind === 'LLM' ? 'LLM Provider' : 'Embedding Provider'}
                </div>
                <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border ${TONE[m.tone]}`}>{m.label}</span>
              </div>
              <dl className="mt-3 space-y-1 text-xs text-slate-400">
                <div className="flex justify-between"><dt>Provider</dt><dd className="font-mono text-slate-300">{p.providerName}</dd></div>
                <div className="flex justify-between"><dt>Model</dt><dd className="font-mono text-slate-300">{p.model ?? '—'}</dd></div>
                <div className="flex justify-between"><dt>Last verification</dt><dd className="text-slate-300">{p.lastVerificationStatus ? verificationStatusLabel(p.lastVerificationStatus) : 'Never'}</dd></div>
                {isRealAvailable(p.operatingMode) && <div className="flex items-center gap-1 text-accent-green"><CheckCircle2 className="h-3.5 w-3.5" /> Verified available</div>}
              </dl>
            </div>
          );
        })}
      </div>

      {/* Active embedding space */}
      <div className="mt-4 rounded-lg border border-space-800 bg-space-900/60 p-4 text-xs">
        <div className="mb-1 font-semibold text-white">Active Embedding Space</div>
        <div className="font-mono text-slate-400">{active.spaceKey}</div>
        <div className="mt-1 text-slate-500">{active.identity.provider} · {active.identity.model} · dim {active.identity.dimension} · {active.identity.normalizationPolicy} · {active.persisted ? 'persisted' : 'implicit'}{active.isFallback ? ' · LocalHashEmbedding (not neural)' : ''}</div>
      </div>

      {/* Re-index + comparison summaries */}
      {(lastReindex || lastComparison) && (
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {lastReindex && (
            <div className="rounded-lg border border-space-800 bg-space-900/60 p-4 text-xs">
              <div className="mb-1 font-semibold text-white">Re-index Progress</div>
              <div className="text-slate-400">Status: <span className="text-slate-200">{lastReindex.status}</span></div>
              <div className="text-slate-400">Documents: {lastReindex.processedDocuments}/{lastReindex.totalDocuments} · chunks {lastReindex.processedChunks}/{lastReindex.totalChunks} · failed {lastReindex.failedDocuments}</div>
              <div className="mt-1 font-mono text-[10px] text-slate-500">→ {lastReindex.targetSpaceKey}</div>
            </div>
          )}
          {lastComparison && (
            <div className="rounded-lg border border-space-800 bg-space-900/60 p-4 text-xs">
              <div className="mb-1 font-semibold text-white">Real vs Fallback</div>
              <div className="text-slate-400">Real available: <span className="text-slate-200">{String(lastComparison.realAvailable)}</span> · scenarios {lastComparison.scenarioCount}</div>
              <div className="text-slate-400">Real accepted {lastComparison.realAcceptedCount} · fallback {lastComparison.fallbackCount} · real failed {lastComparison.realFailedCount}</div>
              <div className="text-slate-400">Grounding valid — real {pctOrDash(lastComparison.realGroundingValidRate)} · fallback {pctOrDash(lastComparison.fallbackGroundingValidRate)}</div>
            </div>
          )}
        </div>
      )}

      {/* Verification history */}
      {verifications.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-semibold text-slate-400">Recent Verifications</div>
          <ul className="space-y-1">
            {verifications.slice(0, 6).map((v) => (
              <li key={v.verificationId ?? `${v.createdAt}-${v.status}`} className="flex items-center justify-between text-xs">
                <span className="text-slate-300">{v.providerKind} · {v.providerName}</span>
                <span className="text-slate-400">{verificationStatusLabel(v.status)} · {v.latencyMs} ms</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Controlled actions (Director/Admin) */}
      <div className="mt-4 flex flex-wrap gap-2 border-t border-space-700 pt-4">
        <button className="btn-ghost text-xs" onClick={() => setAction('verifyLlm')}><ShieldCheck className="h-3.5 w-3.5" /> Verify LLM Provider</button>
        <button className="btn-ghost text-xs" onClick={() => setAction('verifyEmbedding')}><ShieldCheck className="h-3.5 w-3.5" /> Verify Embedding Provider</button>
        <button className="btn-ghost text-xs" onClick={() => setAction('reindex')}><RefreshCw className="h-3.5 w-3.5" /> Start Corpus Re-Embedding</button>
        <button className="btn-ghost text-xs" onClick={() => setAction('compare')}><PlayCircle className="h-3.5 w-3.5" /> Run Real-vs-Fallback Evaluation</button>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">All actions are Director/Admin and read-only w.r.t. mission state. Deterministic fallback is never real AI; scores are ranking/quality signals, not confidence.</p>

      <ConfirmationModal
        open={action !== null}
        title={action ? confirmText[action].title : ''}
        confirmLabel={action ? confirmText[action].label : 'Confirm'}
        busy={busy}
        onCancel={() => setAction(null)}
        onConfirm={runAction}
      >
        {action ? confirmText[action].body : ''}
      </ConfirmationModal>
    </Panel>
  );
}
