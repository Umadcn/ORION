import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  CheckCircle2, Clock, Database, FileText, RefreshCw, ShieldCheck, ThumbsDown, ThumbsUp, Wrench,
} from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { EmptyState, ErrorState, LoadingState, Panel, SeverityBadge, StatusBadge } from '../components/ui';
import { ConfidenceMeter, InvestigationProgress, RecommendationCard } from '../components/domain';
import { EvidenceLedger, ExpandableAgentTimeline, HypothesisEvaluation } from '../components/investigation';
import { TelemetryChart } from '../components/TelemetryChart';
import { ConfirmationModal } from '../components/ConfirmationModal';
import { humanize } from '../lib/format';

type Action = 'approve' | 'reject' | null;

export default function InvestigationDetailsPage() {
  const { id } = useParams();
  const invId = Number(id);
  const navigate = useNavigate();
  const detail = usePolling(() => api.investigation(invId), 3000, [invId]);
  const telemetry = usePolling(() => api.satelliteTelemetry(detail.data?.satellite_id ?? 'ORION-3', 60), 3000, [detail.data?.satellite_id]);

  const [confirm, setConfirm] = useState<Action>(null);
  const [busy, setBusy] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  if (detail.loading) return <LoadingState label="Loading investigation…" />;
  if (detail.error || !detail.data) return <ErrorState message={detail.error ?? 'Not found'} onRetry={detail.refetch} />;

  const inv = detail.data;
  const isWaiting = inv.status === 'WAITING_FOR_REVIEW';
  const canResolve = inv.status === 'APPROVED' || inv.status === 'REJECTED';
  const canReport = inv.status === 'RESOLVED';
  const triggerAlert = inv.alerts[0] ?? null;

  const run = async (label: string, fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      setBanner(`${label} ✓`);
      detail.refetch();
      after?.();
    } catch (e) {
      setBanner(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Link to="/investigations" className="hover:underline">Investigations</Link>
            <span>/</span><span className="font-mono">INV#{inv.id}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold text-white">Investigation Command Center</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link to={`/satellites/${inv.satellite_id}`} className="text-sm font-semibold text-accent-cyan hover:underline">{inv.satellite_id}</Link>
            <StatusBadge status={inv.status} />
            <SeverityBadge severity={inv.priority} />
            {triggerAlert && (
              <span className="text-xs text-slate-400">Trigger: <span className="text-accent-orange">{humanize(triggerAlert.anomaly_type)}</span></span>
            )}
            <span className="flex items-center gap-1 text-xs text-slate-500"><Clock className="h-3 w-3" /> opened {new Date(inv.created_at).toUTCString().slice(5, 22)}</span>
            {inv.resolved_at && <span className="text-xs text-slate-500">· resolved {new Date(inv.resolved_at).toUTCString().slice(5, 22)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 no-print">
          <button className="btn-ghost" disabled={busy} onClick={() => run('Rerun analysis', () => api.rerunAnalysis(inv.id))}><RefreshCw className="h-4 w-4" /> Rerun</button>
          {isWaiting && (
            <>
              <button className="btn-success" disabled={busy} onClick={() => setConfirm('approve')}><ThumbsUp className="h-4 w-4" /> Approve</button>
              <button className="btn-danger" disabled={busy} onClick={() => setConfirm('reject')}><ThumbsDown className="h-4 w-4" /> Reject</button>
            </>
          )}
          {canResolve && <button className="btn-primary" disabled={busy} onClick={() => run('Resolve', () => api.resolve(inv.id))}><CheckCircle2 className="h-4 w-4" /> Resolve</button>}
          {canReport && (
            inv.report
              ? <button className="btn-primary" onClick={() => navigate(`/reports/${inv.report!.id}`)}><FileText className="h-4 w-4" /> View Report</button>
              : <button className="btn-primary" disabled={busy} onClick={() => run('Generate report', () => api.generateReport(inv.id))}><FileText className="h-4 w-4" /> Generate Report</button>
          )}
        </div>
      </div>

      {banner && <div className="rounded-lg border border-accent-blue/40 bg-accent-blue/10 px-4 py-2 text-sm text-accent-blue no-print">{banner}</div>}

      <Panel title="Investigation Progress"><InvestigationProgress status={inv.status} /></Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* Agent Execution Timeline (expandable) */}
          <Panel title="Agent Execution Timeline" action={<span className="text-xs text-slate-500">{inv.agent_executions.length} executions</span>}>
            <ExpandableAgentTimeline executions={inv.agent_executions} />
          </Panel>

          {/* Evidence Provenance Ledger */}
          <Panel title={<span className="flex items-center gap-2"><Database className="h-4 w-4 text-accent-cyan" /> Evidence Provenance Ledger</span>} action={<span className="text-xs text-slate-500">{inv.evidence.length} items</span>}>
            <EvidenceLedger evidence={inv.evidence} />
          </Panel>

          {/* Hypothesis Evaluation */}
          <Panel title="Hypothesis Evaluation" action={<span className="text-xs text-slate-500">weighted deterministic scoring</span>}>
            <HypothesisEvaluation entries={inv.scoring_breakdown} winner={inv.root_cause} />
          </Panel>

          <Panel title="Telemetry Evidence"><TelemetryChart data={telemetry.data ?? []} height={240} /></Panel>
        </div>

        <div className="space-y-5">
          {/* RCA Decision Panel */}
          <Panel title="Root Cause · Decision Support">
            {inv.root_cause ? (
              <div className="space-y-4">
                <div>
                  <div className="label">Likely Root Cause</div>
                  <div className="mt-0.5 text-lg font-bold text-white">{humanize(inv.root_cause)}</div>
                </div>
                <ConfidenceMeter confidence={inv.confidence ?? 0} />
                <div className="flex items-center justify-between text-sm"><span className="text-slate-400">Severity</span><SeverityBadge severity={inv.severity} /></div>
                <p className="text-sm leading-relaxed text-slate-300">{inv.explanation}</p>
                <div className="rounded-lg border border-space-700 bg-space-800/50 p-3 text-xs">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-slate-300"><ShieldCheck className="h-3.5 w-3.5 text-accent-green" /> Human Decision Support</div>
                  <div className="text-slate-400">
                    {inv.review_decision
                      ? <>Mission Director decision: <b className="text-slate-200">{inv.review_decision}</b>{inv.reviewed_at ? ` · ${new Date(inv.reviewed_at).toUTCString().slice(5, 22)}` : ''}.</>
                      : 'Awaiting Mission Director review. Recommendations are advisory; no command is sent to any satellite.'}
                  </div>
                </div>
              </div>
            ) : <EmptyState message="Analysis pending." />}
          </Panel>

          {/* Detected anomalies */}
          <Panel title="Detected Anomalies">
            {inv.detected_anomalies.length === 0 ? <EmptyState message="None" /> : (
              <div className="flex flex-wrap gap-2">
                {inv.detected_anomalies.map((a) => <span key={a} className="rounded border border-accent-orange/40 bg-accent-orange/10 px-2 py-1 text-xs font-semibold text-accent-orange">{humanize(a)}</span>)}
              </div>
            )}
          </Panel>

          {/* Recommendations */}
          <Panel title={<span className="flex items-center gap-2"><Wrench className="h-4 w-4 text-accent-blue" /> Recommended Actions</span>}>
            {inv.recommendations.length === 0 ? <EmptyState message="No recommendations." /> : (
              <div className="space-y-2.5">{inv.recommendations.map((r, i) => <RecommendationCard key={r.id} rec={r} index={i} />)}</div>
            )}
          </Panel>

          {/* Report persistence */}
          <Panel title="Report Persistence">
            {inv.report ? (
              <div className="flex items-center justify-between rounded-lg border border-accent-green/30 bg-accent-green/5 p-3">
                <div className="text-sm">
                  <div className="flex items-center gap-1.5 font-semibold text-accent-green"><CheckCircle2 className="h-4 w-4" /> Report #{inv.report.id} persisted</div>
                  <div className="mt-0.5 text-xs text-slate-500">Retrievable via /api/reports/{inv.report.id}</div>
                </div>
                <button className="btn-ghost !px-3 !py-1.5 text-xs" onClick={() => navigate(`/reports/${inv.report!.id}`)}><FileText className="h-3.5 w-3.5" /> Open</button>
              </div>
            ) : canReport ? (
              <div className="text-sm text-slate-400">No report yet. Use <b>Generate Report</b> above to persist one.</div>
            ) : (
              <div className="text-sm text-slate-500">A report can be generated once the investigation is resolved.</div>
            )}
          </Panel>
        </div>
      </div>

      <ConfirmationModal open={confirm === 'approve'} title="Approve Recommendation" tone="success" confirmLabel="Approve" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => run('Approved', () => api.approve(inv.id))}>
        Approve the AI-generated root cause and recommended actions for <b>{inv.satellite_id}</b>? This records your decision as Mission Director. No command is sent to any satellite.
      </ConfirmationModal>
      <ConfirmationModal open={confirm === 'reject'} title="Reject Recommendation" tone="danger" confirmLabel="Reject" busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => run('Rejected', () => api.reject(inv.id))}>
        Reject this investigation's conclusion for <b>{inv.satellite_id}</b>? It can still be resolved and reported for the record.
      </ConfirmationModal>
    </div>
  );
}
