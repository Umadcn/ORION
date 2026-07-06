/**
 * Async handler wrapper + centralized error handler.
 * Maps known domain errors to appropriate HTTP status codes and never leaks
 * stack traces to the client.
 */
import type { NextFunction, Request, Response } from 'express';
import { InvalidTransitionError, NotFoundError } from '../services/investigationService.js';
import { ReportError } from '../services/reportService.js';
import { IngestionValidationError } from '../knowledge/ingestionService.js';
import { RetrievalValidationError, RetrievalSpaceMismatchError } from '../knowledge/retrievalService.js';
import { CopilotValidationError } from '../copilot/copilotService.js';
import { SatelliteValidationError, SatelliteConflictError, SatelliteNotFoundError } from '../services/satelliteService.js';
import { SimulationValidationError, SimulationConflictError, SimulationNotFoundError } from '../services/simulationService.js';

type Handler = (req: Request, res: Response, next: NextFunction) => unknown | Promise<unknown>;

export function asyncHandler(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof NotFoundError || err instanceof SatelliteNotFoundError || err instanceof SimulationNotFoundError) {
    res.status(404).json({ error: 'NOT_FOUND', message: err.message });
    return;
  }
  if (err instanceof SatelliteValidationError || err instanceof SimulationValidationError) {
    res.status(400).json({ error: 'BAD_REQUEST', message: err.message, details: err.details ?? {} });
    return;
  }
  if (err instanceof SatelliteConflictError || err instanceof SimulationConflictError) {
    res.status(409).json({ error: 'CONFLICT', message: err.message });
    return;
  }
  if (err instanceof InvalidTransitionError) {
    res.status(409).json({ error: 'INVALID_TRANSITION', message: err.message });
    return;
  }
  if (err instanceof ReportError) {
    res.status(422).json({ error: 'REPORT_ERROR', message: err.message });
    return;
  }
  if (err instanceof IngestionValidationError || err instanceof RetrievalValidationError || err instanceof CopilotValidationError) {
    res.status(400).json({ error: 'BAD_REQUEST', message: err.message });
    return;
  }
  if (err instanceof RetrievalSpaceMismatchError) {
    res.status(409).json({ error: 'EMBEDDING_SPACE_MISMATCH', message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  // eslint-disable-next-line no-console
  console.error('[ORION] Unhandled error:', message);
  res.status(500).json({ error: 'INTERNAL_ERROR', message });
}
