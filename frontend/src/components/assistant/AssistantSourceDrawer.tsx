import { useEffect, useState } from 'react';
import { X, FileText } from 'lucide-react';
import { api } from '../../api/client';
import type { AssistantSource } from '../../api/client';
import { LoadingState, ErrorState } from '../ui';

/**
 * Exact source-inspection drawer. Shows document title/version/provenance + the
 * exact bounded excerpt + (safe) embedding-space identity. NEVER shows raw
 * vectors, filesystem paths, secrets, or hidden prompts.
 */
export function AssistantSourceDrawer({ citationId, onClose }: { citationId: string | null; onClose: () => void }) {
  const [src, setSrc] = useState<AssistantSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!citationId) { setSrc(null); return; }
    setLoading(true); setError(null);
    api.assistantCitation(citationId)
      .then((s) => setSrc(s))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [citationId]);

  if (!citationId) return null;
  return (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50" onClick={onClose} />
      <aside className="fixed right-0 top-0 z-[60] flex h-full w-full max-w-md flex-col border-l border-space-700 bg-space-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-space-700 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><FileText className="h-4 w-4 text-accent-cyan" /> Source inspection</div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
          {loading && <LoadingState />}
          {error && <ErrorState message={error} />}
          {src && (
            <div className="space-y-3">
              <Row label="Citation" value={src.citationId} />
              <Row label="Document" value={src.documentTitle} />
              <Row label="Stable ID" value={src.documentStableId ?? '—'} />
              <Row label="Version" value={src.documentVersion ?? '—'} />
              <Row label="Source type" value={src.sourceType ?? '—'} />
              <Row label="Provenance origin" value={src.provenanceOrigin ?? '—'} />
              <Row label="Ingested by" value={src.ingestedBy ?? '—'} />
              <Row label="Ingested at" value={src.ingestedAt ?? '—'} />
              <Row label="Chunk index" value={String(src.chunkIndex ?? '—')} />
              <Row label="Embedding space" value={src.embeddingSpaceKey ?? '—'} />
              <div>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Exact excerpt</div>
                <p className="rounded-lg border border-space-700 bg-space-800/60 p-2.5 text-xs text-slate-300">{src.excerpt}</p>
              </div>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3 text-xs"><span className="text-slate-500">{label}</span><span className="text-right text-slate-300">{value}</span></div>;
}
