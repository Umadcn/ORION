import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Earth } from './orbit3d/Earth';

// Sun mostly to the right and slightly behind the camera so the Earth face we
// see is largely night (city lights) with a bright day/atmosphere terminator on
// the right limb — matching the login reference composition.
const LOGIN_SUN: [number, number, number] = [2.4, 0.5, -0.7];

function SpinningEarth() {
  const ref = useRef<THREE.Group>(null);
  // Very slow, professional drift. Rotation only — position/scale set by parent.
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.025; });
  // Initial rotation brings the Americas roughly toward the viewer.
  return (
    <group ref={ref} rotation={[0.32, 2.15, 0.12]}>
      <Earth sunDirection={LOGIN_SUN} />
    </group>
  );
}

/**
 * Realistic WebGL Earth for the login hero — reuses the shared Earth shader
 * (NASA day/night textures, city lights, atmosphere) but non-interactive and
 * cropped into the bottom-left. Transparent canvas so the space background shows
 * through. Offline (local textures), no controls, no mission data.
 */
export default function LoginEarth() {
  return (
    <Canvas
      camera={{ position: [0, 0, 6], fov: 40 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      style={{ pointerEvents: 'none' }}
    >
      <ambientLight intensity={0.45} />
      <directionalLight position={[6, 2, 4]} intensity={1.0} />
      <Suspense fallback={null}>
        {/* Positioned lower-left and scaled so the globe enters from the
            bottom-left corner and crops off-frame, like the reference. */}
        <group position={[-1.9, -2.0, 0]} scale={3.1}>
          <SpinningEarth />
        </group>
      </Suspense>
    </Canvas>
  );
}
