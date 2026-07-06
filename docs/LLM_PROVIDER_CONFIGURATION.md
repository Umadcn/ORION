# LLM Provider Configuration

How to enable a real LLM provider for PROJECT ORION **without embedding any credentials in the repository**. By default ORION runs fully offline in `DETERMINISTIC_FALLBACK` mode; configuring a provider is optional.

## Operating modes

| Mode | When | Behavior |
|------|------|----------|
| `DETERMINISTIC_FALLBACK` (default) | No real provider configured, fallback enabled | Offline, deterministic, schema-valid output shaped from grounded data. Never claims to be model-generated. |
| `REAL_PROVIDER` | `ORION_LLM_*` fully configured and reachable | Calls the configured HTTP LLM; validates + audits every call. |
| `DISABLED` | No real provider **and** `ORION_LLM_FALLBACK_ENABLED=false` | LLM calls return `FAILED` (no output). |

Check the current mode: `GET /api/llm/status` (Mission Director / System Admin). It returns non-secret config only.

## Environment variables

Set these in the environment or an **untracked** local `.env` (never commit real values):

```bash
ORION_LLM_PROVIDER=openai            # none (default) | openai | anthropic | http (OpenAI-compatible)
ORION_LLM_ENDPOINT=https://api.openai.com/v1/chat/completions
ORION_LLM_API_KEY=<supplied via secret store / local untracked env>
ORION_LLM_MODEL=gpt-4o-mini
ORION_LLM_TIMEOUT_MS=20000
ORION_LLM_MAX_RETRIES=2
ORION_LLM_MAX_INPUT_TOKENS=6000
ORION_LLM_MAX_OUTPUT_TOKENS=1024
ORION_LLM_FALLBACK_ENABLED=true      # recommended: keep true so the platform degrades gracefully
```

A real provider is considered configured only when `PROVIDER != none` **and** `ENDPOINT`, `API_KEY`, and `MODEL` are all present. If partially set, `/api/llm/status.diagnostics` lists exactly what is missing (without revealing secrets).

## Wire format

`HttpLlmProvider` posts an OpenAI-compatible Chat Completions body:
```json
{ "model": "...", "messages": [...], "temperature": 0, "max_tokens": 1024, "response_format": {"type": "json_object"} }
```
`response_format` is included only for structured requests. Any endpoint that accepts this shape and returns `choices[0].message.content` (+ optional `usage`) works. For non-OpenAI wire formats, add a new `LlmProvider` implementation — application code depends only on the interface.

## Security guarantees

- The API key is read from the environment only — never hardcoded, logged, persisted, or returned by any API.
- `redactSecrets()` scrubs bearer tokens / key-shaped strings from audit records and error messages.
- `llm_executions` stores no credentials; raw prompt/response summaries are persisted only when a caller sets `persistPayloads: true`, and are sanitized + truncated.
- `/api/llm/*` is read-only and restricted to Mission Director + System Administrator. There is intentionally **no** endpoint to submit arbitrary prompts.

## Local testing without a real provider

All tests run offline with mock providers / mocked `fetch` — no key or network required. To smoke-test the real path locally, point `ORION_LLM_ENDPOINT` at a local mock server that speaks the OpenAI wire format.
