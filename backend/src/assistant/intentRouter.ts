/**
 * ORION AI Assistant intent router (Phase 10).
 *
 * A deterministic intent router (always available offline) plus an optional
 * real-provider structured classification through LlmRunner. Output is strictly
 * schema-validated. Unsupported intent fails safely; prohibited operational
 * intent is refused before any tool/workflow execution. Users can NEVER inject
 * an arbitrary capability/tool/workflow name — only an allowlisted intent maps
 * to a capability.
 */
import { LlmRunner, llmRunner } from '../llm/runner.js';
import { isRealLlmConfigured } from '../config.js';
import { ASSISTANT_INTENT_SCHEMA, ASSISTANT_INTENT_SCHEMA_NAME } from './assistantSchemas.js';
import { ASSISTANT_INTENT_VERSION, ASSISTANT_INTENT_SYSTEM_PROMPT, buildIntentUserPrompt } from './prompt.js';
import { findSatelliteIdInText } from '../services/satelliteService.js';
import type { MessageRow } from '../copilot/types.js';
import type { AssistantConversationContext, AssistantIntent } from './types.js';

export interface AssistantEntityRefs {
  satelliteId: string | null;
  /** A satellite-id *candidate* token (uppercased) that LOOKS like a satellite id
   *  even when it is NOT persisted (e.g. ORION-6). Existence is resolved later. */
  satelliteCandidate: string | null;
  /** All distinct satellite-id candidates in the message (for comparison). */
  satelliteCandidates: string[];
  investigationId: number | null;
  reportId: number | null;
  citationId: string | null;
  citationOrdinal: number | null;
  referencesPrevious: boolean;
}

export interface IntentResult {
  intent: AssistantIntent;
  entities: AssistantEntityRefs;
  source: 'DETERMINISTIC' | 'REAL_PROVIDER';
}

const PROHIBITED: RegExp[] = [
  /\b(reset|start|stop|restart|pause|resume|create|launch|run|speed\s*up|slow\s*down|change\s+the\s+speed)\b[^.]*\bsimulation\b/i,
  /\bsimulation\b[^.]*\b(reset|start|stop|restart|pause|resume|speed)\b/i,
  /\b(inject|trigger|add|simulate|remove|clear)\b[^.]*\b(failure|fault|anomaly)\b/i,
  /\b(change|set|modify|adjust|override)\b[^.]*\b(telemetry|battery|temperature|power|signal|simulation\s+speed)\b/i,
  /\b(approve|reject|resolve|dismiss|acknowledge)\b[^.]*\b(investigation|incident|alert|anomaly)\b/i,
  /\b(approve|reject|resolve)\s+(it|that|this)\b/i,
  /\b(shell|bash|powershell|\bls\b|\brm\b|\bcat\b|exec|command\s*line|terminal)\b/i,
  /\b(sql|select\s|drop\s+table|delete\s+from|update\s+\w+\s+set|insert\s+into)\b/i,
  /\b(https?:\/\/|fetch\s+this\s+url|open\s+this\s+url|curl|wget)\b/i,
  /\b(fire|command|control|maneuver|uplink|transmit)\b[^.]*\b(thruster|satellite|spacecraft|payload)s?\b/i,
  /\b(power|shut)\s*(off|down)\b[^.]*\b(satellite|spacecraft|payload)s?\b/i,
];

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5 };

/**
 * Extract satellite-id CANDIDATES: tokens that look like a satellite identifier
 * (letters + hyphen + must contain a digit) — independent of DB existence. Excludes
 * ORION-KB-* citation ids. Uppercased + de-duplicated, in first-seen order. Uses
 * whole-token boundaries so ORION-6 never matches ORION-10 / ORION-KB-*.
 */
export function extractSatelliteCandidates(message: string): string[] {
  const text = String(message ?? '');
  const out: string[] = [];
  const re = /(?<![A-Z0-9])([A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+)(?![A-Z0-9])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const tok = m[1].toUpperCase();
    if (/^ORION-KB-/.test(tok)) continue;   // citation id, not a satellite
    if (!/\d/.test(tok)) continue;          // must contain a digit (excludes READ-ONLY, FOLLOW-UP)
    if (!out.includes(tok)) out.push(tok);
  }
  return out;
}

function extractEntities(message: string): AssistantEntityRefs {
  const text = String(message ?? '');
  const lower = text.toLowerCase();
  // Dynamic: recognize ANY persisted satellite id (seeded or manually-registered),
  // not just the ORION-\d+ pattern.
  const satelliteId = findSatelliteIdInText(text);
  const satelliteCandidates = extractSatelliteCandidates(text);
  const satelliteCandidate = satelliteId ?? satelliteCandidates[0] ?? null;
  const invMatch = text.match(/(?:investigation|inv)\s*#?\s*(\d+)/i);
  const reportMatch = text.match(/report\s*#?\s*(\d+)/i);
  const citationId = text.match(/ORION-KB-[A-Z0-9-]+/i)?.[0]?.toUpperCase() ?? null;
  let citationOrdinal: number | null = null;
  const ordMatch = lower.match(/\b(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th)\b\s+(citation|source|reference|result)/);
  if (ordMatch) citationOrdinal = ORDINALS[ordMatch[1]] ?? null;
  const referencesPrevious = /\b(it|its|that|this|the (evidence|analysis|result|report|investigation|citation|source)|previous|those|them|again)\b/i.test(lower)
    && !satelliteCandidate && !invMatch && !reportMatch && !citationId;
  return {
    satelliteId,
    satelliteCandidate,
    satelliteCandidates,
    investigationId: invMatch ? Number(invMatch[1]) : null,
    reportId: reportMatch ? Number(reportMatch[1]) : null,
    citationId,
    citationOrdinal,
    referencesPrevious,
  };
}

// Cues that a message is genuinely about mission knowledge / procedures.
const MISSION_DOC_CUES = /\b(mission manual|knowledge base|documentation|document|procedure|protocol|guideline|playbook|runbook|what does the (manual|doc|guide|documentation) say|according to the (manual|docs?)|recommend|how (do|should) (we|i)|troubleshoot|remediation|recovery step|safe mode)\b/;
// Mission-domain subsystem/anomaly terms (a knowledge question even without a doc cue).
const MISSION_DOMAIN_TERMS = /\b(communication loss|comm loss|communications? (subsystem|anomaly|failure|degradation)|downlink|uplink|transponder|antenna|thermal (control|runaway|anomaly)|battery (degradation|cell)|power (subsystem|anomaly)|orbit(al)? (deviation|perturbation|decay)|attitude|reaction wheel|solar array|radiation|space weather|geomagnetic)\b/;
// Clearly out-of-scope, non-mission topics.
const OUT_OF_SCOPE_CUES = /\b(weather today|football|soccer|world cup|movie|song|recipe|stock price|joke|poem|who (is|was) the president|capital of|translate|write me|sports?|celebrity|horoscope)\b/;

/** Deterministic intent classification (always available). */
export function deterministicIntent(message: string, ctx: AssistantConversationContext): IntentResult {
  const text = String(message ?? '');
  const lower = text.toLowerCase();
  const entities = extractEntities(text);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const short = words.length <= 6;

  if (PROHIBITED.some((re) => re.test(text))) {
    return { intent: 'PROHIBITED', entities, source: 'DETERMINISTIC' };
  }

  const has = (re: RegExp) => re.test(lower);
  const hasEntity = !!(entities.satelliteCandidate || entities.investigationId || entities.reportId || entities.citationId);

  // --- Conversational / meta (answered directly, NEVER routed to retrieval). ---
  // Greeting: a short message that is essentially a greeting, with no entity/mission term.
  if (!hasEntity && short && has(/^\s*(hi+|hey+|hello+|holla|yo|howdy|greetings|good\s+(morning|afternoon|evening|day)|gm|sup|what'?s up)\b/)) {
    return { intent: 'GREETING', entities, source: 'DETERMINISTIC' };
  }
  if (!hasEntity && short && has(/\b(thanks|thank you|thx|ty|much appreciated|appreciate it|cheers|great|awesome|perfect|got it)\b/) && !has(/\b(why|how|what|show|tell|latest|alert|telemetry|report|evidence|investigation)\b/)) {
    return { intent: 'THANKS', entities, source: 'DETERMINISTIC' };
  }
  if (has(/\b(what can you do|what do you do|how can you help|what are you|who are you|your capabilities|help me|^help$|what can i ask|list (your )?capabilities)\b/) && !hasEntity) {
    return { intent: 'CAPABILITIES', entities, source: 'DETERMINISTIC' };
  }

  // Explicit workflow requests.
  if (has(/\b(validated|verify (your|the) (findings|analysis)|fully investigate|thorough(ly)? (analy[sz]e|investigate))\b/) ||
      (has(/\banaly[sz]e\b/) && has(/\bverify\b/))) {
    return { intent: 'VALIDATED_INVESTIGATION_ANALYSIS', entities, source: 'DETERMINISTIC' };
  }
  if (has(/\b(critique|critic review|review the (planner|analysis)|check whether .* grounded|is (the|that) analysis (grounded|sound))\b/)) {
    return { intent: 'CRITIC_REVIEW', entities, source: 'DETERMINISTIC' };
  }
  if (has(/\b(deeper analysis|run (a |an )?(deeper |planner )?analysis|planner analysis|investigate orion|create an? investigation analysis|analyze this investigation)\b/)) {
    return { intent: 'PLANNER_ANALYSIS', entities, source: 'DETERMINISTIC' };
  }

  // Source inspection.
  if (entities.citationId || entities.citationOrdinal !== null || has(/\b(explain|show|inspect|open)\b.*\b(citation|source)\b/)) {
    return { intent: 'SOURCE_INSPECTION', entities, source: 'DETERMINISTIC' };
  }

  // Telemetry comparison (two satellites + compare/versus).
  if (has(/\b(compare|comparison|versus|vs\.?|difference between|diff)\b/) && has(/\btelemetry|battery|temperature|signal|power\b/) && entities.satelliteCandidates.length >= 2) {
    return { intent: 'TELEMETRY_COMPARISON', entities, source: 'DETERMINISTIC' };
  }

  // Data intents (structured project state — highest priority when applicable).
  if (has(/\balert/)) return { intent: 'ALERT_ANALYSIS', entities, source: 'DETERMINISTIC' };
  if (has(/\b(telemetry|battery|temperature|signal|power draw|power consumption)\b/)) return { intent: 'TELEMETRY_ANALYSIS', entities, source: 'DETERMINISTIC' };
  if (has(/\b(similar|seen this before|happened before|precedent)\b/)) return { intent: 'SIMILAR_INCIDENT_ANALYSIS', entities, source: 'DETERMINISTIC' };
  if (has(/\b(history|historical|past incidents|previous incidents)\b/)) return { intent: 'HISTORICAL_INCIDENT_SEARCH', entities, source: 'DETERMINISTIC' };
  if (MISSION_DOC_CUES.test(lower)) return { intent: 'MISSION_KNOWLEDGE_SEARCH', entities, source: 'DETERMINISTIC' };
  if (has(/\bevidence\b/)) return { intent: 'EVIDENCE_EXPLANATION', entities, source: 'DETERMINISTIC' };
  if (has(/\breport\b/) || entities.reportId) return { intent: 'REPORT_EXPLANATION', entities, source: 'DETERMINISTIC' };
  if (has(/\b(why|root cause|unhealthy|failing|what.?s wrong|explain the investigation)\b/) || entities.investigationId) {
    return { intent: 'INVESTIGATION_EXPLANATION', entities, source: 'DETERMINISTIC' };
  }
  if (has(/\b(status|health|healthy|which satellites|state of)\b/)) {
    return { intent: 'SATELLITE_STATUS', entities, source: 'DETERMINISTIC' };
  }

  // Satellite lookup: a satellite candidate present + a lookup phrasing or a bare id.
  // Existence is resolved downstream (exists → status; not found → NOT_FOUND, no RAG).
  if (entities.satelliteCandidate && (short || has(/\b(tell me about|info(rmation)? (on|about)|look ?up|details? (on|about|for)|about)\b/))) {
    return { intent: 'SATELLITE_LOOKUP', entities, source: 'DETERMINISTIC' };
  }

  // Follow-up without a fresh entity but referencing prior context.
  if (entities.referencesPrevious && (ctx.satelliteId || ctx.investigationId || ctx.plannerExecutionId)) {
    return { intent: 'FOLLOW_UP', entities, source: 'DETERMINISTIC' };
  }

  // Mission knowledge only when there is a genuine mission-domain signal.
  if (MISSION_DOMAIN_TERMS.test(lower)) return { intent: 'MISSION_KNOWLEDGE_SEARCH', entities, source: 'DETERMINISTIC' };

  // Explicitly out-of-scope topics.
  if (OUT_OF_SCOPE_CUES.test(lower)) return { intent: 'OUT_OF_SCOPE', entities, source: 'DETERMINISTIC' };

  // DEFAULT: do NOT auto-route unknown text to RAG. Out-of-scope safe response.
  if (text.trim().length > 0) return { intent: 'OUT_OF_SCOPE', entities, source: 'DETERMINISTIC' };
  return { intent: 'UNSUPPORTED', entities, source: 'DETERMINISTIC' };
}

const ALLOWED_INTENTS = new Set<AssistantIntent>([
  'GREETING', 'THANKS', 'CAPABILITIES', 'OUT_OF_SCOPE', 'CLARIFICATION_NEEDED', 'SATELLITE_LOOKUP', 'TELEMETRY_COMPARISON',
  'MISSION_QA', 'SATELLITE_STATUS', 'TELEMETRY_ANALYSIS', 'ALERT_ANALYSIS', 'INVESTIGATION_EXPLANATION',
  'EVIDENCE_EXPLANATION', 'REPORT_EXPLANATION', 'MISSION_KNOWLEDGE_SEARCH', 'HISTORICAL_INCIDENT_SEARCH',
  'SIMILAR_INCIDENT_ANALYSIS', 'PLANNER_ANALYSIS', 'CRITIC_REVIEW', 'VALIDATED_INVESTIGATION_ANALYSIS',
  'SOURCE_INSPECTION', 'FOLLOW_UP', 'PROHIBITED', 'UNSUPPORTED',
]);

export interface IntentRouterDeps { runner?: LlmRunner; realProviderAvailable?: boolean }

export class AssistantIntentRouter {
  private runner: LlmRunner;
  private realAvailable: boolean;
  constructor(deps: IntentRouterDeps = {}) {
    this.runner = deps.runner ?? llmRunner;
    this.realAvailable = deps.realProviderAvailable ?? isRealLlmConfigured();
  }

  async classify(message: string, ctx: AssistantConversationContext, history: MessageRow[], correlationId?: string): Promise<IntentResult> {
    const det = deterministicIntent(message, ctx);
    // Prohibited is decided deterministically and is NOT delegated to the model.
    if (!this.realAvailable || det.intent === 'PROHIBITED') return det;

    try {
      const resp = await this.runner.run<{ intent: AssistantIntent; satellite_id?: string | null; investigation_id?: number | null; report_id?: number | null; citation_id?: string | null; citation_ordinal?: number | null; references_previous?: boolean | null }>({
        requestType: 'assistant-intent', promptVersion: ASSISTANT_INTENT_VERSION,
        messages: [
          { role: 'system', content: ASSISTANT_INTENT_SYSTEM_PROMPT },
          { role: 'user', content: buildIntentUserPrompt(message, ctx, history) },
        ],
        structuredOutput: { name: ASSISTANT_INTENT_SCHEMA_NAME, schema: ASSISTANT_INTENT_SCHEMA },
        correlationId,
      });
      if (resp.executionMode === 'REAL_PROVIDER' && resp.structured && ALLOWED_INTENTS.has(resp.structured.intent)) {
        const s = resp.structured;
        // A real classification of PROHIBITED is honored (extra safety); everything
        // else keeps the deterministic entity extraction, enriched by the model.
        const entities: AssistantEntityRefs = {
          ...det.entities,
          // Accept the model's satellite id only if it resolves to a persisted satellite (dynamic; validated downstream too).
          satelliteId: (typeof s.satellite_id === 'string' && findSatelliteIdInText(s.satellite_id)) || det.entities.satelliteId,
          investigationId: Number.isInteger(s.investigation_id) ? Number(s.investigation_id) : det.entities.investigationId,
          reportId: Number.isInteger(s.report_id) ? Number(s.report_id) : det.entities.reportId,
          citationId: (typeof s.citation_id === 'string' && /^ORION-KB-/i.test(s.citation_id) ? s.citation_id.toUpperCase() : det.entities.citationId),
          citationOrdinal: Number.isInteger(s.citation_ordinal) ? Number(s.citation_ordinal) : det.entities.citationOrdinal,
          referencesPrevious: typeof s.references_previous === 'boolean' ? s.references_previous : det.entities.referencesPrevious,
        };
        return { intent: s.intent, entities, source: 'REAL_PROVIDER' };
      }
    } catch { /* fall through to deterministic */ }
    return det;
  }
}

export const assistantIntentRouter = new AssistantIntentRouter();
