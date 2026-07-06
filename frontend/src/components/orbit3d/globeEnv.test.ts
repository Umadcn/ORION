import { describe, it, expect } from 'vitest';
import { isWebGLAvailable, getFullscreenElement } from './globeEnv';

describe('globeEnv helpers', () => {
  it('isWebGLAvailable returns false in jsdom (no GPU context) — drives the fallback UI', () => {
    // jsdom cannot create a WebGL context; the helper must fail closed to false
    // so the component renders its "WebGL unavailable" fallback rather than crashing.
    expect(isWebGLAvailable()).toBe(false);
  });

  it('getFullscreenElement returns null when nothing is fullscreen', () => {
    expect(getFullscreenElement()).toBeNull();
  });
});
