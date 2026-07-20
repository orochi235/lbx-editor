# lbx-editor

Web-based visual editor for Brother P-touch label files (.lbx).

## Architecture

Standalone Vite + React app consuming:
- `@weasel-js/core` (linked from `../weasel`) — 2D scene graph, canvas rendering, tools
- `bil-lbx` (linked from `../bil-lbx`) — .lbx serialization/parsing
- `obwat` (linked from `../obwat`) — Brother P-touch printing: raster encoding,
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

Requires sibling repos: `~/src/weasel` and `~/src/bil-lbx`.

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
- Printer status chip is a button — click fires `queryStatus()`. obwat's
  keepalive polls fast (3 s) while the printer is absent, so power-on shows
  up on the chip within seconds.
- Printer panel in the right sidebar (between Properties and Debug): status
  chip (same component as the toolbar's), Auto cut, Print preview toggle,
  and the Dithering selector; future printer controls land there.
- Print preview: runs the real print pipeline (renderLabelToRgba →
  ditherToMask) on each committed scene change and draws the ink dots over
  the printable band (ink color, transparent elsewhere) while suppressing
  the live scene draw. The Dithering choice (threshold / Floyd–Steinberg /
  Atkinson / Bayer) feeds preview and print job alike.
- Auto-length is hidden/unimplemented: the flag round-trips .lbx but layout
  always uses the explicit Length field.

## Governing rule

It's OK to make changes to the weasel API when it makes both sides simpler, cleaner, or more elegant.
