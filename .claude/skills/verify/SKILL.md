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

1. Write a small script importing `../bil-lbx/src/index.ts` (`buildLbx`,
   `TAPE`), run with `npx -y tsx` **from the bil-lbx dir** (deps resolve
   there; name the script `.mts` or tsx treats it as CJS and top-level
   await fails).
2. The upload tool only accepts files inside the workspace — copy the
   .lbx into the repo first (and delete it afterwards).
3. `upload_file` on the **"Open .lbx" button** uid — the hidden file
   input never appears in the a11y snapshot, but the button intercepts
   the chooser.

## Exercise the Print flow headlessly

Before clicking Print, in `evaluate_script`:

```js
window.__alerts = []; window.alert = m => window.__alerts.push(String(m));
localStorage.setItem('lbx-editor.hasUsbGrant', '1');   // forces the "asleep" alert path, no USB chooser
const orig = OffscreenCanvas.prototype.getContext;
window.__glCanvases = [];
OffscreenCanvas.prototype.getContext = function (t, ...a) {
  if (t === 'webgl2') window.__glCanvases.push(this);
  return orig.call(this, t, ...a);
};
```

Click Print. Outcomes, in pipeline order:

- alert `Print failed: …` → the render/raster stage threw (regression).
- alert `Printer not found — it may have auto-powered off…` → render +
  raster encode succeeded; failure is at device acquisition (expected
  with printer asleep). This is the PASS signal without hardware.
- alert `Printer reported an error (check tape/cover)` → the job reached
  a live printer and was rejected — usually the label's tape size ≠
  loaded cassette (flashing red LED on the PT-P710BT; clears on a valid
  job or power cycle). If the printer is on and sizes match, IT PRINTS
  REAL TAPE — check before clicking.

Capture the actual print pixels (weasel renders with
`preserveDrawingBuffer: true`, so the buffer survives dispose):

```js
const c = window.__glCanvases.at(-1);          // print render, e.g. 360×128
const png = await c.convertToBlob({type: 'image/png'});  // → FileReader → dataURL
```

Expected dims: width = round(labelLengthPt × dpi/72), height =
printableDots for the tape (e.g. 128 for 24mm at 180 dpi). Save the PNG
and `open` it.

## Gotchas

- `evaluate_script` returns must be JSON-serializable; big payloads →
  `filePath` output.
- Two Print clicks in a row: the grant flag is one-shot — the first
  "asleep" alert clears it; re-set it before the next click or you get
  the WebUSB chooser (browser dialog, blocks automation).
