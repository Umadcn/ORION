# ORION AI Assistant — Context Resolution & Bounded Memory (Phase 10)

## Multi-turn context resolution (`contextResolution.ts`)

Deterministic resolution of conversational references, each validated against
authoritative data:

- **Entities:** satellite id, investigation id, report id, planner/critic execution
  ids — validated to exist; unknown ids are **rejected** (`UNKNOWN_*`) and never applied.
- **Ordinal citations:** "the second citation" resolves to the Nth id from the
  previous turn's ordered citation list; out-of-range is rejected.
- **Pronoun follow-ups:** "it", "that investigation", "the evidence", "that
  analysis" carry forward the prior active entities.
- **Derivation:** investigation/evidence/planner/validated capabilities derive the
  latest investigation for the active satellite when none is given.
- **Stale rejection:** a carried-forward planner execution that no longer exists is
  dropped before a Critic review.

Cross-user isolation is enforced at the conversation layer (`requireOwnedConversation`
→ 404, no existence leak).

## Bounded conversation memory (`memoryService.ts`)

Short-term only — Phase 10 does **not** implement long-term semantic memory.

- **Retained window:** the most recent `ORION_ASSISTANT_MAX_RETAINED_MESSAGES`
  messages feed reasoning context.
- **Summarization:** when the message count exceeds the window, a bounded summary
  of the older messages is (re)computed. Deterministic by default; an optional
  real-provider summary (strict `{summary}` schema) is adopted **only if it
  validates**, else the deterministic summary is kept.
- **Active state:** per-conversation active entities, ordered referenced citation
  ids, evidence ids, workflow execution ids, last capability, last execution mode
  (`assistant_conversation_state`).

Constraints: bounded summary size · no secrets · no hidden chain-of-thought · no raw
tool payloads · no raw provider responses · no fabricated ids · per-user isolation.
