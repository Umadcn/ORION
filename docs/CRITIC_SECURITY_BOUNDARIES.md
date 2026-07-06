# Critic Security Boundaries (Phase 7)

The Critic Agent is analysis-assistance only and **read-only** with respect to
mission state. This document enumerates the boundaries and their enforcement.

## Boundaries + controls

| Boundary | Control |
|----------|---------|
| No mission-state mutation (investigations, RCA, evidence scores, alerts, telemetry, reports, simulations, satellites) | The Critic has no write path. It reads authoritative facts and reconstructs the Planner analysis; the RevisionService only rewrites an in-memory analysis copy. Verified by tests + runtime (investigation remains RESOLVED). |
| ACCEPT ≠ approval, REJECT ≠ rejection | The decision never maps to any lifecycle transition or operational action. Every result carries `advisoryLabel: ANALYSIS_ASSISTANCE_ONLY` and `humanReviewRequired: true`. |
| No approve/reject/resolve, no operational commands | Output validator + deterministic contradiction detector flag action-executed / decision / command language as CRITICAL/POLICY; safety regexes reject such text in the review. |
| Critic never mutates the Planner analysis directly | A SEPARATE `RevisionService` produces revised candidates; the Critic only reads. |
| Bounded reflection loop | Max revision attempts, max Critic calls, max execution time, repeated-analysis + repeated-review detection (deterministic hashes). No recursive/unbounded reflection. |
| No fabricated IDs | Contradiction detector + output validator + grounding validator reject citation/evidence/satellite/investigation/report IDs not present in the review context. |
| No arbitrary tools / dynamic loading / SQL / URL / filesystem / shell | The Critic invokes no tools. Output validator rejects SQL/URL/path/operational vocabulary in review text. |
| No provider/model/prompt/review/analysis override via API | The endpoint ignores the request body entirely; prompt/schema are built server-side. |
| LlmRunner-only | The Critic calls `LlmRunner` exclusively; no direct provider imports in `src/critic`. `LlmRunner` remains unwired from the six operational agents. |
| Deterministic RCA authority | The authoritative root cause is compared exactly; any mismatch is a CRITICAL contradiction → REJECT. The RevisionService forces the RCA to the authoritative value (preserved exactly). |
| Safe fallback | Invalid/unsafe/inconsistent real reviews (or reviews that hide a deterministic CRITICAL finding) are rejected and replaced by the deterministic Critic (`fallback_reason` audited); fallback is never labeled real. |
| No confidence mislabeling | Grounding/coverage are lexical/ranking signals, never labeled as RCA confidence. The deterministic RCA confidence is passed through clearly labeled as deterministic-only. |
| RBAC + auth | The review endpoint is authenticated (any role that can request a Planner analysis); audit endpoints are Director/Admin only. |
| No secret / raw-payload leakage | Audits store bounded summaries only — no raw prompts, hidden reasoning, raw model responses, raw embeddings, secrets, or unrestricted payloads. |

## Not implemented (explicitly out of scope for Phase 7)

Long-term semantic memory, semantic cache, ChromaDB, multimodal AI, write-capable
tools, autonomous operational actions, Critic-triggered mission-state changes, an
AI Evaluation Dashboard, unrestricted self-improvement, unbounded self-reflection,
and recursive agent spawning are **not** implemented.

## Not guaranteed

Prompt-injection defenses reduce risk but do not guarantee prevention. Coverage,
contradiction, grounding, and overstatement checks are deterministic and lexical,
not semantic. The output validator + allowlists + bounded loop are the security
boundary; changing them is a deliberate, reviewed action.
