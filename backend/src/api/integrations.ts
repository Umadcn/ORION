import { Router } from 'express';
import { asyncHandler } from './errors.js';
import { config } from '../config.js';
import { getSpaceWeather } from '../integrations/noaaSwpc.js';
import { getAllOrbits } from '../integrations/celestrak.js';

const router = Router();

// GET /api/integrations/status — provenance + mode of each adapter.
router.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const sw = await getSpaceWeather();
    const orbits = await getAllOrbits();
    res.json({
      integration_mode: config.integrationMode,
      live_mode_enabled: config.integrationMode === 'LIVE_API',
      adapters: [
        {
          name: 'NOAA SWPC',
          purpose: 'Space-weather context',
          source_url: sw.provenance.source_url,
          mode: sw.provenance.mode,
          cached: sw.provenance.cached,
          fallback_used: sw.provenance.fallback_used,
          sample: { kp_index: sw.kp_index, geomagnetic_condition: sw.geomagnetic_condition },
        },
        {
          name: 'CelesTrak',
          purpose: 'Orbital / TLE context',
          source_url: 'https://celestrak.org/NORAD/elements/',
          mode: config.integrationMode,
          cached: orbits[0]?.provenance.cached ?? false,
          fallback_used: orbits[0]?.provenance.fallback_used ?? false,
          sample: { objects: orbits.length },
        },
        {
          name: 'OpenAlex',
          purpose: 'Scientific references for reports',
          source_url: 'https://api.openalex.org/works',
          mode: config.integrationMode,
          cached: false,
          fallback_used: false,
          sample: { note: 'Used during report generation' },
        },
      ],
    });
  }),
);

export default router;
