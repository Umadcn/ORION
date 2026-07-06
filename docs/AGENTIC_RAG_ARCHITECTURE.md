# Agentic RAG Architecture (Phase 6)

Bounded, deterministic iterative retrieval inside the Planner Agent. The Planner
may decide current context is insufficient and retrieve more mission knowledge —
within hard limits, with deterministic queries, and without ever changing the
authoritative RCA.

## Loop

```
execute plan steps  →  ASSESS_KNOWLEDGE_GAP
   → detect gap (deterministic)
   → if sufficient: stop
   → else, while (refinements < max AND retrieval calls < max AND time left):
        build a deterministic, bounded, sanitized query (gap-driven)
        if query duplicates a previous one: stop
        searchMissionKnowledge (HYBRID_RRF_RERANK)  → accumulate citations
        re-detect gap
   → record each refinement (audit)
→ BUILD_FINAL_ANALYSIS (grounded)
```

## Knowledge-gap detection (deterministic)

`knowledgeGapDetector` evaluates gathered material against bounded thresholds:
mission-knowledge citations ≥ `ORION_PLANNER_MIN_CITATIONS` and deterministic
evidence ≥ `ORION_PLANNER_MIN_EVIDENCE_ITEMS` ⇒ sufficient. It also reports
missing telemetry / historical categories. It returns the gap type, description,
missing source categories, and suggested bounded retrieval terms. No LLM judge is
used. Mission-identifier aware.

## Query construction + refinement (deterministic)

`retrievalQueryBuilder` composes a sanitized, bounded query from the satellite
ID, subsystem, authoritative root-cause label, anomaly types, evidence terms, and
gap-suggested terms. Refinement is deterministic: each iteration appends a
distinct slice of gap terms. Queries are hashed and de-duplicated — a repeat
query stops refinement. The LLM never supplies an unrestricted retrieval query.

## Bounds (never unbounded)

- `ORION_PLANNER_MAX_RETRIEVAL_CALLS` — total retrieval calls per analysis.
- `ORION_PLANNER_MAX_QUERY_REFINEMENTS` — additional retrieval iterations after
  the first gap assessment.
- `ORION_PLANNER_MAX_EXECUTION_MS` — overall wall-clock budget.
- Duplicate-query prevention — a repeated query halts refinement.
- Stops on sufficiency, refinement limit, retrieval limit, duplicate query, or
  time budget.

## Grounding + provenance

Each retrieval reuses Phase 3 `HYBRID_RRF_RERANK`, persists a normal
`retrieval_executions` audit row, and surfaces resolvable citations (with
provenance) that feed claim-level grounding. Retrieval and grounding scores are
ranking signals — **not confidence**, and retrieved context **never** changes the
authoritative RCA.

## Audit

Each iteration writes a `planner_retrieval_refinements` row: iteration, gap type,
query hash, sanitized query summary, retrieval execution id, result count, new
citation count, and sufficiency-after. No raw prompts, no embeddings, no secrets.
