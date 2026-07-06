/**
 * Pure, deterministic aggregation helpers for observability (Phase 8).
 *
 * Percentiles use the nearest-rank method on ascending-sorted samples. All
 * helpers are side-effect free and unit-tested. Rate helpers are zero-denominator
 * safe (return 0 rather than NaN/Infinity).
 */
import type { DistributionItem, LatencyDistribution, ObservabilityTimeRange } from './types.js';
import { OBSERVABILITY_TIME_RANGES } from './types.js';

/** Whether a string is an allowlisted time range. */
export function isValidRange(v: unknown): v is ObservabilityTimeRange {
  return typeof v === 'string' && (OBSERVABILITY_TIME_RANGES as string[]).includes(v);
}

/** Parse a range value, defaulting to `fallback` for unknown/empty input. */
export function parseRange(v: unknown, fallback: ObservabilityTimeRange): ObservabilityTimeRange {
  return isValidRange(v) ? v : fallback;
}

/** Milliseconds covered by a bounded range; null for ALL. */
export function rangeWindowMs(range: ObservabilityTimeRange): number | null {
  switch (range) {
    case '24H': return 24 * 60 * 60 * 1000;
    case '7D': return 7 * 24 * 60 * 60 * 1000;
    case '30D': return 30 * 24 * 60 * 60 * 1000;
    case 'ALL': return null;
  }
}

/**
 * ISO-8601 UTC lower bound for a range given a reference `nowIso`. Returns null
 * for ALL. created_at columns are ISO-8601 UTC, so a lexical `>=` compare is
 * chronologically correct.
 */
export function rangeCutoffIso(range: ObservabilityTimeRange, nowIso: string): string | null {
  const win = rangeWindowMs(range);
  if (win === null) return null;
  return new Date(new Date(nowIso).getTime() - win).toISOString();
}

/** Zero-safe rate = numerator / denominator, clamped to [0,1]-ish (no clamp on >1). */
export function rate(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(6));
}

/** Arithmetic mean of finite numbers; null for an empty set. */
export function average(values: number[]): number | null {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return null;
  return Number((nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(4));
}

/** Sum of finite numbers (0 for empty). */
export function sum(values: number[]): number {
  return values.reduce((s, v) => (Number.isFinite(v) ? s + v : s), 0);
}

/**
 * Nearest-rank percentile in [0,100]. Given ascending-sorted (or unsorted)
 * samples, rank = ceil(p/100 * n); returns samples[rank-1]. Exact + deterministic.
 */
export function percentile(samples: number[], p: number): number | null {
  const xs = samples.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  if (p <= 0) return xs[0];
  if (p >= 100) return xs[xs.length - 1];
  const rank = Math.ceil((p / 100) * xs.length);
  return xs[Math.min(xs.length, Math.max(1, rank)) - 1];
}

/** Build a full latency distribution from raw millisecond samples. */
export function latencyDistribution(samples: number[]): LatencyDistribution {
  const xs = samples.filter((v) => Number.isFinite(v));
  return {
    count: xs.length,
    averageMs: average(xs),
    p50Ms: percentile(xs, 50),
    p95Ms: percentile(xs, 95),
    p99Ms: percentile(xs, 99),
    minMs: xs.length ? Math.min(...xs) : null,
    maxMs: xs.length ? Math.max(...xs) : null,
  };
}

/**
 * Build a stable, bounded categorical distribution. Keys are sorted by count
 * desc then key asc (deterministic); null/empty keys map to `nullKey`. When
 * `maxItems` is exceeded, the tail is folded into a single `OTHER` bucket so the
 * response size stays bounded while counts still sum to the total.
 */
export function distribution(values: (string | null | undefined)[], maxItems: number, nullKey = 'UNKNOWN'): DistributionItem[] {
  const total = values.length;
  const counts = new Map<string, number>();
  for (const v of values) {
    const key = v === null || v === undefined || v === '' ? nullKey : String(v);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, Math.max(1, maxItems));
  const tail = sorted.slice(Math.max(1, maxItems));
  const items: DistributionItem[] = head.map(([key, count]) => ({ key, count, rate: rate(count, total) }));
  if (tail.length > 0) {
    const otherCount = tail.reduce((s, [, c]) => s + c, 0);
    items.push({ key: 'OTHER', count: otherCount, rate: rate(otherCount, total) });
  }
  return items;
}

/** Count rows whose value === match (case-sensitive). */
export function countWhere<T>(rows: T[], pred: (r: T) => boolean): number {
  let n = 0;
  for (const r of rows) if (pred(r)) n++;
  return n;
}
