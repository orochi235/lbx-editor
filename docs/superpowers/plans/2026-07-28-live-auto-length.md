# Live Auto-Length Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** While auto-length is on, the label's extent tracks an in-flight drag continuously — growing past either edge and shrinking back — and commits whatever it was showing when the pointer came up.

**Architecture:** Two pure geometry functions in `src/autoLength.ts` express the head/tail rule. A hook in `src/useLiveExtent.ts` runs a rAF loop for the lifetime of a pointer gesture, unioning weasel's overlay-aware `getEffectiveBounds` over the scene's nodes into a live extent. App.tsx feeds that extent to the three things that draw (paper layer, printable clip path, view fit) and to nothing else — export, print, autosave, cut-mark pruning and diagnostics keep reading the committed `labelLength`. On pointer-up, a leftward overshoot is normalized by shifting every node and cut mark right.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, `@weasel-js/core` 0.6.

**Spec:** `docs/superpowers/specs/2026-07-28-live-auto-length-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/autoLength.ts` (modify) | Pure geometry. Gains `LabelExtent`, `fitExtentToContent`, `rebaseShift` beside the existing `fitLengthToContent`. No React, no weasel. |
| `src/autoLength.test.ts` (modify) | Unit tests for the two new functions, including the equivalence guard against `fitLengthToContent`. |
| `src/useLiveExtent.ts` (create) | Gesture bookkeeping: rAF loop, pointer-driven start/stop, per-frame union of effective bounds. Takes a node-id getter and a `helpersRef` — no `Scene` generics. |
| `src/useLiveExtent.test.ts` (create) | Tests the hook against a stub helpers object and fake rAF/pointer events. |
| `src/App.tsx` (modify) | Wiring only: `helpersRef` on `SceneCanvas`, the `displayOrigin`/`displayLength` pair into the three visual sites, and the rebase-on-commit. |

**Out of scope (follow-up):** create-drag (rect/line/text/barcode insert) keeps today's snap-at-drop. Covering it needs `CanvasHelpers.getGestureBounds()` added to weasel, which is a separate repo and a separate release. Everything in this plan is built against the existing `getEffectiveBounds`.

---

### Task 1: Live extent geometry

**Files:**
- Modify: `src/autoLength.ts`
- Test: `src/autoLength.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/autoLength.test.ts`. Also add `fitExtentToContent` and `rebaseShift` to the existing import block at the top of the file (lines 2-7).

```ts
describe('fitExtentToContent', () => {
  it('matches the committed fit when all content is non-negative', () => {
    // The drift guard: the live extent and the committed fit must agree on
    // every document that has been through a rebase (i.e. every saved one).
    const poses = [
      { x: 10, y: 0, width: 30, height: 5 },
      { x: 80, y: 0, width: 20, height: 5 },
    ];
    const extent = fitExtentToContent(poses);
    expect(extent.originX).toBe(0);
    expect(extent.length).toBe(fitLengthToContent(poses));
  });

  it('extends the head by a margin when content crosses zero', () => {
    // Content spans -20 → 40, so the label runs -25.6 → 45.6.
    const extent = fitExtentToContent([{ x: -20, y: 0, width: 60, height: 5 }]);
    expect(extent.originX).toBe(-20 - LENGTH_MARGIN_PT);
    expect(extent.length).toBeCloseTo(60 + LENGTH_MARGIN_PT * 2, 6);
  });

  it('takes the furthest edge on each side, not the last node', () => {
    const poses = [
      { x: 100, y: 0, width: 20, height: 5 },
      { x: -30, y: 0, width: 10, height: 5 },
      { x: 5, y: 0, width: 10, height: 5 },
    ];
    const extent = fitExtentToContent(poses);
    expect(extent.originX).toBe(-30 - LENGTH_MARGIN_PT);
    expect(extent.length).toBeCloseTo(150 + LENGTH_MARGIN_PT * 2, 6);
  });

  it('keeps the head at zero for content entirely right of the origin', () => {
    expect(fitExtentToContent([{ x: 50, y: 0, width: 10, height: 5 }]).originX).toBe(0);
  });

  it('handles content entirely left of the origin', () => {
    const extent = fitExtentToContent([{ x: -80, y: 0, width: 20, height: 5 }]);
    expect(extent.originX).toBe(-80 - LENGTH_MARGIN_PT);
    // Tail still stops at the origin — the label never ends left of x=0.
    expect(extent.length).toBeCloseTo(80 + LENGTH_MARGIN_PT * 2, 6);
  });

  it('falls back to the minimum for an empty scene', () => {
    expect(fitExtentToContent([])).toEqual({ originX: 0, length: MIN_LABEL_LENGTH_PT });
  });

  it('clamps the tail, not the head, at the 1000mm ceiling', () => {
    const extent = fitExtentToContent([{ x: -10, y: 0, width: 5000, height: 5 }]);
    expect(extent.originX).toBe(-10 - LENGTH_MARGIN_PT);
    expect(extent.length).toBe(MAX_LABEL_LENGTH_PT);
  });
});

describe('rebaseShift', () => {
  it('is zero for a label already at the origin', () => {
    expect(rebaseShift(0)).toBe(0);
  });

  it('shifts right by the overhang', () => {
    expect(rebaseShift(-25.6)).toBeCloseTo(25.6, 6);
  });

  it('lands the leftmost object exactly on the leading margin', () => {
    const poses = [{ x: -20, y: 0, width: 60, height: 5 }];
    const s = rebaseShift(fitExtentToContent(poses).originX);
    const shifted = poses.map((p) => ({ ...p, x: p.x + s }));
    expect(Math.min(...shifted.map((p) => p.x))).toBeCloseTo(LENGTH_MARGIN_PT, 6);
  });

  it('preserves the on-screen length across the rebase', () => {
    // What was displayed mid-drag must be what commits — otherwise the label
    // visibly jumps at the moment of release.
    const poses = [
      { x: -20, y: 0, width: 60, height: 5 },
      { x: 90, y: 0, width: 10, height: 5 },
    ];
    const live = fitExtentToContent(poses);
    const s = rebaseShift(live.originX);
    const shifted = poses.map((p) => ({ ...p, x: p.x + s }));
    expect(fitLengthToContent(shifted)).toBeCloseTo(live.length, 6);
    expect(fitExtentToContent(shifted).originX).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/autoLength.test.ts`
Expected: FAIL — `fitExtentToContent is not a function` / `rebaseShift is not a function` (and a TS error on the import).

- [ ] **Step 3: Write the implementation**

Append to `src/autoLength.ts`:

```ts
/** A label span in label points: where it starts, and how long it is. */
export interface LabelExtent {
  /** Left edge. `0` normally; negative while content hangs off the head. */
  originX: number;
  /** Distance from `originX` to the tail. */
  length: number;
}

/**
 * The label span that fits `poses`, allowing the head to extend for content at
 * negative x — what the label looks like mid-drag, before the rebase.
 *
 * The head extends only when content actually crosses zero, and never retracts
 * past it: a label whose leftmost object sits at x=50 keeps that 50pt leading
 * gap, exactly as the tail rule keeps content unreflowed.
 */
export function fitExtentToContent(poses: Iterable<LabelPose>): LabelExtent {
  let leftmost = 0;
  let rightmost = 0;
  for (const pose of poses) {
    if (pose.x < leftmost) leftmost = pose.x;
    const edge = pose.x + pose.width;
    if (edge > rightmost) rightmost = edge;
  }
  const originX = leftmost < 0 ? leftmost - LENGTH_MARGIN_PT : 0;
  const span = rightmost + LENGTH_MARGIN_PT - originX;
  return {
    originX,
    length: Math.min(MAX_LABEL_LENGTH_PT, Math.max(MIN_LABEL_LENGTH_PT, span)),
  };
}

/**
 * How far right to shift every object (and cut mark) so an extent whose head
 * hangs off the origin sits back at x=0 — .lbx has no way to say "negative x".
 *
 * It's just the overhang: shifting by −originX lands the leftmost object on
 * the leading margin and leaves the fitted length exactly where the drag left
 * it, so nothing moves relative to the label.
 */
export function rebaseShift(originX: number): number {
  return originX < 0 ? -originX : 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/autoLength.test.ts`
Expected: PASS — all tests, including the 8 pre-existing `fitLengthToContent` cases (they must be untouched; `fitLengthToContent` keeps its origin-0 semantics and its deliberate blindness to negative-x content).

- [ ] **Step 5: Commit**

```bash
git add src/autoLength.ts src/autoLength.test.ts
git commit -m "Add live label extent geometry"
```

---

### Task 2: The live-extent hook

**Files:**
- Create: `src/useLiveExtent.ts`
- Test: `src/useLiveExtent.test.ts`

The hook owns gesture bookkeeping so App.tsx doesn't grow another subsystem. It knows nothing about scenes or weasel generics: it's given a way to list node ids and a ref to weasel's overlay-aware bounds lookup.

- [ ] **Step 1: Write the failing test**

Create `src/useLiveExtent.test.ts`:

```ts
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
      window.dispatchEvent(new PointerEvent('pointerup'));
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
      window.dispatchEvent(new PointerEvent('pointercancel'));
    });
    expect(result.current.extent).toBeNull();
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
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
      window.dispatchEvent(new PointerEvent('pointerup'));
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
```

- [ ] **Step 2: Check the test dependency, then run to verify it fails**

`@testing-library/react` is needed for `renderHook`. Check first:

Run: `node -e "console.log(require('./package.json').devDependencies)"`

If `@testing-library/react` is absent, install it (it brings its own peer of `react-dom`, already present):

Run: `npm install -D @testing-library/react`

Then run: `npx vitest run src/useLiveExtent.test.ts`
Expected: FAIL — `Failed to resolve import "./useLiveExtent"`.

Note: `renderHook` needs a DOM. If vitest reports `document is not defined`, add `// @vitest-environment jsdom` as the first line of the test file and install jsdom with `npm install -D jsdom`.

- [ ] **Step 3: Write the implementation**

Create `src/useLiveExtent.ts`:

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/useLiveExtent.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/useLiveExtent.ts src/useLiveExtent.test.ts package.json package-lock.json
git commit -m "Add the live-extent gesture hook"
```

---

### Task 3: Expose weasel's overlay-aware bounds to App

**Files:**
- Modify: `src/App.tsx` (imports; the `helpersRef` declaration near the scene/canvas state; the `<SceneCanvas>` element at ~1320)

`helpersRef` is a `CanvasProps` field that `SceneCanvasProps` passes through (it is not in the `Omit` list at `index.d.ts:6171`). Weasel writes the helpers object into the ref on every render.

- [ ] **Step 1: Add the ref**

Add `CanvasHelpers` to the type imports from `@weasel-js/core` (the import block at the top of `App.tsx`, alongside `ToolsApi`):

```ts
  type CanvasHelpers,
```

Then declare the ref immediately after the `canvasContainerRef` declaration (`App.tsx:329`):

```ts
  // Weasel writes its overlay-aware pose/bounds lookups here each render.
  // `getEffectiveBounds` reports the in-flight gesture's proposed box for a
  // node under drag/resize/rotate, and the committed box otherwise — the one
  // reading that lets the label follow a drag weasel hasn't committed yet.
  const helpersRef = useRef<CanvasHelpers<LabelPose> | null>(null);
```

- [ ] **Step 2: Pass it to SceneCanvas**

In the `<SceneCanvas>` element, add the prop next to `layers` (`App.tsx:1338`):

```tsx
                    helpersRef={helpersRef}
                    layers={layers}
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

The hook (Task 2) declares its own narrow `LiveBoundsLookup` rather than
importing `CanvasHelpers`, and TypeScript's object property variance normally
accepts the wider ref where the narrower one is expected. If it complains that
`RefObject<CanvasHelpers<LabelPose> | null>` isn't assignable to
`RefObject<LiveBoundsLookup | null>`, cast at the single call site in Task 4:

```ts
    helpersRef: helpersRef as RefObject<LiveBoundsLookup | null>,
```

Don't widen the hook's parameter to `CanvasHelpers` to dodge this — keeping
weasel's generics out of the hook is what makes it testable with a stub.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "Wire weasel's canvas helpers ref into App"
```

---

### Task 4: Draw the live extent

**Files:**
- Modify: `src/App.tsx` (the display pair after `paperWidth`/`paperHeight` at ~322; the paper-size fit effect at 386-393; the paper layer memo at 690-750; `printablePath` at 1221-1224; the canvas container div at 1313-1318)

This is where the two lengths stay separated. `labelLength` and `paperWidth` keep feeding export, print, print preview, autosave, cut-mark pruning and diagnostics, untouched. Only the three things that *draw* read the display pair.

- [ ] **Step 1: Add the hook call and the display pair**

Add the import beside the other local imports:

```ts
import { fitLengthToContent, fitExtentToContent, rebaseShift } from './autoLength';
import { useLiveExtent } from './useLiveExtent';
```

(`fitLengthToContent` is already imported at `App.tsx:46` — extend that line rather than adding a second import.)

Insert after the `paperWidth` / `paperHeight` declarations (`App.tsx:322-323`):

```ts
  // While a drag is in flight the label follows the gesture instead of the
  // committed scene. This pair is for DRAWING ONLY — `labelLength` and
  // `paperWidth` above stay committed, so export, print, autosave, cut-mark
  // pruning and diagnostics never see a transient value. That separation is
  // load-bearing: a mid-drag shrink reaching the cut-mark pruning below would
  // destroy marks on a drag the user then abandoned.
  const getNodeIds = useCallback(() => [...scene.nodes.keys()].map(String), [scene]);
  const { extent: liveExtent, handlePointerDown: handleCanvasPointerDown } = useLiveExtent({
    enabled: autoLength,
    getNodeIds,
    helpersRef,
    onGestureEnd: handleGestureEnd,
  });
  const displayOrigin = liveExtent ? liveExtent.originX : 0;
  const displayLength = liveExtent ? liveExtent.length : paperWidth;
```

`handleGestureEnd` is defined in Task 5. Until then, use a placeholder so this task stands alone and the app runs:

```ts
  const handleGestureEnd = useCallback(() => {}, []);
```

Declare it just above the `useLiveExtent` call.

- [ ] **Step 2: Fit the view to the live extent**

Replace the paper-size fit effect (`App.tsx:386-393`) with:

```ts
  useEffect(() => {
    if (canvasSize.width === 0 || canvasSize.height === 0) return;
    if (prevPaperSize.current.w === displayLength
      && prevPaperSize.current.h === paperHeight
      && prevPaperSize.current.x === displayOrigin) return;
    prevPaperSize.current = { w: displayLength, h: paperHeight, x: displayOrigin };
    setView((v) =>
      fitViewToBounds(paperBounds(displayOrigin, displayLength, paperHeight), canvasSize, v, {
        padding: FIT_PADDING,
      }),
    );
  }, [displayOrigin, displayLength, paperHeight, canvasSize]);
```

Update the ref's initializer (`App.tsx:336`) to carry the origin:

```ts
  const prevPaperSize = useRef({ w: paperWidth, h: paperHeight, x: 0 });
```

- [ ] **Step 3: Teach `paperBounds` about the origin**

Replace `paperBounds` (`App.tsx:142-145`):

```ts
// The full drawn footprint of the tape: paper rect + brick shadow. `originX`
// is 0 for a committed label and negative while a drag has grown the head.
function paperBounds(originX: number, paperWidth: number, paperHeight: number) {
  const depth = paperShadowDepth(paperHeight);
  return { x: originX, y: 0, width: paperWidth + depth, height: paperHeight + depth };
}
```

There are exactly two call sites. One is the fit effect rewritten in Step 2. The
other is `handleZoomFit` (`App.tsx:412-416`) — give it the display pair, so a
Fit pressed mid-drag frames what's actually on screen:

```ts
  const handleZoomFit = useCallback(() => {
    setView((v) =>
      fitViewToBounds(paperBounds(displayOrigin, displayLength, paperHeight), canvasSize, v, {
        padding: FIT_PADDING,
      }),
    );
  }, [displayOrigin, displayLength, paperHeight, canvasSize]);
```

`centeredView` (`App.tsx:149-156`) does its own math and does **not** call
`paperBounds`. Leave it alone: it serves the toolbar Reset and Cmd-0, which
operate on committed state.

- [ ] **Step 4: Draw the paper at the live origin and length**

In the paper layer memo (`App.tsx:690-750`), replace the geometry constants and the tape rect:

```ts
    const x0 = displayOrigin - s;
    const y0 = -s;
    const x1 = displayOrigin + displayLength + s;
    const y1 = paperHeight + s;
```

```ts
        {
          kind: 'path',
          path: rectPath(displayOrigin, 0, displayLength, paperHeight),
          fill: { fill: 'solid', color: tapeCss, opacity: tapeClear ? 0.45 : 1 },
          stroke: { paint: { color: printsAsInk(tapeCss) ? '#888888' : '#000000' }, width: strokeW },
        },
```

Leave the print-preview image at `x: 0` with `w: paperWidth` — it's a render of committed state and stays pinned to committed geometry, going briefly stale during a gesture and refreshing on commit, exactly as it does today.

Cut guides need no change: they're absolute label coordinates and stay put while the label grows around them.

Update the memo's dependency array (`App.tsx:750`):

```ts
  }, [displayOrigin, displayLength, paperWidth, paperHeight, tapeCss, tapeClear, previewBitmap, printableBand, cutMarks]);
```

- [ ] **Step 5: Follow the label with the off-label dimming**

Replace `printablePath` (`App.tsx:1221-1224`):

```ts
  const printablePath = useMemo(
    () => rectPath(displayOrigin, printableBand.y, displayLength, printableBand.height),
    [printableBand, displayOrigin, displayLength],
  );
```

Without this the dragged object would read as semitransparent — "outside the label" — while sitting inside the label that just grew to hold it.

- [ ] **Step 6: Start the loop on pointerdown**

On the canvas container div (`App.tsx:1313-1318`), add the handler beside the existing drop handlers:

```tsx
                onPointerDown={handleCanvasPointerDown}
                onDrop={handleDrop}
                onDragOver={handleDragOver}
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "Follow the in-flight gesture with the drawn label"
```

---

### Task 5: Rebase a leftward overshoot on drop

**Files:**
- Modify: `src/App.tsx` (replace the `handleGestureEnd` placeholder from Task 4, Step 1)

`.lbx` cannot represent content at negative x, so a drag that grew the head has to be normalized when it commits: shift every object and every cut mark right by the overhang. Because the shift is exactly `−originX`, the leftmost object lands on the leading margin and the fitted length comes out equal to what was on screen — nothing jumps at the moment of release.

- [ ] **Step 1: Replace the placeholder**

```ts
  // A drag that grew the head leaves content at negative x, which .lbx has no
  // way to record. Shift the world right by the overhang so the label origin
  // is 0 again. The shift is chosen so that nothing moves *relative to the
  // label* — the committed length equals what was on screen mid-drag — so the
  // release reads as the drag simply finishing.
  //
  // useLayoutEffect timing is why this is a callback fired from the hook's
  // pointerup rather than an effect on the committed scene: it runs in the
  // same task as weasel's commit, so no frame is ever painted with content
  // hanging off an un-grown label.
  const handleGestureEnd = useCallback(() => {
    if (!autoLength) return;
    const { originX } = fitExtentToContent([...scene.nodes.values()].map((n) => n.pose));
    const shift = rebaseShift(originX);
    if (shift === 0) return;
    scene.batch('Extend label', () => {
      for (const [id, node] of scene.nodes) {
        scene.setPose(id, { ...node.pose, x: node.pose.x + shift });
      }
    });
    setCutMarks((marks) => marks.map((x) => x + shift));
  }, [autoLength, scene]);
```

- [ ] **Step 2: Verify the ordering assumption**

The hook's `pointerup` listener is on `window` and weasel's dispatcher also commits on `pointerup`. Weasel's listener is attached to the canvas element (it captures the pointer), and a bubbling `pointerup` reaches the element before `window`, so the commit lands before `handleGestureEnd` reads the scene.

Confirm this in the browser rather than assuming it — Step 4 below is the check. If the read turns out to see pre-commit poses (the rebase would shift by the wrong amount, or not at all), the fix is to defer the body of `handleGestureEnd` by one microtask with `queueMicrotask`.

- [ ] **Step 3: Run the test suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 4: Verify in the browser**

Start the dev server in the background (Bash with `run_in_background: true`):

Run: `npm run dev`

Then drive it with the `verify` skill, or the Chrome automation tools directly, against `http://localhost:5180`. Check each of these — they are the behaviors the spec promises, and the type-checker cannot see any of them:

1. **Tail growth.** Auto on. Drag an object right past the end: the label follows continuously, the canvas zooms out to keep it framed. Release — the label stays exactly where it was showing, no jump.
2. **Rubber-band.** Drag right past the end, then back left without releasing: the label shrinks in lockstep back to its original length.
3. **Head growth and rebase.** Drag an object left past x=0: the label extends leftward. Release — nothing jumps, the object sits a leading margin in from the label's start, and the other objects have moved right with it.
4. **Cut marks ride along.** Set Labels to 3, then drag an object left past x=0 and release: the dashed guides keep their spacing relative to the content, and none are lost.
5. **Auto off.** Turn Auto off, drag past both edges: the label does not move at all.
6. **Resize.** Auto on. Drag an object's right handle past the end: the label grows. Same for a left handle past x=0.
7. **Abandoned drag.** Drag well past the end, then press Escape (or drag back and release in place): no length change survives.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "Rebase a leftward overshoot when the drag commits"
```

---

### Task 6: Document the behavior

**Files:**
- Modify: `CLAUDE.md` (the auto-length bullet under "Current state")

- [ ] **Step 1: Update the auto-length bullet**

The existing bullet says auto-length is "refitted on every committed scene change" and that "content is never reflowed, only the tail moves" — both now need qualifying. Extend it:

```markdown
  While a drag is in flight the label follows the gesture instead of the
  committed scene (`src/useLiveExtent.ts` polls weasel's overlay-aware
  `getEffectiveBounds` each frame, since weasel doesn't commit a drag until
  pointer-up), so the label grows and shrinks under the cursor and commits
  what it was showing. The live value reaches only what's drawn — the paper
  layer, the printable clip, the view fit — never export, print, autosave,
  cut-mark pruning or diagnostics. The head grows too: content dragged past
  x=0 extends the label leftward, and on release everything shifts right by
  the overhang (`rebaseShift`) since .lbx can't record negative x. That
  shift lands the committed length exactly where the drag left it, so
  nothing jumps. Create-drag (inserting a new object) still snaps at drop —
  a nascent insert has no node id for `getEffectiveBounds` to find.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document live auto-length"
```

---

## Verification

The whole feature, end to end:

```bash
npx tsc --noEmit && npx vitest run && npm run build
```

Plus the seven browser checks in Task 5, Step 4 — the gesture behavior has no unit harness, so that list is the real acceptance test.
