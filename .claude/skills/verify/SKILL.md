---
name: verify
description: Drive lbx-editor's real print flow in the automation Chrome and capture the print raster without printer hardware
---

# Verifying lbx-editor (print path included, no printer needed)

## Launch

```sh
npm run dev   # http://localhost:5180 (background it)
```

Use the chrome-devtools MCP tools (that Chrome profile has a WebUSB grant
for localhost:5180).

## Populate a label deterministically

Don't drag-draw nodes — import a generated .lbx instead:

1. Write a small script importing `bil-lbx` (`buildLbx`, `TAPE`), run with
   `npx -y tsx` — bil-lbx is an ordinary npm dependency, so it resolves
   from `node_modules` (name the script `.mts` or tsx treats it as CJS and
   top-level await fails). **Put the script inside the editor dir**, not a
   scratchpad: node resolves bare imports from the script's own location,
   not the cwd. `.tmp-*` is gitignored.
2. The upload tool only accepts files inside the workspace — copy the
   .lbx into the repo first (and delete it afterwards).
3. `upload_file` on the **"Open .lbx" button** uid — the hidden file
   input never appears in the a11y snapshot, but the button intercepts
   the chooser.

## Exercise the Print flow headlessly

Before clicking Print, in `evaluate_script`:

```js
localStorage.setItem('lbx-editor.hasUsbGrant', '1');   // forces the "asleep" path, no USB chooser
const orig = OffscreenCanvas.prototype.getContext;
window.__glCanvases = [];
OffscreenCanvas.prototype.getContext = function (t, ...a) {
  if (t === 'webgl2') window.__glCanvases.push(this);
  return orig.call(this, t, ...a);
};
```

Click Print. **The result is a toast, not an `alert()`** — every `alert()`
is gone. Toasts auto-dismiss, and they carry no `role`, so a single
snapshot taken a beat too late shows nothing. Poll the DOM instead:

```js
document.querySelectorAll('[class*="toast" i]')   // accumulate over ~3s
```

Outcomes, in pipeline order:

- `Print failed: …` → the render/raster stage threw (regression).
- `Printer not found — It may have auto-powered off…` → render + raster
  encode succeeded; failure is at device acquisition (expected with
  printer asleep). This is the PASS signal without hardware.
- `Printer reported an error (check tape/cover)` → the job reached a live
  printer and was rejected — usually the label's tape size ≠ loaded
  cassette (flashing red LED on the PT-P710BT; clears on a valid job or
  power cycle). If the printer is on and sizes match, IT PRINTS REAL TAPE
  — check before clicking.
- `Print blocked …` → `printPreflight` refused the document (undersized
  barcode, tape mismatch). Nothing rendered; fix the label, not the code.

Capture the actual print pixels (weasel renders with
`preserveDrawingBuffer: true`, so the buffer survives dispose):

```js
const c = window.__glCanvases.at(-1);          // print render, e.g. 360×128
const png = await c.convertToBlob({type: 'image/png'});  // → FileReader → dataURL
```

Expected dims: width = round(labelLengthPt × dpi/72), height =
printableDots for the tape (e.g. 128 for 24mm at 180 dpi). Save the PNG
and `open` it.

This buffer is the *pre-dither* RGBA render. It's the right artifact for
"what did the scene draw at print resolution"; for what actually inks the
tape, turn on **Print preview**, which draws the post-dither mask.

To check the raster numerically rather than by eye, count dark pixels per
column in the page (`createImageBitmap` → 2D `getImageData`) and read off
the runs. Blank-column runs give object edges in dots exactly.

## Gotchas

- `evaluate_script` returns must be JSON-serializable; big payloads →
  `filePath` output.
- Two Print clicks in a row: the grant flag is one-shot — the first
  "asleep" toast clears it; re-set it before the next click or you get
  the WebUSB chooser (browser dialog, blocks automation).
- Print preview suppresses the live scene draw, so a canvas screenshot
  meant to show *screen* colors needs it off.
