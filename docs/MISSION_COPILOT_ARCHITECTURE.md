# Mission Copilot Architecture (Phase 5)

A **READ-ONLY** conversational assistant that answers grounded mission questions
using controlled read-only tool calling + conversational RAG, built on the
Phase 1 LlmRunner and the Phase 4 grounded-generation philosophy.

## Non-negotiable truths

- **Read-only.** The Copilot cannot control satellites, start/reset/inject
  simulations, approve/reject/resolve investigations, or modify alerts,
  telemetry, RCA, or any data. It runs no shell, no arbitrary SQL, no filesystem
  access, no URL fetching, and no unrestricted application APIs.
- **The deterministic RCA remains authoritative.** Tool results + deterministic
  facts outrank retrieved documents; retrieved text is untrusted data.
- **LlmRunner only.** No direct LLM provider calls. `LlmRunner` remains unwired
  from the six operational agents.
- **Deterministic fallback is never labeled real.** Offline, a deterministic
  intent-routed planner drives the *same* read-only tool registry.
- **No hidden chain-of-thought.** Only a short bounded `reasoning_summary`.
- **Grounding support and retrieval scores are not confidence.**
- **Short-term conversation memory only** (no long-term/semantic memory).

## Modules

`src/copilot/`: `types`, `schemas`, `prompt`, `toolRegistry`, `toolExecutor`,
`copilotContextBuilder`, `copilotValidators`, `deterministicCopilotFallback`,
`copilotService`, `conversationRepository`, `conversationService`,
`copilotAuditRepository`; `src/copilot/tools/` (8 read-only tools);
`src/api/copilot.ts`. Frontend: `components/AiDrawer.tsx` (+ client methods).

## Controlled tool model

`ToolDefinition` = name, description, version, input schema, output schema,
optional RBAC roles, timeout, max output size, `readOnly: true`, and a
deterministic `execute` over existing services/repositories. The `ToolRegistry`
is a fixed, frozen allowlist built at load — **unknown tools fail closed**; there
is no dynamic module loading, no arbitrary function/API/SQL/URL/filesystem access.

**Tools (all read-only):** `getSatellite`, `getTelemetry`, `getAlerts`,
`getInvestigation`, `getEvidence`, `getReport`, `searchMissionKnowledge`
(Phase 3 hybrid retrieval; surfaces citations), `searchHistoricalInvestigations`.

## Tool executor

Every call: resolve against the allowlist (unknown → fail closed) → RBAC check →
input-schema validation → execute with a timeout (`Promise.race`) → output-schema
validation → bound + sanitize (redact secrets, truncate) → persist a
`copilot_tool_executions` audit row. Never throws; failures become `REJECTED`/
`ERROR` results.

## Bounded execution loop

Configurable, safe defaults: max iterations (4), max tool calls (6), max
tool-output chars, max message chars, max context chars, max retained messages,
max execution time (15s), tool timeout (3s), max suggested follow-ups. The loop
stops on FINAL_ANSWER, iteration limit, tool-call limit, timeout, policy
violation, or exhausted budget. It **cannot** loop indefinitely.

## Real-provider tool calling (LlmRunner)

Strict discriminated structured output (`COPILOT_STEP_SCHEMA`, `type` =
`TOOL_REQUEST` | `FINAL_ANSWER`). Each iteration is one `LlmRunner.run` call. A
`TOOL_REQUEST` (reasoning_summary + tool_calls[]) is validated against the
registry and executed; results are fed back (sanitized, bounded). A
`FINAL_ANSWER` (answer + claims[] + citations + evidence_ids + limitations +
suggested_followups) is validated and grounded.

## Deterministic fallback

When no real provider is configured, `deterministicCopilotFallback` classifies
intent (why/root-cause, evidence, historical, recommended actions, telemetry,
alerts, prohibited) and drives the same read-only tools, composing a grounded,
cited answer or an explicit insufficient-evidence response. Prohibited
(write/control) requests are refused safely. Execution mode is
`DETERMINISTIC_FALLBACK`; it never claims to be real model output.

## Grounding

Reuses the Phase 4 philosophy (deterministic, lexical, bounded). Every factual
claim must be grounded by (1) a resolvable in-context citation with lexical
support ≥ threshold, (2) a valid in-context evidence ID, or (3) a deterministic
tool-fact (lexical support against tool-output tokens). Citations must resolve;
evidence IDs must belong to an accessed investigation; satellite/investigation/
report/alert IDs mentioned must exist (fabrication rejected). Policy rejects
operational commands, action-executed claims, approve/reject/resolve decisions,
and secret-shaped strings. Real-provider output and the fallback pass through the
same validators; a rejected real answer safely degrades to the deterministic
grounded answer.

## Answer statuses

`REAL_PROVIDER` (validated real output), `DETERMINISTIC_FALLBACK` (validated
deterministic output), `INSUFFICIENT_EVIDENCE` (no safe grounded answer),
`FAILED`.

## Audit

`copilot_tool_executions` (per tool call) and `copilot_executions` (per message:
iteration/tool-call counts, retrieval + LLM execution IDs, generation/grounding
status, citation/evidence counts, latency, fallback/failure reasons). No secrets,
no raw prompts, no hidden reasoning, no raw vectors, no unrestricted payloads.

## APIs

`GET /api/copilot/status`; `POST/GET /api/copilot/conversations`;
`GET /api/copilot/conversations/:id`; `POST /api/copilot/conversations/:id/messages`
(accepts only the user message); `POST /api/copilot/conversations/:id/archive`.
All authenticated; conversations are strictly per-user.

## Limitations

Offline default always yields `DETERMINISTIC_FALLBACK`/`INSUFFICIENT_EVIDENCE`
(the real-provider loop is mock-tested). Grounding is lexical, not semantic.
Prompt-injection defenses reduce risk but do not guarantee prevention. No
planner/critic/reflection agents, no long-term memory, no autonomous actions —
deferred by design.

## Phase 10 — upgraded into the ORION AI Assistant

The Copilot is extended (not replaced) into the full ORION AI Assistant. The
conversation store, tool registry/executor, grounding validators, and deterministic
fallback are all reused. New: capability catalog + intent routing + multi-turn
context resolution + bounded summarization + dynamic tool calling + Planner/Critic/
validated chat workflows + Agentic RAG + rich answer cards + safe SSE streaming +
citation/source inspection + feedback + evaluation + observability/governance + a
full-page frontend (`/ai-assistant`). See `ORION_AI_ASSISTANT_ARCHITECTURE.md`. The
tool executor gained an optional resolver + tool-timeout injection (defaults
preserve exact Phase 5 behavior). All Phase 0–9 boundaries are preserved.
