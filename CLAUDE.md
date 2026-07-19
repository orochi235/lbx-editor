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

- Print renders through weasel's headless `renderSceneToPixels` with the same `drawOne` as the screen — print is the screen's rendering at printer resolution (WYSIWYG by construction).
- Text renders as real glyphs via a canvas rasterizer (`src/textRender.ts`) rasterized into a 4× bitmap cache (`src/textBitmapCache.ts`) used by both screen and print; weasel MSDF text remains the eventual replacement.
- Objects can be created, selected, moved, resized via weasel tools
- Import/export .lbx files works end-to-end
- Property panel for editing text, rect, and pose properties
- Canvas previews the loaded cassette's tape/ink colors from live printer
  status (`src/tapeColors.ts`); Debug panel (below Properties) has the enable
  toggle and manual overrides
- Content outside the label rect renders semitransparent via weasel's scene
  `postProcess` hook (faded full draw + clipped crisp draw in App.tsx)

## Governing rule

It's OK to make changes to the weasel API when it makes both sides simpler, cleaner, or more elegant.
