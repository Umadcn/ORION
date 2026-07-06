import { useRef } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { statusColorHex } from './orbitStatus';
import type { PlottedSatellite } from './orbitTypes';

export interface MarkerCallbacks {
  onHover: (id: string | null, clientX: number, clientY: number) => void;
  onSelect: (id: string) => void;
}

/**
 * Lightweight satellite marker: an unlit status-colored dot + a soft halo, with
 * hover/select scaling and an optional camera-facing label. Unlit material means
 * the effectiveStatus color reads accurately regardless of scene lighting.
 */
export function SatelliteMarker({
  plotted, selected, hovered, showLabel, onHover, onSelect,
}: {
  plotted: PlottedSatellite;
  selected: boolean;
  hovered: boolean;
  showLabel: boolean;
  onHover: MarkerCallbacks['onHover'];
  onSelect: MarkerCallbacks['onSelect'];
}) {
  const group = useRef<THREE.Group>(null);
  const color = statusColorHex(plotted.status);
  const active = selected || hovered;
  const base = 0.032;
  const scale = active ? 1.6 : 1;

  const over = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    document.body.style.cursor = 'pointer';
    onHover(plotted.id, e.clientX, e.clientY);
  };
  const move = (e: ThreeEvent<PointerEvent>) => { if (hovered) onHover(plotted.id, e.clientX, e.clientY); };
  const out = () => { document.body.style.cursor = 'auto'; onHover(null, 0, 0); };
  const click = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(plotted.id); };

  return (
    <group ref={group} position={plotted.position}>
      {/* Soft halo */}
      <mesh scale={scale * 2.4}>
        <sphereGeometry args={[base, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={active ? 0.28 : 0.16} depthWrite={false} />
      </mesh>
      {/* Core dot + interaction target */}
      <mesh scale={scale} onPointerOver={over} onPointerMove={move} onPointerOut={out} onClick={click}>
        <sphereGeometry args={[base, 16, 16]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      {selected && (
        <mesh scale={scale * 1.5}>
          <ringGeometry args={[base * 1.7, base * 2.0, 24]} />
          <meshBasicMaterial color="#e2e8f0" transparent opacity={0.9} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {showLabel && (
        <Html position={[0, base * 3.2, 0]} center distanceFactor={9} pointerEvents="none" zIndexRange={[20, 0]}>
          <div
            className={`pointer-events-none select-none whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              active ? 'bg-space-900/90 text-white' : 'bg-space-900/70 text-slate-300'
            }`}
            style={{ transform: 'translateY(-2px)' }}
          >
            {plotted.satellite.display_name || plotted.satellite.name || plotted.id}
          </div>
        </Html>
      )}
    </group>
  );
}
