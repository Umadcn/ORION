import { useParams, Link } from 'react-router-dom';
import { Printer, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import { usePolling } from '../hooks/usePolling';
import { ErrorState, LoadingState } from '../components/ui';
import { humanize } from '../lib/format';

export default function ReportDetailsPage() {
  const { id } = useParams();
  const report = usePolling(() => api.report(Number(id)), 0, [id]);

  if (report.loading) return <LoadingState label="Loading report…" />;
  if (report.error || !report.data) return <ErrorState message={report.error ?? 'Not found'} onRetry={report.refetch} />;

  const c = report.data.content;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between no-print">
        <div className="text-xs text-slate-500"><Link to="/reports" className="hover:underline">Reports</Link> / #{report.data.id}</div>
        <button className="btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print / Save PDF</button>
      </div>

      <article className="print-surface panel space-y-6 p-8">
        <header className="border-b border-space-700 pb-4">
          <h1 className="text-2xl font-bold text-white">{c.title}</h1>
          <p className="mt-1 text-sm text-slate-400">Generated {new Date(c.generated_at).toUTCString()}</p>
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-accent-green/30 bg-accent-green/10 p-3 text-xs text-slate-300">
            <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-green" />
            {c.safety_statement}
          </div>
        </header>

        <Section title="Incident Summary"><p className="text-sm leading-relaxed text-slate-300">{c.incident_summary}</p></Section>

        <Section title="Satellite">
          <dl className="grid grid-cols-2 gap-y-1 text-sm sm:grid-cols-4">
            <Field k="Name" v={c.satellite.name} /><Field k="Mission" v={c.satellite.mission} />
            <Field k="Orbit" v={c.satellite.orbit_type} /><Field k="NORAD" v={c.satellite.norad_id} />
          </dl>
        </Section>

        <Section title="Root Cause">
          <div className="flex items-center justify-between">
            <span className="text-lg font-bold text-white">{humanize(c.root_cause)}</span>
            <span className="text-sm text-slate-400">Confidence {c.confidence != null ? Math.round(c.confidence * 100) : '—'}% · Severity {c.severity}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-slate-300">{c.explanation}</p>
        </Section>

        <Section title="Detected Anomalies">
          <div className="flex flex-wrap gap-2">{c.detected_anomalies.map((a) => <span key={a} className="rounded bg-space-700 px-2 py-1 text-xs text-slate-200">{humanize(a)}</span>)}</div>
        </Section>

        <Section title="Timeline">
          <ul className="space-y-1 text-sm">
            {c.timeline.map((t, i) => (
              <li key={i} className="flex gap-3"><span className="w-44 flex-shrink-0 font-mono text-xs text-slate-500">{new Date(t.time).toUTCString().slice(5, 25)}</span><span className="text-slate-300">{t.event}</span></li>
            ))}
          </ul>
        </Section>

        <Section title="Agent Execution History">
          <ul className="space-y-1 text-sm">
            {c.agent_execution_history.map((a, i) => (
              <li key={i} className="flex items-center justify-between border-b border-space-700 py-1 last:border-0">
                <span className="text-slate-200">{a.agent_name}</span>
                <span className="text-xs text-slate-500">{a.status}{a.duration_ms != null ? ` · ${a.duration_ms}ms` : ''}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Recommended Actions">
          <ol className="list-inside list-decimal space-y-1 text-sm text-slate-300">
            {c.recommendations.map((r, i) => <li key={i}><b>{r.action}</b> — {r.rationale} <span className="text-xs text-slate-500">({r.priority})</span></li>)}
          </ol>
        </Section>

        <Section title="Mission Director Decision">
          <p className="text-sm text-slate-300">Decision: <b>{c.mission_director_decision}</b>{c.reviewed_at ? ` on ${new Date(c.reviewed_at).toUTCString()}` : ''}. {c.resolution}</p>
        </Section>

        <Section title="Scientific References (OpenAlex — offline sample)">
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
            {c.references.map((r, i) => <li key={i}>{r.title} <span className="text-xs text-slate-500">— {r.host_venue}, {r.publication_year}</span></li>)}
          </ul>
        </Section>

        <Section title="Data Provenance">
          <ul className="space-y-1 text-xs text-slate-400">
            {c.provenance.map((p, i) => (
              <li key={i} className="flex items-center justify-between border-b border-space-700 py-1 last:border-0">
                <span>{p.source_name} <span className="text-slate-600">{p.source_url}</span></span>
                <span className="font-semibold text-accent-cyan">{p.mode}{p.fallback_used ? ' (fallback)' : ''}</span>
              </li>
            ))}
          </ul>
        </Section>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-accent-blue">{title}</h2>
      {children}
    </section>
  );
}
function Field({ k, v }: { k: string; v: string }) {
  return (<><dt className="text-xs text-slate-500">{k}</dt><dd className="text-slate-200">{v}</dd></>);
}
