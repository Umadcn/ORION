# Planner Security Boundaries (Phase 6)

The Planner Agent is analysis-assistance only and **read-only** with respect to
mission state. This document enumerates the boundaries and their enforcement.

## Boundaries + controls

| Boundary | Control |
|----------|---------|
| No mission-state mutation (investigations, RCA, evidence scores, alerts, telemetry, reports, simulations, satellites) | The Planner has no write path. It reuses only read-only Copilot tools; internal steps compute in-memory. Verified by tests + runtime (investigation remains RESOLVED). |
| No approve/reject/resolve | No such action exists in the action registry; plan validator rejects such vocabulary; policy validator rejects decision text in output. |
| No arbitrary tools / dynamic loading | Fixed frozen action registry mapping to the frozen Phase 5 Copilot allowlist; unmapped/unknown step types fail closed. |
| No arbitrary SQL / filesystem / URL / shell | No such tool. Plan validator rejects SQL/URL/path/operational vocabulary in objective, reasons, and parameters. |
| No fabricated IDs | Plan validator rejects foreign investigation/satellite IDs in parameters; analysis grounding rejects fabricated citation/evidence IDs; mentioned satellite/investigation IDs must exist. |
| No unbounded execution | Bounded steps, iterations, tool calls, retrieval calls, query refinements, per-step timeout, and overall time budget. Duplicate-query prevention. Graceful PARTIAL/TIMED_OUT/ITERATION_LIMIT. |
| No provider/model/prompt/plan/query override via API | The endpoint ignores the request body entirely; the deterministic plan/prompt/query are built server-side. |
| LlmRunner-only | Plan generation calls `LlmRunner` exclusively; no direct provider imports in `src/planner`. `LlmRunner` remains unwired from the six operational agents. |
| Deterministic RCA authority | The authoritative root cause is copied exactly; grounding validation rejects any mismatch. |
| No confidence mislabeling | Grounding support + retrieval scores are reported as lexical/ranking signals, never as confidence. |
| RBAC + auth | Analysis endpoint is authenticated (any role that can read the investigation); audit endpoints are Director/Admin only. |
| Safe fallback | Invalid/unsafe real plans are rejected and replaced by the deterministic plan (`fallback_reason` audited); fallback is never labeled real. |
| No secret / raw-payload leakage | Audits store bounded summaries only — no raw prompts, hidden reasoning, raw embeddings, secrets, or unrestricted tool payloads. |

## Advisory-only semantics

Every Planner result carries `advisoryLabel: ANALYSIS_ASSISTANCE_ONLY`. Planner
output cannot trigger any operational action; it exists solely to help a human
reviewer understand an investigation.

## Not guaranteed

Prompt-injection defenses reduce risk but do not guarantee prevention. Grounding
and gap detection are deterministic and lexical, not semantic. The allowlist +
plan validator are the security boundary; changing them is a deliberate, reviewed
action.
