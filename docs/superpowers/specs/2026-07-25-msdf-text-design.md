# MSDF text migration — design

Date: 2026-07-25
Status: approved (brainstorm), pending implementation plan

## Goal

Replace the canvas-rasterizer text path (`src/textRender.ts` +
`src/textBitmapCache.ts`, drawn as image commands) with weasel's MSDF text
pipeline, on both screen and print. Print and screen share `drawLabelNode`
through `renderLabelToRgba` → `renderSceneToPixels`, so both convert in the
same change and WYSIWYG is preserved by construction.

## Why

- Resolution-independent glyphs at every zoom (no 4× bitmap-cache softening),
  no cache memory/invalidation.
- Deliberate font substitution instead of silent browser fallback: real .lbx
  files reference machine fonts (Helvetica Neue Condensed Bold, Futura
  Condensed, Univers LT Std 57 Cn) that browsers don't have.
- Text becomes a first-class weasel citizen (layout, kerning, future
  rich-text runs ride the kit).

## Decisions (made during brainstorm)

1. **Fonts:** curated open set bundled in lbx-editor + tooling to bake
   personal machine-font atlases locally (options 1+3).
2. **Tooling home:** atlas generator restored in weasel (`scripts/gen-font.ts`,
   per weasel's own TODO); personal atlases live gitignored in lbx-editor.
3. **Layout:** adopt weasel word-wrap (box width as `maxWidth`). `\n` still
   forces breaks; JUSTIFY still renders as LEFT.
4. **Font UI:** Property panel font family becomes a dropdown of registered
   families.
5. **Integration shape (approach C):** weasel's text command learns box
   vertical alignment natively; the app emits one text command with no
   app-side baseline math.

## Weasel changes (all public surface; no `@internal` leakage)

- **`TextDrawCommand`**: optional `height?: number` and
  `verticalAlign?: 'top' | 'center' | 'bottom'` (default `'top'` = current
  behavior; existing consumers unaffected). `drawText` shifts the laid-out
  block by `(height − bounds.height) × {0, ½, 1}` using the bounds
  `layoutRuns` already returns. `textCommand` builder and `createTextLayer`
  forward both (the layer already has the pose's height).
- **`measureTextBounds(text, style?, opts?)`**: new
  `opts: { maxWidth?, lineHeight? }` so wrapped height is measurable
  publicly.
- **`scripts/gen-font.ts`**: restored atlas generator wrapping
  `msdf-bmfont-xml` (already a devDependency). Input TTF/OTF + charset +
  variant flags; output BmFont JSON + atlas PNG, exactly what
  `registerFont(family, variant, metricsUrl, atlasUrl)` consumes.
- Fix README's stale 2-arg `registerFont` example.

## Fonts

**Bundled (committed, `public/fonts/` in lbx-editor):**

| Family | Niche | Stands in for |
|---|---|---|
| Inter | default / general sans | Arial, Helvetica |
| Barlow Condensed | condensed sans | Helvetica Neue Condensed, Univers Cn, Futura Condensed |
| JetBrains Mono | monospace | part-number labels (optional; cut if unwanted) |

Each family: regular (400) + bold (700) atlases; italic via weasel's
synthetic-italic skew. Charset: printable ASCII + Latin-1 supplement.

**Substitution map (`src/fonts.ts`):** .lbx font name → registered family.
Exact-name match first, then heuristic (name contains "Cond"/"Cn" → Barlow
Condensed; else Inter). Node `fontFamily` data is never rewritten —
substitution happens at draw/measure time; export round-trips the original
name.

**Local atlases:** `public/fonts/local/` (gitignored) + `manifest.json`
(family/weight/style/filenames). Startup fetches the manifest (404 → skip),
registers entries; locally registered families win over the heuristic.

**Startup:** one `registerFonts()` kicked off at app startup (parallel
fetches); rendering does not block on it. Until it resolves, text nodes paint
no glyphs (weasel warns, doesn't crash); a redraw on resolution fills them in.
Print and preview `await registerFonts()` before rasterizing, so the print
path never runs with unregistered fonts.

## lbx-editor changes

- **`drawLabelNode` text case:** emit `kind:'text'` with x/y from pose,
  `maxWidth` = box width, `height` + `verticalAlign` from pose/node data,
  style from substituted family + size/weight/italic/color (post ink-remap).
  H-align LEFT/CENTER/RIGHT → `left/center/right`; JUSTIFY → `left`.
- **Delete** `textBitmapCache.ts`; retire `drawLabelText`, `lineLayout`,
  `cssFont`, and the 1.2/0.8 layout constants (atlas metrics own layout).
  `textLines` survives only if something still needs it. Tests retire with
  them.
- **Property panel:** font family select of registered families. A node whose
  stored name isn't registered shows a distinct substitution entry
  ("Univers LT Std 57 Cn → Barlow Condensed") keeping the original name
  selectable/exportable; picking a real family overwrites node data. Weight
  stays numeric; italic checkbox unchanged.
- **No data-format changes:** autosave, .lbx import/export untouched.

## Accepted visual changes at switchover

- All text reflows to atlas metrics (different from canvas `fillText`).
- Long lines wrap at the box instead of overflowing.
- Unavailable fonts render in a deliberate substitute, not browser fallback.

## Testing

- Weasel: unit tests for `verticalAlign` offsets and `measureTextBounds`
  with `maxWidth`; extend `tests/visual/render-to-pixels.spec.ts` with a
  box-aligned case; `gen-font` smoke test (tiny charset → `parseBmFont`).
- lbx-editor: substitution-map unit tests; existing `labelRender` geometry
  tests unchanged; end-to-end via the `/verify` skill (headless print-raster
  capture) plus on-screen review of imported fixtures.

## Risks

- Glyph coverage: missing chars render `?` (mitigated: Latin-1 charset).
- One-frame-ish blank text before fonts register (accepted).
- Print raster changes what the ditherer sees; crisper edges likely help the
  known diagonal-stepping issue, but verify with a real print.
- Rollback is cheap: the old path is two files restorable from git.

## Out of scope

- Rich-text runs / per-run styling in label text.
- JUSTIFY spacing.
- An in-app "add font" upload UI (local manifest covers the need).
- Complex-script shaping (weasel TODO).
