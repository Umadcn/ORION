import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { orbitPathPoints } from './orbitMath';
import type { OrbitCategory, PlottedSatellite } from './orbitTypes';

// Orbit-line color is driven by orbit CATEGORY (not status) with a highlighted
// selected state — keeps the paths subtle and avoids implying status via lines.
const CATEGORY_COLOR: Record<OrbitCategory, string> = {
  LEO: '#38bdf8', MEO: '#818cf8', GEO: '#f472b6', HEO: '#c084fc', OTHER: '#64748b',
};

export function OrbitPath({ plotted, selected, segments = 96 }: { plotted: PlottedSatellite; selected: boolean; segments?: number }) {
  const points = useMemo(() => orbitPathPoints(plotted, segments), [plotted, segments]);
  const color = CATEGORY_COLOR[plotted.category];
  return (
    <Line
      points={points}
      color={selected ? '#e2e8f0' : color}
      lineWidth={selected ? 1.8 : 1}
      transparent
      opacity={selected ? 0.9 : 0.28}
      depthWrite={false}
    />
  );
}
