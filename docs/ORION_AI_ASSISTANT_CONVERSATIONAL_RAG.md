# ORION AI Assistant — Conversational Agentic RAG (Phase 10)

The Assistant reuses the Phase 3 hybrid retrieval (`HYBRID_RRF_RERANK` via the
`searchMissionKnowledge` tool) and the Phase 9 **active embedding-space** identity.

## Bounded Agentic RAG loop

For knowledge/investigation capabilities the executor:

1. formulates a bounded query (message + active satellite/root-cause terms),
2. searches mission knowledge,
3. inspects results; if insufficient (`< 2` relevant passages),
4. refines the query (adds `procedure recommendation subsystem` terms) and retries,
5. **stops** when: evidence is sufficient, `maxRetrievalCalls` reached, a
   **duplicate query** is detected, or no useful results remain.

## Embedding-space safety (no mixed spaces)

Retrieval respects the persisted active embedding space. If the query space key
differs from the active space, retrieval **fails closed** (`RetrievalSpaceMismatchError`
→ 409, audited `EMBEDDING_SPACE_MISMATCH`) — vectors from different
providers/models/dimensions/versions/normalization policies are never mixed.

## Honest labeling

- Offline, embeddings run in `LOCAL_HASH_FALLBACK` — a deterministic lexical
  feature hash, **never** labeled real semantic execution.
- `REAL_EMBEDDING_PROVIDER` is reported only after a genuine provider embedding call.
- Retrieval similarity / rerank / grounding support are **ranking signals, not
  confidence**.

## Grounding requirement

Every document-derived factual claim must carry a **resolvable citation id**; every
evidence reference must be a valid in-context evidence id; deterministic tool facts
ground tool-derived claims. Fabricated ids are rejected by the quality gate.
