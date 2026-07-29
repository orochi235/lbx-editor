/**
 * Live label extent for the duration of a pointer gesture.
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
import { fitExtentToContent } from './autoLength';
import type { LabelExtent } from './autoLength';
import type { LabelPose } from './label';

/** The slice of weasel's `CanvasHelpers` this hook needs. */
export interface LiveBoundsLookup {
  /** In-flight gesture pose for `id` if one is active on it, else committed. */
  getEffectiveBounds(id: string): { x: number; y: number; width: number; height: number } | null;
}

export interface UseLiveExtentArgs {
  /** Off entirely when auto-length is off — the length is the user's then. */
  enabled: boolean;
  getNodeIds: () => string[];
  helpersRef: RefObject<LiveBoundsLookup | null>;
  /** Fires once when the pointer comes up, after the extent is cleared. */
  onGestureEnd: () => void;
}

export interface UseLiveExtentResult {
  /** The span to draw, or `null` when no gesture is in flight. */
  extent: LabelExtent | null;
  /** Wire to the canvas container's `onPointerDown`. */
  handlePointerDown: () => void;
}

export function useLiveExtent({
  enabled,
  getNodeIds,
  helpersRef,
  onGestureEnd,
}: UseLiveExtentArgs): UseLiveExtentResult {
  const [extent, setExtent] = useState<LabelExtent | null>(null);
  const rafRef = useRef(0);
  const activeRef = useRef(false);

  // Latest-value refs: the rAF loop and the window listeners are installed
  // once per gesture and must not capture a stale render's closures.
  const getNodeIdsRef = useRef(getNodeIds);
  getNodeIdsRef.current = getNodeIds;
  const onGestureEndRef = useRef(onGestureEnd);
  onGestureEndRef.current = onGestureEnd;

  const stop = useCallback(() => {
    // Guarded on `activeRef`: a click that never became a gesture must not
    // fire `onGestureEnd`, which is what triggers the rebase pass.
    if (!activeRef.current) return;
    activeRef.current = false;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setExtent(null);
    onGestureEndRef.current();
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
        const next = fitExtentToContent(poses);
        // Hold the old object when nothing moved, so a stationary pointer
        // doesn't re-render (and refit the view) on every frame.
        setExtent((prev) =>
          prev && prev.originX === next.originX && prev.length === next.length ? prev : next,
        );
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

  return { extent, handlePointerDown };
}
