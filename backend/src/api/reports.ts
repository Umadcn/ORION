import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { getReport, listReportSummaries } from '../services/reportService.js';

const router = Router();

// GET /api/reports — audit-ready index: report metadata enriched with the
// parent investigation's satellite, root cause, confidence, severity, status.
router.get('/', (_req, res) => {
  res.json(listReportSummaries());
});

// GET /api/reports/:id — full report with parsed content.
router.get(
  '/:id',
  asyncHandler((req, res) => {
    const report = getReport(Number(req.params.id));
    if (!report) return res.status(404).json({ error: 'NOT_FOUND', message: 'Report not found' });
    return res.json({ ...report, content: JSON.parse(report.content) });
  }),
);

export default router;
