import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, FileText, Loader2, Satellite, Search, SearchX, X } from 'lucide-react';
import { api } from '../api/client';
import { humanize } from '../lib/format';

interface Hit {
  kind: 'Satellite' | 'Investigation' | 'Alert' | 'Report';
  label: string;
  sub: string;
  to: string;
  icon: typeof Search;
}

/**
 * Global search across real ORION entities (satellites, investigations, alerts,
 * reports). Data is fetched once on first focus and filtered client-side — no
 * search endpoint is invented. Selecting a result navigates to its detail page.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [index, setIndex] = useState<Hit[] | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const buildIndex = async () => {
    if (index) return;
    setLoading(true);
    try {
      const [sats, invs, alerts, reports] = await Promise.all([
        api.satellites(), api.investigations(), api.alerts(), api.reports(),
      ]);
      const hits: Hit[] = [
        ...sats.map((s) => ({ kind: 'Satellite' as const, label: `${s.name}`, sub: `${s.mission} · ${s.orbit_type} · ${s.status}`, to: `/satellites/${s.id}`, icon: Satellite })),
        ...invs.map((i) => ({ kind: 'Investigation' as const, label: `INV#${i.id} · ${i.satellite_id}`, sub: i.root_cause ? humanize(i.root_cause) : i.title, to: `/investigations/${i.id}`, icon: Search })),
        ...alerts.map((a) => ({ kind: 'Alert' as const, label: `${a.satellite_id} · ${humanize(a.anomaly_type)}`, sub: `${a.severity} · ${a.status}`, to: a.investigation_id ? `/investigations/${a.investigation_id}` : '/alerts', icon: AlertTriangle })),
        ...reports.map((r) => ({ kind: 'Report' as const, label: `RPT#${r.id} · ${r.satellite_id ?? ''}`, sub: r.root_cause ? humanize(r.root_cause) : r.title, to: `/reports/${r.id}`, icon: FileText })),
      ];
      setIndex(hits);
    } catch {
      setIndex([]);
    } finally {
      setLoading(false);
    }
  };

  const results = useMemo(() => {
    if (!query.trim() || !index) return [];
    const q = query.toLowerCase();
    return index.filter((h) => h.label.toLowerCase().includes(q) || h.sub.toLowerCase().includes(q) || h.kind.toLowerCase().includes(q)).slice(0, 12);
  }, [query, index]);

  const go = (to: string) => { setOpen(false); setQuery(''); navigate(to); };

  return (
    <div ref={boxRef} className="relative w-full min-w-0 max-w-xl">
      <div className="flex h-[var(--control-height)] items-center gap-2 rounded-lg border border-space-600 bg-space-800/80 px-3 focus-within:border-accent-blue/50">
        <Search className="h-4 w-4 flex-shrink-0 text-slate-500" />
        <input
          value={query}
          onFocus={() => { setOpen(true); void buildIndex(); }}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); if (e.key === 'Enter' && results[0]) go(results[0].to); }}
          placeholder="Search satellites, investigations, alerts, reports…"
          className="w-full bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none"
        />
        {query && <button onClick={() => setQuery('')} className="text-slate-500 hover:text-slate-300"><X className="h-4 w-4" /></button>}
      </div>

      {open && query.trim() && (
        <div className="absolute z-40 mt-2 max-h-96 w-full overflow-y-auto rounded-lg border border-space-600 bg-space-850 shadow-panel">
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Indexing…</div>
          ) : results.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500"><SearchX className="h-4 w-4" /> No matches for “{query}”.</div>
          ) : (
            <ul className="divide-y divide-space-700">
              {results.map((h, i) => {
                const Icon = h.icon;
                return (
                  <li key={i}>
                    <button onClick={() => go(h.to)} className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-space-800">
                      <Icon className="h-4 w-4 flex-shrink-0 text-accent-blue" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-slate-200">{h.label}</div>
                        <div className="truncate text-xs text-slate-500">{h.sub}</div>
                      </div>
                      <span className="rounded bg-space-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">{h.kind}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
