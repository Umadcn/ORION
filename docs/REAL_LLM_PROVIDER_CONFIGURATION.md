# Real LLM Provider Configuration (Phase 9)

Enabling a real LLM provider is **opt-in**. With none of these set, ORION uses the
deterministic fallback (`DETERMINISTIC_FALLBACK`) and startup/tests are unaffected.

## Environment variables (set locally only — never commit credentials)

| Variable | Meaning |
|----------|---------|
| `ORION_LLM_PROVIDER` | provider id; must be in `ORION_LLM_PROVIDER_ALLOWLIST` (default `openai,azure-openai,anthropic,http`) |
| `ORION_LLM_ENDPOINT` | OpenAI-compatible chat-completions URL (HTTPS required unless loopback) |
| `ORION_LLM_API_KEY` | API key — environment only; never logged/persisted/returned |
| `ORION_LLM_MODEL` | model id |
| `ORION_LLM_SUPPORTS_STRUCTURED_OUTPUT` / `_JSON_SCHEMA` / `_TOOL_CALLING` / `_STREAMING` | explicit capability declarations (never inferred from the name) |
| `ORION_LLM_TIMEOUT_MS`, `ORION_LLM_MAX_RETRIES`, `ORION_LLM_MAX_INPUT_TOKENS`, `ORION_LLM_MAX_OUTPUT_TOKENS` | runner bounds |

Example (local `.env`, git-ignored):

```
ORION_LLM_PROVIDER=openai
ORION_LLM_ENDPOINT=https://api.openai.com/v1/chat/completions
ORION_LLM_API_KEY=__your_key_here__
ORION_LLM_MODEL=gpt-4o-mini
```

## Adapter

`HttpLlmProvider` (`src/llm/httpProvider.ts`) implements the `LlmProvider`
contract: POSTs `{model, messages, temperature, max_tokens, response_format}`,
normalizes usage tokens + finish reason, and normalizes HTTP errors to stable
codes (`AUTH` 401/403, `RATE_LIMIT` 429, `SERVER` 5xx, `TIMEOUT` on abort,
`BAD_RESPONSE` on non-JSON / missing content). Retry + deterministic fallback are
owned by `LlmRunner`.

## Verifying

Configuration alone does NOT make the provider `AVAILABLE`. Run a live
verification (Director/Admin): `POST /api/providers/llm/verify`. It sends a fixed,
internal, bounded structured request through `LlmRunner` with fallback DISABLED —
so a real success yields `REAL_PROVIDER_VERIFIED` and any failure yields
`UNAVAILABLE`/`DEGRADED` (never a mislabeled fallback). See PROVIDER_VERIFICATION.md.

## Security

Keys are never hardcoded, persisted, logged, returned by APIs, or sent to the
frontend. `describeProvidersConfig()` exposes only boolean `*_configured` flags,
model ids, allowlist membership, and endpoint-trust — never the key.
