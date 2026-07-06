// Environment helpers for the globe: WebGL capability detection + a
// cross-browser fullscreen hook. Kept out of the WebGL components so the small
// amount of testable logic (fullscreen element resolution) is isolated.
import { useCallback, useEffect, useState } from 'react';

/** True when the browser can create a WebGL context (false in jsdom). */
export function isWebGLAvailable(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };

/** Resolve the current fullscreen element across vendor prefixes. */
export function getFullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const d = document as FsDocument;
  return document.fullscreenElement ?? d.webkitFullscreenElement ?? null;
}

/** useFullscreen(ref) → [isFullscreen, toggle]. Fails safe on API errors. */
export function useFullscreen(ref: React.RefObject<HTMLElement>): [boolean, () => void] {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFs(getFullscreenElement() === ref.current && !!ref.current);
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, [ref]);

  const toggle = useCallback(() => {
    const el = ref.current as FsElement | null;
    if (!el) return;
    try {
      if (getFullscreenElement()) {
        const d = document as FsDocument;
        (document.exitFullscreen ?? d.webkitExitFullscreen)?.call(document);
      } else {
        (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
      }
    } catch {
      /* fullscreen API unavailable / blocked — ignore, stay windowed */
    }
  }, [ref]);

  return [isFs, toggle];
}
