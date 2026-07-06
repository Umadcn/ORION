# AI Assistant — Query Understanding

Every turn is understood BEFORE any tool/retrieval runs. The pipeline is:

```
input validation → conversation-context load → intent classification →
entity extraction → entity resolution → route selection → tool/retrieval planning
→ execution → conditional retrieval → relevance filter → evidence assembly →
answer synthesis → grounding + answer↔question alignment + policy validation → response
```

## Intents (`AssistantIntent`)

Conversational/meta (answered directly, **never** retrieval): `GREETING`, `THANKS`,
`CAPABILITIES`, `OUT_OF_SCOPE`, `CLARIFICATION_NEEDED`, `SATELLITE_LOOKUP`.
Structured/knowledge: `SATELLITE_STATUS`, `TELEMETRY_ANALYSIS`,
`TELEMETRY_COMPARISON`, `ALERT_ANALYSIS`, `INVESTIGATION_EXPLANATION`,
`EVIDENCE_EXPLANATION`, `REPORT_EXPLANATION`, `MISSION_KNOWLEDGE_SEARCH`,
`HISTORICAL_INCIDENT_SEARCH`, `SIMILAR_INCIDENT_ANALYSIS`, `SOURCE_INSPECTION`,
`PLANNER_ANALYSIS`, `CRITIC_REVIEW`, `VALIDATED_INVESTIGATION_ANALYSIS`. Control:
`PROHIBITED`. Meta: `FOLLOW_UP`, `UNSUPPORTED`.

## Deterministic first-pass classifier (`deterministicIntent`)

Always available offline; ordered so the highest-priority signal wins:
1. `PROHIBITED` (control/mutation) — decided deterministically, never delegated.
2. Conversational: greeting / thanks / capabilities (short, no entity).
3. Explicit workflow requests (planner / critic / validated).
4. Source inspection (citation id / ordinal).
5. `TELEMETRY_COMPARISON` (compare + telemetry + ≥2 satellite candidates).
6. Structured data intents (alerts, telemetry, similar/historical, evidence, report,
   investigation/why/unhealthy, status).
7. `MISSION_KNOWLEDGE_SEARCH` on explicit doc cues.
8. `SATELLITE_LOOKUP` (a satellite candidate + bare/lookup phrasing).
9. `FOLLOW_UP` (reference + prior context).
10. `MISSION_KNOWLEDGE_SEARCH` on mission-domain terms (e.g. "communication loss").
11. `OUT_OF_SCOPE` cues.
12. **Default → `OUT_OF_SCOPE`** (NOT `MISSION_QA`). Unknown text is never
    auto-routed to retrieval.

## Real-provider refinement (optional)

When a verified real LLM is configured, `AssistantIntentRouter` may refine the
classification through `LlmRunner` using a strict schema (enum-bounded to the
allowlisted intents). Invalid or non-real output falls back to the deterministic
result. `PROHIBITED` is never delegated. Deterministic output is never labeled real.
