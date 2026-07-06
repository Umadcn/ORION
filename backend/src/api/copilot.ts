/**
 * Mission Copilot API (Phase 5). Authenticated; conversations are per-user.
 * READ-ONLY: the message endpoint accepts ONLY the user message (bounded) — no
 * provider/model/system-prompt/tool/retrieval-mode/URL/SQL/filesystem overrides.
 */
import { Router } from 'express';
import { asyncHandler } from './errors.js';
import type { AuthedRequest } from '../auth/middleware.js';
import { config, describeCopilotConfig } from '../config.js';
import { listTools } from '../copilot/toolRegistry.js';
import * as conv from '../copilot/conversationService.js';
import { copilotService, CopilotValidationError } from '../copilot/copilotService.js';
import type { Role } from '../auth/users.js';

const router = Router();

function user(req: AuthedRequest): { id: string; role: Role } {
  return { id: req.user!.sub, role: req.user!.role as Role };
}

// GET /api/copilot/status — non-secret config + tool catalog.
router.get('/status', (_req, res) => {
  res.json({ config: describeCopilotConfig(), tools: listTools().map((t) => ({ name: t.name, description: t.description, version: t.version })), read_only: true });
});

// POST /api/copilot/conversations — create a conversation.
router.post('/conversations', (req: AuthedRequest, res) => {
  const u = user(req);
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
  res.status(201).json(conv.createConversation(u.id, u.role, title));
});

// GET /api/copilot/conversations — list the caller's conversations.
router.get('/conversations', (req: AuthedRequest, res) => {
  res.json(conv.listConversations(user(req).id));
});

// GET /api/copilot/conversations/:id — a conversation + its messages (owner only).
router.get(
  '/conversations/:id',
  asyncHandler((req: AuthedRequest, res) => {
    res.json(conv.getConversationWithMessages(req.params.id, user(req).id));
  }),
);

// POST /api/copilot/conversations/:id/messages — ask the Copilot (read-only).
router.post(
  '/conversations/:id/messages',
  asyncHandler(async (req: AuthedRequest, res) => {
    const u = user(req);
    const message = req.body?.message;
    if (typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: 'message is required' });
    }
    if (message.length > config.copilot.maxMessageChars) {
      return res.status(400).json({ error: 'BAD_REQUEST', message: `message exceeds ${config.copilot.maxMessageChars} characters` });
    }
    const result = await copilotService.ask({ conversationId: req.params.id, userId: u.id, role: u.role, message });
    return res.json(result);
  }),
);

// POST /api/copilot/conversations/:id/archive — archive own conversation.
router.post(
  '/conversations/:id/archive',
  asyncHandler((req: AuthedRequest, res) => {
    conv.archiveConversation(req.params.id, user(req).id);
    res.json({ ok: true });
  }),
);

export default router;
