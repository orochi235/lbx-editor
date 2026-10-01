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
