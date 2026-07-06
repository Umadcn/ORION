# Real Embedding Provider Configuration (Phase 9)

Enabling a real semantic embedding provider is **opt-in**. The default is
`LocalHashEmbedding` (deterministic lexical feature hashing — **NOT** a neural
model), reported as `LOCAL_HASH_FALLBACK`.

## Environment variables (set locally only)

| Variable | Meaning |
|----------|---------|
| `ORION_EMBEDDING_PROVIDER` | provider id; must be in `ORION_EMBEDDING_PROVIDER_ALLOWLIST` (default `openai,azure-openai,http`); `local`/`none` = fallback |
| `ORION_EMBEDDING_ENDPOINT` | OpenAI-compatible embeddings URL (HTTPS required unless loopback) |
| `ORION_EMBEDDING_API_KEY` | API key — environment only |
| `ORION_EMBEDDING_MODEL` | model id |
| `ORION_EMBEDDING_DIMENSION` | expected vector dimension (validated on every response) |
| `ORION_EMBEDDING_MAX_BATCH_SIZE`, `ORION_EMBEDDING_TIMEOUT_MS` | bounds |
| `ORION_EMBEDDING_NORMALIZED` | normalization policy (`true`→`L2_NORMALIZED`) recorded with every embedding space |

Example (local `.env`):

```
ORION_EMBEDDING_PROVIDER=openai
ORION_EMBEDDING_ENDPOINT=https://api.openai.com/v1/embeddings
ORION_EMBEDDING_API_KEY=__your_key_here__
ORION_EMBEDDING_MODEL=text-embedding-3-small
ORION_EMBEDDING_DIMENSION=1536
```

## Adapter

`HttpEmbeddingProvider` (`src/embeddings/httpEmbeddingProvider.ts`) implements
`EmbeddingProvider`: POSTs `{model, input[]}`, validates `data.length === input.length`,
validates each vector's dimension and finiteness (rejects NaN/Infinity), and
normalizes errors (AUTH/RATE_LIMIT/SERVER/TIMEOUT/BAD_RESPONSE/BATCH_TOO_LARGE).
Its execution mode is `REAL_EMBEDDING_PROVIDER` — assigned only for genuine
successful output. A fallback result is never labeled `REAL_EMBEDDING_PROVIDER`.

## Consequence: re-embedding required

Switching from `LOCAL_HASH_FALLBACK` to a real provider changes the embedding
space (provider/model/dimension/normalization). Vectors from different spaces are
NOT comparable. You MUST run a controlled corpus re-embedding before real
semantic vector retrieval — see EMBEDDING_SPACE_MIGRATION.md. Retrieval fails
closed on a space mismatch.

## Verifying

`POST /api/providers/embeddings/verify` (Director/Admin) sends a fixed internal
input to the configured provider and validates dimension + finiteness. Only a
genuine success yields `REAL_EMBEDDING_VERIFIED`.
