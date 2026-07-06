# Copilot Conversation Memory (Phase 5)

**Short-term conversation memory only.** No long-term or semantic memory in
Phase 5.

## What is stored

- `copilot_conversations`: id (UUID), user_id, role, title, status
  (ACTIVE/ARCHIVED), created_at, updated_at, archived_at.
- `copilot_messages`: conversation_id, role (`user`/`assistant`), **sanitized
  content only**, execution_mode (assistant), correlation_id, created_at.

## What is NOT stored

No secrets, credentials, or Authorization headers; no raw prompts; no hidden
chain-of-thought; no raw embedding vectors; no unrestricted tool outputs. Tool
outputs live only as bounded, redacted summaries in the tool audit — never in
conversation memory.

## Retention + bounds

- Reasoning context uses the most recent `ORION_COPILOT_MAX_RETAINED_MESSAGES`
  (default 20) messages, oldest→newest.
- Message content is bounded (`ORION_COPILOT_MAX_MESSAGE_CHARS`, assistant answer
  truncated to the context bound).
- Conversation listing and message listing are bounded.

## Ownership + isolation

Every conversation belongs to exactly one `user_id`. `requireOwnedConversation`
returns **NotFound (404)** when a conversation does not exist *or* is not owned by
the caller — existence is never leaked across users. All conversation and message
operations (list, get, send, archive) enforce ownership.

## Lifecycle

Create → send messages (each turn appends a user message + an assistant message)
→ archive (own only). Archived conversations are hidden from the active list.
The Copilot never mutates mission state as part of memory operations.

## Correlation

Each turn has a `correlation_id` linking the user message, assistant message,
`copilot_executions` audit row, `copilot_tool_executions` rows, and any
`retrieval_executions` / `llm_executions` produced during the turn.
