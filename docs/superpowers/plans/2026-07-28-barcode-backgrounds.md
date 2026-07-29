# Barcode Backgrounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barcodes mask the label under them (so nothing prints into a space or
quiet zone a scanner reads as light), and their bars follow the cassette's ink
color on screen.

**Architecture:** A new `opaqueBackground` field on the barcode node drives one
extra fill command, prepended to the barcode's draw commands so it paints under
the bars. The rect it fills comes from a new `barcodeBackgroundRect` in
`src/barcode/geometry.ts`, which `ditherProtect` also adopts so the masked
region and the dither-protected region are one definition. Both barcode colors
(black bars, white background) are renderer-picked rather than document-stored,
so they arrive through a new `colors` parameter on `drawLabelNode` whose
defaults are the print values — screen passes the cassette's ink and tape
colors, print passes nothing.

**Tech Stack:** TypeScript, React, Vite, Vitest, weasel (`@weasel-js/core`),
bil-lbx.

**Spec:** `docs/superpowers/specs/2026-07-28-barcode-backgrounds-design.md`

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/barcode/geometry.ts` | Modify | Add `barcodeBackgroundRect`; add the deferred-work comment on `QUIET_ZONE_MODULES_1D` |
| `src/barcode/geometry.test.ts` | Modify | Cover the new rect, 1D and 2D |
| `src/barcode/index.ts` | Modify | Re-export `barcodeBackgroundRect` |
| `src/label.ts` | Modify | `opaqueBackground: boolean` on `LabelBarcodeData` |
| `src/ditherProtect.ts` | Modify | Call `barcodeBackgroundRect` instead of open-coding the inflation |
| `src/lbxImport.ts` | Modify | Always import `opaqueBackground: true` |
| `src/lbxImport.test.ts` | Modify | Pin `SOLID`/`NULL`/absent all → `true` |
| `src/lbxExport.ts` | Modify | Write `brush` `SOLID`/`NULL` |
| `src/barcodeExport.test.ts` | Modify | Pin the exported `brush` |
| `src/drawLabelNode.ts` | Create | Node → draw commands, moved out of `App.tsx` |
| `src/drawLabelNode.test.ts` | Create | Pin the color defaults and the background command |
| `src/App.tsx` | Modify | Import `drawLabelNode` instead of defining it; pass ink+paper from the screen wrapper; add the field to the insert factory |
| `src/label.ts` | Modify | Also hosts the `LabelNode` alias, moved off `App.tsx` |
| `src/PropertyPanel.tsx` | Modify | The "Opaque background" checkbox |
| `src/diagnostics.test.ts`, `src/ditherProtect.test.ts` | Modify | Fixtures gain the new required field |

`opaqueBackground` is deliberately **required**, not optional — that makes the
compiler list every construction site rather than letting one silently default.

---

## Task 1: `barcodeBackgroundRect`

**Files:**
- Modify: `src/barcode/geometry.ts`
- Modify: `src/barcode/index.ts`
- Test: `src/barcode/geometry.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/barcode/geometry.test.ts`. Note the import on line 2 gains
`barcodeBackgroundRect` and `QUIET_ZONE_MODULES_1D`/`QUIET_ZONE_MODULES_2D`:

```ts
import {
  barcodeRects,
  barcodeBackgroundRect,
  HUMAN_READABLE_HEIGHT_PT,
  QUIET_ZONE_MODULES_1D,
  QUIET_ZONE_MODULES_2D,
} from './geometry';
```

and append this block at the end of the file:

```ts
describe('barcodeBackgroundRect', () => {
  it('inflates the pose by the quiet zone on all four sides', () => {
    // oneD is 10 modules across a 20pt pose, so a module is 2pt and the
    // quiet zone is 10 * 2 = 20pt.
    const pose = { x: 5, y: 3, width: 20, height: 10 };
    const quiet = QUIET_ZONE_MODULES_1D * 2;

    expect(barcodeBackgroundRect(oneD, pose)).toEqual({
      x: pose.x - quiet,
      y: pose.y - quiet,
      width: pose.width + quiet * 2,
      height: pose.height + quiet * 2,
    });
  });

  it('uses the tighter 2d quiet zone', () => {
    const twoD: Symbol2D = {
      kind: '2d',
      size: 2,
      modules: [[true, false], [false, true]],
      text: 'X',
    };
    // Square side = min(20, 10) = 10 across 2 modules, so a module is 5pt.
    const pose = { x: 0, y: 0, width: 20, height: 10 };
    const quiet = QUIET_ZONE_MODULES_2D * 5;

    expect(barcodeBackgroundRect(twoD, pose)).toEqual({
      x: -quiet,
      y: -quiet,
      width: 20 + quiet * 2,
      height: 10 + quiet * 2,
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/barcode/geometry.test.ts`
Expected: FAIL — `barcodeBackgroundRect is not a function` (or a TS error that
it is not exported from `./geometry`).

- [ ] **Step 3: Implement it**

Append to `src/barcode/geometry.ts`, after `barcodeRects`:

```ts
/**
 * The region a barcode masks: its pose plus the quiet zone.
 *
 * Shared by the drawn background and `ditherProtect.protectedRegions`, so the
 * area we blank and the area we exempt from dithering are the same rectangle
 * by construction rather than by two copies agreeing.
 */
export function barcodeBackgroundRect(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
): Rect {
  const quiet = quietZonePt(symbol, pose);
  return {
    x: pose.x - quiet,
    y: pose.y - quiet,
    width: pose.width + quiet * 2,
    height: pose.height + quiet * 2,
  };
}
```

Then add the deferred-work note above `QUIET_ZONE_MODULES_1D` (replacing the
existing comment on those two constants):

```ts
/**
 * Blank margin a scanner needs on each side to find where the symbol starts:
 * 10 modules is the GS1 minimum shared by the 1D symbologies here, and the QR
 * spec asks for 4 cells.
 *
 * KNOWN INCONSISTENCY, deferred: this is applied *outside* the pose, but
 * `ean.ts` bakes 9 quiet modules *inside* its `totalModules` while code128 /
 * code39 / itf / codabar bake none. So the EAN family counts its quiet zone
 * twice and everything derived from this — the drawn background and the
 * dither-protected region — is about twice as wide as it needs to be there.
 * Fixing it changes `barcodeModulePt` and so redraws existing EAN labels ~19%
 * wider; which direction is correct needs a P-touch-authored file to settle.
 * See docs/superpowers/specs/2026-07-28-barcode-backgrounds-design.md.
 */
export const QUIET_ZONE_MODULES_1D = 10;
export const QUIET_ZONE_MODULES_2D = 4;
```

Add `barcodeBackgroundRect` to the `./geometry` export block in
`src/barcode/index.ts`:

```ts
export {
  barcodeRects,
  barcodeBackgroundRect,
  barcodeModulePt,
  quietZonePt,
  HUMAN_READABLE_HEIGHT_PT,
  QUIET_ZONE_MODULES_1D,
  QUIET_ZONE_MODULES_2D,
  type Rect,
} from './geometry';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/barcode/geometry.test.ts`
Expected: PASS, all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add src/barcode/geometry.ts src/barcode/geometry.test.ts src/barcode/index.ts
git commit -m "Name the region a barcode has to keep blank"
```

---

## Task 2: `ditherProtect` adopts the shared rect

The protected region must not change — the point is that it now comes from one
place. The existing tests are the regression check, so they stay untouched.

**Files:**
- Modify: `src/ditherProtect.ts`

- [ ] **Step 1: Run the existing tests to establish the baseline**

Run: `npx vitest run src/ditherProtect.test.ts`
Expected: PASS (6 tests). Note the count — it must be identical after the
change.

- [ ] **Step 2: Replace the open-coded inflation**

In `src/ditherProtect.ts`, change the import on line 19 from:

```ts
import { encodeBarcode, barcodeRequest, quietZonePt } from './barcode';
```

to:

```ts
import { encodeBarcode, barcodeRequest, barcodeBackgroundRect } from './barcode';
```

and replace the body of the loop after the `if (!symbol.ok) continue;` guard:

```ts
    const { pose } = node;
    const quiet = quietZonePt(symbol, pose);
    regions.push({
      x: (pose.x - quiet) * scale,
      y: (pose.y - geometry.band.y - quiet) * scale,
      width: (pose.width + quiet * 2) * scale,
      height: (pose.height + quiet * 2) * scale,
    });
```

with:

```ts
    // The same rectangle the barcode draws its opaque background over: what we
    // blank and what we exempt from dithering are one region, not two.
    const rect = barcodeBackgroundRect(symbol, node.pose);
    regions.push({
      x: rect.x * scale,
      y: (rect.y - geometry.band.y) * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    });
```

Also update the docblock sentence above `protectedRegions` that says "Each
barcode's whole pose is protected, plus its quiet zone" to name the shared
function:

```
 * Each barcode's region is `barcodeBackgroundRect` — its pose plus its quiet
 * zone, the same rectangle the barcode paints its opaque background over. The
 * pose includes the human-readable text below the bars, which is small type
 * that gains nothing from a dither either, and the quiet zone keeps the
 * diffuser from dropping a speck into the blank margin a scanner reads as the
 * symbol's edge. Barcodes that don't encode draw as a placeholder box and are
 * skipped — there's no symbol whose geometry needs preserving.
```

- [ ] **Step 3: Run the tests to verify they still pass**

Run: `npx vitest run src/ditherProtect.test.ts`
Expected: PASS, same 6 tests. A failure here means the shared rect is not the
rect that was being computed, and the shared rect is wrong — fix Task 1, not
this.

- [ ] **Step 4: Commit**

```bash
git add src/ditherProtect.ts
git commit -m "Protect the region the barcode blanks, not a copy of it"
```

---

## Task 3: The `opaqueBackground` field

Adding a required field breaks every construction site at compile time, which
is the point. This task adds the field and fixes the sites; behavior is
unchanged until Task 5 draws it.

**Files:**
- Modify: `src/label.ts:52-66`
- Modify: `src/lbxImport.ts:103-118`
- Modify: `src/App.tsx:872-889` (the `barcode` insert factory)
- Modify: `src/ditherProtect.test.ts:9-22`, `src/diagnostics.test.ts:13`, `src/barcodeExport.test.ts:12-22`

- [ ] **Step 1: Add the field**

In `src/label.ts`, inside `LabelBarcodeData`, after `zeroFill: boolean;`:

```ts
  /** Mask the label under the symbol and its quiet zone, so nothing prints
   *  into a space a scanner would read as light. */
  opaqueBackground: boolean;
```

- [ ] **Step 2: Run the type check to see every site that must decide**

Run: `npx tsc --noEmit`
Expected: FAIL — errors naming `src/lbxImport.ts`, `src/App.tsx`,
`src/ditherProtect.test.ts`, `src/diagnostics.test.ts`,
`src/barcodeExport.test.ts`, each "Property 'opaqueBackground' is missing".

- [ ] **Step 3: Fix each site**

`src/lbxImport.ts`, in the `case 'barcode':` data object, after
`zeroFill: obj.zeroFill ?? false,`:

```ts
          // Not readable from the file: bil-lbx's parseBrush collapses a NULL
          // brush to undefined, and its serializer writes an absent brush as
          // NULL, so "off" and "never set" are the same state in a .lbx. Always
          // importing it on is the safe direction to be lossy in — a reopened
          // barcode is opaque, which is scannable. See the design doc.
          opaqueBackground: true,
```

`src/App.tsx`, in the `barcode` insert factory's data object, after
`zeroFill: false,`:

```ts
        opaqueBackground: true,
```

In all three test files, add `opaqueBackground: true,` to the barcode fixture
literal (after `zeroFill: false,`):

- `src/ditherProtect.test.ts` — the `barcode()` factory's base object
- `src/diagnostics.test.ts` — the fixture at line 13
- `src/barcodeExport.test.ts` — the `BASE` constant

- [ ] **Step 4: Verify the type check and the suite are clean**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. Baseline on `main` at the time this
plan was written is **216 tests in 25 files**; Task 1 adds 2, so expect 218
here.

- [ ] **Step 5: Commit**

```bash
git add src/label.ts src/lbxImport.ts src/App.tsx src/ditherProtect.test.ts src/diagnostics.test.ts src/barcodeExport.test.ts
git commit -m "Give a barcode an opaque-background flag"
```

---

## Task 4: Export the flag as a brush

**Files:**
- Modify: `src/lbxExport.ts:90-101` (the barcode `objects.push`)
- Test: `src/barcodeExport.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/barcodeExport.test.ts`:

```ts
describe('opaque background export', () => {
  it('writes a solid white brush when the background is on', () => {
    const out = exportOne({ ...BASE, opaqueBackground: true }, { width: 120, height: 46 });
    expect(out.brush).toEqual({ style: 'SOLID', color: '#FFFFFF' });
  });

  it('writes a null brush when the background is off', () => {
    const out = exportOne({ ...BASE, opaqueBackground: false }, { width: 120, height: 46 });
    expect(out.brush).toEqual({ style: 'NULL' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/barcodeExport.test.ts`
Expected: FAIL — `expected undefined to deeply equal { style: 'SOLID', ... }`.

- [ ] **Step 3: Write the brush**

In `src/lbxExport.ts`, in the barcode `objects.push({ ... })` call, after
`zeroFill: data.zeroFill,`:

```ts
          // P-touch may or may not honor a brush on a barcode — unverified.
          // Written faithfully either way so the file states what we drew.
          // Note the reverse doesn't survive: bil-lbx parses a NULL brush back
          // as undefined, so import always yields opaqueBackground: true.
          brush: data.opaqueBackground
            ? { style: 'SOLID' as const, color: '#FFFFFF' }
            : { style: 'NULL' as const },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/barcodeExport.test.ts`
Expected: PASS.

- [ ] **Step 5: Pin the lossy import direction**

Append to the `describe('barcode objects', ...)` block in
`src/lbxImport.test.ts`:

```ts
  it('always imports the opaque background on, whatever the brush says', async () => {
    // bil-lbx parses a NULL brush back as undefined and serializes an absent
    // brush as NULL, so "off" and "never set" are indistinguishable in a .lbx.
    // Importing on is the safe direction: a reopened barcode is scannable.
    for (const brush of [
      { style: 'SOLID' as const, color: '#FFFFFF' },
      { style: 'NULL' as const },
      undefined,
    ]) {
      const config = label({ autoLength: false, paperHeight: 200, rightEdge: 100 });
      config.objects = [{ ...barcode, ...(brush ? { brush } : {}) }];
      const result = await importLbx(toArrayBuffer(await buildLbx(config)));

      expect(result.nodes[0]!.data).toMatchObject({ opaqueBackground: true });
    }
  });
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lbxImport.test.ts src/barcodeExport.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lbxExport.ts src/barcodeExport.test.ts src/lbxImport.test.ts
git commit -m "Record the opaque background as the barcode's brush"
```

---

## Task 5: Move `drawLabelNode` into its own module

**No behavior change.** This is a prerequisite, not a preference: a test cannot
import `./App`. Verified by probe —

```
Error: Cannot find module '.../node_modules/obwat/dist/types'
       imported from .../node_modules/obwat/dist/index.js
```

obwat's `dist` uses extensionless relative imports that vitest's node
resolution won't follow. Existing tests only ever import obwat *types*, which
are erased at compile time; `App.tsx` imports obwat values, so importing it
from a test loads obwat for real and dies. Every one of `drawLabelNode`'s own
dependencies (`@weasel-js/core`, `./fonts`, `./imageUtils`, `./label`,
`./barcode`) was probed and imports cleanly, so the moved module is testable
where `App.tsx` is not.

**Files:**
- Create: `src/drawLabelNode.ts`
- Modify: `src/label.ts` (gain the `LabelNode` alias), `src/App.tsx:93` (drop it), `src/App.tsx:160-250` (drop the function, import it)

- [ ] **Step 1: Move the `LabelNode` alias to `label.ts`**

`src/label.ts` currently imports only bil-lbx types. Add at the top:

```ts
import type { SceneNode } from '@weasel-js/core';
```

and after the `LabelPose` / `LabelLayer` declarations:

```ts
/** A scene node carrying this app's data. Lives here rather than in App.tsx
 *  so the renderer and its tests can name it without importing the app. */
export type LabelNode = SceneNode<LabelNodeData, LabelLayer, LabelPose>;
```

Weasel exports this as `SceneNode` (an alias of its internal `Node$1`), so the
named import above is the correct spelling.

- [ ] **Step 2: Create `src/drawLabelNode.ts`**

Move `drawLabelNode` from `src/App.tsx:160-250` verbatim — the whole function,
every `case`, unchanged — into a new `src/drawLabelNode.ts`, with this header
and the imports its body needs:

```ts
/**
 * Node → draw commands, shared by the on-screen canvas and the print raster:
 * `renderLabelToRgba` takes this as its `drawOne`, so print is the screen's
 * rendering at printer resolution and WYSIWYG holds by construction.
 *
 * Lives outside App.tsx so it can be tested. App.tsx imports obwat, whose dist
 * uses extensionless relative imports that vitest's node resolution can't
 * follow — importing the app from a test fails before any test runs. Nothing
 * here needs obwat.
 */
import {
  getImageBitmap,
  polygonFromPoints,
  rectPath,
  textCommand,
  type DrawCommand,
  type View,
} from '@weasel-js/core';
import {
  encodeBarcode,
  barcodeRects,
  barcodeRequest,
  HUMAN_READABLE_HEIGHT_PT,
} from './barcode';
import { substituteFontFamily, toWeaselAlign, toWeaselVerticalAlign } from './fonts';
import { imageDataUri } from './imageUtils';
import { lineEndpoints, type LabelNode, type LabelPose } from './label';

export function drawLabelNode(node: LabelNode, pose: LabelPose, _view: View): DrawCommand[] {
  // ...body moved unchanged from App.tsx
}
```

- [ ] **Step 3: Update `App.tsx`**

Delete the `LabelNode` type alias at line 93 and the whole `drawLabelNode`
function at lines 160-250. Add:

```ts
import { drawLabelNode } from './drawLabelNode';
```

and add `LabelNode` to the existing `./label` type import.

Then remove whatever imports `App.tsx` no longer uses. **`noUnusedLocals` is
not set in `tsconfig.json`, so `tsc` will not find these for you** — check each
candidate by hand:

```sh
for s in textCommand getImageBitmap lineEndpoints HUMAN_READABLE_HEIGHT_PT \
         imageDataUri barcodeRects toWeaselAlign toWeaselVerticalAlign \
         substituteFontFamily polygonFromPoints rectPath; do
  printf '%-26s %s\n' "$s" "$(grep -c "\b$s\b" src/App.tsx)"
done
```

A count of 1 means the import line is the only mention — remove it. Anything
higher is still used elsewhere in the file; leave it. Several of these *are*
used elsewhere (`rectPath` by the paper layer, for one), so do not delete on
suspicion.

- [ ] **Step 4: Verify nothing changed**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass, same count as before this task. This
is a pure move — a behavior difference here means something was edited that
shouldn't have been.

- [ ] **Step 5: Confirm the app still renders**

Run: `npm run dev` and load http://localhost:5180. The autosaved document
should draw exactly as before.

- [ ] **Step 6: Commit**

```bash
git add src/drawLabelNode.ts src/App.tsx src/label.ts
git commit -m "Move the node renderer out of App, where it can be tested"
```

---

## Task 6: Draw it, in ink and paper

`drawLabelNode` gains a `colors` parameter, draws the background, and stops
hardcoding black.

**Files:**
- Modify: `src/drawLabelNode.ts`
- Modify: `src/App.tsx` (`drawScreenNode`)
- Test: `src/drawLabelNode.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/drawLabelNode.test.ts`:

```ts
/**
 * The barcode's two colors are renderer-picked, not document-stored: the bars
 * are ink, the background is paper, and neither is a field the user sets. They
 * arrive through drawLabelNode's `colors` parameter, whose defaults are the
 * print values — so a call site that forgets the argument prints correctly
 * rather than printing a black box over the label.
 */
import { describe, it, expect } from 'vitest';
import type { DrawCommand, View } from '@weasel-js/core';
import { drawLabelNode } from './drawLabelNode';
import { encodeBarcode, barcodeRequest, barcodeBackgroundRect } from './barcode';
import type { LabelBarcodeData, LabelNode, LabelPose } from './label';

const pose: LabelPose = { x: 20, y: 12, width: 60, height: 24 };

const barcodeData: LabelBarcodeData = {
  kind: 'barcode',
  protocol: 'CODE128',
  data: 'SHELF-42',
  barWidth: 0.3,
  barRatio: '1:3',
  humanReadable: false,
  humanReadableAlignment: 'CENTER',
  checkDigit: false,
  zeroFill: false,
  opaqueBackground: true,
};

const node = (over: Partial<LabelBarcodeData> = {}): LabelNode => ({
  id: 'n1',
  pose,
  data: { ...barcodeData, ...over },
});

/** Solid-fill colors, in paint order. `'color' in fill` is the narrowing that
 *  works: FillStyle's solid variant leaves `fill` optional. */
function fills(commands: DrawCommand[]): string[] {
  return commands.flatMap((c) =>
    c.kind === 'path' && c.fill && 'color' in c.fill ? [c.fill.color] : [],
  );
}

// drawLabelNode ignores its view argument (`_view`).
const view = {} as View;

describe('drawLabelNode, barcode colors', () => {
  it('defaults to black bars on a white background', () => {
    const painted = fills(drawLabelNode(node(), pose, view));

    // The background is first, so it paints under the bars.
    expect(painted[0]).toBe('#ffffff');
    expect(new Set(painted.slice(1))).toEqual(new Set(['#000000']));
  });

  it('uses the cassette ink and tape colors when given them', () => {
    const painted = fills(
      drawLabelNode(node(), pose, view, { ink: '#2149c0', paper: '#f7d117' }),
    );

    expect(painted[0]).toBe('#f7d117');
    expect(new Set(painted.slice(1))).toEqual(new Set(['#2149c0']));
  });

  it('draws no background when the flag is off', () => {
    const painted = fills(drawLabelNode(node({ opaqueBackground: false }), pose, view));

    expect(new Set(painted)).toEqual(new Set(['#000000']));
  });

  it('covers exactly the pose plus its quiet zone', () => {
    const symbol = encodeBarcode(barcodeRequest(barcodeData));
    if (!symbol.ok) throw new Error('fixture should encode');
    const expected = barcodeBackgroundRect(symbol, pose);

    const [background] = drawLabelNode(node(), pose, view);
    // rectPath returns the RectPath fast-path subtype, which carries
    // x/y/width/height directly rather than a point list.
    if (background?.kind !== 'path' || background.path.kind !== 'rect') {
      throw new Error('expected a rect path');
    }
    const { x, y, width, height } = background.path;
    expect({ x, y, width, height }).toEqual(expected);

    // And that really is bigger than the pose, on every side.
    expect(x).toBeLessThan(pose.x);
    expect(y).toBeLessThan(pose.y);
    expect(x + width).toBeGreaterThan(pose.x + pose.width);
    expect(y + height).toBeGreaterThan(pose.y + pose.height);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/drawLabelNode.test.ts`
Expected: FAIL — the first two tests fail on the background color (nothing
paints `#ffffff` yet, and `#2149c0`/`#f7d117` are ignored), and
`drawLabelNode` rejects a 4th argument.

- [ ] **Step 3: Add the colors parameter**

In `src/drawLabelNode.ts`, replace the signature:

```ts
export function drawLabelNode(node: LabelNode, pose: LabelPose, _view: View): DrawCommand[] {
```

with:

```ts
/**
 * `colors` carries the two colors the *renderer* picks rather than the
 * document: a barcode's bars and its opaque background aren't fields the user
 * sets. Colors the document does carry go the other way, through
 * `remapNodeInk` before this is called. The defaults are the print values, so
 * a call site that forgets the argument prints correctly instead of laying a
 * black box over the label.
 */
export function drawLabelNode(
  node: LabelNode,
  pose: LabelPose,
  _view: View,
  colors: { ink?: string; paper?: string } = {},
): DrawCommand[] {
  const ink = colors.ink ?? '#000000';
  const paper = colors.paper ?? '#ffffff';
```

- [ ] **Step 4: Draw the background and use the ink color**

Add `barcodeBackgroundRect` to `src/drawLabelNode.ts`'s `./barcode` import:

```ts
import {
  encodeBarcode,
  barcodeRects,
  barcodeBackgroundRect,
  barcodeRequest,
  HUMAN_READABLE_HEIGHT_PT,
} from './barcode';
```

Replace the successful-encode half of the `case 'barcode':` block (from
`const commands: DrawCommand[] =` through `return commands;`) with:

```ts
      const commands: DrawCommand[] = [];
      if (data.opaqueBackground) {
        // Under the bars, so it masks whatever is below this node in the scene
        // and nothing above it. Covers the quiet zone as well as the symbol:
        // artwork in the blank margin is read as a bar. In the print raster
        // this is white, which the luminance threshold turns into no dots.
        const bg = barcodeBackgroundRect(symbol, pose);
        commands.push({
          kind: 'path',
          path: rectPath(bg.x, bg.y, bg.width, bg.height),
          fill: { fill: 'solid', color: paper },
        });
      }
      for (const r of barcodeRects(symbol, pose, data.humanReadable)) {
        commands.push({
          kind: 'path',
          path: rectPath(r.x, r.y, r.width, r.height),
          fill: { fill: 'solid', color: ink },
        });
      }
      if (data.humanReadable && symbol.kind === '1d') {
        commands.push(textCommand(
          x,
          y + height - HUMAN_READABLE_HEIGHT_PT,
          symbol.text,
          {
            fontFamily: substituteFontFamily('Helvetica'),
            fontSize: HUMAN_READABLE_HEIGHT_PT - 1,
            fontWeight: 400,
            fontStyle: 'normal',
            align: toWeaselAlign(data.humanReadableAlignment),
            fill: { fill: 'solid', color: ink },
          },
          width,
          HUMAN_READABLE_HEIGHT_PT,
          toWeaselVerticalAlign('BOTTOM'),
        ));
      }
      return commands;
```

Leave the unencodable-barcode branch above it alone: it has no symbol, so no
quiet zone to compute, and `printPreflight` blocks the job regardless.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/drawLabelNode.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Pass the cassette colors from the screen**

In `src/App.tsx`, replace `drawScreenNode` (around line 1243):

```ts
  const drawScreenNode = useCallback((node: LabelNode, pose: LabelPose, view: View) => {
    const data = remapNodeInk(node.data, inkCss);
    return drawLabelNode(data === node.data ? node : { ...node, data }, pose, view);
  }, [inkCss]);
```

with:

```ts
  // Two recolor paths, and they are not interchangeable. `remapNodeInk`
  // rewrites colors the *document* carries — a text's color, a rect's fill —
  // which it can only do because they're on the node. A barcode has none: its
  // bars and its background are picked by the renderer, so they come through
  // the `colors` argument instead. Print takes neither path: it keeps the raw
  // node data (a white-ink remap would erase the label under the <128
  // luminance threshold) and takes the parameter defaults.
  const drawScreenNode = useCallback((node: LabelNode, pose: LabelPose, view: View) => {
    const data = remapNodeInk(node.data, inkCss);
    return drawLabelNode(
      data === node.data ? node : { ...node, data },
      pose,
      view,
      { ink: inkCss, paper: tapeCss },
    );
  }, [inkCss, tapeCss]);
```

Note the dependency array gains `tapeCss`. Also update the comment block
immediately above it (lines 1240-1242, "Screen draw: same drawLabelNode as
print, but with ink-dark node colors recolored…") — the replacement above
supersedes it, so delete the old one.

- [ ] **Step 7: Verify the whole suite and the type check**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/drawLabelNode.ts src/drawLabelNode.test.ts src/App.tsx
git commit -m "Draw the barcode's blank ground, and its bars in the cassette ink"
```

---

## Task 7: The checkbox

**Files:**
- Modify: `src/PropertyPanel.tsx` (in `BarcodeFields`, before the `{isQr ? ... : ...}` branch)

- [ ] **Step 1: Add the control**

In `src/PropertyPanel.tsx`, immediately after the `ZERO_FILL_PROTOCOLS` block
and before `{isQr ? (`:

```tsx
      <label className="prop-check">
        <input
          type="checkbox"
          checked={data.opaqueBackground}
          onChange={(e) => update({ opaqueBackground: e.target.checked })}
        />
        Opaque background
      </label>
```

It sits outside the `isQr` branch because it applies to every symbology, unlike
the controls around it.

- [ ] **Step 2: Verify the type check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Confirm it in the running app**

Run: `npm run dev` (port 5180). Draw a barcode, select it, and confirm the
**Opaque background** checkbox appears in the property panel, starts checked,
and that unchecking it removes the blank margin around the symbol on canvas.

- [ ] **Step 4: Commit**

```bash
git add src/PropertyPanel.tsx
git commit -m "Let a barcode's background be turned off"
```

---

## Task 8: Verify against the real print flow

Unit tests cover the geometry and the color plumbing; they cannot show that the
mask actually lands on the printed raster.

**Files:** none — verification only.

- [x] **Step 1: Run the full suite and type check one more time**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass. Record the count.

Done 2026-07-28: `tsc` clean, 233/233 across 27 files.

- [x] **Step 2: Drive the real print flow**

Use the `verify` skill (`.claude/skills/verify`), which drives the print
pipeline in the automation Chrome without printer hardware. Dev server on 5180.

Build this label: an image object, with a Code 128 barcode overlapping it.

Confirm in the captured raster:
- the barcode's spaces are blank, with no image dots in them
- the blank margin extends past the bars on all sides
- the image is intact everywhere outside that margin

Done 2026-07-28. A 24mm × 200pt label: a diagonal-stripe image at
x=8pt w=184pt, and a Code 128 of `1337` at x=45pt w=100pt over it. The
captured 500×128 raster, counted by column:

| dot columns | content |
|---|---|
| 0–19 | blank (before the image) |
| 20–68 | image stripes |
| **69–111** | **blank — masked** |
| 112–362 | bars |
| **363–405** | **blank — masked** |
| 406–479 | image stripes |
| 480–499 | blank (after the image) |

The bars land on 112–362 against a pose of x=45pt w=100pt → dots
112.5–362.5, so the pose is the bars exactly, and the mask is 43 dots
(10 modules) on each side. Every masked column is blank over all 128
rows — the quiet zone erases the image outright rather than thinning it.

- [x] **Step 3: Confirm the ink color is screen-only**

In the Debug panel, override the cassette to a non-black ink (e.g. blue).

Confirm:
- the barcode's bars are blue on canvas, like the text and rects around them
- the captured print raster is still black — print takes the parameter
  defaults, not the cassette colors

Done 2026-07-28, on a blue-ink/yellow-tape override: bars draw blue and
the background draws in the tape yellow, so the mask is invisible against
the tape and visible only as the hole it cuts in the image — which is
what "the background is paper" means on screen.

Stronger than "still black": the raster captured after the override is
**byte-identical** to the one before it (same SHA-256), so the cassette
colors reach the screen and nothing else.

- [x] **Step 4: Confirm print preview agrees**

Turn on **Print preview**. The preview runs the real dither over the same
render, so the barcode should show as clean bars over blank tape — no dither
speckle inside the background, which is the `barcodeBackgroundRect` sharing
from Task 2 doing its job. Note the EAN caveat below: on an EAN barcode the
blank region will look wider than the symbol needs, and that is the known
double-count, not a bug in this work.

Done 2026-07-28, under Floyd–Steinberg: bars are clean-edged and the
background carries no dither speckle, right up against a striped image
that dithers heavily — the observable effect of `barcodeBackgroundRect`
feeding the mask and `protect` from one definition.

- [x] **Step 5: Open the captured raster so it can be seen**

Run: `open <path-to-captured-raster>`

- [x] **Step 6: Commit any doc updates**

Update `CLAUDE.md`'s barcode bullet under **Current state** to mention the
opaque background, and add a line to the barcode entry noting that bars follow
the cassette ink on screen. Then:

```bash
git add CLAUDE.md
git commit -m "Document the barcode's opaque background"
```

---

## Deferred, deliberately

Recorded in the spec's **Follow-up** section, in
`docs/handoff-barcode-support.md`, and now in a comment on
`QUIET_ZONE_MODULES_1D` itself:

- ~~**The quiet zone is inconsistent between encoders.**~~ Deferred past this
  plan, then fixed straight after it on the same branch: `ean.ts`'s `QUIET = 9`
  is gone, so `quietZonePt` is the only quiet zone and the EAN family stopped
  double-counting. `encode.test.ts` now pins the invariant across all nine 1D
  symbologies. See the spec's **Follow-up**.
- ~~**The off state doesn't survive an `.lbx` round-trip.**~~ Deferred past
  this plan, then done once bil-lbx 0.2.2 shipped `generator` on `LabelConfig`:
  a brush is read literally in files we wrote and ignored in everyone else's.
  The obstacle was never `parseBrush` — `SOLID` and `NULL` always survived
  distinctly — it was telling our files from P-touch's. See the spec's
  **Making it lossless**, including the correction about the legacy
  `brother-lbx` stamp.
