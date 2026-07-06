# AI Assistant — Routing Architecture

Routing is allowlisted and fail-closed. An intent maps to exactly one handling
path; user input can never inject a capability, tool, or workflow name.

## Route classes

| Route | Intents | Retrieval | Handling |
|---|---|:--:|---|
| DIRECT_CONVERSATION | GREETING, THANKS, CAPABILITIES, OUT_OF_SCOPE | never | direct answer in `assistantService` (zero tools) |
| STRUCTURED_LOOKUP | SATELLITE_LOOKUP → SATELLITE_STATUS | never | `getSatellite`/`getTelemetry` |
| STRUCTURED_MULTI_TOOL | SATELLITE_STATUS, ALERT_ANALYSIS, TELEMETRY_ANALYSIS | never | structured tools |
| COMPARISON | TELEMETRY_COMPARISON | never | resolve both sats + `getTelemetry` each |
| CURRENT_STATE_ANALYSIS | INVESTIGATION_EXPLANATION, EVIDENCE_EXPLANATION | gated | investigation/evidence + optional relevant RAG |
| MISSION_KNOWLEDGE_RAG | MISSION_KNOWLEDGE_SEARCH | required + gated | `searchMissionKnowledge` + relevance filter |
| HISTORICAL_SEARCH | HISTORICAL_INCIDENT_SEARCH, SIMILAR_INCIDENT_ANALYSIS | historical tool | `searchHistoricalInvestigations` |
| FOLLOW_UP_RESOLUTION | FOLLOW_UP | inherits | resolve context → prior capability |
| PROHIBITED_REFUSAL | PROHIBITED | never | deterministic refusal |
| OUT_OF_SCOPE_RESPONSE | OUT_OF_SCOPE | never | scope message |
| CLARIFICATION_REQUIRED | (entity-requiring intent, no entity/context) | never | clarification question |
| INSUFFICIENT_EVIDENCE | any, when nothing relevant | — | abstention |

## Route-to-tool matrix (deterministic executor)

| Capability | Tools | Retrieval |
|---|---|:--:|
| SATELLITE_STATUS | getSatellite, getTelemetry | no |
| TELEMETRY_ANALYSIS | getTelemetry, getSatellite | no |
| TELEMETRY_COMPARISON | getTelemetry (×2), getSatellite | no |
| ALERT_ANALYSIS | getAlerts | no |
| INVESTIGATION_EXPLANATION | getInvestigation, getEvidence, searchMissionKnowledge | gated |
| EVIDENCE_EXPLANATION | getInvestigation, getEvidence | no |
| REPORT_EXPLANATION | getReport | no |
| MISSION_KNOWLEDGE_SEARCH | searchMissionKnowledge | required + gated |
| HISTORICAL / SIMILAR | searchHistoricalInvestigations, getInvestigation | no/opt |
| SOURCE_INSPECTION | resolveCitation, getKnowledgeDocumentMetadata | no |
| PLANNER / CRITIC / VALIDATED | (workflows) | no |

`searchMissionKnowledge` is **never** a universal fallback — it runs only for the
knowledge/RCA-background routes, and its results pass the relevance gate.

## Structured-data priority

Questions about current project state (satellite existence/metadata/status,
telemetry, alerts, investigations, RCA, evidence, reports, simulation) are answered
from authoritative structured data via read-only tools — never primarily from
mission documents.
