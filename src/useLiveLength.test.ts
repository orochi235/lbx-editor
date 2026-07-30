// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveLength } from './useLiveLength';
import { LENGTH_MARGIN_PT } from './autoLength';
import type { LiveGestureLookup } from './useLiveLength';

interface Box {
  x: number;
  width: number;
}

const box = (b: Box) => ({ x: b.x, y: 0, width: b.width, height: 10 });

/**
 * A stand-in for weasel's `CanvasHelpers` gesture surface: a bounds lookup
 * plus the subscribe/version pair, driven by hand so each dispatcher pump is
 * an explicit step.
 */
function stubHelpers(boxes: Record<string, Box>) {
  const listeners = new Set<() => void>();
  let version = 0;
  let gesture: Box | null = null;

  const lookup: LiveGestureLookup = {
    getEffectiveBounds: (id) => (boxes[id] ? box(boxes[id]) : null),
    getGestureBounds: () => (gesture ? box(gesture) : null),
    subscribeGestures: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getGestureVersion: () => version,
  };

  return {
    ref: { current: lookup as LiveGestureLookup | null },
    /** One dispatcher pump: sets what the gesture proposes, then notifies. */
    pump(next: Box | null) {
      gesture = next;
      version += 1;
      for (const fn of [...listeners]) fn();
    },
    get subscribed() {
      return listeners.size > 0;
    },
  };
}

describe('useLiveLength', () => {
  it('reports no length until a gesture is in flight', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, ready: true, getNodeIds: () => ['a'], helpersRef: helpers.ref }),
    );
    expect(result.current).toBeNull();
    expect(helpers.subscribed).toBe(true);
  });

  it('follows the gesture as it moves, growing and shrinking in lockstep', () => {
    const boxes = { a: { x: 10, width: 30 } };
    const helpers = stubHelpers(boxes);
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, ready: true, getNodeIds: () => ['a'], helpersRef: helpers.ref }),
    );

    boxes.a.x = 10;
    act(() => helpers.pump({ x: 10, width: 30 }));
    expect(result.current).toBe(40 + LENGTH_MARGIN_PT);

    // The drag moves the object right; the next pump follows it.
    boxes.a.x = 60;
    act(() => helpers.pump({ x: 60, width: 30 }));
    expect(result.current).toBe(90 + LENGTH_MARGIN_PT);

    // ...and back left again: the label shrinks, because the dragged node's
    // effective bounds displace rather than add to its committed pose.
    boxes.a.x = 10;
    act(() => helpers.pump({ x: 10, width: 30 }));
    expect(result.current).toBe(40 + LENGTH_MARGIN_PT);
  });

  it('follows a create-drag, which has no node id to look up', () => {
    // A nascent insert lives in the dispatcher's overlay, not the scene, so
    // `getEffectiveBounds` can't see it. `getGestureBounds` folds it in.
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, ready: true, getNodeIds: () => ['a'], helpersRef: helpers.ref }),
    );

    act(() => helpers.pump({ x: 100, width: 45 }));
    expect(result.current).toBe(145 + LENGTH_MARGIN_PT);
  });

  it('keeps committed content in the fit while another node is dragged', () => {
    const boxes = { a: { x: 10, width: 30 }, b: { x: 200, width: 10 } };
    const helpers = stubHelpers(boxes);
    const { result } = renderHook(() =>
      useLiveLength({
        enabled: true,
        ready: true,
        getNodeIds: () => ['a', 'b'],
        helpersRef: helpers.ref,
      }),
    );

    // `a` is under the gesture; stationary `b` still governs the length.
    boxes.a.x = 50;
    act(() => helpers.pump({ x: 50, width: 30 }));
    expect(result.current).toBe(210 + LENGTH_MARGIN_PT);
  });

  it('does not grow the head for content dragged past the origin', () => {
    // The label origin is pinned at x=0: a leftward overshoot just hangs off
    // the tape, as it does on the committed path.
    const boxes = { a: { x: 10, width: 30 }, b: { x: 200, width: 10 } };
    const helpers = stubHelpers(boxes);
    const { result } = renderHook(() =>
      useLiveLength({
        enabled: true,
        ready: true,
        getNodeIds: () => ['a', 'b'],
        helpersRef: helpers.ref,
      }),
    );

    act(() => helpers.pump({ x: 10, width: 30 }));
    const before = result.current;
    boxes.a.x = -50;
    act(() => helpers.pump({ x: -50, width: 30 }));
    expect(result.current).toBe(before);
  });

  it('clears the length when the gesture ends', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, ready: true, getNodeIds: () => ['a'], helpersRef: helpers.ref }),
    );

    act(() => helpers.pump({ x: 10, width: 30 }));
    expect(result.current).not.toBeNull();

    // End and cancel both pump with nothing in flight.
    act(() => helpers.pump(null));
    expect(result.current).toBeNull();
  });

  it('ignores a gesture that proposes no content', () => {
    // A marquee or lasso has geometry but proposes no poses, so weasel reports
    // no gesture bounds for it and the label must not react to the sweep.
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, ready: true, getNodeIds: () => ['a'], helpersRef: helpers.ref }),
    );

    act(() => helpers.pump(null));
    expect(result.current).toBeNull();
  });

  it('does nothing at all when disabled', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({
        enabled: false,
        ready: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers.ref,
      }),
    );

    expect(helpers.subscribed).toBe(false);
    act(() => helpers.pump({ x: 10, width: 30 }));
    expect(result.current).toBeNull();
  });

  it('subscribes once the canvas that owns the gesture source has mounted', () => {
    // `SceneCanvas` only renders after the container has been measured, and it
    // writes `helpersRef` during its own render — so a subscription attempted
    // before that would bind to nothing and never fire again.
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const ref: { current: LiveGestureLookup | null } = { current: null };
    const { result, rerender } = renderHook(
      ({ ready }: { ready: boolean }) =>
        useLiveLength({ enabled: true, ready, getNodeIds: () => ['a'], helpersRef: ref }),
      { initialProps: { ready: false } },
    );

    expect(helpers.subscribed).toBe(false);

    ref.current = helpers.ref.current;
    rerender({ ready: true });
    expect(helpers.subscribed).toBe(true);

    act(() => helpers.pump({ x: 10, width: 30 }));
    expect(result.current).toBe(40 + LENGTH_MARGIN_PT);
  });
});
