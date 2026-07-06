# Copilot Tool Security (Phase 5)

Security model for the Mission Copilot's controlled, read-only tool calling.

## Threat model + controls

| Threat | Control |
|--------|---------|
| Unknown / arbitrary tool invocation | Fixed frozen **allowlist** registry; `getTool` returns undefined for anything else → executor emits `UNKNOWN_TOOL` / `REJECTED` (fail closed). No dynamic import. |
| Malformed tool arguments | Every tool has an **input JSON-Schema**; the executor validates before execution (`INPUT_INVALID` → rejected). |
| Tool returning unexpected/huge data | Every tool has an **output JSON-Schema** + `maxOutputChars`; output is validated, bounded, and secret-redacted before reuse. |
| Runaway / hanging tool | Per-tool **timeout** via `Promise.race` (min of tool + config timeout) → `TIMEOUT`. |
| Infinite reasoning loop | Bounded loop: max iterations, max tool calls, max execution time, context budget — all configurable with safe defaults. |
| Write / control actions | Tools are **read-only** over existing read services/repositories. There is no tool that mutates state, controls satellites, runs simulations, or changes investigations/alerts/telemetry/RCA. |
| Arbitrary SQL / filesystem / URL / shell | No such tool exists. Knowledge search uses Phase 3 in-process retrieval; alert/history queries are **parameterized** column filters only. No `exec`, no `fetch`, no `fs`. |
| Prompt injection (user message) | The deterministic planner ignores embedded instructions; the real-provider system prompt marks retrieved text as untrusted data; injected "reveal secrets / ignore instructions" yields insufficient-evidence, never a leak. |
| Prompt injection (retrieved documents) | Retrieved chunks are delimited as untrusted data and (Phase 4) injection-filtered; the Copilot reuses grounded retrieval. |
| Operational-command / decision output | Deterministic **policy validator** rejects operational commands, action-executed claims, and approve/reject/resolve decisions. |
| Fabricated citation / evidence / satellite / investigation / report / alert IDs | Citation IDs must resolve + be in-context; evidence IDs must belong to an accessed investigation; satellite/investigation IDs mentioned must exist. Fabrication → rejected. |
| Secret leakage | `redactSecrets` on tool output summaries + audit + answer; policy scans for secret-shaped strings; audits store no secrets/prompts/payloads. |
| Cross-user data access | Conversations are per-user; access to another user's conversation returns 404 (existence not leaked). |
| Privilege escalation | Tools may declare `requiredRoles`; the executor enforces RBAC (`FORBIDDEN`). All routes are authenticated. |

## Fail-safe posture

Every failure path returns a safe result: unknown/invalid/forbidden tool calls
are rejected and audited; a rejected real-provider answer degrades to the
deterministic grounded answer; when nothing can be grounded, the Copilot returns
`INSUFFICIENT_EVIDENCE` rather than fabricating.

## Not guaranteed

Prompt-injection defenses reduce risk but do not guarantee prevention. Grounding
is lexical, not semantic. The allowlist is the security boundary — adding a tool
is a deliberate, reviewed change.

## Phase 10 — Assistant tool registry

The ORION AI Assistant reuses this frozen, allowlisted, read-only tool executor
unchanged (extended only with optional resolver + tool-timeout injection; defaults
preserve exact behavior). Its registry reuses the 8 Copilot tools and adds 4
read-only tools: `resolveCitation`, `getKnowledgeDocumentMetadata`,
`getPlannerAnalysis`, `getCriticReview`. Real-provider dynamic tool calls are
constrained to the selected capability's allowlisted tools (a disallowed tool is
rejected, not executed); duplicate tool-call detection and all Phase 5 bounds apply.
See `ORION_AI_ASSISTANT_TOOL_CALLING.md`.
