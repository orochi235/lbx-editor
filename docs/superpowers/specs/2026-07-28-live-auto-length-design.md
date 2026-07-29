# Live auto-length during a drag

## Problem

Auto-length fits the label to its content — length = rightmost object edge +
5.6 pt (`src/autoLength.ts`), recomputed on every *committed* scene change.

Weasel's move gesture doesn't commit until the pointer comes up: it renders a
preview ghost and leaves the scene untouched. So while an object is dragged
past the end of the label, the label stays where it was and then jumps to the
new length at the instant of release. The user gets no feedback about the label
they're actually making until they've already made it.

The same holds for a resize handle dragged rightward, and for drawing a new
object past the end.

## Goal

While auto-length is on, the label's length tracks the in-flight gesture
continuously: it grows as the object passes the end, shrinks back as the object
comes home, and commits at whatever it was showing when the pointer came up.

> **Status: implemented, with one part cut.** This spec originally covered both
> edges. Head growth — the label extending leftward for content dragged past
> x=0, then rebasing on drop — was built, tested, and then **removed**: it
> cannot coexist with the canvas's continuous refit. See "Why the head doesn't
> grow" below. The tail behavior described here shipped as written.

## Behavior

**Growth is 1:1, not eased.** The label edge sits exactly 5.6 pt past the
proposed content edge on every frame. Dragging back inward shrinks it in
lockstep, so the "rubber-band back if you change your mind" behavior falls out
of the same rule rather than needing its own. What's on screen mid-drag is
exactly what commits on release.

**The view refits continuously.** The canvas already refits when paper size
changes (`App.tsx:386`); during a live gesture that fit runs each frame, so the
whole label stays in frame as it grows. Content therefore slides slightly under
the cursor while the zoom changes — accepted, in exchange for never dragging
into off-screen space.

**Every pose-mutating gesture participates:** move (single and multi-select),
resize, rotate, and anything else that displaces existing nodes. Create-drag
(rect / line / text / barcode insert) participates once the weasel addition in
"Gesture extent" lands; until then it keeps today's snap-at-drop.

**Only when auto-length is on.** With Auto off the length is the user's, and a
drag must not move it.

**The head stays pinned at x=0.** An object dragged past the start of the label
just hangs off it, exactly as on the committed path.

## Design

### Gesture extent

A rAF loop runs while — and only while — a pointer gesture is in flight. It
starts on `pointerdown` over the canvas container and stops on `pointerup` /
`pointercancel` (listened for on `window`, so a release outside the canvas
still ends it).

Weasel's own `tools.gestureTick` would be the more obvious trigger, but the app
captures `ToolsApi` once via `onToolsCreated` and holds it in state, so the
`gestureTick` it can see is frozen at the value from first mount. The
`dispatcher` on that captured object *is* stable and its `hasActiveGesture()`
is a live getter, but nothing re-renders App when it flips. Driving off raw
pointer events sidesteps weasel's phase bookkeeping entirely and is both
simpler and more robust: the loop's lifetime is exactly the pointer's.

Each frame the loop unions `helpersRef.getEffectiveBounds(id)` over the scene's
nodes. That helper is documented as returning the drag/resize/rotate overlay
box when a gesture is active on the id and the committed box otherwise — so one
call site covers every gesture that displaces an existing node, with no
per-tool plumbing and no reliance on tool internals.

`helpersRef` is a `SceneCanvas` prop the app doesn't currently pass; wiring it
is a one-line addition.

A create-drag has no node id yet — its preview lives in the dispatcher's
overlay, not in the scene. Covering it needs one addition to weasel's public
surface:

    // CanvasHelpers
    /** Union AABB of what the in-flight gesture proposes — displaced poses
     *  plus any nascent insert rect. Null when no gesture is in flight. */
    getGestureBounds(): Bounds | null

This is a general question a canvas consumer wants to ask ("is my gesture
leaving the page?"), not a peephole into a tool's scratch, so it belongs on
`CanvasHelpers` next to the existing `getEffectiveBounds`. Landing it also lets
the app drop the per-node union in favor of one call. Implementation order:
build against `getEffectiveBounds` first, adopt `getGestureBounds` when weasel
ships it.

### Two lengths, strictly separated

`labelLength` stays exactly what it is today — the committed length, derived
from committed poses. It keeps feeding export, print, print preview, autosave,
cut-mark pruning, and diagnostics. **No live value reaches any of them.**

A new pair — `displayOrigin` and `displayLength` — feeds only what's drawn:

- the paper layer (`App.tsx:690`): tape face, brick shadow, cut guides
- `printablePath`, so the off-label dimming follows the growing label and the
  dragged object doesn't read as "outside" while it's inside
- `fitViewToBounds` in the paper-size effect

When no gesture is in flight the pair equals `{0, labelLength}`, so every
non-gesture code path behaves as it does today.

This separation is load-bearing, not tidiness. `labelLength` currently prunes
cut marks that fall past the end (`App.tsx:312`); if a transient mid-drag
shrink reached it, marks would be destroyed by a drag the user then abandoned.
It also keeps the 300 ms autosave from writing on every animation frame.

The print-preview bitmap is a render of committed state, so it stays pinned at
origin 0 with the committed width and goes briefly stale during a gesture. It
refreshes on commit like it does now.

### The live length

Over the effective poses, the live length is the same fit the committed path
uses, applied to the gesture's proposed poses instead of the scene's:

    displayLength = clamp(max(pose.x + pose.width) + 5.6pt,
                          MIN_LABEL_LENGTH_PT, MAX_LABEL_LENGTH_PT)

`fitLengthToContent` already computes exactly this, so there is no second
implementation to keep in step — the live path and the committed path are the
same function over different poses.

The `MAX_LABEL_LENGTH_PT` clamp means a drag past the 1000 mm ceiling stops
growing the label while the object keeps moving, which is the correct signal
that the object is leaving printable space.

### Why the head doesn't grow

The original design grew the label leftward for content dragged past x=0 and
rebased everything right on drop. It was built, and it does not work, for a
reason that only shows up against a live canvas:

1. The object crosses x=0, so the live extent's origin goes negative and the
   label grows leftward.
2. `fitViewToBounds` re-frames the canvas — and the label's **left edge is the
   anchor it frames to**, so the view pans.
3. That pan maps the same screen pointer to a larger world x, pushing the
   dragged object back to the right.
4. The loop settles with the object parked at x ≈ 0 and the label never grown.

Measured: after a hard leftward drag the object committed at **x = 0.015** with
the length unchanged at 139 pt. With the mid-gesture refit suppressed, the same
drag produced **139 → 155.6 pt** and the rebase fired correctly — confirming the
refit, not the extent math, was the cause.

The tail escapes this because growing the tail changes only the *zoom*, not the
anchor. (It perturbs the tail drag too, just far less.)

That left three options: hold the view steady mid-gesture, pan-compensate at
the cursor each frame, or keep continuous refit and drop head growth. **Head
growth was dropped** — the tail case is the one that motivated the feature, and
keeping the head meant either giving up the always-framed canvas or adding a
per-frame pan correction for a secondary case.

Consequences: the label origin stays pinned at x=0 on both paths, so the extent
collapses to a plain length. `fitExtentToContent`, `rebaseShift`, the
`displayOrigin` plumbing, the `paperBounds` origin parameter and the
rebase-on-drop commit are all gone, along with the two-press undo wart they
carried. Dragging an object past the start of the label leaves it hanging off
the tape, flagged by the existing "will be clipped" diagnostic — unchanged
behavior.

### Component boundaries

`src/autoLength.ts` is unchanged: `fitLengthToContent` serves both paths, since
the live fit is that same function over the gesture's proposed poses. Its
existing "ignores negative-x content" test is now load-bearing for the live
path too — it *is* the head-pinned-at-0 rule.

`src/useLiveLength.ts` holds the gesture bookkeeping — the rAF loop, its
pointer-driven start/stop, and the per-frame poll. It takes a node-id getter
and the `helpersRef`, not the `Scene`, so it stays free of weasel's scene
generics and can be exercised with a stub helpers object. App.tsx keeps only
`displayLength` and the `helpersRef` wiring — it is already 1400 lines and
shouldn't absorb another gesture subsystem.

## Testing

- `src/useLiveLength.test.ts` drives the hook against a stub bounds lookup with
  a hand-cranked `requestAnimationFrame`: tracking a rightward drag frame by
  frame, shrinking back on the way home, ignoring content dragged past x=0,
  clearing on pointerup and pointercancel, doing nothing when disabled, and
  holding a stable value for a stationary pointer.
- `src/autoLength.test.ts` covers the fit itself, unchanged.
- The App-level wiring has no unit harness. Verified in the browser
  (Playwright, screenshots taken mid-drag with the pointer still down):
  - **Tail growth** — 86.6 → 130.7 pt, tail tracking 5.6 pt past the object.
  - **Rubber-band** — dragging back left shrank the label in lockstep.
  - **Committed value lags by design** — the toolbar Length field held its old
    value for the whole drag and updated only on release.
  - **Resize** — 163 → 198.7 pt, label growing as the handle moved.
  - **Auto off** — length pinned through an entire drag, to the digit.
  - **Cut marks survive a live shrink** — with 3 labels set, a drag that
    collapsed the live label past both marks left the marks intact (one visibly
    floating outside the shrunken tape); Escape restored 198.7 pt and 3 labels.
    This is the two-lengths separation doing its job: had `displayLength` fed
    the pruning effect, an abandoned drag would have deleted them for good.

## Out of scope

- Easing or spring on the growth. Rejected in favor of 1:1 — the length shown
  mid-drag should be the length that commits.
- Live growth on the vertical axis. Tape width is a physical property of the
  cassette, not something content can change.
- Head growth (see "Why the head doesn't grow"). Revisiting it means revisiting
  the continuous refit first.
- Create-drag, pending `CanvasHelpers.getGestureBounds()` in weasel.

## Known cosmetic nit

A cut mark whose position lies past the live label's end is drawn floating in
the canvas background for the duration of the drag, rather than being hidden.
It's transient and it's honest — the mark is still where the committed document
puts it — so it's left alone.
