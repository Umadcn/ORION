/**
 * Deterministic contradiction detection (Phase 7). No LLM-as-judge.
 *
 * Compares the Planner analysis against the authoritative deterministic facts and
 * flags contradictions: RCA mismatch, health-state conflict, false claims of
 * absent evidence/citations/alerts, claims that an action was executed, fabricated
 * satellite/investigation/report IDs, and numeric telemetry conflicts (with a
 * configurable relative tolerance). Explainable + mission-identifier aware.
 */
import { config } from '../config.js';
import type { ContradictionFinding, CriticContext } from './types.js';
import type { PlannerAnalysis } from '../planner/types.js';

const ACTION_EXECUTED = [
  /\b(has|have|was|were)\s+(been\s+)?(executed|commanded|uplinked|transmitted|activated|deactivated|reset|approved|rejected|resolved)\b/i,
  /\b(i|we)\s+(have\s+)?(executed|commanded|sent|reset|approved|rejected|resolved)\b/i,
];
const NO_EVIDENCE = /\b(no|without|lack of|absence of)\s+(supporting\s+)?evidence\b/i;
const NO_CITATIONS = /\bno\s+(citations?|mission knowledge|knowledge (?:base )?sources?|references?)\b/i;
const NO_ALERTS = /\b(no|without|zero)\s+(active\s+)?alerts?\b/i;
const HEALTHY = /\b(fully\s+)?(healthy|nominal|operating normally|no anomal(y|ies)|functioning normally|no issues?)\b/i;

/** Numeric telemetry claim patterns → (telemetryLatest key). */
const NUMERIC_PATTERNS: { re: RegExp; key: string }[] = [
  { re: /battery\D{0,12}?(-?\d+(?:\.\d+)?)\s*%?/i, key: 'battery_percent' },
  { re: /temperature\D{0,12}?(-?\d+(?:\.\d+)?)\s*(?:°|deg|c\b)?/i, key: 'temperature_c' },
  { re: /signal(?:\s+strength)?\D{0,12}?(-?\d+(?:\.\d+)?)\s*dbm?/i, key: 'signal_strength_dbm' },
  { re: /power(?:\s+consumption)?\D{0,12}?(-?\d+(?:\.\d+)?)\s*w\b/i, key: 'power_consumption_w' },
];

function perClaimText(a: PlannerAnalysis): { text: string; index: number | null }[] {
  const out: { text: string; index: number | null }[] = [{ text: a.analysis_summary, index: null }];
  a.findings.forEach((f, i) => out.push({ text: f.claim, index: i }));
  return out;
}

export function detectContradictions(ctx: CriticContext): ContradictionFinding[] {
  const a = ctx.analysis;
  const found: ContradictionFinding[] = [];
  const knownSats = new Set(ctx.knownSatelliteIdsUpper);
  const knownInvs = new Set(ctx.knownInvestigationIds);
  const knownReports = new Set(ctx.knownReportIds);

  // RCA mismatch — the single most important consistency check (CRITICAL).
  if (a.authoritative_root_cause !== ctx.authoritativeRootCause) {
    found.push({ type: 'RCA_MISMATCH', category: 'RCA_CONSISTENCY', severity: 'CRITICAL', claimIndex: null, description: `Analysis root cause "${a.authoritative_root_cause}" differs from the authoritative "${ctx.authoritativeRootCause}".` });
  }

  const anomalyPresent = !!ctx.authoritativeRootCause && ctx.authoritativeRootCause !== 'UNKNOWN_ANOMALY';

  for (const { text, index } of perClaimText(a)) {
    if (anomalyPresent && HEALTHY.test(text)) {
      found.push({ type: 'HEALTH_STATE', category: 'CONTRADICTION', severity: 'ERROR', claimIndex: index, description: `Claim describes the satellite as healthy/nominal while investigation ${ctx.investigationId} has an authoritative anomaly (${ctx.authoritativeRootCause}).` });
    }
    if (ctx.evidence.length > 0 && NO_EVIDENCE.test(text)) {
      found.push({ type: 'EVIDENCE_EXISTENCE', category: 'CONTRADICTION', severity: 'ERROR', claimIndex: index, description: `Claim asserts no evidence exists while ${ctx.evidence.length} deterministic evidence item(s) exist.` });
    }
    if (ctx.citations.length > 0 && NO_CITATIONS.test(text)) {
      found.push({ type: 'CITATION_EXISTENCE', category: 'CONTRADICTION', severity: 'ERROR', claimIndex: index, description: `Claim asserts no citations exist while ${ctx.citations.length} were retrieved.` });
    }
    if (ctx.alertsActiveCount > 0 && NO_ALERTS.test(text)) {
      found.push({ type: 'ALERT_EXISTENCE', category: 'CONTRADICTION', severity: 'ERROR', claimIndex: index, description: `Claim asserts no active alerts while ${ctx.alertsActiveCount} are active.` });
    }
    if (ACTION_EXECUTED.some((re) => re.test(text))) {
      found.push({ type: 'ACTION_EXECUTED', category: 'POLICY', severity: 'CRITICAL', claimIndex: index, description: 'Claim states an operational action was executed; the Critic and Planner are read-only and cannot execute actions.' });
    }
    // Fabricated identifiers.
    for (const raw of text.match(/\bORION-\d+\b/gi) ?? []) {
      if (!knownSats.has(raw.toUpperCase())) found.push({ type: 'SATELLITE_ID', category: 'FABRICATED_ID', severity: 'CRITICAL', claimIndex: index, description: `References unknown satellite ID ${raw}.` });
    }
    for (const m of text.match(/\b(?:investigation|inv)\s*#?\s*(\d+)/gi) ?? []) {
      const n = Number((m.match(/(\d+)/) ?? [])[1]);
      if (Number.isFinite(n) && !knownInvs.has(n)) found.push({ type: 'INVESTIGATION_ID', category: 'FABRICATED_ID', severity: 'CRITICAL', claimIndex: index, description: `References unknown investigation ID ${n}.` });
    }
    for (const m of text.match(/\breport\s*#?\s*(\d+)/gi) ?? []) {
      const n = Number((m.match(/(\d+)/) ?? [])[1]);
      if (Number.isFinite(n) && !knownReports.has(n)) found.push({ type: 'REPORT_ID', category: 'FABRICATED_ID', severity: 'CRITICAL', claimIndex: index, description: `References unknown report ID ${n}.` });
    }
    // Numeric telemetry contradictions (relative tolerance).
    if (ctx.telemetryLatest) {
      for (const { re, key } of NUMERIC_PATTERNS) {
        const m = re.exec(text);
        const actual = ctx.telemetryLatest[key];
        if (m && typeof actual === 'number') {
          const claimed = Number(m[1]);
          if (Number.isFinite(claimed)) {
            const tol = Math.max(Math.abs(actual) * config.critic.numericTolerance, config.critic.numericTolerance);
            if (Math.abs(claimed - actual) > tol) {
              found.push({ type: 'TELEMETRY_NUMERIC', category: 'CONTRADICTION', severity: 'ERROR', claimIndex: index, description: `Claimed ${key} ${claimed} conflicts with deterministic tool fact ${actual} (tolerance ${tol.toFixed(3)}).` });
            }
          }
        }
      }
    }
  }

  return found;
}
