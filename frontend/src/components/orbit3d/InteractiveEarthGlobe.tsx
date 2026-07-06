import { Suspense, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars, useProgress } from '@react-three/drei';
import { Loader2, Orbit } from 'lucide-react';
import type { Satellite } from '../../types';
import { Earth } from './Earth';
import { OrbitPath } from './OrbitPath';
import { SatelliteMarker } from './SatelliteMarker';
import { SatelliteTooltip } from './SatelliteTooltip';
import { SatelliteDetailsPanel } from './SatelliteDetailsPanel';
import { GlobeControlsPanel } from './GlobeControlsPanel';
import { STATUS_LEGEND, type StatusFilter } from './orbitStatus';
import { selectPlotted, type OrbitFilter } from './orbitMath';
import { isWebGLAvailable, useFullscreen } from './globeEnv';

export interface InteractiveEarthGlobeProps {
  satellites: Satellite[];
  mode?: 'full' | 'compact';
  height?: number;
  className?: string;
}

/** DOM overlay spinner driven by drei's global loading store. */
function GlobeLoader() {
  const { active, progress } = useProgress();
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 text-slate-400">
      <Loader2 className="h-6 w-6 animate-spin text-accent-cyan" />
      <span className="text-xs">Rendering globe… {Math.round(progress)}%</span>
    </div>
  );
}

/**
 * Genuine WebGL interactive 3D Earth. One renderer, two modes: `full` (Orbit &
 * Trajectory page — filters, details, reset, auto-rotate, fullscreen) and
 * `compact` (Dashboard Live Orbit Map). Consumes real backend satellites; never
 * mutates mission state.
 */
export function InteractiveEarthGlobe({ satellites, mode = 'full', height = 480, className = '' }: InteractiveEarthGlobeProps) {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const [isFullscreen, toggleFullscreen] = useFullscreen(containerRef);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [orbitFilter, setOrbitFilter] = useState<OrbitFilter>('ALL');
  const [autoRotate, setAutoRotate] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);

  const webgl = useMemo(() => isWebGLAvailable(), []);
  const selection = useMemo(
    () => selectPlotted(satellites, statusFilter, orbitFilter),
    [satellites, statusFilter, orbitFilter],
  );

  const selected = selection.plotted.find((p) => p.id === selectedId) ?? null;
  const hovered = hover ? selection.plotted.find((p) => p.id === hover.id) ?? null : null;
  const labelBudget = mode === 'compact' ? 8 : 14;
  const showAllLabels = selection.plotted.length <= labelBudget;

  const onSelect = (id: string) => {
    if (mode === 'full') setSelectedId((cur) => (cur === id ? cur : id));
    else navigate(`/satellites/${id}`);
  };
  const onReset = () => { controlsRef.current?.reset(); setSelectedId(null); };

  const emptyMessage =
    selection.total === 0 ? 'No satellites available.'
      : selection.plotted.length === 0 && selection.hiddenByFilter > 0 ? 'No satellites match the current filters.'
      : selection.plotted.length === 0 ? 'No satellites with orbit data available.'
      : null;

  const wrapCls = `relative overflow-hidden rounded-lg bg-[#05080f] ${isFullscreen ? 'fixed inset-0 z-50' : ''} ${className}`;
  const style = isFullscreen ? undefined : { height };

  if (!webgl) {
    return (
      <div ref={containerRef} className={wrapCls} style={style}>
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-slate-400">
          <Orbit className="h-8 w-8 text-slate-600" />
          <div className="text-sm">3D visualization unavailable — WebGL is not supported in this browser.</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={wrapCls} style={style}>
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.4, 4.6], fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onPointerMissed={() => mode === 'full' && setSelectedId(null)}
      >
        <color attach="background" args={['#05080f']} />
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 3, 5]} intensity={0.9} />
        <Suspense fallback={null}>
          <Stars radius={50} depth={30} count={1400} factor={3.5} saturation={0} fade speed={0} />
          <Earth />
          {selection.plotted.map((p) => (
            <OrbitPath key={`o-${p.id}`} plotted={p} selected={p.id === selectedId} segments={mode === 'compact' ? 64 : 96} />
          ))}
          {selection.plotted.map((p) => (
            <SatelliteMarker
              key={`m-${p.id}`}
              plotted={p}
              selected={p.id === selectedId}
              hovered={hover?.id === p.id}
              showLabel={showAllLabels || p.id === selectedId || hover?.id === p.id}
              onHover={(id, x, y) => setHover(id ? { id, x, y } : null)}
              onSelect={onSelect}
            />
          ))}
        </Suspense>
        <OrbitControls
          ref={controlsRef}
          enablePan={false}
          enableRotate
          enableZoom
          autoRotate={autoRotate && !interacting}
          autoRotateSpeed={0.35}
          enableDamping
          dampingFactor={0.08}
          minDistance={1.6}
          maxDistance={9}
          onStart={() => setInteracting(true)}
          onEnd={() => setInteracting(false)}
        />
      </Canvas>

      <GlobeLoader />

      <GlobeControlsPanel
        mode={mode}
        statusFilter={statusFilter} setStatusFilter={setStatusFilter}
        orbitFilter={orbitFilter} setOrbitFilter={setOrbitFilter}
        autoRotate={autoRotate} setAutoRotate={setAutoRotate}
        onReset={onReset}
        isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
      />

      {/* Legend + counts */}
      <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1 text-[11px] text-slate-400">
        <div className="flex items-center gap-3 rounded-md bg-space-900/70 px-2 py-1 backdrop-blur">
          {STATUS_LEGEND.map((e) => (
            <span key={e.status} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: e.color }} /> {e.label}</span>
          ))}
        </div>
        <div className="rounded-md bg-space-900/70 px-2 py-0.5 backdrop-blur">
          {selection.plotted.length} of {selection.total} shown
          {selection.withoutOrbitData > 0 && ` · ${selection.withoutOrbitData} without orbit data`}
        </div>
      </div>

      {emptyMessage && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 text-center text-sm text-slate-400">
          {emptyMessage}
        </div>
      )}

      {hover && hovered && <SatelliteTooltip plotted={hovered} x={hover.x} y={hover.y} />}
      {mode === 'full' && selected && <SatelliteDetailsPanel plotted={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
