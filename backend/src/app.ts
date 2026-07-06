/**
 * Express app assembly. Kept separate from index.ts so tests can mount the app
 * (on an ephemeral port) without the production listen call.
 *
 * Auth model: /api/health and /api/auth are public. Everything else under /api
 * requires a valid JWT. Mission-decision and settings-write endpoints add
 * role-based authorization on top (see routers).
 */
import express from 'express';
import cors from 'cors';
import { config, SAFETY_STATEMENT } from './config.js';
import { initSchema } from './db.js';
import { initSimulation } from './services/simulationService.js';
import { seedUsers } from './auth/users.js';
import { seedKnowledgeIfEmpty } from './knowledge/seed.js';
import { authenticate } from './auth/middleware.js';

import authRouter from './api/auth.js';
import healthRouter from './api/health.js';
import dashboardRouter from './api/dashboard.js';
import satellitesRouter from './api/satellites.js';
import telemetryRouter from './api/telemetry.js';
import alertsRouter from './api/alerts.js';
import investigationsRouter from './api/investigations.js';
import simulationRouter from './api/simulation.js';
import agentsRouter from './api/agents.js';
import integrationsRouter from './api/integrations.js';
import reportsRouter from './api/reports.js';
import settingsRouter from './api/settings.js';
import llmRouter from './api/llm.js';
import knowledgeRouter from './api/knowledge.js';
import briefingRouter from './api/briefing.js';
import generationRouter from './api/generation.js';
import copilotRouter from './api/copilot.js';
import assistantRouter from './api/assistant.js';
import { plannerInvestigationRouter, plannerAuditRouter } from './api/planner.js';
import { criticReviewRouter, criticAuditRouter } from './api/critic.js';
import observabilityRouter from './api/observability.js';
import providersRouter from './api/providers.js';
import { errorHandler } from './api/errors.js';

/** Initialize schema + seed data + demo users. Safe to call repeatedly. */
export function initOrion(): void {
  initSchema();
  initSimulation();
  seedUsers();
  seedKnowledgeIfEmpty();
}

export function buildApp() {
  initOrion();

  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  // Basic security headers (no external dependency).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    next();
  });

  // Public routes.
  app.use('/api/health', healthRouter);
  app.use('/api/auth', authRouter);

  app.get('/', (_req, res) => {
    res.json({
      name: 'Project ORION API',
      version: '1.0.0',
      safety: SAFETY_STATEMENT,
      integration_mode: config.integrationMode,
      auth: 'JWT Bearer required for /api/* (except /api/health and /api/auth/login)',
    });
  });

  // Everything below requires authentication.
  app.use('/api', authenticate);

  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/satellites', satellitesRouter);
  app.use('/api/telemetry', telemetryRouter);
  app.use('/api/alerts', alertsRouter);
  app.use('/api/investigations', investigationsRouter);
  app.use('/api/investigations', briefingRouter); // read-only /:id/briefing (after investigations)
  app.use('/api/investigations', plannerInvestigationRouter); // read-only /:id/planner-analysis
  app.use('/api/simulation', simulationRouter);
  app.use('/api/agents', agentsRouter);
  app.use('/api/integrations', integrationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/llm', llmRouter);
  app.use('/api/knowledge', knowledgeRouter);
  app.use('/api/generation', generationRouter);
  app.use('/api/copilot', copilotRouter);
  app.use('/api/assistant', assistantRouter);
  // Critic review (any authenticated role) must be mounted BEFORE the Director/Admin
  // planner-audit router so it is not gated by that router's role guard.
  app.use('/api/planner', criticReviewRouter); // read-only /executions/:id/critic-review
  app.use('/api/planner', plannerAuditRouter);
  app.use('/api/critic', criticAuditRouter);
  app.use('/api/observability', observabilityRouter);
  app.use('/api/providers', providersRouter);

  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Route not found' }));
  app.use(errorHandler);

  return app;
}
