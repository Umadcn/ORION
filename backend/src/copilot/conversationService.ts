/**
 * Conversation access layer (Phase 5). Enforces per-user ownership: a user can
 * only see/modify their own conversations. Cross-user access returns NotFound
 * (existence is never leaked). Read-only with respect to mission state.
 */
import { NotFoundError } from '../services/investigationService.js';
import * as repo from './conversationRepository.js';
import type { ConversationRow } from './types.js';

/** Resolve a conversation the user owns, or throw NotFoundError (404). */
export function requireOwnedConversation(id: string, userId: string): ConversationRow {
  const conv = repo.getConversation(id);
  if (!conv || conv.user_id !== userId) throw new NotFoundError(`Conversation ${id} not found`);
  return conv;
}

export function createConversation(userId: string, role: string, title?: string): ConversationRow {
  return repo.createConversation(userId, role, title && title.trim() ? title.trim() : 'New conversation');
}

export function listConversations(userId: string): ConversationRow[] {
  return repo.listConversations(userId);
}

export function getConversationWithMessages(id: string, userId: string) {
  const conversation = requireOwnedConversation(id, userId);
  return { conversation, messages: repo.getMessages(id) };
}

export function archiveConversation(id: string, userId: string): void {
  requireOwnedConversation(id, userId);
  repo.archiveConversation(id);
}
