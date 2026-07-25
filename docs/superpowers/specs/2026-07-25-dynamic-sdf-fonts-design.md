# Dynamic canvas-sourced SDF fonts — design

Date: 2026-07-25
Status: approved (brainstorm); implement from a fresh session
Builds on: `2026-07-25-msdf-text-design.md` (shipped)

## Goal

Render text in any font installed on the machine — no atlas baking, no font
files — via runtime single-channel SDF glyphs (TinySDF technique: canvas
rasterize → distance transform), while keeping baked MSDF atlases as the
first-class, higher-quality tier.

## Why

- Imported .lbx files reference machine fonts (Futura, Helvetica Neue
  Condensed, Univers…). Baked MSDF covers them only after manual extraction
  and baking (`docs/local-fonts.md`); dynamic SDF makes them just work.
- Canvas `fillText` can rasterize *installed* fonts that the web platform
  exposes no outlines for — this is the only route to installed-font
  support. (True-MSDF-at-runtime via msdfgen-WASM needs font bytes and is a
  separate future upgrade — "Route B" — behind the same atlas manager.)

## Placement decision

All rendering machinery lands in **weasel** (atlas manager, resolver tier,
shader, layout support): an app-side baker would need to inject into
weasel's internal glyph registry — exactly the internal-surface leak the
project forbids — and every kit consumer benefits. lbx-editor keeps only
policy (which families to offer, print-fidelity warnings).

## Weasel changes

### Public API

- `registerCanvasFont(family: string): void` — mark a family as
  canvas-sourced. `isCanvasFont(family)`, `unregisterCanvasFont(family)`
  (possible here because nothing is fetched or uploaded ahead of time).
- Variant resolution order (in `resolveFontVariant`): baked MSDF atlas
  (exact → nearest, with existing synthetic bold/italic) → canvas-dynamic
  if registered → warn-and-skip (today's behavior). **Baked always wins**;
  existing consumers and quality are untouched.

### `DynamicGlyphAtlas` (renderer)

- Single-channel R8 texture pages, 1024² each; shelf packing; glyphs keyed
  `family|weight|style|codepoint`.
- Bake: OffscreenCanvas `fillText` at 48 px + 8 px padding → Euclidean
  distance transform (Felzenszwalb 1D×2 passes, pure JS, no dependencies)
  → `texSubImage2D` patch upload.
- V1 cap: 4 pages (4 MB GPU); console.warn at cap; no eviction. A label
  document cannot plausibly need ~16k distinct glyphs.

### Bake scheduling — synchronous with a frame budget

Per-glyph bake cost at 48 px is well under 1 ms. Bake synchronously on
glyph miss, budgeted (~16 glyphs/frame); overflow queues and triggers a
redraw when ready via the same notify-and-redraw plumbing the kit
`imageCache` uses. No worker, no threading subsystem.

Headless consequence: `renderSceneToPixels` bakes all missing glyphs
inline before drawing — no async gap, so print stays WYSIWYG on the
machine doing the printing.

### Metrics & layout

- Advance: `measureText` per glyph, cached. Vertical metrics:
  `fontBoundingBoxAscent/Descent`.
- No kerning in v1 (see Future work — measured-pair kerning is cheap).
- `layoutRuns` consumes dynamic families through the same per-run resolver
  handle as atlas fonts; groups carry their source so the renderer picks
  the right shader per group.

### Shader

Single-channel sibling of `textSdf` (sample R instead of median-of-RGB).
Accepted trade: slight corner rounding at extreme zoom — invisible at
label print resolution (180 dpi thermal + dithering).

## lbx-editor changes

- `substituteFontFamily` gains a middle tier: exact registered (baked)
  match → **installed check** (`document.fonts.check('12px "<name>"')`) →
  `registerCanvasFont(name)` and render the real font → else existing
  substitution table/heuristic.
- Font dropdown: an "installed (this machine)" group for
  canvas-registered families alongside the baked ones.
- Print flow: one-line notice when the document uses canvas-sourced fonts
  ("prints correctly here; other machines without <font> will substitute").
- Custom-font upload + local manifest remain the portable/high-quality
  tier; nothing about them changes.

## Testing

- Weasel: distance-transform unit tests (known shapes → expected field
  values); shelf-packing unit tests (fill, overflow to new page, cap
  warning); resolver-order tests (baked beats dynamic beats warn);
  budget/queue test (N+K glyph misses → N baked this pass, K after
  notify); headless test that `renderSceneToPixels` output contains glyphs
  for a canvas-registered family (jsdom-free — needs the GL/OffscreenCanvas
  environment of the visual suite).
- lbx-editor: substitution middle-tier unit tests with `document.fonts`
  mocked; visual check on a real imported fixture with no local manifest.

## Out of scope (v1)

- Kerning for dynamic glyphs, IndexedDB glyph cache, `queryLocalFonts`
  enumeration — costed in Future work below.
- msdfgen-WASM runtime baking (Route B): future quality upgrade reusing
  `DynamicGlyphAtlas`'s management, feeding MSDF patches instead.
- Eviction/LRU for atlas pages.

## Future work — cost estimates

1. **Measured-pair kerning (~1 day, low risk).** Canvas applies kerning
   inside `measureText` on whole strings, so
   `measure("AV") − (measure("A") + measure("V"))` recovers the pair
   adjustment without any font-table access. Add a memoized
   `kernFor(prev, curr)` to the dynamic handle, populated lazily for pairs
   actually encountered. Cost is one cache + a resolver-handle method;
   ligatures remain out. Recommended as the first fast-follow — it closes
   most of the visible quality gap to baked atlases.
2. **IndexedDB glyph cache (~1 day code, real correctness risk, ~zero
   payoff).** Bakes are sub-millisecond; the cache saves nothing
   perceptible while adding a staleness hazard (machine font updated →
   stale glyphs, requiring a fingerprint heuristic to invalidate).
   Recommend never, absent measured need.
3. **`queryLocalFonts` dropdown enumeration (~half a day, Chromium-only).**
   Permission-gated API listing installed families; feature-detect and
   fall back to the check-based flow elsewhere. Bonus: it exposes raw font
   *bytes* (`FontData.blob()`), which is the missing input for Route B —
   worth doing when/if Route B is scheduled, marginal before then.
