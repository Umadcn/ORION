/**
 * Deterministic weighted scoring math for root-cause analysis.
 * Pure functions only — no I/O, no randomness. Easy to unit-test.
 */
import type {
  AnomalyDetectionResult,
  OrbitEvidence,
  RootCause,
  ScoringEntry,
  SpaceWeatherEvidence,
} from '../types.js';
import { ANOMALY_WEIGHTS, CONTEXT_WEIGHTS, ALL_ROOT_CAUSES } from './rootCauseKnowledgeBase.js';

export interface ScoreInputs {
  anomalies: AnomalyDetectionResult;
  spaceWeather: SpaceWeatherEvidence;
  orbit: OrbitEvidence;
}

/** Accumulate raw weighted scores per candidate root cause. */
export function computeScores(inputs: ScoreInputs): ScoringEntry[] {
  const raw = new Map<RootCause, { score: number; contributions: { factor: string; weight: number }[] }>();
  for (const rc of ALL_ROOT_CAUSES) raw.set(rc, { score: 0, contributions: [] });

  const add = (rc: RootCause, weight: number, factor: string) => {
    const entry = raw.get(rc)!;
    entry.score += weight;
    entry.contributions.push({ factor, weight: round(weight) });
  };

  // Anomaly-driven weights.
  for (const anomaly of inputs.anomalies.detected_anomalies) {
    const rules = ANOMALY_WEIGHTS[anomaly.type] || [];
    for (const rule of rules) {
      add(rule.root_cause, rule.weight, `${anomaly.type}: ${rule.reason}`);
    }
  }

  // Space-weather context.
  if (inputs.spaceWeather.relevant_to_incident) {
    const c = CONTEXT_WEIGHTS.severeGeomagnetic;
    add(c.root_cause, c.weight, c.reason);
  } else {
    const c = CONTEXT_WEIGHTS.quietGeomagneticPenalty;
    add(c.root_cause, c.weight, c.reason);
  }

  // Orbit context.
  if (inputs.orbit.orbit_deviation_detected && inputs.orbit.relevant_to_incident) {
    const c = CONTEXT_WEIGHTS.orbitDeviationConfirmed;
    add(c.root_cause, c.weight, c.reason);
  } else {
    const c = CONTEXT_WEIGHTS.orbitNominalPenalty;
    add(c.root_cause, c.weight, c.reason);
  }

  // Clamp negatives to zero for normalization, but keep contributions visible.
  const positives = ALL_ROOT_CAUSES.map((rc) => Math.max(0, raw.get(rc)!.score));
  const total = positives.reduce((a, b) => a + b, 0) || 1;

  const entries: ScoringEntry[] = ALL_ROOT_CAUSES.map((rc) => {
    const e = raw.get(rc)!;
    return {
      root_cause: rc,
      raw_score: round(e.score),
      normalized: round(Math.max(0, e.score) / total),
      contributions: e.contributions,
    };
  })
    // Only keep candidates that received any signal, plus always keep the winner-eligible ones.
    .filter((e) => e.raw_score !== 0 || e.contributions.length > 0);

  // Sort by normalized score descending for display.
  entries.sort((a, b) => b.normalized - a.normalized);
  return entries;
}

/**
 * Confidence is derived deterministically from:
 *  - the winner's normalized share (dominance)
 *  - the margin over the runner-up (separation)
 * Bounded to a realistic 0.50–0.97 band so it never claims certainty.
 */
export function computeConfidence(entries: ScoringEntry[]): number {
  if (entries.length === 0) return 0.5;
  const top = entries[0].normalized;
  const second = entries[1]?.normalized ?? 0;
  const margin = top - second;
  const confidence = 0.5 + top * 0.35 + margin * 0.25;
  return round(clamp(confidence, 0.5, 0.97));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
