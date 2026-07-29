// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveLength } from './useLiveLength';
import { LENGTH_MARGIN_PT } from './autoLength';
import type { LiveBoundsLookup } from './useLiveLength';

/** Drives requestAnimationFrame by hand so each frame is an explicit step. */
function stubRaf() {
  let pending: FrameRequestCallback | null = null;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    pending = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    pending = null;
  });
  return {
    frame() {
      const cb = pending;
      pending = null;
      cb?.(0);
    },
    get scheduled() {
      return pending !== null;
    },
  };
}

/** A stand-in for weasel's CanvasHelpers, returning whatever we set. */
function stubHelpers(boxes: Record<string, { x: number; width: number }>) {
  const lookup: LiveBoundsLookup = {
    getEffectiveBounds: (id) => {
      const b = boxes[id];
      return b ? { x: b.x, y: 0, width: b.width, height: 10 } : null;
    },
  };
  return { current: lookup };
}

describe('useLiveLength', () => {
  let raf: ReturnType<typeof stubRaf>;

  beforeEach(() => {
    raf = stubRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports no length before a gesture starts', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, getNodeIds: () => ['a'], helpersRef: helpers }),
    );
    expect(result.current.length).toBeNull();
    expect(raf.scheduled).toBe(false);
  });

  it('tracks the effective bounds each frame while the pointer is down', () => {
    const boxes = { a: { x: 10, width: 30 } };
    const helpers = stubHelpers(boxes);
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, getNodeIds: () => ['a'], helpersRef: helpers }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    expect(result.current.length).toBe(40 + LENGTH_MARGIN_PT);

    // The drag moves the object right; the next frame follows it.
    boxes.a.x = 60;
    act(() => raf.frame());
    expect(result.current.length).toBe(90 + LENGTH_MARGIN_PT);

    // ...and back left again: the label shrinks in lockstep.
    boxes.a.x = 10;
    act(() => raf.frame());
    expect(result.current.length).toBe(40 + LENGTH_MARGIN_PT);
  });

  it('does not grow the head for content dragged past the origin', () => {
    // The label origin is pinned at x=0: a leftward overshoot just hangs off
    // the tape, as it does on the committed path.
    const boxes = { a: { x: 10, width: 30 }, b: { x: 200, width: 10 } };
    const helpers = stubHelpers(boxes);
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, getNodeIds: () => ['a', 'b'], helpersRef: helpers }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    const before = result.current.length;
    boxes.a.x = -50;
    act(() => raf.frame());
    expect(result.current.length).toBe(before);
  });

  it('clears the length when the pointer comes up', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, getNodeIds: () => ['a'], helpersRef: helpers }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    expect(result.current.length).not.toBeNull();

    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(result.current.length).toBeNull();
    expect(raf.scheduled).toBe(false);
  });

  it('ends the gesture on pointercancel too', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, getNodeIds: () => ['a'], helpersRef: helpers }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    act(() => {
      window.dispatchEvent(new Event('pointercancel'));
    });
    expect(result.current.length).toBeNull();
  });

  it('does nothing at all when disabled', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: false, getNodeIds: () => ['a'], helpersRef: helpers }),
    );

    act(() => result.current.handlePointerDown());
    expect(raf.scheduled).toBe(false);
    expect(result.current.length).toBeNull();
  });

  it('keeps the same length value when nothing moved', () => {
    // A stationary pointer must not re-render App (and refit the view) on
    // every frame; React bails out when the state value is unchanged.
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveLength({ enabled: true, getNodeIds: () => ['a'], helpersRef: helpers }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    const first = result.current.length;
    act(() => raf.frame());
    expect(result.current.length).toBe(first);
  });
});
