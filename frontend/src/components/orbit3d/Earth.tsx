import { useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { EARTH_RADIUS } from './orbitMath';

const DAY = '/assets/earth/earth_day_2048.jpg';
const NIGHT = '/assets/earth/earth_night_2048.png';
const SPEC = '/assets/earth/earth_specular_2048.jpg';

// Fixed "sun" direction — gives a stable day/night terminator without spinning
// the globe (markers are placed in world space and must stay over their
// continents, so the Earth mesh itself never rotates).
const SUN_DIR = new THREE.Vector3(1.0, 0.35, 0.7).normalize();

const surfaceVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const surfaceFragment = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D specMap;
  uniform vec3 sunDir;
  uniform vec3 atmoColor;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    vec3 L = normalize(sunDir);
    float ndl = dot(N, L);
    float dayAmt = smoothstep(-0.15, 0.30, ndl);
    vec3 day = texture2D(dayMap, vUv).rgb;
    vec3 night = texture2D(nightMap, vUv).rgb;
    vec3 base = mix(night * 1.2, day, dayAmt);
    float specMask = texture2D(specMap, vUv).r;
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 40.0) * specMask * dayAmt * 0.55;
    float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
    vec3 rim = atmoColor * fres * (0.35 + 0.65 * dayAmt);
    vec3 color = base + vec3(spec) + rim;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

const atmoFragment = /* glsl */ `
  uniform vec3 glowColor;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float intensity = pow(0.62 - dot(N, V), 4.0);
    gl_FragColor = vec4(glowColor, 1.0) * clamp(intensity, 0.0, 1.0);
  }
`;

/**
 * Realistic WebGL Earth: NASA Blue Marble day map, city-lights night map on the
 * dark side, ocean specular highlight, a fresnel surface rim, and an outer
 * additive atmosphere halo. The mesh does not rotate so world-space satellite
 * markers stay aligned with the geography.
 */
export function Earth({ sunDirection }: { sunDirection?: [number, number, number] } = {}) {
  const [dayMap, nightMap, specMap] = useTexture([DAY, NIGHT, SPEC]);
  const sun = useMemo(
    () => (sunDirection ? new THREE.Vector3(...sunDirection).normalize() : SUN_DIR),
    [sunDirection],
  );

  useMemo(() => {
    dayMap.colorSpace = THREE.SRGBColorSpace;
    nightMap.colorSpace = THREE.SRGBColorSpace;
    specMap.colorSpace = THREE.NoColorSpace;
    for (const t of [dayMap, nightMap, specMap]) t.anisotropy = 8;
  }, [dayMap, nightMap, specMap]);

  const surfaceMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: dayMap },
      nightMap: { value: nightMap },
      specMap: { value: specMap },
      sunDir: { value: sun },
      atmoColor: { value: new THREE.Color('#3b82f6') },
    },
    vertexShader: surfaceVertex,
    fragmentShader: surfaceFragment,
  }), [dayMap, nightMap, specMap, sun]);

  const atmoMat = useMemo(() => new THREE.ShaderMaterial({
    uniforms: { glowColor: { value: new THREE.Color('#4ea8ff') } },
    vertexShader: surfaceVertex,
    fragmentShader: atmoFragment,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }), []);

  return (
    <group>
      <mesh material={surfaceMat}>
        <sphereGeometry args={[EARTH_RADIUS, 96, 96]} />
      </mesh>
      <mesh material={atmoMat} scale={1.035}>
        <sphereGeometry args={[EARTH_RADIUS, 48, 48]} />
      </mesh>
    </group>
  );
}
