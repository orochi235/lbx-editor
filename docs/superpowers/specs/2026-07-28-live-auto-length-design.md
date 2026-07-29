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

While auto-length is on, the label's extent tracks the in-flight gesture
continuously: it grows as the object crosses an edge, shrinks back as the
object comes home, and commits at whatever it was showing when the pointer
came up. Both edges — the tail as today, and the head, which auto-length has
never fitted.

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

### Live extent, and why the head never retracts

Over the effective poses:

    minX = min(pose.x)
    maxX = max(pose.x + pose.width)

    displayOrigin = min(0, minX − 5.6pt)
    displayEnd    = maxX + 5.6pt
    displayLength = clamp(displayEnd − displayOrigin,
                          MIN_LABEL_LENGTH_PT, MAX_LABEL_LENGTH_PT)

The clamp trims the tail, never the head: `displayOrigin` is whatever the
formula above gives and `displayLength` is clamped against it, so a label that
hits the ceiling stops growing rightward while the head stays put.

The head extends only when content crosses into negative x, and never retracts
past 0. A label whose leftmost object sits at x = 50 has a 50 pt leading gap
that is part of the design; starting a drag anywhere on that label must not
snap the head shut. This mirrors the rule auto-length already follows at the
tail — content is never reflowed, only the boundary moves.

The `MAX_LABEL_LENGTH_PT` clamp means a drag past the 1000 mm ceiling stops
growing the label while the object keeps moving, which is the correct signal
that the object is leaving printable space.

### Left-edge rebase on drop

.lbx has no representation for content at negative x, so a leftward overshoot
has to be normalized at commit. On gesture end with `minX < 0`, shift every
node — and every cut mark — right by

    s = 5.6pt − minX

The result is seamless by construction. Post-shift the leftmost object sits at
5.6 pt, which is exactly the head gap that was displayed mid-drag, and

    fitLengthToContent(shifted) = maxX + s + 5.6pt
                                = (maxX + 5.6pt) − (minX − 5.6pt)
                                = displayLength

So the committed length equals what was on screen, and every object's position
*relative to the label* is unchanged: nothing visibly jumps at release. The
whole world moved, and the label moved with it.

**Undo cost:** the rebase lands as its own history entry ("Extend label"). The
gesture owns its commit batch and the app has no way to append to it, so
undoing a leftward overshoot takes two presses — first the rebase, then the
move. The intermediate state is valid (content at negative x, label origin 0),
just not one the user asked for. Accepted for now; folding the two would need a
second weasel change and doesn't block the feature.

### Component boundaries

`src/autoLength.ts` gains two pure functions beside `fitLengthToContent`:

    /** The label span that fits `poses`, allowing a negative head. */
    fitExtentToContent(poses): { originX: number; length: number }

    /** Rightward shift that normalizes a negative-origin extent to x=0.
     *  Equals −originX: shift right by however far the label overhangs. */
    rebaseShift(originX: number): number

Both are pure geometry over poses — no React, no weasel, unit-testable in
isolation, and they express the whole of the head/tail rule.

`fitLengthToContent` stays as it is and does **not** become a wrapper over
`fitExtentToContent`. The two answer different questions: the committed fit
assumes an origin at 0 and deliberately ignores negative-x content (a pinned
behavior — see the existing "ignores negative-x content" test), while the live
extent is the one that grows a head. Drift is guarded by a test asserting they
agree whenever all content is non-negative, which is every committed document
once the rebase has run.

`src/useLiveExtent.ts` holds the gesture bookkeeping — the rAF loop, its
pointer-driven start/stop, and the per-frame union. It takes a node-id getter
and the `helpersRef`, not the `Scene`, so it stays free of weasel's scene
generics and can be exercised with a stub helpers object. App.tsx keeps only
the display pair, the rebase commit, and the `helpersRef` wiring — it is
already 1400 lines and shouldn't absorb another gesture subsystem.

## Testing

- `src/autoLength.test.ts` covers `fitExtentToContent` (empty scene, all-positive
  content, content crossing zero, content entirely negative, ceiling clamp) and
  `rebaseShift` (including the round-trip identity: rebasing an extent then
  refitting yields the same length).
- The rAF/gesture wiring has no unit harness — App-level gesture code isn't
  tested today. Verified in the browser via the `verify` skill: drag right past
  the end and watch the label follow, drag back and watch it shrink, release and
  confirm the committed length matches what was shown; the same leftward,
  confirming no jump at release and that cut marks moved with the content;
  and with Auto off, confirming a drag moves nothing.

## Out of scope

- Easing or spring on the growth. Rejected in favor of 1:1 — the length shown
  mid-drag should be the length that commits.
- Live growth on the vertical axis. Tape width is a physical property of the
  cassette, not something content can change.
- Folding the rebase into the gesture's undo entry (see "Undo cost").
