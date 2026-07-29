/**
 * Live label length for the duration of a pointer gesture.
 *
 * Weasel doesn't commit a drag until the pointer comes up — it renders a
 * preview ghost and leaves the scene alone — so auto-length has nothing to
 * refit against mid-drag. This hook polls weasel's overlay-aware bounds
 * lookup each frame instead, giving the label something to follow.
 *
 * It deliberately knows nothing about the scene: an id getter and a bounds
 * lookup are the whole input, which keeps weasel's generics out of it and
 * makes it testable against a stub.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { fitLengthToContent } from './autoLength';
import type { LabelPose } from './label';

/** The slice of weasel's `CanvasHelpers` this hook needs. */
export interface LiveBoundsLookup {
  /** In-flight gesture pose for `id` if one is active on it, else committed. */
  getEffectiveBounds(id: string): { x: number; y: number; width: number; height: number } | null;
}

export interface UseLiveLengthArgs {
  /** Off entirely when auto-length is off — the length is the user's then. */
  enabled: boolean;
  getNodeIds: () => string[];
  helpersRef: RefObject<LiveBoundsLookup | null>;
}

export interface UseLiveLengthResult {
  /** The length to draw, or `null` when no gesture is in flight. */
  length: number | null;
  /** Wire to the canvas container's `onPointerDown`. */
  handlePointerDown: () => void;
}

export function useLiveLength({
  enabled,
  getNodeIds,
  helpersRef,
}: UseLiveLengthArgs): UseLiveLengthResult {
  const [length, setLength] = useState<number | null>(null);
  const rafRef = useRef(0);
  const activeRef = useRef(false);

  // Latest-value ref: the rAF loop is installed once per gesture and must not
  // capture a stale render's closure.
  const getNodeIdsRef = useRef(getNodeIds);
  getNodeIdsRef.current = getNodeIds;

  const stop = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setLength(null);
  }, []);

  const handlePointerDown = useCallback(() => {
    if (!enabled || activeRef.current) return;
    activeRef.current = true;

    const tick = () => {
      const helpers = helpersRef.current;
      if (helpers) {
        const poses: LabelPose[] = [];
        for (const id of getNodeIdsRef.current()) {
          const b = helpers.getEffectiveBounds(id);
          if (b) poses.push({ x: b.x, y: b.y, width: b.width, height: b.height });
        }
        // Same fit as the committed path, over the gesture's proposed poses.
        setLength(fitLengthToContent(poses));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [enabled, helpersRef]);

  // Listened for on `window`, not the canvas: a drag that releases over the
  // sidebar (or off the window entirely) still has to end the gesture.
  useEffect(() => {
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    return () => {
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      cancelAnimationFrame(rafRef.current);
    };
  }, [stop]);

  return { length, handlePointerDown };
}
