# AI Assistant — Retrieval Gating

Mission-knowledge retrieval (`searchMissionKnowledge`) runs ONLY when justified:

- intent is `MISSION_KNOWLEDGE_SEARCH`, OR
- a grounded RCA explanation needs supporting mission-document background
  (`INVESTIGATION_EXPLANATION`), OR
- the user explicitly asks for procedures / manuals / documentation.

Retrieval NEVER runs for: `GREETING`, `THANKS`, `CAPABILITIES`, `OUT_OF_SCOPE`,
`SATELLITE_LOOKUP` (found → structured; not found → NOT_FOUND), `SATELLITE_STATUS`,
`TELEMETRY_ANALYSIS`, `TELEMETRY_COMPARISON`, `ALERT_ANALYSIS`,
`EVIDENCE_EXPLANATION`, `REPORT_EXPLANATION`, `PROHIBITED`, or `CLARIFICATION_NEEDED`.
The correctness test suite asserts `retrievalCallCount === 0` for these cases.

## Intent-aware query construction

Retrieval does not receive the raw message. `buildKnowledgeQuery(message, satelliteId)`
strips conversational filler ("what does the mission manual say about", "tell me
about", "can you", punctuation) and preserves the mission subject + any resolved
satellite id. For an RCA-background query it uses the authoritative root-cause label
(e.g. `communication_subsystem_failure troubleshooting recovery procedure`) rather
than the bare user phrase.

## Bounded refinement

Retrieval is attempted at most `max(2, capability.maxRetrievalCalls)` times. After
each attempt the results pass the relevance gate (see
`AI_ASSISTANT_RELEVANCE_AND_ABSTENTION.md`); refinement (adding
`procedure recommendation troubleshooting subsystem`) happens only when there is a
WEAK signal. Duplicate queries stop the loop. No unbounded loops, no recursion, and
every retrieval attempt is audited (`retrieval_executions`).
