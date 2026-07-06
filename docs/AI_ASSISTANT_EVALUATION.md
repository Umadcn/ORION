# AI Assistant — Evaluation

## Measurable behaviors

The correctness repair is validated deterministically (offline, reproducible) via
`backend/tests/assistantCorrectness.test.ts` and the existing evaluation harness
`backend/src/assistant/assistantEvaluation.ts` (surfaced to Director/Admin through
`/api/assistant/evaluations`). Metrics tracked include intent accuracy, refusal
correctness, grounding-accepted rate, fallback rate, and failure rate. Scores are
relevance / grounding signals — **never** confidence.

## Categories covered by the correctness suite

| Category | Asserted behavior |
|---|---|
| Greetings / conversation | GREETING/THANKS classification, retrieval = 0, no citations |
| Capabilities / help | CAPABILITIES classification, retrieval = 0 |
| Satellite lookup / status | candidate extraction, exact resolution, structured answer |
| Unknown entity | `orion-6` → NOT_FOUND, retrieval = 0, no ORION-3 leakage |
| Identifier safety | ORION-6≠ORION-3, ORION-1≠ORION-10, SAT-NEW-001≠SAT-NEW-0010 |
| Telemetry / alerts | structured tools, retrieval = 0 |
| Telemetry comparison | both satellites resolved, retrieval = 0 |
| Mission knowledge | relevance-gated retrieval + synthesized cited answer / abstention |
| Relevance / negative | identifier-conflict rejection; abstain when nothing relevant |
| Root cause | investigation/RCA path |
| Follow-up | "its telemetry" resolves to prior satellite |
| Ambiguity | clarification question, no silent selection |
| Out-of-scope | OUT_OF_SCOPE, retrieval = 0 |
| Prohibited | REFUSED, retrieval = 0, tools = 0 |
| No-mutation | asking never changes satellites/investigations/simulation_failures |

## Real-provider evaluation

No verified external provider is configured in this environment
(`ORION_LLM_PROVIDER=none`), so real-provider metrics were **not** executed and are
**not** reported. When a provider is verified, the same harness runs in
`REAL_PROVIDER` mode and its metrics are reported separately (never combined with
deterministic-fallback metrics). Deterministic classification/synthesis remains the
authoritative offline path; a rejected real answer is recorded `REAL_REJECTED` and
degraded to deterministic — fallback is never labeled real.

## Honest scope note

This pass did not add a separate standalone 100-case JSON dataset file; the
measurable, deterministic coverage above (24 correctness assertions across all
required categories + the existing evaluation harness) is what is implemented and
green. Expanding to a 100+ case labeled dataset with per-case retrieval labels is a
follow-up opportunity.
