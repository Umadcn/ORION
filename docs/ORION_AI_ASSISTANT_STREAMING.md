# ORION AI Assistant — Safe Staged Streaming (Phase 10)

The Assistant streams **staged execution events** (not raw model tokens) over
Server-Sent Events. The final natural-language answer is emitted **only after the
quality gate passes**.

## Transport

`POST /api/assistant/conversations/:id/messages/stream` (authenticated, per-user
ownership). SSE frames:

- `event: progress` — a staged execution event (see below).
- `event: result` — the validated `AssistantExecutionResult` (final answer + rich
  content + citations + diagnostics).
- `event: error` — a sanitized error (e.g. `NOT_FOUND` for a non-owned conversation).
- `event: done` — stream terminator.

The non-streaming `POST .../messages` endpoint returns the same result in one shot.

## Stage events

`ASSISTANT_STARTED · CONTEXT_RESOLVED · INTENT_CLASSIFIED · TOOL_STARTED ·
TOOL_COMPLETED · RETRIEVAL_STARTED · RETRIEVAL_COMPLETED · PLANNER_STARTED ·
PLANNER_COMPLETED · CRITIC_STARTED · CRITIC_COMPLETED · VALIDATING_ANSWER ·
ANSWER_READY · FAILED`. `GET /api/assistant/executions/:id/events` returns a derived
staged summary for a completed turn (owner only).

## What is NEVER streamed

Hidden chain-of-thought · raw prompts · raw provider responses · raw tool payloads ·
secrets · raw vectors · unvalidated model claims. Only bounded, sanitized stage
detail strings are sent.

## Requirements met

Authenticated · per-user ownership (404 on cross-user) · client-disconnect cleanup
(tracked via the response `close`, not the request, so the stream is never
truncated when the request body is consumed) · bounded event count
(`ORION_ASSISTANT_MAX_EVENTS`) · execution timeout · correlation id · deterministic-
fallback compatible · covered by tests.

## Frontend

`api.assistantStream` uses a `fetch` body reader (EventSource cannot send the auth
header), parsing `event:`/`data:` frames, calling `onProgress` per stage and
resolving with the final result. The page renders a live `AssistantExecutionTimeline`.
