/**
 * Live label length for the duration of a pointer gesture.
 *
 * Weasel doesn't commit a drag until the pointer comes up — it renders a
 * preview ghost and leaves the scene alone — so auto-length has nothing to
 * refit against mid-drag. This hook rides weasel's gesture layer instead,
 * refitting on each dispatcher pump, which gives the label something to
 * follow.
 *
 * It deliberately knows nothing about the scene: an id getter and the gesture
 * surface are the whole input, which keeps weasel's generics out of it and
 * makes it testable against a stub.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import { fitLengthToContent } from './autoLength';
import type { LabelPose } from './label';

/** The slice of weasel's `CanvasHelpers` this hook needs. */
export interface LiveGestureLookup {
  /** In-flight gesture pose for `id` if one is active on it, else committed. */
  getEffectiveBounds(id: string): { x: number; y: number; width: number; height: number } | null;
  /**
   * Union of what the in-flight gesture proposes — displaced poses plus any
   * nascent insert rect — or null when nothing is in flight. Select-only
   * gestures (marquee, lasso) report null: they have geometry but propose no
   * content, and the label must not grow because the user swept a selection.
   */
  getGestureBounds(): { x: number; y: number; width: number; height: number } | null;
  /** Fires once per dispatcher pump: start, each move, end, cancel. */
  subscribeGestures(fn: () => void): () => void;
  /** Monotonic counter bumped on exactly those events. */
  getGestureVersion(): number;
}

export interface UseLiveLengthArgs {
  /** Off entirely when auto-length is off — the length is the user's then. */
  enabled: boolean;
  /**
   * Whether the canvas owning the gesture source has mounted. `SceneCanvas`
   * renders only once its container has been measured and writes `helpersRef`
   * during that render, so subscribing any earlier would bind to nothing and,
   * with no signal to retry on, never fire again.
   */
  ready: boolean;
  getNodeIds: () => string[];
  helpersRef: RefObject<LiveGestureLookup | null>;
}

const noOpUnsubscribe = () => {};

/** The length to draw, or `null` when no gesture is in flight. */
export function useLiveLength({
  enabled,
  ready,
  getNodeIds,
  helpersRef,
}: UseLiveLengthArgs): number | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!enabled || !ready) return noOpUnsubscribe;
      return helpersRef.current?.subscribeGestures(onChange) ?? noOpUnsubscribe;
    },
    [enabled, ready, helpersRef],
  );

  const version = useSyncExternalStore(
    subscribe,
    () => helpersRef.current?.getGestureVersion() ?? 0,
  );

  return useMemo(() => {
    if (!enabled) return null;
    const helpers = helpersRef.current;
    if (!helpers) return null;

    const gesture = helpers.getGestureBounds();
    // Nothing in flight (or a select-only sweep): the committed length governs.
    if (!gesture) return null;

    // Still a per-node union, despite `getGestureBounds` landing: that call
    // reports only what the gesture proposes, while the fit needs every
    // object. Unioning it with the committed scene would pin the label to the
    // dragged node's *old* pose, so a leftward drag could never shrink it.
    // `getEffectiveBounds` is what displaces rather than adds — proposed pose
    // for nodes under the gesture, committed pose for the rest.
    const poses: LabelPose[] = [];
    for (const id of getNodeIds()) {
      const b = helpers.getEffectiveBounds(id);
      if (b) poses.push({ x: b.x, y: b.y, width: b.width, height: b.height });
    }
    // A create-drag's rect lives in the dispatcher's overlay and has no node
    // id, so the loop above can't see it; this is the only way it counts.
    poses.push({ x: gesture.x, y: gesture.y, width: gesture.width, height: gesture.height });

    // Same fit as the committed path, over the gesture's proposed poses.
    return fitLengthToContent(poses);
    // `version` is the dependency that matters: it changes on exactly the
    // events that move the bounds this reads through live refs.
  }, [version, enabled, getNodeIds, helpersRef]);
}
