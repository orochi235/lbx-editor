# lbx-editor

Web-based visual editor for Brother P-touch label files (.lbx).

## Architecture

Standalone Vite + React app consuming:
- `@weasel-js/core` (linked from `../weasel`) — 2D scene graph, canvas rendering, tools
- `bil-lbx` (linked from `../bil-lbx`) — .lbx serialization/parsing
- `obwat` (from npm, `^0.1.0`) — Brother P-touch printing: raster encoding,
  WebUSB/Web Serial transports, and the `createBrotherPrinter` facade (device
  acquisition, keepalive, status events). Weasel renders pixels for print via
  `renderSceneToPixels` (`src/labelRender.ts` is just the unit math); obwat
  owns pixels-to-paper. UX policy (grant-flag localStorage, alert copy) stays
  in App.tsx.

## Local development

```sh
npm install
npm run dev    # starts on http://localhost:5180
```

Requires sibling repos: `~/src/weasel` and `~/src/bil-lbx`. obwat installs
from npm; to develop it against the editor, `npm link ../obwat` (and remember
obwat consumers use its built `dist/` — run its `npm run build` after edits).

## Weasel integration

Uses `weaselAliases()` from weasel's scripts to resolve all `@weasel-js/*` imports
and the kit's internal bare-path imports (`core/...`, `features/...`, etc.) to
local weasel source.

Key weasel APIs used:
- `SceneCanvas` with `layers.scene.drawOne` for custom rendering
- `useScene` for the document model
- `useSelection` for selection state
- `toolBundle: "standard"` for built-in select/hand/rect tools

## Current state

- Print renders through weasel's headless `renderSceneToPixels` with the same `drawOne` as the screen — print is the screen's rendering at printer resolution (WYSIWYG by construction). Uniform dpi/72 scale on both axes; only the tape's centered printable band renders (`printableBandPt` in `src/labelRender.ts`), and the canvas dims content outside it.
- Text renders as real glyphs via a canvas rasterizer (`src/textRender.ts`) rasterized into a 4× bitmap cache (`src/textBitmapCache.ts`) used by both screen and print; weasel MSDF text remains the eventual replacement.
- Objects can be created, selected, moved, resized via weasel tools
- Import/export .lbx files works end-to-end
- Property panel for editing text, rect, and pose properties
- Canvas previews the loaded cassette's tape/ink colors from live printer
  status (`src/tapeColors.ts`); Debug panel (below Properties) has the enable
  toggle and manual overrides. Clear cassettes render the tape strip
  translucent (the paper layer draws only the brick's L-shaped shadow, so the
  canvas shows through the face).
- Content outside the label rect renders semitransparent via weasel's scene
  `postProcess` hook (faded full draw + clipped crisp draw in App.tsx)
- Images render through weasel's kit `imageCache` (data-URI keys via
  `imageDataUri`); SceneCanvas redraws when a decode lands, so no app-side
  bitmap cache. Undecodable picks alert and revert to the select tool.
  .lbx-embedded 32bpp BMPs are re-encoded as PNG in `imageDataUri` via
  bil-lbx's `decodeBmp32` (P-touch Editor macOS carries artwork in the BMP
  alpha byte, which browser decoders discard as reserved); nodes keep the
  original BMP bytes so export round-trips. On export the reverse runs:
  non-BMP node bytes (user-inserted PNG/JPEG) transcode to 32bpp RGB+alpha
  BMP via `ensureBmp32Bytes` → bil-lbx `encodeBmp32`, since .lbx embeds
  only BMP.
- Printer status chip is a button — click fires `queryStatus()`. obwat's
  keepalive polls fast (3 s) while the printer is absent, so power-on shows
  up on the chip within seconds.
- Printer panel in the right sidebar (between Properties and Debug): status
  chip (same component as the toolbar's), Auto cut, Print preview toggle,
  and the Dithering selector; future printer controls land there.
- Preferences modal (toolbar gear → kit `PrefsDialog`, schema in
  `src/prefs.ts`): a second live view over the same persisted settings the
  panels edit (Auto cut, Print preview, Dithering, Cassette colors).
- Print preview: runs the real print pipeline (renderLabelToRgba →
  ditherToMask) on each committed scene change and draws the ink dots over
  the printable band (ink color, transparent elsewhere) while suppressing
  the live scene draw. The Dithering choice (threshold / Floyd–Steinberg /
  Atkinson / Bayer) feeds preview and print job alike.
- Auto-length is hidden/unimplemented: the flag round-trips .lbx but layout
  always uses the explicit Length field.
- The document autosaves to localStorage (`lbx-editor.doc`: scene JSON +
  tape config + cut marks, 300 ms debounce) and restores on load, so
  refreshes keep the label being edited.
- Cut marks (`src/cutMarks.ts`): the toolbar's Labels control makes N-1
  evenly spaced marks; dashed red guides show them; print slices the raster
  into pages at the marks (obwat multi-page job — cutter fires between
  pages); round-trips .lbx via bil-lbx's `cut` (`style:cutLine`).

## Governing rule

It's OK to make changes to the weasel API when it makes both sides simpler, cleaner, or more elegant.
