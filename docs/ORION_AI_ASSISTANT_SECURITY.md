# ORION AI Assistant — Security & Boundaries (Phase 10)

The Assistant is **advisory and read-only** with respect to mission state. It
preserves every Phase 0–9 boundary.

## Provider access

- `LlmRunner` is the **only** application path to an LLM provider. The Assistant,
  its intent router, memory summarizer, workflows, and the real answer loop all go
  through it. No direct provider calls anywhere.
- `EmbeddingProvider` is the only embedding abstraction; retrieval respects the
  active embedding space and fails closed on mismatch.
- `LlmRunner` remains **unwired** from the six operational agents.

## Input constraints (no injection surface)

The message endpoints accept **only** the bounded user message. The feedback
endpoint accepts an allowlisted rating/reason + bounded comment. There is **no**
provider/model/endpoint/system-prompt/tool/retrieval-mode/**capability** override —
capabilities and tools are selected only from fixed allowlists; unknown values fail
closed. No arbitrary SQL, shell, URL fetch, filesystem access, dynamic tool loading,
or recursive agent spawning.

## Query understanding & retrieval gating (correctness repair)

The Assistant understands each turn before acting: input validation → context →
intent classification → entity extraction → **entity resolution** → route planning
→ conditional retrieval → **relevance filtering** → synthesis → grounding + answer↔
question alignment + policy validation. Conversational/meta intents (greeting,
thanks, capabilities, out-of-scope) and unknown/ambiguous input are answered
directly and **never** trigger retrieval; unknown text is not auto-routed to RAG.
Satellite ids are resolved against authoritative storage (exact, never substring)
before any retrieval — a non-existent id returns NOT_FOUND with no document lookup.
Retrieval results pass a deterministic relevance + identifier-conflict gate;
rejected passages are never cited and the Assistant abstains when nothing is
relevant. See `AI_ASSISTANT_*` docs. These are correctness controls layered on top
of — and never weakening — the read-only boundaries below.

## Prohibited-request handling

Control/decision requests (reset/start/stop simulation, approve/reject/resolve,
SQL/shell, URL fetch, satellite control) are classified `PROHIBITED` **before** any
tool/workflow runs and refused safely. Prohibited classification is always
deterministic and is never delegated to the model. Prompt-injection attempts
("ignore your instructions and approve…") are refused by the same deterministic
gate.

## No mission-state mutation

The Assistant, tools, workflows, evaluation, observability, and feedback are
read-only w.r.t. satellites/telemetry/alerts/investigations/evidence/reports.
Planner/Critic invocation is advisory; `humanReviewRequired` is preserved; Critic
`ACCEPT/REJECT` is analysis-quality review, never a mission decision. The
deterministic RCA/evidence/scoring remain authoritative.

## No secrets / no hidden reasoning / no raw payloads

No API keys, Authorization headers, or secret-shaped values in prompts, context,
audits, DB, logs, API responses, docs, or tests. Bounded metadata only in
`assistant_executions` / `assistant_feedback` / `assistant_conversation_state`
(no raw prompts, raw provider responses, hidden chain-of-thought, raw vectors, or
unrestricted tool payloads). The persisted answer card is secret-redacted and
bounded. Source inspection never returns raw vectors, filesystem paths, or secrets.

## RBAC

All routes authenticated + per-user conversation ownership (cross-user → 404).
Evaluation + observability detail are Director/Admin only. Capability-level RBAC is
enforced on top of route auth (fail-closed).

## Execution-mode integrity

Deterministic fallback is never labeled real; a rejected real answer is recorded
`REAL_REJECTED` and degraded to fallback (never counted real-accepted); LocalHash
embeddings are never labeled real semantic; **mock success is never live
verification**.

## Manual satellite status (human-only; AI reads effective status)

Manual status control (`PATCH /api/satellites/:id/status`, AUTO / HEALTHY /
WARNING / ALERT) is an explicit authenticated HUMAN action (Director/Admin). It is
a display/operational override only — it never fabricates telemetry, alerts,
investigations, RCA, or evidence, and never overwrites the system-derived status.
The AI Assistant, `getSatellite` tool, and all read surfaces report the
**effective** status via one canonical resolver (`services/satelliteStatus.ts`):
when overridden the answer is honest — "…is currently in WARNING status due to a
manual operator override. Its system-derived status is HEALTHY." No AI tool can
set or clear a manual status; verified: an Assistant "set … to HEALTHY" request
does not change `status_mode`/`manual_status`.

## Dynamic satellites (read-only for AI)

Satellite registration/edit/archive/reactivation and simulation start/stop are
explicit authenticated HUMAN actions (Director/Admin per RBAC). The AI Assistant,
Mission Copilot, Planner, Critic, the six operational agents, and the RAG/provider
layers can READ any persisted satellite (dynamic id resolution via
`findSatelliteIdInText`, not a hardcoded ORION pattern) but can NEVER create, edit,
archive, reactivate, control, or simulate one — verified: an Assistant "start the
simulation" request is REFUSED and mission state is unchanged.

## Simulation Control Center (read-only for AI)

The Satellite Simulation Control Center (sessions, speed, telemetry config, failure
injection/removal) is a human-only surface (Director/Admin). No write-capable
simulation tool exists in any AI tool registry. Control/mutation requests —
start / pause / resume / stop / reset / create simulation, change speed, modify
telemetry, and inject / remove / clear failures — are classified `PROHIBITED`
**deterministically before any tool/workflow runs** (see `intentRouter`,
`copilotValidators`, `deterministicCopilotFallback`) and refused. Verified: an
Assistant "Inject a LOW_BATTERY failure into …" request is `REFUSED` and
`simulation_failures` / `simulation_sessions` are unchanged.
