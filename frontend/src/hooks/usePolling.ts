import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetch `fn` once and then poll every `intervalMs` (default 3s, per spec).
 * Exposes loading/error/data and a manual refetch. Poll refreshes are silent
 * (no loading flicker); only the initial load shows the loading state.
 */
export function usePolling<T>(fn: () => Promise<T>, intervalMs = 3000, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    try {
      const result = await fnRef.current();
      if (!mounted.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof ApiError ? err.message : 'Unable to reach the ORION backend.');
    } finally {
      if (mounted.current && initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(true);
    if (intervalMs <= 0) return () => { mounted.current = false; };
    const timer = setInterval(() => void load(false), intervalMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refetch = useCallback(() => void load(false), [load]);
  return { data, loading, error, refetch };
}
