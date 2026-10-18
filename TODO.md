# TODO

Known problems, not yet fixed.

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
