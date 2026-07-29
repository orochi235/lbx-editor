// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveExtent } from './useLiveExtent';
import { LENGTH_MARGIN_PT } from './autoLength';
import type { LiveBoundsLookup } from './useLiveExtent';

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

describe('useLiveExtent', () => {
  let raf: ReturnType<typeof stubRaf>;

  beforeEach(() => {
    raf = stubRaf();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports no extent before a gesture starts', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveExtent({
        enabled: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd: () => {},
      }),
    );
    expect(result.current.extent).toBeNull();
    expect(raf.scheduled).toBe(false);
  });

  it('tracks the effective bounds each frame while the pointer is down', () => {
    const boxes = { a: { x: 10, width: 30 } };
    const helpers = stubHelpers(boxes);
    const { result } = renderHook(() =>
      useLiveExtent({
        enabled: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd: () => {},
      }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    expect(result.current.extent).toEqual({ originX: 0, length: 40 + LENGTH_MARGIN_PT });

    // The drag moves the object right; the next frame follows it.
    boxes.a.x = 60;
    act(() => raf.frame());
    expect(result.current.extent).toEqual({ originX: 0, length: 90 + LENGTH_MARGIN_PT });

    // ...and back left again: the label shrinks in lockstep.
    boxes.a.x = 10;
    act(() => raf.frame());
    expect(result.current.extent).toEqual({ originX: 0, length: 40 + LENGTH_MARGIN_PT });
  });

  it('grows the head when the drag crosses the origin', () => {
    const boxes = { a: { x: 10, width: 30 } };
    const helpers = stubHelpers(boxes);
    const { result } = renderHook(() =>
      useLiveExtent({
        enabled: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd: () => {},
      }),
    );

    act(() => result.current.handlePointerDown());
    boxes.a.x = -15;
    act(() => raf.frame());
    expect(result.current.extent?.originX).toBe(-15 - LENGTH_MARGIN_PT);
  });

  it('clears the extent and fires onGestureEnd when the pointer comes up', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const onGestureEnd = vi.fn();
    const { result } = renderHook(() =>
      useLiveExtent({
        enabled: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd,
      }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    expect(result.current.extent).not.toBeNull();

    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(result.current.extent).toBeNull();
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(raf.scheduled).toBe(false);
  });

  it('ends the gesture on pointercancel too', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const onGestureEnd = vi.fn();
    const { result } = renderHook(() =>
      useLiveExtent({
        enabled: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd,
      }),
    );

    act(() => result.current.handlePointerDown());
    act(() => {
      window.dispatchEvent(new Event('pointercancel'));
    });
    expect(result.current.extent).toBeNull();
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  it('does not fire onGestureEnd for a pointerup with no gesture in flight', () => {
    // Clicks that never started a gesture must not trigger a rebase pass.
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const onGestureEnd = vi.fn();
    renderHook(() =>
      useLiveExtent({
        enabled: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd,
      }),
    );

    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(onGestureEnd).not.toHaveBeenCalled();
  });

  it('does nothing at all when disabled', () => {
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const onGestureEnd = vi.fn();
    const { result } = renderHook(() =>
      useLiveExtent({
        enabled: false,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd,
      }),
    );

    act(() => result.current.handlePointerDown());
    expect(raf.scheduled).toBe(false);
    expect(result.current.extent).toBeNull();

    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    expect(onGestureEnd).not.toHaveBeenCalled();
  });

  it('keeps the same extent object when nothing moved', () => {
    // Identity stability matters: a fresh object every frame would re-render
    // App (and refit the view) 60 times a second on a stationary pointer.
    const helpers = stubHelpers({ a: { x: 10, width: 30 } });
    const { result } = renderHook(() =>
      useLiveExtent({
        enabled: true,
        getNodeIds: () => ['a'],
        helpersRef: helpers,
        onGestureEnd: () => {},
      }),
    );

    act(() => result.current.handlePointerDown());
    act(() => raf.frame());
    const first = result.current.extent;
    act(() => raf.frame());
    expect(result.current.extent).toBe(first);
  });
});
