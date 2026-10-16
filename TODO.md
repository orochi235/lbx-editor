# TODO

Known problems, not yet fixed.

## The clipping warning swallows clicks on the canvas

The "Object will be clipped" bubble is page content laid over the canvas, so a press that lands on
it never reaches the canvas — it selects nothing, or hits a different node than the one under it,
and it can cover a resize handle outright. Seen 2026-09-30 at 100% and 244% zoom on 12mm tape. The
bubble should either stay off the canvas or let pointer events through to it.

## Only corner handles resize

A selected node shows resize handles at its corners only; the middle of each edge has no handle and
no resize cursor. A drag started there is a drag on whatever node is under the pointer, so with a
second node behind the edge, that node moves instead of the selected one resizing. This is the
likely source of the 2026-07-28 report that resize "grabs the node under the handle" — weasel
resizes the selected node correctly from every corner (re-tested 2026-09-30 on
`@weasel-js/core` 0.7.2). Add edge handles, or confirm corner-only is intended.

## The clipping warning keeps focus, so Backspace in a panel field deletes the object

While an "Object will be clipped" callout is open, clicking any sidebar field leaves focus on the
callout's close button rather than the field. Typing then goes nowhere, and Backspace or Delete
reaches the canvas's delete binding — which skips editable targets, but the target is the button —
so the selected object is removed. Seen 2026-10-16 on the base commit e9ec414 as well as the labkit
refresh, so it predates it; with document warnings off, fields keep focus normally.

## A reload restores a zoom that runs the label off the canvas

After a reload the view comes back at the zoom it was left at (224% for `test/fixtures/barcodes.lbx`
on 24mm tape, at 1440×900) but not refitted, so a long label runs past the canvas's right edge until
Fit is pressed. Seen 2026-10-16 on main (e9ec414) and on the labkit refresh alike.
