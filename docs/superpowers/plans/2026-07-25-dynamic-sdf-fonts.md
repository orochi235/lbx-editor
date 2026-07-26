# Dynamic Canvas-Sourced SDF Fonts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render text in any font installed on the machine — no atlas baking — via runtime single-channel SDF glyphs (canvas `fillText` → Euclidean distance transform → R8 texture pages), as a fallback tier below baked MSDF atlases.

**Architecture:** All rendering machinery lands in **weasel** (`~/src/weasel`): a `dynamic/` module beside the existing `atlas/` MSDF code exposes `registerCanvasFont` and produces lazily-populated BmFont-shaped faces that `layoutRuns` consumes through the existing `ResolveResult` handle; groups carry a `source`/`page` discriminant that routes to a new single-channel R8 sibling of the `textSdf` shader. Bakes are synchronous with a per-frame budget (16 glyphs); overflow queues and redraws via the same subscribe/notify pattern as `imageCache`. Headless `renderSceneToPixels` bakes with an unlimited budget, so print stays WYSIWYG. **lbx-editor** keeps only policy: a `document.fonts.check` middle tier in `substituteFontFamily`, an "Installed (this machine)" dropdown group, and a print notice.

**Tech Stack:** TypeScript, WebGL2 (R8/`gl.RED` textures, `texSubImage2D` patches), OffscreenCanvas 2D, Felzenszwalb 1D×2 EDT (pure JS, no deps), Vitest (jsdom, `--project=kit`), Playwright visual suite.

**Spec:** `docs/superpowers/specs/2026-07-25-dynamic-sdf-fonts-design.md`

**Repos & branches:** Tasks 1–11 run in `~/src/weasel` (branch `dynamic-sdf-fonts`), Tasks 12–14 in `~/src/lbx-editor` (branch `dynamic-sdf-fonts`). lbx-editor consumes weasel source live via `weaselAliases()`, so no build/publish step between repos. Create each branch before that repo's first task (`git switch -c dynamic-sdf-fonts`).

---

## Key existing code (orientation for a zero-context engineer)

| What | Where |
|---|---|
| Font registry, `resolveFontVariant`, `ResolveResult` | `~/src/weasel/src/features/text/atlas/registerFont.ts` |
| `BmFont`/`BmFontChar` types | `~/src/weasel/src/features/text/atlas/FontAtlas.ts:12-44` |
| Layout (`layoutRuns`, `LaidOutGroup`) | `~/src/weasel/src/features/text/atlas/layoutRuns.ts` |
| MSDF shader sources | `~/src/weasel/src/renderer/shaders/textSdf.ts` |
| GL texture cache (string-keyed) | `~/src/weasel/src/renderer/cache/GLTextureCache.ts` |
| Text draw dispatch | `~/src/weasel/src/renderer/draw.ts:793-909` |
| Renderer program build/dispose/ctx | `~/src/weasel/src/renderer/WeaselRenderer.ts:148-176, 269-283, 343-357, 371-392, 415-428` |
| Headless render | `~/src/weasel/src/canvas/renderSceneToPixels.ts:185-231` |
| notify-and-redraw pattern to clone | `~/src/weasel/src/features/images/imageCache.ts` + `SceneCanvas.tsx:847-852` |
| Public barrel font export | `~/src/weasel/src/index.ts:961` (also `src/renderer/index.ts:23`) |
| lbx-editor substitution | `~/src/lbx-editor/src/fonts.ts:34-72` |
| lbx-editor font dropdown | `~/src/lbx-editor/src/PropertyPanel.tsx:95-121` |
| lbx-editor print flow | `~/src/lbx-editor/src/App.tsx:859-938` |

Weasel unit tests: `npm run test:kit` (Vitest, jsdom, **no real GL** — `vitest.setup.ts` stubs `getContext('webgl2')` to null). Single file: `npx vitest run --project=kit <path>`. Visual suite (real Chromium GL): `npm run test:visual`.

**SDF encoding convention (used throughout):** bake at 48 px with 8 px padding; distance mapped as `byte = round(255 − 255·(dist/radius + cutoff))` with `radius = 8`, `cutoff = 0.5`, so the glyph edge encodes at ~128 and the existing shader threshold of 0.5 (and the `u_synthBold` threshold shift) works unchanged.

---

### Task 1: Distance transform (`alphaToSdf`)

**Files:**
- Create: `~/src/weasel/src/features/text/dynamic/distanceTransform.ts`
- Test: `~/src/weasel/src/features/text/dynamic/distanceTransform.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ~/src/weasel/src/features/text/dynamic/distanceTransform.test.ts
import { describe, it, expect } from 'vitest';
import { alphaToSdf } from './distanceTransform';

/** w×h alpha bitmap with the rect [x0,x1)×[y0,y1) filled solid. */
function filledRect(
  w: number, h: number, x0: number, y0: number, x1: number, y1: number,
): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) a[y * w + x] = 255;
  }
  return a;
}

describe('alphaToSdf', () => {
  it('returns all zeros for empty input', () => {
    const sdf = alphaToSdf(new Uint8ClampedArray(16 * 16), 16, 16, 8, 0.5);
    expect(sdf.length).toBe(16 * 16);
    expect(sdf.every((v) => v === 0)).toBe(true);
  });

  it('saturates deep inside and zeroes far outside a filled square', () => {
    const sdf = alphaToSdf(filledRect(32, 32, 8, 8, 24, 24), 32, 32, 8, 0.5);
    // Center of the 16×16 square is ~8px from the nearest edge:
    // value = 255 - 255*(-8/8 + 0.5) = 382 → clamps to 255.
    expect(sdf[16 * 32 + 16]).toBeGreaterThan(240);
    // Corner (1,1) is ~9.9px outside → negative → clamps to 0.
    expect(sdf[1 * 32 + 1]).toBe(0);
  });

  it('encodes the edge at ~0.5 (byte 128)', () => {
    const sdf = alphaToSdf(filledRect(32, 32, 8, 8, 24, 24), 32, 32, 8, 0.5);
    // Row through the middle: first filled column x=8 (inner dist 1 →
    // d=-1 → 159), last empty column x=7 (outer dist 1 → d=+1 → 96).
    expect(sdf[16 * 32 + 8]).toBeGreaterThan(128);
    expect(sdf[16 * 32 + 7]).toBeLessThan(128);
  });

  it('is monotonically non-decreasing approaching the shape', () => {
    const sdf = alphaToSdf(filledRect(32, 32, 8, 8, 24, 24), 32, 32, 8, 0.5);
    for (let x = 1; x <= 16; x++) {
      expect(sdf[16 * 32 + x]).toBeGreaterThanOrEqual(sdf[16 * 32 + x - 1]);
    }
  });

  it('is symmetric for a symmetric shape', () => {
    const sdf = alphaToSdf(filledRect(32, 32, 8, 8, 24, 24), 32, 32, 8, 0.5);
    // Square spans columns [8,24): column 7 mirrors column 24 across the
    // center line x=15.5.
    expect(sdf[16 * 32 + 7]).toBe(sdf[16 * 32 + 24]);
    expect(sdf[16 * 32 + 10]).toBe(sdf[16 * 32 + 21]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/dynamic/distanceTransform.test.ts`
Expected: FAIL — cannot resolve `./distanceTransform`.

- [ ] **Step 3: Write the implementation**

```ts
// ~/src/weasel/src/features/text/dynamic/distanceTransform.ts
/**
 * Euclidean distance transform for runtime SDF glyph baking (the TinySDF
 * technique): antialiased canvas coverage in → single-channel SDF bytes out.
 *
 * Uses Felzenszwalb & Huttenlocher's 1D squared-distance transform applied
 * along columns then rows. Pure JS, no dependencies, no allocation beyond
 * the work arrays sized to the input.
 */

const INF = 1e20;

/** One 1D pass of the squared EDT (Felzenszwalb & Huttenlocher 2012, §2). */
function edt1d(
  f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array, n: number,
): void {
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  let k = 0;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** In-place 2D squared EDT over `grid` (width × height): columns, then rows. */
function edt2d(
  grid: Float64Array, width: number, height: number,
  f: Float64Array, d: Float64Array, v: Int32Array, z: Float64Array,
): void {
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x];
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x];
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x];
  }
}

/**
 * Convert an alpha-coverage bitmap (0–255) to single-channel SDF bytes.
 * Signed distance is positive outside the shape; the output maps it as
 * `255 − 255·(dist/radius + cutoff)` clamped to [0,255], so with
 * cutoff 0.5 the shape edge lands at byte ~128 (shader threshold 0.5).
 */
export function alphaToSdf(
  alpha: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  radius: number,
  cutoff: number,
): Uint8Array {
  const n = width * height;
  const gridOuter = new Float64Array(n);
  const gridInner = new Float64Array(n);
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);

  for (let i = 0; i < n; i++) {
    const a = alpha[i] / 255;
    gridOuter[i] = a === 1 ? 0 : a === 0 ? INF : Math.max(0, 0.5 - a) ** 2;
    gridInner[i] = a === 1 ? INF : a === 0 ? 0 : Math.max(0, a - 0.5) ** 2;
  }
  edt2d(gridOuter, width, height, f, d, v, z);
  edt2d(gridInner, width, height, f, d, v, z);

  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const dist = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i]);
    const byte = Math.round(255 - 255 * (dist / radius + cutoff));
    out[i] = byte < 0 ? 0 : byte > 255 ? 255 : byte;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/dynamic/distanceTransform.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/src/weasel
git add src/features/text/dynamic/distanceTransform.ts src/features/text/dynamic/distanceTransform.test.ts
git commit -m "feat(text): Felzenszwalb EDT for runtime SDF glyph baking"
```

---

### Task 2: Shelf packer

**Files:**
- Create: `~/src/weasel/src/features/text/dynamic/shelfPack.ts`
- Test: `~/src/weasel/src/features/text/dynamic/shelfPack.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ~/src/weasel/src/features/text/dynamic/shelfPack.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ShelfPacker } from './shelfPack';

afterEach(() => vi.restoreAllMocks());

describe('ShelfPacker', () => {
  it('packs left-to-right on a shelf', () => {
    const p = new ShelfPacker(64, 4);
    expect(p.alloc(10, 10)).toEqual({ page: 0, x: 0, y: 0 });
    expect(p.alloc(10, 10)).toEqual({ page: 0, x: 10, y: 0 });
    expect(p.pageCount).toBe(1);
  });

  it('opens a new shelf when a row fills', () => {
    const p = new ShelfPacker(32, 4);
    expect(p.alloc(20, 10)).toEqual({ page: 0, x: 0, y: 0 });
    expect(p.alloc(20, 10)).toEqual({ page: 0, x: 0, y: 10 });
  });

  it('puts a taller glyph on its own shelf but backfills shorter ones', () => {
    const p = new ShelfPacker(64, 4);
    expect(p.alloc(10, 10)).toEqual({ page: 0, x: 0, y: 0 });
    expect(p.alloc(10, 20)).toEqual({ page: 0, x: 0, y: 10 });
    // Fits back on the first (height-10) shelf.
    expect(p.alloc(10, 10)).toEqual({ page: 0, x: 10, y: 0 });
  });

  it('overflows to a new page when vertical space runs out', () => {
    const p = new ShelfPacker(16, 2);
    expect(p.alloc(16, 16)).toEqual({ page: 0, x: 0, y: 0 });
    expect(p.alloc(16, 16)).toEqual({ page: 1, x: 0, y: 0 });
    expect(p.pageCount).toBe(2);
  });

  it('returns null and warns exactly once at the page cap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new ShelfPacker(16, 1);
    expect(p.alloc(16, 16)).toEqual({ page: 0, x: 0, y: 0 });
    expect(p.alloc(16, 16)).toBeNull();
    expect(p.alloc(4, 4)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('rejects rects larger than a page without creating pages', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new ShelfPacker(16, 4);
    expect(p.alloc(17, 4)).toBeNull();
    expect(p.pageCount).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/dynamic/shelfPack.test.ts`
Expected: FAIL — cannot resolve `./shelfPack`.

- [ ] **Step 3: Write the implementation**

```ts
// ~/src/weasel/src/features/text/dynamic/shelfPack.ts
/**
 * Shelf packer for the dynamic glyph atlas: fixed-size square pages, rows
 * ("shelves") of same-ish-height rects filled left to right. Simple and
 * good enough for glyph rects; no rotation, no eviction (v1).
 */

export interface ShelfAlloc {
  page: number;
  x: number;
  y: number;
}

interface Shelf { y: number; height: number; x: number; }
interface Page { shelves: Shelf[]; nextY: number; }

export class ShelfPacker {
  private pages: Page[] = [];
  private warned = false;

  constructor(
    private readonly pageSize: number,
    private readonly maxPages: number,
  ) {}

  get pageCount(): number {
    return this.pages.length;
  }

  /** Allocate a w×h rect. Returns null (warning once) when capacity is out. */
  alloc(w: number, h: number): ShelfAlloc | null {
    if (w > this.pageSize || h > this.pageSize) return this.fail();
    for (let p = 0; p < this.pages.length; p++) {
      const spot = this.allocInPage(this.pages[p], w, h);
      if (spot) return { page: p, ...spot };
    }
    if (this.pages.length < this.maxPages) {
      const page: Page = { shelves: [], nextY: 0 };
      this.pages.push(page);
      const spot = this.allocInPage(page, w, h);
      if (spot) return { page: this.pages.length - 1, ...spot };
    }
    return this.fail();
  }

  private allocInPage(page: Page, w: number, h: number): { x: number; y: number } | null {
    for (const shelf of page.shelves) {
      if (h <= shelf.height && shelf.x + w <= this.pageSize) {
        const x = shelf.x;
        shelf.x += w;
        return { x, y: shelf.y };
      }
    }
    if (page.nextY + h <= this.pageSize) {
      const shelf: Shelf = { y: page.nextY, height: h, x: w };
      page.shelves.push(shelf);
      page.nextY += h;
      return { x: 0, y: shelf.y };
    }
    return null;
  }

  private fail(): null {
    if (!this.warned) {
      this.warned = true;
      console.warn(
        `weasel DynamicGlyphAtlas: glyph pages full (${this.maxPages} × ${this.pageSize}²); ` +
        'further dynamic glyphs will not render.',
      );
    }
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/dynamic/shelfPack.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
cd ~/src/weasel
git add src/features/text/dynamic/shelfPack.ts src/features/text/dynamic/shelfPack.test.ts
git commit -m "feat(text): shelf packer for dynamic glyph atlas pages"
```

---

### Task 3: Glyph rasterizer (canvas measure + fillText)

The one environment-bound module. Unit tests can't exercise it (jsdom has no canvas 2D metrics); it is verified by typecheck here and end-to-end by the Playwright visual test (Task 11). Everything downstream tests against the injectable `GlyphRasterizer` interface.

**Files:**
- Create: `~/src/weasel/src/features/text/dynamic/glyphRasterizer.ts`

- [ ] **Step 1: Write the module**

```ts
// ~/src/weasel/src/features/text/dynamic/glyphRasterizer.ts
/**
 * Canvas-2D glyph rasterizer for the dynamic SDF atlas. `fillText` is the
 * only web-platform route to *installed* machine fonts (no outline access),
 * which is exactly why this tier exists.
 *
 * Coordinate contract (all values in bake-size px, i.e. at BAKE_SIZE):
 *   bitmap left  = penX + left      (left is negative: pad + left bearing)
 *   bitmap top   = baseline − top   (top is positive above the baseline)
 *   pen advance  = advance
 * The bitmap includes a PAD border on all four sides so the SDF field has
 * room to fall off. Blank glyphs (e.g. space) return width/height 0.
 */

export const BAKE_SIZE = 48;
export const PAD = 8;

export interface FaceMetrics {
  ascent: number;
  descent: number;
}

export interface RasterizedGlyph {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
  left: number;
  top: number;
  advance: number;
}

export interface GlyphRasterizer {
  faceMetrics(family: string, weight: number, style: 'normal' | 'italic'): FaceMetrics;
  rasterize(
    family: string, weight: number, style: 'normal' | 'italic', codepoint: number,
  ): RasterizedGlyph;
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function cssFontString(weight: number, style: 'normal' | 'italic', family: string): string {
  return `${style === 'italic' ? 'italic ' : ''}${weight} ${BAKE_SIZE}px ${JSON.stringify(family)}`;
}

export function createCanvasRasterizer(): GlyphRasterizer {
  let canvas: OffscreenCanvas | HTMLCanvasElement;
  if (typeof OffscreenCanvas !== 'undefined') {
    canvas = new OffscreenCanvas(BAKE_SIZE * 3, BAKE_SIZE * 3);
  } else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas');
    canvas.width = BAKE_SIZE * 3;
    canvas.height = BAKE_SIZE * 3;
  } else {
    throw new Error('weasel DynamicGlyphAtlas: no canvas available for glyph rasterization');
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as Canvas2D | null;
  if (!ctx) throw new Error('weasel DynamicGlyphAtlas: 2D context unavailable');

  function setFont(family: string, weight: number, style: 'normal' | 'italic'): void {
    ctx!.font = cssFontString(weight, style, family);
    ctx!.textBaseline = 'alphabetic';
    ctx!.textAlign = 'left';
  }

  return {
    faceMetrics(family, weight, style) {
      setFont(family, weight, style);
      const m = ctx!.measureText('Hg');
      return {
        ascent: m.fontBoundingBoxAscent ?? BAKE_SIZE * 0.8,
        descent: m.fontBoundingBoxDescent ?? BAKE_SIZE * 0.2,
      };
    },

    rasterize(family, weight, style, codepoint) {
      setFont(family, weight, style);
      const chStr = String.fromCodePoint(codepoint);
      const m = ctx!.measureText(chStr);
      const advance = m.width;
      const inkLeft = Math.ceil(m.actualBoundingBoxLeft ?? 0);
      const inkRight = Math.ceil(m.actualBoundingBoxRight ?? advance);
      const inkAscent = Math.ceil(m.actualBoundingBoxAscent ?? BAKE_SIZE * 0.8);
      const inkDescent = Math.ceil(m.actualBoundingBoxDescent ?? BAKE_SIZE * 0.2);
      const inkW = inkLeft + inkRight;
      const inkH = inkAscent + inkDescent;
      if (inkW <= 0 || inkH <= 0) {
        return { width: 0, height: 0, alpha: new Uint8ClampedArray(0), left: 0, top: 0, advance };
      }
      const w = inkW + 2 * PAD;
      const h = inkH + 2 * PAD;
      if (canvas.width < w || canvas.height < h) {
        canvas.width = Math.max(canvas.width, w);
        canvas.height = Math.max(canvas.height, h);
        setFont(family, weight, style); // resizing resets 2D state
      }
      ctx!.clearRect(0, 0, w, h);
      ctx!.fillStyle = '#fff';
      ctx!.fillText(chStr, PAD + inkLeft, PAD + inkAscent);
      const img = ctx!.getImageData(0, 0, w, h);
      const alpha = new Uint8ClampedArray(w * h);
      for (let i = 0; i < alpha.length; i++) alpha[i] = img.data[i * 4 + 3];
      return {
        width: w,
        height: h,
        alpha,
        left: -(inkLeft + PAD),
        top: inkAscent + PAD,
        advance,
      };
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd ~/src/weasel && npx tsc --noEmit`
Expected: no new errors (pre-existing errors, if any, unchanged — check `git stash && npx tsc --noEmit` for a baseline if unsure).

- [ ] **Step 3: Commit**

```bash
cd ~/src/weasel
git add src/features/text/dynamic/glyphRasterizer.ts
git commit -m "feat(text): canvas glyph rasterizer for dynamic SDF fonts"
```

---

### Task 4: `dynamicAtlas` — registry, faces, bake, pages

The stateful heart: `registerCanvasFont`/`isCanvasFont`/`unregisterCanvasFont`, per-variant faces exposing a BmFont-shaped `font` whose `charMap` grows lazily, synchronous bake into CPU-side R8 pages with a patch log. (Budget/queue/notify comes in Task 5; this task bakes everything inline.)

**Files:**
- Create: `~/src/weasel/src/features/text/dynamic/dynamicAtlas.ts`
- Test: `~/src/weasel/src/features/text/dynamic/dynamicAtlas.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// ~/src/weasel/src/features/text/dynamic/dynamicAtlas.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  registerCanvasFont, isCanvasFont, unregisterCanvasFont, getDynamicFace,
  _resetDynamicFontsForTests, __setGlyphRasterizerForTests,
  PAGE_SIZE, _getPagesForTests,
} from './dynamicAtlas';
import { BAKE_SIZE, type GlyphRasterizer } from './glyphRasterizer';

/** Deterministic fake: every glyph is a solid 20×24 box; space is blank. */
function fakeRasterizer(): GlyphRasterizer {
  return {
    faceMetrics: () => ({ ascent: 40, descent: 8 }),
    rasterize: (_family, _weight, _style, cp) => {
      if (cp === 32) {
        return { width: 0, height: 0, alpha: new Uint8ClampedArray(0), left: 0, top: 0, advance: 12 };
      }
      const w = 20, h = 24;
      return {
        width: w, height: h,
        alpha: new Uint8ClampedArray(w * h).fill(255),
        left: -8, top: 26, advance: 22,
      };
    },
  };
}

beforeEach(() => {
  _resetDynamicFontsForTests();
  __setGlyphRasterizerForTests(fakeRasterizer());
});
afterEach(() => vi.restoreAllMocks());

describe('canvas font registry', () => {
  it('register/is/unregister round-trips', () => {
    expect(isCanvasFont('Futura')).toBe(false);
    registerCanvasFont('Futura');
    expect(isCanvasFont('Futura')).toBe(true);
    unregisterCanvasFont('Futura');
    expect(isCanvasFont('Futura')).toBe(false);
  });
});

describe('getDynamicFace', () => {
  it('builds a BmFont-shaped face from canvas metrics', () => {
    const face = getDynamicFace('Futura', 400, 'normal');
    expect(face.font.info.size).toBe(BAKE_SIZE);
    expect(face.font.common.base).toBe(40);
    expect(face.font.common.lineHeight).toBe(48);
    expect(face.font.common.scaleW).toBe(PAGE_SIZE);
    expect(face.font.common.scaleH).toBe(PAGE_SIZE);
    expect(face.font.charMap.size).toBe(0);
  });

  it('caches faces per (family, weight, style)', () => {
    const a = getDynamicFace('Futura', 400, 'normal');
    expect(getDynamicFace('Futura', 400, 'normal')).toBe(a);
    expect(getDynamicFace('Futura', 700, 'normal')).not.toBe(a);
  });
});

describe('requestGlyph', () => {
  it('measures and bakes a glyph synchronously', () => {
    const face = getDynamicFace('Futura', 400, 'normal');
    const ch = face.requestGlyph(65);
    expect(ch.xadvance).toBe(22);
    expect(ch.xoffset).toBe(-8);
    expect(ch.yoffset).toBe(40 - 26); // base − top
    expect(ch.width).toBe(20);
    expect(ch.height).toBe(24);
    expect(ch.page).toBe(0);
    expect(face.requestGlyph(65)).toBe(ch); // cached record
  });

  it('writes SDF bytes into the page and logs a patch', () => {
    const face = getDynamicFace('Futura', 400, 'normal');
    const ch = face.requestGlyph(65);
    const pages = _getPagesForTests();
    expect(pages.length).toBe(1);
    expect(pages[0].version).toBe(1);
    expect(pages[0].patches).toEqual([{ seq: 1, x: ch.x, y: ch.y, w: 20, h: 24 }]);
    // Solid-alpha input → interior of the glyph rect saturates high.
    const centerIdx = (ch.y + 12) * PAGE_SIZE + ch.x + 10;
    expect(pages[0].data[centerIdx]).toBeGreaterThan(200);
  });

  it('handles blank glyphs (space) without allocating atlas space', () => {
    const face = getDynamicFace('Futura', 400, 'normal');
    const ch = face.requestGlyph(32);
    expect(ch.xadvance).toBe(12);
    expect(ch.width).toBe(0);
    expect(ch.page).toBe(0); // marked done, never queued
    expect(_getPagesForTests().length).toBe(0);
  });

  it('leaves the glyph invisible (width 0) when pages are full', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    __setGlyphRasterizerForTests({
      faceMetrics: () => ({ ascent: 40, descent: 8 }),
      rasterize: () => ({
        width: PAGE_SIZE, height: PAGE_SIZE,
        alpha: new Uint8ClampedArray(PAGE_SIZE * PAGE_SIZE).fill(255),
        left: 0, top: 0, advance: PAGE_SIZE,
      }),
    });
    const face = getDynamicFace('Big', 400, 'normal');
    for (let i = 0; i < 4; i++) expect(face.requestGlyph(65 + i).page).toBe(i);
    const fifth = face.requestGlyph(70);
    expect(fifth.page).toBe(-1);
    expect(fifth.width).toBe(0);
    expect(fifth.xadvance).toBe(PAGE_SIZE); // advance still valid
  });
});

describe('unregisterCanvasFont', () => {
  it('drops the family faces but keeps baked pages (no eviction)', () => {
    registerCanvasFont('Futura');
    const face = getDynamicFace('Futura', 400, 'normal');
    face.requestGlyph(65);
    unregisterCanvasFont('Futura');
    expect(getDynamicFace('Futura', 400, 'normal')).not.toBe(face);
    expect(_getPagesForTests().length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/dynamic/dynamicAtlas.test.ts`
Expected: FAIL — cannot resolve `./dynamicAtlas`.

- [ ] **Step 3: Write the implementation**

```ts
// ~/src/weasel/src/features/text/dynamic/dynamicAtlas.ts
/**
 * DynamicGlyphAtlas — runtime single-channel SDF glyphs for canvas-sourced
 * (installed machine) fonts. TinySDF technique: canvas fillText at 48 px →
 * Euclidean distance transform → shelf-packed R8 pages (1024², max 4).
 *
 * Baked MSDF atlases always win: this tier only serves families registered
 * via `registerCanvasFont` that have no baked entry (see resolveFontVariant).
 *
 * Faces expose a BmFont-shaped `font` whose charMap grows as glyphs are
 * requested, so `layoutRuns` consumes them through the same code path as
 * baked atlases. A char's advance is valid immediately (measureText); its
 * atlas rect fills in when the bake lands (width 0 / page -1 until then, so
 * layout advances the pen but emits no quad).
 */

import type { BmFont, BmFontChar } from '../atlas/FontAtlas';
import type { GLTextureCache } from '../../../renderer/cache/GLTextureCache';
import { ShelfPacker } from './shelfPack';
import { alphaToSdf } from './distanceTransform';
import {
  createCanvasRasterizer, BAKE_SIZE,
  type GlyphRasterizer, type RasterizedGlyph,
} from './glyphRasterizer';

export const PAGE_SIZE = 1024;
export const MAX_PAGES = 4;
export const SDF_RADIUS = 8;
export const SDF_CUTOFF = 0.5;
export const DEFAULT_BAKE_BUDGET = 16;

export interface DynamicFace {
  family: string;
  weight: number;
  style: 'normal' | 'italic';
  /** BmFont-shaped view consumed by layoutRuns; charMap grows lazily. */
  font: BmFont;
  /** Char record for `cp`, measured on first request (advance always valid
   *  immediately; atlas rect fills in when the bake lands). */
  requestGlyph(cp: number): BmFontChar;
}

interface DynamicPage {
  data: Uint8Array;
  /** Bumps on every glyph blit; each blit appends a patch with seq = version. */
  version: number;
  patches: { seq: number; x: number; y: number; w: number; h: number }[];
}

interface PendingBake { char: BmFontChar; raster: RasterizedGlyph; }

const canvasFamilies = new Set<string>();
let faces = new Map<string, DynamicFace>();
let pages: DynamicPage[] = [];
let packer = new ShelfPacker(PAGE_SIZE, MAX_PAGES);
let pending: PendingBake[] = [];
let flushScheduled = false;
let budget = DEFAULT_BAKE_BUDGET;
const subscribers = new Set<() => void>();
let rasterizer: GlyphRasterizer | null = null;

function getRasterizer(): GlyphRasterizer {
  if (!rasterizer) rasterizer = createCanvasRasterizer();
  return rasterizer;
}

/** Mark `family` as canvas-sourced: when no baked atlas covers it,
 *  resolveFontVariant serves it from this dynamic atlas. */
export function registerCanvasFont(family: string): void {
  canvasFamilies.add(family);
}

export function isCanvasFont(family: string): boolean {
  return canvasFamilies.has(family);
}

/** Remove a canvas family. Its faces are dropped; already-baked glyph
 *  pixels stay in their pages (no eviction in v1). */
export function unregisterCanvasFont(family: string): void {
  canvasFamilies.delete(family);
  for (const key of [...faces.keys()]) {
    if (faces.get(key)!.family === family) faces.delete(key);
  }
}

export function getDynamicFace(
  family: string, weight: number, style: 'normal' | 'italic',
): DynamicFace {
  const key = `${family}|${weight}|${style}`;
  const existing = faces.get(key);
  if (existing) return existing;

  const r = getRasterizer();
  const metrics = r.faceMetrics(family, weight, style);
  const base = Math.round(metrics.ascent);
  const font: BmFont = {
    info: { face: family, size: BAKE_SIZE },
    common: {
      lineHeight: Math.round(metrics.ascent + metrics.descent),
      base,
      scaleW: PAGE_SIZE,
      scaleH: PAGE_SIZE,
    },
    chars: [],
    kernings: [], // no kerning in v1 (measured-pair kerning is future work)
    charMap: new Map(),
    kerningMap: new Map(),
  };

  const face: DynamicFace = {
    family, weight, style, font,
    requestGlyph(cp: number): BmFontChar {
      const cached = font.charMap.get(cp);
      if (cached) return cached;
      const raster = r.rasterize(family, weight, style, cp);
      const char: BmFontChar = {
        id: cp, x: 0, y: 0, width: 0, height: 0,
        xoffset: raster.left,
        yoffset: base - raster.top,
        xadvance: raster.advance,
        page: -1,
      };
      font.charMap.set(cp, char);
      font.chars.push(char);
      if (raster.width === 0 || raster.height === 0) {
        char.page = 0; // blank glyph (space): nothing to bake
        return char;
      }
      if (budget > 0) {
        budget--;
        bake(char, raster);
      } else {
        pending.push({ char, raster });
        scheduleFlush();
      }
      return char;
    },
  };
  faces.set(key, face);
  return face;
}

function bake(char: BmFontChar, raster: RasterizedGlyph): void {
  const spot = packer.alloc(raster.width, raster.height);
  if (!spot) return; // pages full — packer warned once; glyph stays invisible
  const sdf = alphaToSdf(raster.alpha, raster.width, raster.height, SDF_RADIUS, SDF_CUTOFF);
  while (pages.length <= spot.page) {
    pages.push({ data: new Uint8Array(PAGE_SIZE * PAGE_SIZE), version: 0, patches: [] });
  }
  const page = pages[spot.page];
  for (let row = 0; row < raster.height; row++) {
    page.data.set(
      sdf.subarray(row * raster.width, (row + 1) * raster.width),
      (spot.y + row) * PAGE_SIZE + spot.x,
    );
  }
  page.version++;
  page.patches.push({ seq: page.version, x: spot.x, y: spot.y, w: raster.width, h: raster.height });
  char.x = spot.x;
  char.y = spot.y;
  char.width = raster.width;
  char.height = raster.height;
  char.page = spot.page;
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flushPending, 0);
}

function flushPending(): void {
  flushScheduled = false;
  let n = 0;
  while (pending.length > 0 && n < DEFAULT_BAKE_BUDGET) {
    const job = pending.shift()!;
    if (job.char.page !== -1) continue; // already baked
    bake(job.char, job.raster);
    n++;
  }
  if (pending.length > 0) scheduleFlush();
  for (const cb of subscribers) cb();
}

/** Subscribe to deferred-bake completion (fires after each flush batch).
 *  `<SceneCanvas>` subscribes and requests a redraw, mirroring
 *  `subscribeImageReady`. Returns an unsubscribe. */
export function subscribeGlyphReady(cb: () => void): () => void {
  subscribers.add(cb);
  return () => {
    subscribers.delete(cb);
  };
}

/** Reset the per-frame synchronous bake budget. Called by
 *  `WeaselRenderer.render()` at frame start; the headless
 *  `renderSceneToPixels` path passes Infinity so print never defers. */
export function resetBakeBudget(n: number = DEFAULT_BAKE_BUDGET): void {
  budget = n;
}

/* ------------------------------------------------------------------ */
/* GPU sync                                                            */
/* ------------------------------------------------------------------ */

/** Texture-cache key for a dynamic page (parallel to `textureCacheKey`). */
export function dynamicPageTextureId(page: number): string {
  return `weasel-dyn-sdf-page-${page}`;
}

// Per-GL-cache upload progress: last page version each cache has seen.
// WeakMap-keyed so disposed renderers don't pin anything.
const uploadedVersions = new WeakMap<GLTextureCache, Map<number, number>>();

/** Bring `cache`'s copy of page `pageIndex` up to date: full R8 upload the
 *  first time, `texSubImage2D` patches after. Returns false if the page
 *  doesn't exist yet. */
export function syncDynamicPageTexture(cache: GLTextureCache, pageIndex: number): boolean {
  const page = pages[pageIndex];
  if (!page) return false;
  const id = dynamicPageTextureId(pageIndex);
  let seen = uploadedVersions.get(cache);
  if (!seen) {
    seen = new Map();
    uploadedVersions.set(cache, seen);
  }
  if (!cache.has(id)) {
    cache.uploadR8(id, PAGE_SIZE, PAGE_SIZE, page.data);
    seen.set(pageIndex, page.version);
    return true;
  }
  const last = seen.get(pageIndex) ?? 0;
  if (last >= page.version) return true;
  for (const patch of page.patches) {
    if (patch.seq <= last) continue;
    const tight = new Uint8Array(patch.w * patch.h);
    for (let row = 0; row < patch.h; row++) {
      const src = (patch.y + row) * PAGE_SIZE + patch.x;
      tight.set(page.data.subarray(src, src + patch.w), row * patch.w);
    }
    cache.subImageR8(id, patch.x, patch.y, patch.w, patch.h, tight);
  }
  seen.set(pageIndex, page.version);
  return true;
}

/* ------------------------------------------------------------------ */
/* Test seams                                                          */
/* ------------------------------------------------------------------ */

/** @internal test seam — inject a fake rasterizer (jsdom has no canvas
 *  metrics). Pass null to restore the lazy default. */
export function __setGlyphRasterizerForTests(r: GlyphRasterizer | null): void {
  rasterizer = r;
}

/** @internal test seam — inspect CPU-side pages. */
export function _getPagesForTests(): readonly DynamicPage[] {
  return pages;
}

/** @internal test seam — clear all dynamic-font state. */
export function _resetDynamicFontsForTests(): void {
  canvasFamilies.clear();
  faces = new Map();
  pages = [];
  packer = new ShelfPacker(PAGE_SIZE, MAX_PAGES);
  pending = [];
  flushScheduled = false;
  budget = DEFAULT_BAKE_BUDGET;
  subscribers.clear();
  rasterizer = null;
}
```

Note: `cache.uploadR8` / `cache.subImageR8` don't exist on `GLTextureCache` yet — they arrive in Task 7. To keep this task compiling and its tests green **without** faking types, add the two methods to `GLTextureCache` **now** as part of this task (they're small and GL-only):

In `~/src/weasel/src/renderer/cache/GLTextureCache.ts`, after the `upload` method (line 43), insert:

```ts
  /** Create a single-channel R8 texture from raw bytes (full upload).
   *  No-op if `id` already exists. Same LINEAR/CLAMP params as `upload`;
   *  UNPACK_ALIGNMENT dropped to 1 for non-4-aligned row widths. */
  uploadR8(id: string, width: number, height: number, data: Uint8Array): void {
    if (this.map.has(id)) return;
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error(`GLTextureCache: createTexture failed for id="${id}"`);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.map.set(id, tex);
  }

  /** Patch a rect of an existing R8 texture with tightly-packed w×h bytes. */
  subImageR8(id: string, x: number, y: number, w: number, h: number, data: Uint8Array): void {
    const tex = this.map.get(id);
    if (!tex) throw new Error(`GLTextureCache: texture "${id}" not uploaded`);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RED, gl.UNSIGNED_BYTE, data);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/dynamic/dynamicAtlas.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Run the whole kit project to catch regressions**

Run: `cd ~/src/weasel && npm run test:kit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/src/weasel
git add src/features/text/dynamic/dynamicAtlas.ts src/features/text/dynamic/dynamicAtlas.test.ts src/renderer/cache/GLTextureCache.ts
git commit -m "feat(text): DynamicGlyphAtlas — canvas font registry, faces, R8 page bake"
```

---

### Task 5: Bake budget, overflow queue, glyph-ready notify

**Files:**
- Modify: `~/src/weasel/src/features/text/dynamic/dynamicAtlas.ts` (already contains the machinery — this task **tests** it; no production edits expected)
- Test: `~/src/weasel/src/features/text/dynamic/dynamicAtlas.test.ts` (extend)

- [ ] **Step 1: Write the failing/verifying tests**

Append to `dynamicAtlas.test.ts` (add `resetBakeBudget, subscribeGlyphReady` to the existing import from `./dynamicAtlas`):

```ts
describe('bake budget and overflow queue', () => {
  it('bakes N within budget now, K after the deferred flush, and notifies', () => {
    vi.useFakeTimers();
    try {
      const notified = vi.fn();
      const unsub = subscribeGlyphReady(notified);
      resetBakeBudget(2);
      const face = getDynamicFace('Futura', 400, 'normal');
      const chars = [65, 66, 67, 68, 69].map((cp) => face.requestGlyph(cp));

      // N=2 baked synchronously, K=3 queued.
      expect(chars.filter((c) => c.page >= 0).length).toBe(2);
      expect(chars.filter((c) => c.page === -1).length).toBe(3);
      // Advances are valid immediately even for queued glyphs.
      for (const c of chars) expect(c.xadvance).toBe(22);
      expect(notified).not.toHaveBeenCalled();

      vi.runAllTimers();
      expect(chars.every((c) => c.page >= 0)).toBe(true);
      expect(notified).toHaveBeenCalled();
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it('Infinity budget never defers (headless print path)', () => {
    vi.useFakeTimers();
    try {
      resetBakeBudget(Infinity);
      const face = getDynamicFace('Futura', 400, 'normal');
      const chars: number[] = [];
      for (let cp = 33; cp < 33 + 50; cp++) chars.push(face.requestGlyph(cp).page);
      expect(chars.every((p) => p >= 0)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('unsubscribe stops notifications', () => {
    vi.useFakeTimers();
    try {
      const notified = vi.fn();
      const unsub = subscribeGlyphReady(notified);
      unsub();
      resetBakeBudget(0);
      getDynamicFace('Futura', 400, 'normal').requestGlyph(65);
      vi.runAllTimers();
      expect(notified).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/dynamic/dynamicAtlas.test.ts`
Expected: PASS. (The machinery landed in Task 4; if any of these fail, fix `dynamicAtlas.ts` — budget decrement order, flush re-scheduling, notify timing — until green.)

- [ ] **Step 3: Commit**

```bash
cd ~/src/weasel
git add src/features/text/dynamic/dynamicAtlas.test.ts
git commit -m "test(text): bake budget, overflow queue, glyph-ready notify"
```

---

### Task 6: Resolver integration — baked beats dynamic beats miss

**Files:**
- Modify: `~/src/weasel/src/features/text/atlas/registerFont.ts`
- Test: `~/src/weasel/src/features/text/atlas/registerFont.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `registerFont.test.ts` (it already mocks `fetch`/`createImageBitmap` and has helpers to register a fake baked font — reuse its existing registration helper for the "baked beats canvas" case):

```ts
import {
  registerCanvasFont, _resetDynamicFontsForTests, __setGlyphRasterizerForTests,
} from '../dynamic/dynamicAtlas';
import { BAKE_SIZE } from '../dynamic/glyphRasterizer';

describe('resolveFontVariant — canvas-dynamic tier', () => {
  beforeEach(() => {
    _resetDynamicFontsForTests();
    __setGlyphRasterizerForTests({
      faceMetrics: () => ({ ascent: 40, descent: 8 }),
      rasterize: () => ({
        width: 20, height: 24, alpha: new Uint8ClampedArray(20 * 24).fill(255),
        left: -8, top: 26, advance: 22,
      }),
    });
  });

  it('serves a canvas-registered family with no baked atlas as source "canvas"', () => {
    registerCanvasFont('Futura');
    const r = resolveFontVariant('Futura', 400, 'normal');
    expect(r.entry).toBeNull();
    expect(r.source).toBe('canvas');
    expect(r.dynamicFace).toBeDefined();
    expect(r.dynamicFace!.font.info.size).toBe(BAKE_SIZE);
    expect(r.resolved).toEqual({ weight: 400, style: 'normal' });
    expect(r.synthetic).toEqual({ bold: false, italic: false });
  });

  it('baked always wins: a registered atlas shadows the canvas registration', async () => {
    // Register a baked variant for the same family using this file's
    // existing mocked-fetch registration helper, then also canvas-register.
    await registerFakeFont('Futura', { weight: 400, style: 'normal' }); // ← use the file's existing helper name
    registerCanvasFont('Futura');
    const r = resolveFontVariant('Futura', 400, 'normal');
    expect(r.entry).not.toBeNull();
    expect(r.source).toBe('atlas');
    expect(r.dynamicFace).toBeUndefined();
  });

  it('dynamic face carries the requested weight/style (real bold, no synthetic)', () => {
    registerCanvasFont('Futura');
    const r = resolveFontVariant('Futura', 700, 'italic');
    expect(r.source).toBe('canvas');
    expect(r.dynamicFace!.weight).toBe(700);
    expect(r.dynamicFace!.style).toBe('italic');
    expect(r.synthetic).toEqual({ bold: false, italic: false });
  });

  it('an unregistered family is still a plain miss', () => {
    const r = resolveFontVariant('Nope', 400, 'normal');
    expect(r.entry).toBeNull();
    expect(r.source).toBe('atlas');
    expect(r.dynamicFace).toBeUndefined();
  });
});
```

(If the file's baked-font registration helper has a different name/signature, adapt the call — the intent is: one baked `Futura` 400/normal entry exists.)

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/atlas/registerFont.test.ts`
Expected: FAIL — `source`/`dynamicFace` don't exist on `ResolveResult`.

- [ ] **Step 3: Implement**

In `registerFont.ts`:

1. Add the import at the top:

```ts
import { isCanvasFont, getDynamicFace, type DynamicFace } from '../dynamic/dynamicAtlas';
```

2. Extend `ResolveResult` (lines 128–139):

```ts
export interface ResolveResult {
  entry: FontEntry | null;
  /** ... (existing doc comment unchanged) ... */
  resolved: { weight: number; style: FontStyle };
  synthetic: { bold: boolean; italic: boolean };
  /** Which tier resolved: a baked MSDF atlas, or the runtime canvas-SDF
   *  dynamic atlas. Misses report 'atlas' (the default tier). */
  source: 'atlas' | 'canvas';
  /** Set only when source === 'canvas': the dynamic face whose BmFont-shaped
   *  `font` layoutRuns consumes in place of `entry.font`. */
  dynamicFace?: DynamicFace;
}
```

3. Replace `nullResolveResult` (lines 141–147) with:

```ts
function missResolveResult(family: string, weight: number, style: FontStyle): ResolveResult {
  // Canvas-dynamic tier: only reached when NO baked variant matched at all,
  // so baked always wins. Dynamic faces rasterize the real weight/style —
  // no synthetic flags.
  if (isCanvasFont(family)) {
    return {
      entry: null,
      dynamicFace: getDynamicFace(family, weight, style),
      resolved: { weight, style },
      synthetic: { bold: false, italic: false },
      source: 'canvas',
    };
  }
  return {
    entry: null,
    resolved: { weight, style },
    synthetic: { bold: false, italic: false },
    source: 'atlas',
  };
}
```

4. Update both former `nullResolveResult(...)` call sites (lines 165 and 268) to `missResolveResult(family, weight, style)`.

5. Add `source: 'atlas',` to **all five** successful return objects in `resolveFontVariant` (the exact-match return at ~line 170, the two nearest-weight returns, and the two synthetic-fallback returns).

- [ ] **Step 4: Run tests**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/atlas/registerFont.test.ts`
Expected: PASS (existing + 4 new). Then `npm run test:kit` — expected PASS (other suites construct `ResolveResult` nowhere, but `layoutRuns` consumers may need no change since the new field is additive).

- [ ] **Step 5: Commit**

```bash
cd ~/src/weasel
git add src/features/text/atlas/registerFont.ts src/features/text/atlas/registerFont.test.ts
git commit -m "feat(text): resolveFontVariant canvas-dynamic tier (baked always wins)"
```

---

### Task 7: layoutRuns integration — dynamic faces, per-page groups

**Files:**
- Modify: `~/src/weasel/src/features/text/atlas/layoutRuns.ts`
- Test: `~/src/weasel/src/features/text/atlas/layoutRuns.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `layoutRuns.test.ts` — mirror the file's existing `ResolvedRun` construction helper (it builds `{ text, fontFamily, fontWeight, fontStyle, fontSize, fill }` objects) and its baked-font registration setup:

```ts
import {
  registerCanvasFont, resetBakeBudget,
  _resetDynamicFontsForTests, __setGlyphRasterizerForTests,
} from '../dynamic/dynamicAtlas';

describe('layoutRuns — canvas-dynamic faces', () => {
  beforeEach(() => {
    _resetDynamicFontsForTests();
    __setGlyphRasterizerForTests({
      faceMetrics: () => ({ ascent: 40, descent: 8 }),
      rasterize: (_f, _w, _s, cp) =>
        cp === 32
          ? { width: 0, height: 0, alpha: new Uint8ClampedArray(0), left: 0, top: 0, advance: 12 }
          : { width: 20, height: 24, alpha: new Uint8ClampedArray(20 * 24).fill(255), left: -8, top: 26, advance: 22 },
    });
    registerCanvasFont('Dyn');
  });

  const dynRun = (text: string) => ({
    text,
    fontFamily: 'Dyn',
    fontWeight: 400,
    fontStyle: 'normal' as const,
    fontSize: 24, // scale = 24/48 = 0.5
    fill: { color: '#000' },
  });

  it('lays out a dynamic run into a canvas-source group with quads', () => {
    const laid = layoutRuns([dynRun('AB')], { maxWidth: Infinity, lineHeight: 1.2, align: 'left' }, { x: 0, y: 0 });
    expect(laid.groups.length).toBe(1);
    const g = laid.groups[0];
    expect(g.source).toBe('canvas');
    expect(g.page).toBe(0);
    expect(g.quads.length).toBe(2);
    // Advance 22 at scale 0.5 → second glyph starts 11 units right of the first.
    expect(laid.groups[0].quads[1].x0 - laid.groups[0].quads[0].x0).toBeCloseTo(11);
    expect(laid.bounds.width).toBeCloseTo(22);
  });

  it('unbaked glyphs advance the pen but emit no quads', () => {
    resetBakeBudget(0);
    const laid = layoutRuns([dynRun('AB')], { maxWidth: Infinity, lineHeight: 1.2, align: 'left' }, { x: 0, y: 0 });
    expect(laid.groups.flatMap((g) => g.quads).length).toBe(0);
    expect(laid.bounds.width).toBeCloseTo(22); // measureText advances still count
  });

  it('spaces contribute real measured advances without quads', () => {
    const laid = layoutRuns([dynRun('A B')], { maxWidth: Infinity, lineHeight: 1.2, align: 'left' }, { x: 0, y: 0 });
    expect(laid.groups.flatMap((g) => g.quads).length).toBe(2);
    // A(22) + space(12) + B(22) at scale 0.5.
    expect(laid.bounds.width).toBeCloseTo(28);
  });

  it('atlas groups still report source "atlas" and page 0', () => {
    // Use the file's existing baked-font setup (mocked registerFont) to lay
    // out a registered-family run, then assert:
    //   group.source === 'atlas' and group.page === 0
    // Reuse whichever existing spec's arrangement is simplest.
  });
});
```

For the last test, copy the arrange step from the file's simplest existing green test and add the two assertions — don't invent a new registration path.

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/atlas/layoutRuns.test.ts`
Expected: FAIL — `source`/`page` missing on groups; dynamic run produces nothing.

- [ ] **Step 3: Implement**

In `layoutRuns.ts`:

1. Extend `LaidOutGroup` (lines 28–37) with two fields:

```ts
export interface LaidOutGroup {
  family: string;
  /** Resolved variant — matches the registered atlas and the texture-cache key. */
  weight: number;
  style: 'normal' | 'italic';
  /** Gap between the request and the resolved match. Drives shader uniforms. */
  synthetic: { bold: boolean; italic: boolean };
  fill: FillStyle;
  /** Which glyph source (and therefore shader/texture) this group binds:
   *  baked MSDF atlas or the runtime canvas-SDF dynamic atlas. */
  source: 'atlas' | 'canvas';
  /** Dynamic-atlas page index for 'canvas' groups; 0 for atlas groups. */
  page: number;
  quads: LaidOutQuad[];
}
```

2. Extend `groupKey` (lines 69–77) — new trailing components:

```ts
function groupKey(
  family: string,
  weight: number,
  style: 'normal' | 'italic',
  synthetic: { bold: boolean; italic: boolean },
  fill: FillStyle,
  source: 'atlas' | 'canvas',
  page: number,
): string {
  return `${family}|${weight}|${style}|${synthetic.bold ? 1 : 0}${synthetic.italic ? 1 : 0}|${fillKey(fill)}|${source}|${page}`;
}
```

3. Change `getOrCreateGroup` (lines 79–106) to take the page (groups are now selected per **glyph**, not per run, because a dynamic run's glyphs can land on different pages):

```ts
function getOrCreateGroup(
  ctx: LayoutContext,
  run: ResolvedRun,
  resolved: ResolveResult,
  page: number,
): LaidOutGroup {
  const resolvedWeight = resolved.resolved.weight;
  const resolvedStyle = resolved.resolved.style;
  const key = groupKey(
    run.fontFamily, resolvedWeight, resolvedStyle, resolved.synthetic, run.fill,
    resolved.source, page,
  );
  let g = ctx.groups.get(key);
  if (!g) {
    g = {
      family: run.fontFamily,
      weight: resolvedWeight,
      style: resolvedStyle,
      synthetic: { ...resolved.synthetic },
      fill: run.fill,
      source: resolved.source,
      page,
      quads: [],
    };
    ctx.groups.set(key, g);
  }
  return g;
}
```

4. In the `Entry` interface (lines 126–137): replace `group: LaidOutGroup;` with `resolved: ResolveResult;`.

5. In the run loop (lines 146–154), consume dynamic faces and drop the eager group creation:

```ts
  for (const run of runs) {
    const resolved = resolveFontVariant(run.fontFamily, run.fontWeight, run.fontStyle);
    const font = resolved.entry?.font ?? resolved.dynamicFace?.font;
    if (!font) {
      prevCp = undefined; prevFont = undefined; prevFontSize = undefined;
      continue;
    }
    const scale = run.fontSize / font.info.size;
```

(Delete the old `const font = resolved.entry.font;` and `const group = getOrCreateGroup(ctx, run, resolved);` lines.)

6. In the three `entries.push` sites (newline ~line 162, space ~line 184, glyph ~line 206): replace `group,` with `resolved,`.

7. In the space branch (~line 175), request the dynamic space glyph so its advance is measured:

```ts
        const spaceGlyph = resolved.dynamicFace
          ? resolved.dynamicFace.requestGlyph(32)
          : font.charMap.get(32);
```

8. In the glyph branch (~line 194), route through the dynamic face:

```ts
      const glyph = resolved.dynamicFace
        ? resolved.dynamicFace.requestGlyph(cp)
        : resolveGlyph(font, cp);
```

9. In pass 3's emission loop (lines 288–307), look the group up per glyph and skip not-yet-baked dynamic glyphs **while still advancing the pen**:

```ts
    for (const e of line.entries) {
      penX += e.kerningBefore;
      if (e.advance === 0) continue;
      if (e.resolved.source === 'canvas' && (e.glyph.width === 0 || e.glyph.page < 0)) {
        // Dynamic glyph not baked yet (or blank, e.g. space): advance the pen
        // so the line doesn't reflow when the bake lands, but emit no quad.
        penX += e.advance;
        continue;
      }
      const group = getOrCreateGroup(ctx, e.run, e.resolved, e.glyph.page);
      const scale = e.fontSize / e.font.info.size;
      // ... (existing quad math unchanged, but push to the local `group`) ...
      group.quads.push({ x0: qx0, y0: qy0, x1: qx1, y1: qy1, u0, v0, u1, v1, baselineY });
      penX += e.advance;
    }
```

(The rest of the quad math — `atlasW/atlasH/u0..v1/baselineY` — is untouched; only `e.group.quads.push` becomes `group.quads.push`.)

**Behavior note:** groups are now created at emission time, so runs that produce zero quads produce zero groups. If an existing test asserted an empty group's presence, update that test's expectation (the renderer skips empty groups anyway — `draw.ts:828`).

- [ ] **Step 4: Run tests**

Run: `cd ~/src/weasel && npx vitest run --project=kit src/features/text/atlas/layoutRuns.test.ts` — PASS.
Then: `npm run test:kit` — PASS (fix any group-shape assumptions elsewhere).

- [ ] **Step 5: Commit**

```bash
cd ~/src/weasel
git add src/features/text/atlas/layoutRuns.ts src/features/text/atlas/layoutRuns.test.ts
git commit -m "feat(text): layoutRuns consumes dynamic faces; groups carry source+page"
```

---

### Task 8: R8 shader + renderer plumbing + draw routing

**Files:**
- Modify: `~/src/weasel/src/renderer/shaders/textSdf.ts`
- Modify: `~/src/weasel/src/renderer/WeaselRenderer.ts`
- Modify: `~/src/weasel/src/renderer/draw.ts`
- Modify: `~/src/weasel/src/canvas/renderSceneToPixels.ts`
- Test: `~/src/weasel/src/renderer/draw.test.ts` (extend)

- [ ] **Step 1: Add the R8 fragment source**

Append to `textSdf.ts` (after `TEXT_FRAG_SRC`, before the uniform lists — same vert shader, same uniforms/attributes):

```ts
/**
 * Single-channel sibling of TEXT_FRAG_SRC for runtime canvas-SDF glyphs
 * (DynamicGlyphAtlas R8 pages): the R channel IS the distance field, so no
 * median. Accepted trade: slight corner rounding at extreme zoom — invisible
 * at label print resolution. Threshold semantics (0.5 edge, u_synthBold
 * shift) match the MSDF shader because the bake encodes the edge at ~128.
 */
export const TEXT_FRAG_R8_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_atlas;
uniform vec4 u_color;
uniform float u_alpha;
uniform float u_aaWidth;
uniform float u_synthBold;
uniform mat4 u_colorMatrix;
uniform vec4 u_colorBias;
out vec4 outColor;

void main() {
  float sdfVal = texture(u_atlas, v_uv).r;
  float aaW = u_aaWidth > 0.0 ? u_aaWidth : 0.05;
  float threshold = 0.5 - u_synthBold;
  float sdfAlpha = smoothstep(threshold - aaW, threshold + aaW, sdfVal);
  vec4 src = vec4(u_color.rgb, u_color.a);
  vec4 mapped = clamp(u_colorMatrix * src + u_colorBias, 0.0, 1.0);
  float a = mapped.a * sdfAlpha * u_alpha;
  outColor = vec4(mapped.rgb * a, a);
}
`;
```

- [ ] **Step 2: Thread `textSdfR8` through WeaselRenderer**

In `WeaselRenderer.ts`:

1. Import `TEXT_FRAG_R8_SRC` alongside the existing `TEXT_VERT_SRC, TEXT_FRAG_SRC, TEXT_SDF_UNIFORMS, TEXT_SDF_ATTRIBUTES` import, and add:

```ts
import { resetBakeBudget, DEFAULT_BAKE_BUDGET } from 'features/text/dynamic/dynamicAtlas';
```

2. Add the option (in `WeaselRendererOptions`, after `flattenTolerance`):

```ts
  /** Per-render synchronous bake budget for dynamic canvas-SDF glyphs.
   *  Default DEFAULT_BAKE_BUDGET (16). The headless renderSceneToPixels
   *  path passes Infinity so print never defers a glyph. */
  bakeBudget?: number;
```

3. Add the field next to `private textSdf` (line 87): `private textSdfR8: ShaderProgram;` and next to `flattenTolerance` (line 107): `private readonly bakeBudget: number;` — initialize in the constructor: `this.bakeBudget = opts.bakeBudget ?? DEFAULT_BAKE_BUDGET;`

4. Build the program in the constructor right after the `textSdf` block (line 158) **and** in `onContextRestored` after line 277 — both times:

```ts
    this.textSdfR8 = new ShaderProgram(this.gl, TEXT_VERT_SRC, TEXT_FRAG_R8_SRC);
    this.textSdfR8.lookupUniforms(TEXT_SDF_UNIFORMS);
    this.textSdfR8.lookupAttributes(TEXT_SDF_ATTRIBUTES);
```

5. Add `this.textSdfR8` to the dispose loop's program array (line 343).

6. Add `textSdfR8: this.textSdfR8,` to the `DrawContext` literal in `render()` (after `textSdf` at line 375), and at the top of `render()` (right after `this.meshCache.drainPendingDeletes();`, line 366) add:

```ts
    // New frame: refill the dynamic-glyph synchronous bake budget.
    resetBakeBudget(this.bakeBudget);
```

7. Add the test accessor next to `_textSdf()` (line 418):

```ts
  /** @internal */ _textSdfR8(): ShaderProgram { return this.textSdfR8; }
```

- [ ] **Step 3: Route groups in draw.ts**

1. Add `textSdfR8: ShaderProgram;` to `DrawContext` (after `textSdf` at line 32).

2. Add to the imports from `features/text/dynamic/dynamicAtlas`:

```ts
import { syncDynamicPageTexture, dynamicPageTextureId } from 'features/text/dynamic/dynamicAtlas';
```

3. Replace the uniform setup + group loop in `drawText` (lines 813–823) with per-program lazy setup:

```ts
  const gl = ctx.gl;
  applyClipTest(ctx);
  const preparedPrograms = new Set<ShaderProgram>();
  for (const group of laid.groups) {
    const prog = group.source === 'canvas' ? ctx.textSdfR8 : ctx.textSdf;
    gl.useProgram(prog.handle);
    if (!preparedPrograms.has(prog)) {
      preparedPrograms.add(prog);
      setProjAndModel(ctx, prog);
      setColorMatrixUniforms(ctx, prog);
      gl.uniform1f(prog.uniform('u_alpha')!, ctx.state.alpha);
      gl.uniform1f(prog.uniform('u_aaWidth')!, 0.05);
    }
    drawTextGroup(ctx, group, prog);
  }
```

4. Change `drawTextGroup`'s signature to `(ctx: DrawContext, group: LaidOutGroup, prog: ShaderProgram)`, replace **every** `ctx.textSdf` inside it with `prog` (attribute lookups at lines 859–861, uniform lookups at lines 885, 891, 898, 902), and replace the texture ensure/bind (lines 827 and 901):

```ts
function drawTextGroup(ctx: DrawContext, group: LaidOutGroup, prog: ShaderProgram): void {
  if (group.source === 'canvas') {
    if (!syncDynamicPageTexture(ctx.textureCache, group.page)) return;
  } else {
    if (!ensureFontTexture(group.family, group.weight, group.style, ctx.textureCache)) return;
  }
  if (group.quads.length === 0) return;
  // ... existing body with ctx.textSdf → prog ...
  const texId = group.source === 'canvas'
    ? dynamicPageTextureId(group.page)
    : textureCacheKey(group.family, group.weight, group.style);
  ctx.textureCache.bind(texId, 0);
  gl.uniform1i(prog.uniform('u_atlas')!, 0);
  // ... rest unchanged ...
}
```

- [ ] **Step 4: Headless unlimited budget**

In `renderSceneToPixels.ts`, add to the `WeaselRenderer` options object (lines 210–217):

```ts
    // Dynamic canvas-SDF glyphs must all bake inline — this path is
    // synchronous with no notify-and-redraw, and print must be complete.
    bakeBudget: Infinity,
```

- [ ] **Step 5: Extend draw.test.ts**

1. In `createRecorderCtx` (line 16), add `textSdfR8: r._textSdfR8(),` after the `textSdf` line.

2. Append a routing test (adjust the `TextDrawCommand` construction to match how existing text-command tests in this file build `cmd.runs` — if none exist, this shape matches `layoutRuns`' `ResolvedRun` consumption):

```ts
import {
  registerCanvasFont, _resetDynamicFontsForTests, __setGlyphRasterizerForTests,
} from 'features/text/dynamic/dynamicAtlas';

describe('drawText — canvas-dynamic routing', () => {
  beforeEach(() => {
    _resetDynamicFontsForTests();
    __setGlyphRasterizerForTests({
      faceMetrics: () => ({ ascent: 40, descent: 8 }),
      rasterize: () => ({
        width: 20, height: 24, alpha: new Uint8ClampedArray(20 * 24).fill(255),
        left: -8, top: 26, advance: 22,
      }),
    });
    registerCanvasFont('Dyn');
  });

  it('binds the R8 program and dynamic page texture for a canvas group', () => {
    const { ctx, calls } = createRecorderCtx();
    const cmd: DrawCommand = {
      kind: 'text',
      x: 10, y: 10,
      runs: [{
        text: 'A', fontFamily: 'Dyn', fontWeight: 400, fontStyle: 'normal',
        fontSize: 24, fill: { color: '#000' },
      }],
    } as DrawCommand;
    dispatch(ctx, cmd);
    const used = calls.filter((c) => c.name === 'useProgram').map((c) => c.args[0]);
    expect(used).toContain(ctx.textSdfR8.handle);
    expect(used).not.toContain(ctx.textSdf.handle);
    // Full R8 page upload happened (texImage2D with R8-format args).
    expect(calls.some((c) => c.name === 'texImage2D')).toBe(true);
  });
});
```

If `makeGLRecorder` (`src/renderer/test-utils/glRecorder.ts`) lacks stubs for `pixelStorei` or `texSubImage2D`, add them following the file's existing no-op-stub pattern (record name+args, return undefined) — same shape as its `texImage2D` stub.

- [ ] **Step 6: Run tests**

Run: `cd ~/src/weasel && npx vitest run --project=draw src/renderer/draw.test.ts` (draw tests run in the `draw` project) — PASS.
Then: `npm test` (all Vitest projects) — PASS.

- [ ] **Step 7: Commit**

```bash
cd ~/src/weasel
git add src/renderer/shaders/textSdf.ts src/renderer/WeaselRenderer.ts src/renderer/draw.ts src/canvas/renderSceneToPixels.ts src/renderer/draw.test.ts src/renderer/test-utils/glRecorder.ts
git commit -m "feat(renderer): R8 SDF text program, per-source group routing, bake budget"
```

---

### Task 9: SceneCanvas redraw hook + public exports

**Files:**
- Modify: `~/src/weasel/src/canvas/SceneCanvas.tsx:847-852`
- Modify: `~/src/weasel/src/index.ts:961`
- Modify: `~/src/weasel/src/renderer/index.ts:23`

- [ ] **Step 1: Subscribe SceneCanvas to glyph-ready**

In `SceneCanvas.tsx`, add to the imports:

```ts
import { subscribeGlyphReady } from 'features/text/dynamic/dynamicAtlas';
```

and directly below the existing image-ready effect (lines 847–852):

```tsx
  // Deferred dynamic-glyph bakes (over-budget frames) redraw exactly like
  // late image decodes: bake lands → notify → repaint with the new quads.
  useEffect(() => subscribeGlyphReady(() => {
    canvasApiRef.current?.requestRedraw?.();
  }), []);
```

- [ ] **Step 2: Export the public surface**

In `src/index.ts`, after the `registerFont` export (line 961):

```ts
// Canvas-sourced dynamic SDF fonts — render any installed machine font with
// no baked atlas (canvas fillText → distance transform → R8 glyph pages).
// Baked MSDF (registerFont) always wins; this is the fallback tier.
export {
  registerCanvasFont,
  isCanvasFont,
  unregisterCanvasFont,
  subscribeGlyphReady,
} from 'features/text/dynamic/dynamicAtlas';
```

In `src/renderer/index.ts`, next to its `registerFont` re-export (line 23), add the same four names re-exported from the same module path (keep parity with how that file references modules — match its existing import-path style).

- [ ] **Step 3: Verify**

Run: `cd ~/src/weasel && npx tsc --noEmit && npm test`
Expected: clean typecheck, all projects PASS.

- [ ] **Step 4: Commit**

```bash
cd ~/src/weasel
git add src/canvas/SceneCanvas.tsx src/index.ts src/renderer/index.ts
git commit -m "feat(text): glyph-ready redraw hook; export canvas-font API"
```

---

### Task 10: Weasel self-check — full suite

- [ ] **Step 1: Run everything**

```bash
cd ~/src/weasel && npm test && npx tsc --noEmit
```
Expected: all Vitest projects PASS, typecheck clean. Fix anything broken before proceeding (this is the last weasel-only checkpoint before the visual suite).

- [ ] **Step 2: Commit any fixes**

```bash
cd ~/src/weasel && git add -A && git commit -m "fix(text): dynamic-SDF integration fallout" # only if fixes were needed
```

---

### Task 11: Headless + visual proof (Playwright, real GL)

**Files:**
- Modify: `~/src/weasel/apps/site/demos/RenderToPixelsDemo.tsx`
- Create: `~/src/weasel/tests/visual/sdf-fallback.spec.ts`

- [ ] **Step 1: Add a canvas-font text node to the demo**

In `RenderToPixelsDemo.tsx`:

1. Add `registerCanvasFont` to the `@weasel-js/core` import (line 2–4) and register at module scope (below the `W`/`H` constants):

```ts
// Exercise the dynamic canvas-SDF tier end-to-end: Arial has no baked atlas
// here, so it resolves through DynamicGlyphAtlas. (If Arial isn't installed,
// canvas fillText falls back to another face — the test only asserts that
// glyph ink renders, not which face.)
registerCanvasFont('Arial');
```

2. Add a node to the `initial` array (the top strip `y < 40` is empty):

```ts
      // Dynamic canvas-SDF text (see registerCanvasFont above).
      { id: 'e' as never, kind: 'leaf', layer: 'default',
        pose: { x: 10, y: 4, width: 460, height: 32 },
        data: { text: 'Dynamic SDF 123', style: { fontFamily: 'Arial', fontSize: 22 } } },
```

- [ ] **Step 2: Write the spec**

```ts
// ~/src/weasel/tests/visual/sdf-fallback.spec.ts
/**
 * Dynamic canvas-SDF fonts, real GL: node 'e' in RenderToPixelsDemo renders
 * 'Dynamic SDF 123' in a canvas-registered family ('Arial') that has no
 * baked MSDF atlas. Asserts (a) the headless renderSceneToPixels output
 * contains glyph ink for the dynamic family (inline bake, no async gap) and
 * (b) headless determinism still holds with dynamic glyphs in play.
 * No committed baseline — installed-font rasterization varies by machine.
 */
import { test, expect } from '@playwright/test';

test('canvas-sourced SDF text renders ink in headless output', async ({ page }) => {
  await page.goto('/#render-to-pixels');
  const readout = page.getByTestId('rtp-readout');
  // 'identical: yes' doubles as the determinism assertion: two consecutive
  // renderSceneToPixels calls byte-match even with dynamic bakes involved.
  await expect(readout).toHaveText(/identical: yes/, { timeout: 15_000 });

  const ink = await page.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="rtp-output"]')!;
    const ctx = c.getContext('2d')!;
    // Node 'e' text band: scene y 4..36 → output rows (scale.y = 1); sample
    // a wide box through the glyphs. scale.x = 2 → scene x 10 ≈ output x 20.
    const { data } = ctx.getImageData(20, 8, 400, 24);
    let total = 0;
    for (let i = 0; i < data.length; i += 4) total += 255 - data[i];
    return total / (data.length / 4);
  });
  // Background-only would be ~0; a text line through the band pulls the
  // average well up. Threshold is loose on purpose (any installed face).
  expect(ink).toBeGreaterThan(5);
});
```

- [ ] **Step 3: Run the visual suite**

Run: `cd ~/src/weasel && npm run test:visual`
Expected: new spec PASSES; existing `render-to-pixels.spec.ts` and `text.spec.ts` still pass (the new node sits in the previously-empty top strip and must not disturb existing probes — if `text.spec.ts` baselines shift, the demo change leaked into the wrong demo; nodes were only added to RenderToPixelsDemo).

- [ ] **Step 4: Commit**

```bash
cd ~/src/weasel
git add apps/site/demos/RenderToPixelsDemo.tsx tests/visual/sdf-fallback.spec.ts
git commit -m "test(visual): headless dynamic canvas-SDF glyph rendering"
```

---

### Task 12: lbx-editor — `substituteFontFamily` middle tier

**Repo switch:** `cd ~/src/lbx-editor && git switch -c dynamic-sdf-fonts`

**Files:**
- Modify: `~/src/lbx-editor/src/fonts.ts`
- Test: `~/src/lbx-editor/src/fonts.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

In `fonts.test.ts`:

1. Extend the existing weasel mock (lines 13–15) to include the new API:

```ts
vi.mock('@weasel-js/core', () => ({
  registerFont: vi.fn(),
  registerCanvasFont: vi.fn(),
}));
```

2. Append (note the existing file uses `vi.stubGlobal` + `vi.unstubAllGlobals()` in `afterEach`, and `_resetFontsForTests()` in `beforeEach` — follow that arrangement):

```ts
import { registerCanvasFont } from '@weasel-js/core';
import {
  substituteFontFamily, installedFamilies, isCanvasFamily, canvasFontsInUse,
  _resetFontsForTests,
} from './fonts';

describe('substituteFontFamily — installed (canvas) middle tier', () => {
  const stubFontsCheck = (result: boolean) => {
    const check = vi.fn().mockReturnValue(result);
    vi.stubGlobal('document', { fonts: { check } });
    return check;
  };

  beforeEach(() => _resetFontsForTests());
  afterEach(() => vi.unstubAllGlobals());

  it('registers and returns an installed family verbatim', () => {
    const check = stubFontsCheck(true);
    expect(substituteFontFamily('Futura')).toBe('Futura');
    expect(check).toHaveBeenCalledWith('12px "Futura"');
    expect(registerCanvasFont).toHaveBeenCalledWith('Futura');
    expect(isCanvasFamily('Futura')).toBe(true);
    expect(installedFamilies()).toContain('Futura');
  });

  it('installed check wins over the substitution table', () => {
    stubFontsCheck(true);
    expect(substituteFontFamily('Arial')).toBe('Arial'); // table would say Inter
  });

  it('falls through to the table/heuristic when not installed', () => {
    stubFontsCheck(false);
    expect(substituteFontFamily('Arial')).toBe('Inter');
    expect(substituteFontFamily('SomeUnknownCn Font')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Mystery Sans')).toBe('Inter');
    expect(installedFamilies()).toEqual([]);
  });

  it('baked families never hit the installed check', () => {
    const check = stubFontsCheck(true);
    expect(substituteFontFamily('Inter')).toBe('Inter');
    expect(check).not.toHaveBeenCalled();
  });

  it('memoizes the check per family', () => {
    const check = stubFontsCheck(false);
    substituteFontFamily('Mystery Sans');
    substituteFontFamily('Mystery Sans');
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('is safe with no document (node/print env)', () => {
    // No stub: bare node environment.
    expect(substituteFontFamily('Futura')).toBe('Inter');
  });

  it('canvasFontsInUse reports only canvas-tier families', () => {
    stubFontsCheck(true);
    substituteFontFamily('Futura'); // becomes canvas-registered
    expect(canvasFontsInUse(['Futura', 'Inter', 'Futura'])).toEqual(['Futura']);
    expect(canvasFontsInUse(['Inter', 'JetBrains Mono'])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd ~/src/lbx-editor && npx vitest run src/fonts.test.ts`
Expected: FAIL — `installedFamilies`/`isCanvasFamily`/`canvasFontsInUse` don't exist; middle tier missing.

- [ ] **Step 3: Implement**

In `fonts.ts`:

1. Add `registerCanvasFont` to the `@weasel-js/core` import.

2. Below `let registered = new Set<string>(BUNDLED_FAMILIES);` (line 48), add:

```ts
// Canvas-sourced (installed-machine) families: rendered by weasel's dynamic
// SDF tier, not from a baked atlas. Kept separate from `registered` so the
// dropdown can group them and print can warn about portability.
let canvasFamilies = new Set<string>();
let installedCheckCache = new Map<string, boolean>();

/** `document.fonts.check` probe, memoized per family. False wherever the
 *  API is missing (node tests, headless print contexts). */
function isInstalledFont(name: string): boolean {
  const cached = installedCheckCache.get(name);
  if (cached !== undefined) return cached;
  let installed = false;
  if (typeof document !== 'undefined' && typeof document.fonts?.check === 'function') {
    try {
      installed = document.fonts.check(`12px ${JSON.stringify(name)}`);
    } catch {
      installed = false;
    }
  }
  installedCheckCache.set(name, installed);
  return installed;
}
```

3. Rewrite `substituteFontFamily` (lines 61–68) — the installed tier sits between the baked match and the substitution table, per the spec (“render the real font” beats the stand-in table):

```ts
/** Registered family for a node's fontFamily; never rewrites node data.
 *  Tiers: baked atlas match → installed on this machine (canvas-SDF tier,
 *  registered with weasel on first sight) → substitution table → heuristic. */
export function substituteFontFamily(name: string): string {
  if (registered.has(name)) return name;
  if (canvasFamilies.has(name)) return name;
  if (isInstalledFont(name)) {
    registerCanvasFont(name);
    canvasFamilies.add(name);
    return name;
  }
  const exact = SUBSTITUTIONS[name];
  if (exact) return exact;
  if (looksCondensed(name)) return 'Barlow Condensed';
  return 'Inter';
}
```

4. Below `registeredFamilies()` (line 72), add:

```ts
/** Canvas-sourced families seen so far (the dropdown's
 *  "Installed (this machine)" group), sorted. */
export function installedFamilies(): string[] {
  return [...canvasFamilies].sort();
}

/** True if `name` renders through weasel's canvas-SDF tier. */
export function isCanvasFamily(name: string): boolean {
  return canvasFamilies.has(name);
}

/** The canvas-tier families a set of node fontFamily values resolves to —
 *  the print-portability warning list. Sorted, deduped. */
export function canvasFontsInUse(families: Iterable<string>): string[] {
  const used = new Set<string>();
  for (const f of families) {
    if (isCanvasFamily(substituteFontFamily(f))) used.add(f);
  }
  return [...used].sort();
}
```

5. Extend `_resetFontsForTests` (lines 166–169) to also reset the new state:

```ts
  canvasFamilies = new Set();
  installedCheckCache = new Map();
```

- [ ] **Step 4: Run tests**

Run: `cd ~/src/lbx-editor && npx vitest run src/fonts.test.ts` — PASS (existing + 7 new).
Then: `npm test` — PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/fonts.ts src/fonts.test.ts
git commit -m "feat(fonts): installed-font middle tier via canvas-SDF registration"
```

---

### Task 13: lbx-editor — dropdown group + print notice

**Files:**
- Modify: `~/src/lbx-editor/src/PropertyPanel.tsx:95-121`
- Modify: `~/src/lbx-editor/src/App.tsx` (`handlePrint`, around line 884)

- [ ] **Step 1: Dropdown "Installed (this machine)" group**

In `PropertyPanel.tsx`, extend the fonts import (line 11) with `installedFamilies`, then replace the select's option building (lines 95 and 108–121):

```tsx
  const families = registeredFamilies();
  const installed = installedFamilies();
```

```tsx
        <select
          value={data.fontFamily}
          onChange={(e) => update({ fontFamily: e.target.value })}
        >
          {!families.includes(data.fontFamily) && !installed.includes(data.fontFamily) && (
            <option value={data.fontFamily}>
              {data.fontFamily} → {substituteFontFamily(data.fontFamily)}
            </option>
          )}
          {families.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
          {installed.length > 0 && (
            <optgroup label="Installed (this machine)">
              {installed.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </optgroup>
          )}
        </select>
```

(Note: `substituteFontFamily(data.fontFamily)` in the synthetic option can itself promote an installed family into `installed` on the next render, at which point the synthetic option disappears and the real optgroup entry matches — that's the intended “just works” flow.)

- [ ] **Step 2: Print notice**

In `App.tsx` `handlePrint` (lines 859–938), extend the fonts import (line 69) with `canvasFontsInUse`, and insert directly after `await registerFonts();` (line 884):

```ts
      const machineFamilies: string[] = [];
      for (const [, node] of scene.nodes) {
        if (node.data.kind === 'text') machineFamilies.push(node.data.fontFamily);
      }
      const machineFonts = canvasFontsInUse(machineFamilies);
      if (machineFonts.length > 0) {
        alert(
          `Heads up: this label uses fonts installed on this machine (${machineFonts.join(', ')}). ` +
          'It will print correctly here; machines without them will substitute.',
        );
      }
```

(Non-blocking notice — no early return; `alert()` matches every other notice in this flow, and these sites are already earmarked for toast conversion later.)

- [ ] **Step 3: Verify**

Run: `cd ~/src/lbx-editor && npm test && npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 4: Commit**

```bash
cd ~/src/lbx-editor
git add src/PropertyPanel.tsx src/App.tsx
git commit -m "feat(fonts): installed-fonts dropdown group and print portability notice"
```

---

### Task 14: End-to-end verification in the real app

No new code — evidence gathering before calling the feature done.

- [ ] **Step 1: Live visual check**

1. `cd ~/src/lbx-editor && npm run dev` (port 5180).
2. Open the app, import a real `.lbx` fixture that references machine fonts (e.g. one using Futura / Helvetica Neue Condensed — the repo's test fixtures or a P-touch Editor export), **with no `public/fonts/local/` manifest present**.
3. Confirm: text renders in the real installed font (not the Barlow/Inter stand-in), the Property panel dropdown shows the family under "Installed (this machine)", and no console errors. Zoom in/out — glyphs stay crisp-ish (slight corner rounding at extreme zoom is the accepted single-channel trade).
4. Toggle Print preview: the dithered preview shows the same glyphs (headless path bakes inline).

- [ ] **Step 2: Print raster check via the `/verify` skill**

Run the project's `/verify` skill (drives the real print flow in the automation Chrome and captures the print raster without hardware) against a label using an installed font. Confirm glyphs appear in the captured raster and match the on-screen preview.

- [ ] **Step 3: Regression sweep**

```bash
cd ~/src/weasel && npm test && npm run test:visual
cd ~/src/lbx-editor && npm test
```
All green.

- [ ] **Step 4: Wrap up**

Both branches complete. Use superpowers:finishing-a-development-branch for each repo (weasel first — lbx-editor's branch depends on weasel's new exports being on whatever ref the sibling checkout has).

---

## Out of scope (per spec — do not implement)

- Kerning for dynamic glyphs (future: measured-pair kerning).
- IndexedDB glyph cache (recommended never).
- `queryLocalFonts` dropdown enumeration.
- msdfgen-WASM runtime baking (Route B).
- Eviction/LRU for atlas pages.
