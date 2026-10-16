# lbx-editor

Web-based visual editor for Brother P-touch label files (.lbx).

## Architecture

Standalone Vite + React app consuming:
- `@weasel-js/core`, `/ui`, `/theme`, `/prefs`, `/labkit` (from npm, pinned at exactly
  **1.10.1**, as are the exact-version peers `@weasel-js/font` and
  `/animator` that core and ui require). Pinned rather than ranged because the
  kit's peers are exact: a caret range lets one package drift ahead of the
  others it must match.

  Things 1.x changed that this app depends on:
  - **A bare `<SceneCanvas>` only renders.** Picking, moving, resizing, undo
    and the zoom keys come from `features` presets; this app names `view`,
    `pick`, `move`, `resize`, `edit` and `arrange` (z-order, shown as the
    kit's public `<ActionBar group="reorder">` in the Arrange panel — app
    buttons calling the actions directly would need the `@experimental`
    registry API; `arrange`'s flip leaves rect poses untouched). Leave out `rotate` (labels don't
    rotate) and `ingest`, whose drop handling would compete with the app's own
    `onDrop`. A canvas missing a preset type-checks fine and silently stops
    responding, so check a preset change in the browser.
  - **`tokens.css` defaults to dark mode and sets no font.** The app follows
    the system instead: `LabShell mode="auto"` applies the theme for the
    resolved mode, and the kit's overlays portal into its root, so they
    match. App CSS uses `--wzl-*` tokens only. `main.tsx` imports
    `@weasel-js/theme/fonts.css` for the kit faces and
    `@weasel-js/labkit/styles.css` for the shell.
  - **Text color is `textCommand`'s 8th argument** (`{ fill: { paint } }`),
    not a `TextStyle` field. A color left in the style is ignored and the text
    renders black, with no type error if the object is built loosely.
  - **`drawOne`'s 4th argument is the kit's `NodePaintCtx`**, so the
    renderer-picked barcode colors can't ride there: `drawLabelNode(node,
    pose, colors)` takes them directly, and the print path uses
    `drawPrintNode`, which supplies the defaults.
  - **Text sits about one printer dot off where 0.7 put it**, from the kit's
    reworked glyph metrics. Measured on three P-touch fixtures: every glyph
    edge moved by a dot while images, rectangles and borders stayed
    pixel-identical. Screen and print moved together.
  - `renderSceneToPixels` releases the WebGL context of a canvas it created,
    so a print raster can't be read back from that canvas afterwards (the
    verify skill's capture) — hook `readPixels` instead.

  Hit-picking defaults to the painter's ink (`picking: 'shape'`), but every
  node here draws through `layers.scene.drawOne` rather than a registered
  painter with a `silhouette`, so the kit keeps the pose-rect answer — clicking
  the blank middle of an unfilled rectangle still selects it (verified on
  0.7.1). `geometry={{ picking: 'pose' }}` on `SceneCanvas` is the explicit
  opt-out if that ever changes.

  A painter's returned command array belongs to the painter, so copy before
  appending; `drawLabelNode` allocates every array it returns.
- `bil-lbx` (from npm, `^0.3.1`) — .lbx serialization/parsing. 0.2.2 was the
  floor for the barcode background round-trip, which reads
  `LabelConfig.generator`. 0.3.0 added the 2D style elements: DataMatrix and
  PDF417 keep their options in their own —
  `barcode:datamatrixStyle` and `barcode:pdf417Style` — and without those
  fields an export drops the module size, the row aspect, and PDF417's
  row/column/ECC choice. It also admits `RSS`, which is what P-touch actually
  stamps for GS1 DataBar.

  **0.3.1 is the floor now**, and this one is a correctness floor rather than
  a feature one: before it, `parseLbx` returned `objects` grouped by element
  name — every text, then every rect, line, image and barcode — where
  `pt:objects` lists them back to front. Node order *is* stacking order here
  (the canvas draws the array in order and `sceneToLbxConfig` writes it back
  the same way), so a label did not merely display restacked, it saved
  restacked. Three of bil-lbx's four P-touch fixtures interleave types, so
  this reached real files; `Filament Label 3` is the plainest, its background
  rectangle coming back on top of the text it was drawn beneath. `^0.3.0`
  would still resolve to 0.3.1 today, but the two parse the same file into
  different documents, so the range says which one this app means.
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
old bundle; `npm run dev -- --force` re-optimizes). A link is invisible in
`package.json`, so check `ls -ld node_modules/bil-lbx` before concluding a test
passes against what ships.

## Asking P-touch (`pte-probes/`)

Almost everything this app knows about `.lbx` geometry was measured in one
direction — reading files P-touch wrote — and the write direction was derived
by inverting that measurement. `scripts/makePteProbes.ts` generates the files
that ask the other half: one question per file, so a file P-touch refuses to
open costs only its own question. `pte-probes/README.md` (also generated) is
the per-file checklist. The flow is open in P-touch → look → **Save As** with a
`-pte` suffix, keeping both halves.

Two conventions make the answers readable. Symbols are sized so one module is a
round number of points, and a hairline rect sits a fixed 5pt *outside* the pose
we believe the ink occupies — a rect carries no convention the two renderers
could disagree about, which is what makes it a ruler and not a second reading
of the same guess. It is held off rather than drawn on the symbol's edge
because a correct symbol hides a coincident line, which looks exactly like a
line that never drew.

The generator reads each file back through our own importer before writing it:
a probe that cannot survive our own round-trip would answer a question about us
while looking like an answer about P-touch. Rerunning rewrites all eight files
regardless — a `.lbx` is a ZIP and jszip stamps the current time — so diff
`unzip -p f.lbx label.xml`, not the bytes.

The open questions are the 2D object box in the write direction, the
per-symbology module-size attributes, whether P-touch honors a pinned PDF417
row/column, and whether it honors `pt:brush` on a barcode at all. Separately,
GS1 DataBar needs a P-touch-*authored* sample — one per variant at **two**
module sizes, since one size cannot separate a per-module quiet zone from a
flat one in points.

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
- `features` presets for canvas behavior; `pick` mounts the kit's select
  tool, and every other palette tool is built from a public factory
  (`useHandTool`, `useLineTool`, `useRectTool`, `useTextTool`,
  `useImageTool`) and registered through the `tools` patch — see "Tool
  palette" below for why

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
- The page is labkit's `LabShell`: header is labkit's `Toolbar`
  (`src/Toolbar.tsx`), footer is the kit `StatusBar` (`src/EditorStatusBar.tsx`:
  tool, selection count, pointer position in mm, printer, zoom), and the right
  column is a kit `Sidebar` (`src/Inspector.tsx`) of collapsible panels —
  Properties, Arrange, Layers, Printer, Debug (collapsed by default), Custom
  fonts — each remembering its folded state in localStorage. The pointer
  position lives in `src/cursorStore.ts`, outside React state, so a pointer
  move re-renders only the readout. The canvas backdrop is a theme token; the
  tape keeps its physical color in both modes.
- Objects can be created, selected, moved, resized via weasel tools
- Tool palette reads in three clusters — Select/Hand, then Line/Rectangle/Text,
  then Image/Barcode (`src/toolGroups.ts`). `ToolPalette` clusters by each
  tool's `presentation.group` and its `groupOrder` prop only permutes clusters,
  so the layout is set by the groups themselves: the kit's taxonomy splits hand
  ('view') from select and text ('type') from the shapes, and puts image in
  with them, which no permutation fixes. `group` is a documented free-form
  string, so the app restates it via `inGroup` on tools built from the kit's
  public factories. Two ordering facts drive the rest: within a cluster the
  palette renders in *registration* order, and a built-in's slot is the kit's
  own canonical one that `defaultTools` order won't move. So every tool whose
  position matters is registered by the `tools` patch, whose key order is the
  palette's layout, and `defaultTools` is gone — `pick` supplies select.
  Hand must stay out of any built-in list: `view` registers it only when the
  patch hasn't, and registering it twice makes the patch entry a
  *replacement*, which warns on every render.
- Import/export .lbx files works end-to-end
- Property panel: kit `PropertyField`s in a `PropertyList pack="pairs"`
  (barcode fields in `src/BarcodeFields.tsx`). Numbers show in pt at one
  decimal (0.035mm, finer than a 180dpi dot) via `src/numberDisplay.ts`; the
  kit's typed field holds the raw text while focused, so rounding never
  rewrites typing. With several objects selected, X/Y/W/H show the shared
  value or "Mixed" (the field's own `mixed`), and typing sets all of them in
  one undo step.
- Arrange panel (`src/ArrangePanel.tsx`, math in `src/arrange.ts`): align
  edges/centers and match width/height to the key object, the selection's
  bounds, or the label (its length by the printable band). The key object is
  the last one added to the selection and doesn't move. Match keeps each
  item's top-left corner, as typing W/H does. Written app-side rather than on
  the kit's `useAlign` because its `{ node }` reference type and align icons
  are `@experimental` — so align draws `src/arrangeIcons.tsx`, while match
  size uses ui's public `WiderIcon`/`TallerIcon`/`FitStretchIcon`.
- Layers panel (`src/LayersPanel.tsx`): the kit's `useSceneLayerList` into a
  `LayerList`, frontmost first; a row click selects, a drag restacks as one
  undo step. No visibility toggle — neither print nor .lbx could honor it.
  Stacking order is `scene.roots` (back to front), *not* `scene.nodes`, which
  stays in insertion order through a restack; export reads `roots`.
- Canvas previews the loaded cassette's tape/ink colors from live printer
  status (`src/tapeColors.ts`); the Debug panel has the enable
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
  up on the chip within seconds. Chip, Printer panel and status bar all read
  `usePrinterSummary` (`src/printerStatus.ts`).
- Printer panel: status chip (same component as the toolbar's), Auto cut,
  Print preview, Printable margins, and the Dithering selector; future
  printer controls land there.
- Preferences modal (toolbar gear → kit `PrefsDialog`, schema in
  `src/prefs.ts`): a second live view over the same persisted settings the
  panels edit (Auto cut, Print preview, Dithering, Cassette colors).
- Print preview: runs the real print pipeline (renderLabelToRgba →
  ditherToMask) on each committed scene change and draws the ink dots over
  the printable band (ink color, transparent elsewhere) while suppressing
  the live scene draw. The Dithering choice (threshold / Floyd–Steinberg /
  Atkinson / Bayer) feeds preview and print job alike.
- Dither protection: `src/ditherProtect.ts` turns protected objects into
  dot-space rects and passes them as obwat's `DitherOptions.protect`, which
  quantizes those pixels at plain threshold and stops error diffusion at
  their boundary. Dithering is for tone; a barcode's geometry is its payload,
  and diffusion carries a bar edge's error into the bar beside it. Barcodes
  are always protected (pose plus quiet zone); every other object follows its
  "Don't dither" flag (`noDither`, app-only — not in .lbx), which defaults on
  for everything but images (`isDitherProtected` in `src/dotSnap.ts`).
- Barcodes print on whole printer dots (`src/dotSnap.ts`). Each module is a
  whole number of dots — `snapNodePose`, which every path that sizes a
  barcode goes through: the resize behavior on `selectTool.resize`, typed
  W/H, match size, insert, import, and edits that change the module count.
  And the barcode is *drawn* onto the dot grid (`gridAligned`, grid origin at
  x = 0 and the printable band's top), because a symbol half a dot off the
  grid puts every edge at 50% coverage, which the threshold resolves
  differently bar to bar. Position is snapped at draw time rather than in the
  pose so that move, nudge, paste and align need no hooks. Measured on the
  print raster: runs went from a 1..8-dot mix to 2,4,6,8. Lines and
  rectangles can opt into whole-dot strokes (`snapStroke`), stored snapped.
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
  (`quietZonePt`). **Each encoder states its own**, per side, as a `QuietZone`
  in module units on the symbol it returns — the flat per-kind constants
  couldn't survive a DataMatrix, which asks for 1 module where QR asks for 4.
  The 1D values are the GS1 minima (10/10, and the EAN family's asymmetric
  11/7, 7/7, 9/9, 9/7), cross-checked against BWIPP's per-symbology
  `borderleft`/`borderright`; `encode.test.ts` pins all of them, because
  TypeScript enforces that the field exists, not that it's sane. 1D symbols
  have **no vertical** quiet zone: the standards' requirement above and below
  the bars is bar *height*, not blank margin. No encoder bakes a quiet zone
  into its `totalModules` — `encode.test.ts` pins that too, because
  `barcodeModulePt` is `pose.width / totalModules`, so whatever that counts is
  what the pose means. Measured against a P-touch-authored file: under the
  `margin="false"` we always export, P-touch's object box is the bars alone.
  (The EAN family used to bake in 9, drawing ~19% narrow and double-counting
  its quiet zone in the background and the dither-protected region.)
- DataMatrix (ECC200, square, ASCII encodation) and PDF417 (byte compaction)
  encode in `src/barcode/`, each diffed module-for-module against bwip-js —
  DataMatrix across every size it emits, PDF417 across free, pinned-width and
  pinned-shape layouts. Both are decomposed so each piece is testable alone
  (field arithmetic, size table, encodation, bit placement / codeword table,
  compaction, layout, assembly). Two limits worth knowing: DataMatrix stops at
  one data region — 44 codewords, ~88 digits — and fails closed above that
  rather than emitting a symbol that looks right and scans as nothing; and
  ASCII-only encodation means an uppercase-heavy payload draws a larger symbol
  than a mode-switching encoder would (both valid, both decode the same).
  MaxiCode and GS1 DataBar still fail closed, for opposite reasons: MaxiCode is
  a fixed 26.9mm tall against an 18.1mm printable band, and DataBar has neither
  a working oracle nor an obtainable sample of an unstacked variant. Both say
  so rather than reporting a bare protocol name, and the property panel shows
  that reason rather than its own.
- A 2D barcode's pose means the symbol; P-touch's object box means the symbol
  plus a flat 2 modules of quiet zone per side. `src/barcode/poseBox.ts`
  converts at the file boundary, so one convention holds inside the app.
  Before it, every imported P-touch 2D barcode drew `(n + 4) / n` too large —
  19% for a 21-module QR, 33% for a 12-module DataMatrix. Not to be confused
  with `Symbol2D.quiet` above: that's the symbology's scanning requirement
  (QR 4, DataMatrix 1, PDF417 2), and neither is this 2. Measured from
  `test/fixtures/barcode2.lbx`, which `lbxImport.test.ts` round-trips.
- Export restates the pose as a module size under whichever attribute the
  symbology uses — `barWidth`, `qrcodeStyle cellSize`, `datamatrixStyle
  cellSize`, `pdf417Style width` — because P-touch redraws from that rather
  than from the box. PDF417 additionally exports the `row` and `column` it was
  drawn with instead of `auto`, since P-touch's automatic choice is not ours.
  `eccLevel` stays `auto` deliberately: those four fields fix the drawn size,
  and the level only moves the padding/ECC boundary inside a matrix they
  already decided.
- Document checks (`src/diagnostics.ts`, pure: document state in, findings
  out) report what the canvas *can't*: a barcode whose modules fall under 1
  printer dot (error) or 2 (warning), an object overhanging the printable band
  or the label length, and a QR the file asks for in a model we don't encode
  (`qr-model-substituted` — `qrcode-generator` builds Model 2 only, so a
  Model 1 file draws and prints as Model 2). That's the entry criterion: every
  check is a thing the canvas draws correctly and therefore cannot show as
  wrong. It is also why `model` has no control in the property panel — one
  would change the exported file while the screen kept drawing Model 2. The
  findings surface as anchored callouts; presentation and the pref gating them
  live in App.tsx.
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
  `src/useLiveLength.ts` subscribes to its gesture layer
  (`subscribeGestures`/`getGestureVersion`) and refits on each
  dispatcher pump. Covers move, resize, rotate and create-drag. The fit is
  still a per-node union over `getEffectiveBounds`, which reports the proposed
  pose for nodes under the gesture and the committed pose for the rest —
  `getGestureBounds` can't replace it, because unioning what the gesture
  proposes with the committed scene would pin the label to the dragged node's
  *old* pose and a leftward drag could never shrink it. What
  `getGestureBounds` uniquely adds is the create-drag rect, which lives in the
  dispatcher's overlay under no node id; it also reports null for a marquee,
  so a selection sweep no longer refits at all. The live
  value reaches ONLY what's drawn — paper layer, printable clip, view fit,
  and the read-only Length readout —
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
