# TODO

Known problems, not yet fixed.

## Two bugs fixed in weasel, waiting on its next release

Both are merged to weasel `main` (2026-10-18) but not yet published. Once a release past 1.10.1 is
out, bump the pins and check each in the browser:

- **Only corner handles resize.** A drag on an edge midpoint moved whatever node was underneath
  instead of resizing the selected one. Weasel now draws edge handles by default; no app change
  needed. Opt-out is `selectTool={{ resize: { edgeHandles: false } }}`.
- **The clipping callout keeps focus.** Clicking a sidebar field while an "Object will be clipped"
  callout was open left focus on its close button, so Backspace deleted the selected object.
  React Aria's `Dialog` contains focus even inside a non-modal popover; weasel's non-modal
  `Callout` no longer uses it, and no longer takes focus when it opens.
