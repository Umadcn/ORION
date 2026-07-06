/**
 * Deterministic Copilot planner/fallback (Phase 5).
 *
 * When no real LLM provider is configured, this deterministic, intent-routed
 * planner drives the SAME read-only tool registry and composes a grounded,
 * cited answer. It never claims to be real model output (the service labels the
 * execution mode DETERMINISTIC_FALLBACK). Prohibited (write/control) requests
 * are refused safely.
 */
import { db } from '../db.js';
import { findSatelliteIdInText } from '../services/satelliteService.js';
import type { Investigation } from '../types.js';
import type { CopilotFinalAnswer, CopilotGroundingContext, ToolCall, ToolExecutionResult } from './types.js';

export type RunTool = (call: ToolCall) => Promise<ToolExecutionResult>;

const PROHIBITED = [
  /\b(reset|start|stop|pause|resume|restart|create|launch)\b.*\bsimulation\b|\bsimulation\b.*\b(reset|start|stop|pause|resume|restart|speed)\b/i,
  /\b(inject|trigger|simulate|remove|clear)\b.*\b(failure|fault|anomaly)\b/i,
  /\b(change|set|modify|override)\b.*\b(telemetry|simulation\s+speed)\b/i,
  /\b(approve|reject|resolve)\b/i,
  /\b(shell|bash|ls|rm|cat|exec|command line)\b/i,
  /\b(sql|select\s|drop\s|delete\s|update\s|insert\s)\b/i,
  /\b(http:\/\/|https:\/\/|fetch this url|curl)\b/i,
  /\b(fire|command|control)\b.*\b(thruster|satellite|spacecraft|payload)\b/i,
];

function excerpt(text: string, n: number): string {
  const flat = (text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : flat.slice(0, n).replace(/\s\S*$/, '');
}

function latestInvestigationForSatellite(satelliteId: string): Investigation | undefined {
  return db.prepare('SELECT * FROM investigations WHERE satellite_id = ? ORDER BY id DESC LIMIT 1').get(satelliteId) as Investigation | undefined;
}

const LIMITATIONS = [
  'Read-only advisory answer. The deterministic root-cause analysis is authoritative.',
  'Generated offline in deterministic fallback mode — not real LLM output.',
];

let TC = 0;
const call = (tool_name: string, args: Record<string, unknown>): ToolCall => ({ tool_call_id: `tc${++TC}`, tool_name, arguments: args });

function refusal(): CopilotFinalAnswer {
  return {
    type: 'FINAL_ANSWER',
    answer:
      "I'm a read-only Mission Copilot and cannot perform that action. I can explain investigations, " +
      'root causes, evidence, telemetry, alerts, reports, and mission knowledge — ask me about those.',
    claims: [],
    citations: [],
    evidence_ids: [],
    limitations: ['Read-only: no satellite control, simulation, approval/rejection/resolution, or data changes are possible here.'],
    suggested_followups: ['Why is a satellite unhealthy?', 'Show the evidence for a root cause.', 'What is the latest telemetry?'],
  };
}

export async function planDeterministicAnswer(
  message: string,
  runTool: RunTool,
  _ctx: CopilotGroundingContext,
): Promise<{ answer: CopilotFinalAnswer; insufficient: boolean; prohibited: boolean }> {
  const text = String(message ?? '');
  const lower = text.toLowerCase();

  if (PROHIBITED.some((re) => re.test(lower))) {
    return { answer: refusal(), insufficient: false, prohibited: true };
  }

  // Dynamic: recognize ANY persisted satellite id (seeded or manually-registered).
  const satelliteId = findSatelliteIdInText(text);
  const invMatch = text.match(/(?:investigation|inv)\s*#?\s*(\d+)/i);
  let investigationId = invMatch ? Number(invMatch[1]) : null;

  const wants = {
    alerts: /\balert/.test(lower),
    telemetry: /\b(telemetry|battery|temperature|signal|power)\b/.test(lower),
    historical: /\b(similar|before|history|historical|past|previously|happened)\b/.test(lower),
    recommend: /\b(recommend|action|next step|review)\b/.test(lower),
    evidence: /\bevidence\b/.test(lower),
    why: /\b(why|root cause|unhealthy|cause|failing|problem|wrong)\b/.test(lower),
    about: /\b(about|status|health|overview|state of|describe|tell me)\b/.test(lower),
  };

  const followups = ['Have similar incidents happened before?', 'What actions are recommended for review?', 'Show the supporting evidence.'];
  const insufficient = (answer: string): { answer: CopilotFinalAnswer; insufficient: boolean; prohibited: boolean } => ({
    answer: { type: 'FINAL_ANSWER', answer, claims: [], citations: [], evidence_ids: [], limitations: LIMITATIONS, suggested_followups: followups },
    insufficient: true,
    prohibited: false,
  });

  // --- SATELLITE OVERVIEW (calls getSatellite; works for any persisted satellite) ---
  if (satelliteId && wants.about && !wants.why && !wants.telemetry && !wants.alerts && !wants.historical && !wants.evidence && investigationId === null) {
    const r = await runTool(call('getSatellite', { satelliteId }));
    const out = r.output as { found?: boolean; id?: string; mission?: string; status?: string; orbit_type?: string } | null;
    if (!out?.found) return insufficient(`Satellite ${satelliteId} was not found.`);
    const hasTelemetry = out.status && out.status !== 'UNKNOWN';
    const claim = hasTelemetry
      ? `${out.id} (${out.mission}) is in a ${out.orbit_type} orbit with status ${out.status}.`
      : `${out.id} (${out.mission}) is registered in a ${out.orbit_type} orbit. No telemetry has been received yet, so its health is not yet known.`;
    return {
      answer: { type: 'FINAL_ANSWER', answer: claim, claims: [{ claim, citation_ids: [], evidence_ids: [] }], citations: [], evidence_ids: [], limitations: LIMITATIONS, suggested_followups: followups },
      insufficient: false, prohibited: false,
    };
  }

  // --- ALERTS ---
  if (wants.alerts && !wants.why) {
    const status = /\bactive\b/.test(lower) ? 'ACTIVE' : undefined;
    const r = await runTool(call('getAlerts', { ...(satelliteId ? { satelliteId } : {}), ...(status ? { status } : {}) }));
    const out = r.output as { count?: number; alerts?: { anomaly_type: string; satellite_id: string; severity: string }[] } | null;
    const n = out?.count ?? 0;
    const list = (out?.alerts ?? []).slice(0, 5).map((a) => `${a.satellite_id} ${a.anomaly_type} (${a.severity})`).join('; ');
    return {
      answer: {
        type: 'FINAL_ANSWER',
        answer: n === 0 ? `There are no ${status ?? ''} alerts${satelliteId ? ` for ${satelliteId}` : ''}.` : `There are ${n} ${status ?? ''} alerts${satelliteId ? ` for ${satelliteId}` : ''}: ${list}.`,
        claims: n > 0 ? [{ claim: `There are ${n} ${status ?? ''} alerts${satelliteId ? ` for ${satelliteId}` : ''}: ${list}.`, citation_ids: [], evidence_ids: [] }] : [],
        citations: [], evidence_ids: [], limitations: LIMITATIONS, suggested_followups: followups,
      },
      insufficient: false, prohibited: false,
    };
  }

  // --- TELEMETRY ---
  if (wants.telemetry && !wants.why) {
    if (!satelliteId) return insufficient('Please specify a satellite (e.g. ORION-3) to see its latest telemetry.');
    const r = await runTool(call('getTelemetry', { satelliteId, limit: 5 }));
    const out = r.output as { latest?: { battery_percent: number; temperature_c: number; signal_strength_dbm: number; power_consumption_w: number } } | null;
    if (!out?.latest) return insufficient(`No telemetry is available for ${satelliteId}.`);
    const l = out.latest;
    const claim = `Latest telemetry for ${satelliteId}: battery ${l.battery_percent}%, temperature ${l.temperature_c} C, signal ${l.signal_strength_dbm} dBm, power ${l.power_consumption_w} W.`;
    return {
      answer: { type: 'FINAL_ANSWER', answer: claim, claims: [{ claim, citation_ids: [], evidence_ids: [] }], citations: [], evidence_ids: [], limitations: LIMITATIONS, suggested_followups: followups },
      insufficient: false, prohibited: false,
    };
  }

  // --- HISTORICAL ---
  if (wants.historical && !wants.evidence) {
    const q = satelliteId ? `${satelliteId} ${text}` : text;
    const r = await runTool(call('searchHistoricalInvestigations', { query: q, ...(satelliteId ? { satelliteId } : {}), limit: 5 }));
    const out = r.output as { count?: number; results?: { investigation_id: number; root_cause: string; satellite_id: string }[] } | null;
    const results = out?.results ?? [];
    if (results.length === 0) return insufficient('No similar historical investigations were found in the record.');
    const claims = results.slice(0, 3).map((h) => ({ claim: `Investigation ${h.investigation_id} on ${h.satellite_id} was attributed to ${h.root_cause}.`, citation_ids: [], evidence_ids: [] }));
    return {
      answer: { type: 'FINAL_ANSWER', answer: `Found ${results.length} similar historical investigation(s).`, claims, citations: [], evidence_ids: [], limitations: LIMITATIONS, suggested_followups: followups },
      insufficient: false, prohibited: false,
    };
  }

  // --- Resolve an investigation for why / evidence / recommendations ---
  if (!investigationId && satelliteId) {
    const inv = latestInvestigationForSatellite(satelliteId);
    if (inv) investigationId = inv.id;
  }
  if (!investigationId) {
    return insufficient('Please specify an investigation (e.g. investigation 1) or a satellite (e.g. ORION-3) so I can look up its analysis.');
  }

  const invRes = await runTool(call('getInvestigation', { investigationId }));
  const inv = invRes.output as { found?: boolean; authoritative_root_cause?: string; satellite_id?: string; explanation?: string; recommended_review_actions?: { action: string; rationale: string }[] } | null;
  if (!inv?.found) return insufficient(`Investigation ${investigationId} was not found.`);
  const rcLabel = (inv.authoritative_root_cause ?? 'UNKNOWN_ANOMALY').replace(/_/g, ' ').toLowerCase();
  const sat = inv.satellite_id ?? satelliteId ?? 'the satellite';

  // --- RECOMMENDED ACTIONS ---
  if (wants.recommend && !wants.why && !wants.evidence) {
    const recs = inv.recommended_review_actions ?? [];
    const claims = recs.slice(0, 4).map((a) => ({ claim: `Recommended for human review: ${a.action} — ${a.rationale}`, citation_ids: [], evidence_ids: [] }));
    return {
      answer: { type: 'FINAL_ANSWER', answer: `Investigation ${investigationId} has ${recs.length} recommended review action(s). These are advisory and require human approval.`, claims, citations: [], evidence_ids: [], limitations: LIMITATIONS, suggested_followups: followups },
      insufficient: false, prohibited: false,
    };
  }

  // --- EVIDENCE / WHY (root cause) ---
  const evRes = await runTool(call('getEvidence', { investigationId }));
  const evOut = evRes.output as { evidence?: { evidence_id: string; summary: string; supports_root_cause: boolean }[] } | null;
  const evItems = (evOut?.evidence ?? []).filter((e) => e.supports_root_cause).slice(0, 3);
  const evItemsAny = evItems.length ? evItems : (evOut?.evidence ?? []).slice(0, 3);

  // Knowledge search to obtain a citation supporting the root cause.
  const kRes = await runTool(call('searchMissionKnowledge', { query: `${rcLabel} ${sat}`, topK: 3 }));
  const kOut = kRes.output as { results?: { citation_id: string; text: string }[] } | null;
  const topCite = (kOut?.results ?? [])[0];

  const claims: CopilotFinalAnswer['claims'] = [];
  // Root-cause claim (tool-fact grounded from getInvestigation output).
  claims.push({ claim: `The deterministic root cause for investigation ${investigationId} on ${sat} is ${rcLabel}.`, citation_ids: [], evidence_ids: [] });
  // Supporting knowledge claim (citation-grounded via chunk excerpt).
  if (topCite) claims.push({ claim: excerpt(topCite.text, 180), citation_ids: [topCite.citation_id], evidence_ids: [] });
  // Evidence claims (evidence-grounded).
  for (const e of evItemsAny) claims.push({ claim: excerpt(e.summary, 160), citation_ids: [], evidence_ids: [e.evidence_id] });

  const citations = topCite ? [topCite.citation_id] : [];
  const evidence_ids = evItemsAny.map((e) => e.evidence_id);

  return {
    answer: {
      type: 'FINAL_ANSWER',
      answer: `${sat} is associated with ${rcLabel} (investigation ${investigationId}). ${inv.explanation ? excerpt(inv.explanation, 220) : ''}`.trim(),
      claims, citations, evidence_ids, limitations: LIMITATIONS, suggested_followups: followups,
    },
    insufficient: false, prohibited: false,
  };
}
