# lbx-editor

Web-based visual editor for Brother P-touch label files (.lbx).

## Architecture

Standalone Vite + React app consuming:
- `@weasel-js/core`, `/ui`, `/theme` (from npm, `^0.6.0`) — 2D scene graph,
  canvas rendering, tools, and the UI kit
- `bil-lbx` (from npm, `^0.2.2`) — .lbx serialization/parsing. The floor is
  0.2.2 because the barcode background round-trip reads `LabelConfig.generator`,
  which older versions neither surface nor stamp with the current name.
- `obwat` (from npm, `^0.3.0`) — Brother P-touch printing: raster encoding,
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

No sibling repos required — bil-lbx, weasel and obwat all install from npm. To
develop any of them against the editor, `npm link ../bil-lbx` (or `../weasel`,
`../obwat`) — and remember consumers use built `dist/`, so run the sibling's
`npm run build` after edits (a stale Vite dep cache will also keep serving the
old bundle; `npm run dev -- --force` re-optimizes).

## Weasel integration

weasel resolves as an ordinary dependency: its own `exports` map answers the
barrel and the `@weasel-js/ui/components/*` subpaths, so nothing mirrors its
source layout. Subpath imports (not the `@weasel-js/ui` barrel) are deliberate
— the barrel pulls in sibling components like DataGrid that trip a
duplicate-`@types/react` mismatch against this app's newer React types.

Until 0.6.0 this went through `weaselAliases()` against a sibling checkout,
because the published `ui` package shipped neither types nor subpaths.

Key weasel APIs used:
- `SceneCanvas` with `layers.scene.drawOne` for custom rendering
- `useScene` for the document model
- `useSelection` for selection state
- `toolBundle: "standard"` for built-in select/hand/rect tools

## Current state

- Print renders through weasel's headless `renderSceneToPixels` with the same `drawOne` as the screen — print is the screen's rendering at printer resolution (WYSIWYG by construction). Uniform dpi/72 scale on both axes; only the tape's centered printable band renders (`printableBandPt` in `src/labelRender.ts`), and the canvas dims content outside it.
- Text renders via weasel MSDF text (screen and print share the same
  `textCommand` in `drawLabelNode`, so WYSIWYG holds). Bundled atlases
  (Inter, Barlow Condensed, JetBrains Mono; 400+700, synthetic italic) in
  `public/fonts/`; .lbx font names map through `substituteFontFamily`
  (`src/fonts.ts`) without rewriting node data; personal atlases (baked
  with weasel's `npm run gen:font`) load either via the sidebar "Custom
  fonts" panel (uploaded .json+.png pair persisted in IndexedDB,
  `src/customFonts.ts`) or from gitignored `public/fonts/local/` +
  manifest — see docs/local-fonts.md. Text word-wraps at the box width;
  `\n` forces breaks; JUSTIFY renders as LEFT.
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
- Barcodes are exempt from dithering: `src/ditherProtect.ts` turns each
  barcode's pose plus its quiet zone into dot-space rects and passes them as
  obwat's `DitherOptions.protect`, which quantizes those pixels at plain
  threshold and stops error diffusion at their boundary. Dithering is for
  tone; a barcode's geometry is its payload, and diffusion carries a bar
  edge's error into the bar beside it. obwat takes plain rectangles and
  knows nothing about barcodes — what to protect is this app's call, so
  hairlines or small type could join later.
- Barcodes draw an opaque background over that same region
  (`barcodeBackgroundRect`, which `ditherProtect` also calls, so the masked
  and the dither-exempt rect are one definition). Without it a barcode over
  an image composites with it and the artwork prints into the spaces and the
  quiet zone, which no scanner reads — a failure the canvas can't show as
  wrong, because it draws it correctly. Per-barcode ("Opaque background",
  default on); `.lbx` carries it as the object's `brush` (`SOLID` on, `NULL`
  off) and both directions round-trip — but only in files *we* wrote, which
  `fileMeansItsBrush` (`src/lbxImport.ts`) decides from bil-lbx's `generator`.
  P-touch stamps `NULL` on every barcode it authors and draws them opaque
  anyway, so its brush carries no information. `bil-lbx` alone counts, and
  deliberately not its former name `brother-lbx`: files we wrote before this
  existed carry that stamp and no brush, so trusting it would reopen their
  barcodes transparent. Needs bil-lbx ≥ 0.2.2, which is both when `generator`
  became readable and when its value changed — hence the `^0.2.2` range.
- A barcode's pose means its *bars*, and the quiet zone lives outside it
  (`quietZonePt`, a flat 10 modules per side for every 1D symbology; 4 cells
  for QR). No encoder bakes a quiet zone into its `totalModules` —
  `encode.test.ts` pins that across all nine, because `barcodeModulePt` is
  `pose.width / totalModules`, so whatever that counts is what the pose means.
  Measured against a P-touch-authored file: under the `margin="false"` we
  always export, P-touch's object box is the bars alone. (The EAN family used
  to bake in 9, drawing ~19% narrow and double-counting its quiet zone in the
  background and the dither-protected region.) Still simplified: EAN-13's
  standard is asymmetric, 11 left / 7 right.
- A barcode's two colors are picked by the renderer, not stored on the node,
  so they come through `drawLabelNode`'s `colors` argument: bars in the
  cassette ink, background in the tape color, both screen-only. The defaults
  are the print values (`#000000` on `#ffffff`, which the luminance threshold
  turns into no dots), so a call site that omits the argument prints
  correctly. `remapNodeInk` is the other path and handles only colors the
  *document* carries — text color, rect fill — which is why barcodes aren't
  in it. `src/drawLabelNode.ts` lives outside App.tsx because a test can't
  import the app: it pulls in obwat, whose dist uses extensionless imports
  vitest won't resolve.
- Auto-length (toolbar "Auto") fits the label to its content: length =
  rightmost object edge + 5.6pt (`src/autoLength.ts`), refitted on every
  committed scene change. Content is never reflowed, only the tail moves.
  Turning Auto off pins the length where the fit left it. New documents
  default to Auto off at the explicit 200pt Length.
  While a drag is in flight the label follows the gesture rather than the
  committed scene — weasel doesn't commit a drag until pointer-up, so
  `src/useLiveLength.ts` polls its overlay-aware `getEffectiveBounds` each
  frame and refits from that. Covers move, resize and rotate; create-drag
  still snaps at drop (a nascent insert has no node id to look up). The live
  value reaches ONLY what's drawn — paper layer, printable clip, view fit —
  never export, print, autosave, cut-mark pruning or diagnostics. That
  separation is load-bearing: a mid-drag shrink reaching the cut-mark pruning
  would delete marks on a drag the user then abandons.
  The head stays pinned at x=0; only the tail moves. Leftward growth was built
  and removed — it can't coexist with the canvas's continuous refit, which
  anchors to the label's left edge and pushes the dragged object back. See
  docs/superpowers/specs/2026-07-28-live-auto-length-design.md.
  On import the *recorded* length wins over our own fit: `paper.height` only
  holds the length for fixed-length files — under autoLength P-touch parks its
  1000mm ceiling (2834.4pt) there and records the real extent in
  `style:backGround`. bil-lbx's `labelLengthPt(config)` knows which field to
  read; content-fitting is the fallback for files with no band. Export writes
  the band explicitly (`backgroundFor`), since an auto-length label's length
  has nowhere else to live.
- The document autosaves to localStorage (`lbx-editor.doc`: scene JSON +
  tape config + cut marks, 300 ms debounce) and restores on load, so
  refreshes keep the label being edited.
- Cut marks (`src/cutMarks.ts`): the toolbar's Labels control makes N-1
  evenly spaced marks; dashed red guides show them; print slices the raster
  into pages at the marks (obwat multi-page job — cutter fires between
  pages); round-trips .lbx via bil-lbx's `cut` (`style:cutLine`).

## Governing rule

It's OK to make changes to the weasel API when it makes both sides simpler, cleaner, or more elegant.
