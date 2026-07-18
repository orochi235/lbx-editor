# Line & Text Rendering Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lines render/print/round-trip at their drawn angle; text renders as real glyphs on screen and in print.

**Architecture (root causes):** (A) `LabelLineData` stores no orientation — the line tool's endpoints are discarded at the insert factory, so screen (`rectPath` placeholder), print (horizontal midline), export (always TL→BR `points`) and import (ignores `points`) all improvise. Fix: a `descending: boolean` field + a shared `lineEndpoints` helper. (B) No glyphs are drawn anywhere — screen shows a 0.3px gray frame, print an outline box. Fix: a shared canvas text drawer (`src/textRender.ts`) used directly by the print path and, on screen, via a sync `OffscreenCanvas.transferToImageBitmap` cache emitting weasel's existing image draw command.

**Tech Stack:** existing app; weasel `polygonFromPoints` for the screen line path (a closed 2-point polygon strokes as the segment; no weasel changes). Vitest env is `node` — canvas work stays untested; pure helpers get unit tests.

**Conventions:** commit trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. App files use semicolons; `src/printing/` doesn't. No inline styles. Keep CLAUDE.md's "Current state" section in sync.

---

### Task A: Line orientation

**Files:**
- Modify: `src/label.ts`, `src/App.tsx`, `src/printing/labelRender.ts`, `src/lbxImport.ts`, `src/lbxExport.ts`
- Test: create `src/label.test.ts`

- [ ] **Step A1: Failing tests**

Create `src/label.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { lineEndpoints } from './label';

describe('lineEndpoints', () => {
  const pose = { x: 10, y: 20, width: 100, height: 40 };

  it('descending line runs top-left to bottom-right', () => {
    expect(lineEndpoints(pose, true)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 60 },
    ]);
  });

  it('ascending line runs bottom-left to top-right', () => {
    expect(lineEndpoints(pose, false)).toEqual([
      { x: 10, y: 60 },
      { x: 110, y: 20 },
    ]);
  });
});
```

Run `npx vitest run src/label.test.ts` — FAIL (no export).

- [ ] **Step A2: Data model + helper (`src/label.ts`)**

```typescript
export interface LabelLineData {
  kind: 'line';
  strokeStyle: string;
  strokeWidth: number;
  /** True: the line runs top-left → bottom-right of its pose box; false: bottom-left → top-right. */
  descending: boolean;
}
```

```typescript
/** The two endpoints of a line within its pose box, honoring its diagonal direction. */
export function lineEndpoints(
  pose: { x: number; y: number; width: number; height: number },
  descending: boolean,
): [{ x: number; y: number }, { x: number; y: number }] {
  return descending
    ? [{ x: pose.x, y: pose.y }, { x: pose.x + pose.width, y: pose.y + pose.height }]
    : [{ x: pose.x, y: pose.y + pose.height }, { x: pose.x + pose.width, y: pose.y }];
}
```

- [ ] **Step A3: Producers/consumers**

`src/App.tsx` line factory (~line 292): after computing `a`/`c`, add `descending: (c.x - a.x) * (c.y - a.y) >= 0` to the data literal.

`src/App.tsx` `drawLabelNode` 'line' case: replace the `rectPath` command with (import `polygonFromPoints` from weasel next to `rectPath`, and `lineEndpoints` from `./label`):

```typescript
    case 'line': {
      const [p, q] = lineEndpoints({ x, y, width, height }, data.descending);
      return [{
        kind: 'path',
        path: polygonFromPoints([p, q]),
        stroke: { paint: { color: data.strokeStyle }, width: data.strokeWidth },
      }];
    }
```

`src/printing/labelRender.ts` 'line' case (device coords already computed as x/y/w/h):

```typescript
      case 'line': {
        const [p, q] = lineEndpoints({ x, y, width: w, height: h }, data.descending)
        ctx.lineWidth = Math.max(1, data.strokeWidth * dotsPerPt)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(q.x, q.y)
        ctx.stroke()
        break
      }
```

(import `lineEndpoints` from `../label`).

`src/lbxExport.ts` 'line' case: `points` become the real endpoints:

```typescript
          points: lineEndpoints(pose, data.descending).map((p) => ({ x: p.x, y: p.y })),
```

`src/lbxImport.ts` 'line' case: derive the flag from the file's `points` when present, default true:

```typescript
    case 'line': {
      const pts = (obj as { points?: Array<{ x: number; y: number }> }).points;
      const descending =
        pts && pts.length >= 2 ? (pts[1]!.x - pts[0]!.x) * (pts[1]!.y - pts[0]!.y) >= 0 : true;
      return {
        id: genId(),
        pose,
        data: {
          kind: 'line',
          strokeStyle: obj.pen?.color ?? '#000000',
          strokeWidth: obj.pen?.widthX ?? 0.5,
          descending,
        },
      };
    }
```

(If the bil-lbx line type already declares `points`, drop the cast and use it directly.)

- [ ] **Step A4: Verify + commit**

`npm test && npm run build` — 62 tests (60 + 2), clean. Commit:

```bash
git add src/label.ts src/label.test.ts src/App.tsx src/printing/labelRender.ts src/lbxImport.ts src/lbxExport.ts
git commit -m "Store and honor line direction across screen, print, and .lbx round-trip"
```

---

### Task B: Real text rendering

**Files:**
- Create: `src/textRender.ts`, `src/textRender.test.ts`, `src/textBitmapCache.ts`
- Modify: `src/App.tsx` (drawLabelNode text case), `src/printing/labelRender.ts` (text case), `CLAUDE.md` (current-state note)

- [ ] **Step B1: Failing tests for the pure layout helpers**

Create `src/textRender.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { textLines, lineLayout } from './textRender';

describe('textLines', () => {
  it('splits on newlines, keeping empty lines', () => {
    expect(textLines('a\n\nb')).toEqual(['a', '', 'b']);
  });
});

describe('lineLayout', () => {
  const box = { x: 0, y: 0, width: 100, height: 60 };

  it('anchors left/center/right x', () => {
    expect(lineLayout(box, 1, 10, 'LEFT', 'TOP').x).toBe(0);
    expect(lineLayout(box, 1, 10, 'CENTER', 'TOP').x).toBe(50);
    expect(lineLayout(box, 1, 10, 'RIGHT', 'TOP').x).toBe(100);
    expect(lineLayout(box, 1, 10, 'JUSTIFY', 'TOP').x).toBe(0);
  });

  it('computes first baseline for TOP/CENTER/BOTTOM vertical alignment', () => {
    // lineHeight = fontSize * 1.2 = 12; ascent approximated at 0.8 * fontSize = 8
    expect(lineLayout(box, 2, 10, 'LEFT', 'TOP').firstBaseline).toBe(8);
    // block height = 2 * 12 = 24; centered: (60 - 24) / 2 + 8 = 26
    expect(lineLayout(box, 2, 10, 'LEFT', 'CENTER').firstBaseline).toBe(26);
    // bottom: 60 - 24 + 8 = 44
    expect(lineLayout(box, 2, 10, 'LEFT', 'BOTTOM').firstBaseline).toBe(44);
    expect(lineLayout(box, 2, 10, 'LEFT', 'TOP').lineHeight).toBe(12);
  });
});
```

Run — FAIL (module missing).

- [ ] **Step B2: Implement `src/textRender.ts`**

```typescript
import type { LabelTextData } from './label';

export interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Split label text into render lines (single-line boxes just yield one). */
export function textLines(text: string): string[] {
  return text.split('\n');
}

const LINE_HEIGHT_FACTOR = 1.2;
const ASCENT_FACTOR = 0.8;

/**
 * Layout for a block of `lineCount` lines in `box`: the anchor x for the given
 * horizontal alignment (JUSTIFY renders as LEFT), the y of the first baseline
 * for the given vertical alignment, and the line advance. Y values are
 * relative to box.y = 0; callers add box.y.
 */
export function lineLayout(
  box: TextBox,
  lineCount: number,
  fontSize: number,
  horizontal: LabelTextData['horizontalAlignment'],
  vertical: LabelTextData['verticalAlignment'],
): { x: number; firstBaseline: number; lineHeight: number; align: CanvasTextAlign } {
  const lineHeight = fontSize * LINE_HEIGHT_FACTOR;
  const ascent = fontSize * ASCENT_FACTOR;
  const blockHeight = lineCount * lineHeight;

  let x: number;
  let align: CanvasTextAlign;
  if (horizontal === 'CENTER') {
    x = box.x + box.width / 2;
    align = 'center';
  } else if (horizontal === 'RIGHT') {
    x = box.x + box.width;
    align = 'right';
  } else {
    x = box.x;
    align = 'left';
  }

  let firstBaseline: number;
  if (vertical === 'CENTER') {
    firstBaseline = (box.height - blockHeight) / 2 + ascent;
  } else if (vertical === 'BOTTOM') {
    firstBaseline = box.height - blockHeight + ascent;
  } else {
    firstBaseline = ascent;
  }

  return { x, firstBaseline, lineHeight, align };
}

/** CSS font string for a text node at the given size (already scaled by caller). */
export function cssFont(data: LabelTextData, fontSize: number): string {
  const style = data.italic ? 'italic ' : '';
  return `${style}${data.fontWeight} ${fontSize}px ${data.fontFamily}`;
}

/**
 * Draw a text node's glyphs into a 2D context, in the same coordinate space as
 * `box`. The context's transform handles any device scaling. Shared by the
 * print rasterizer and the on-screen bitmap cache so screen matches print.
 */
export function drawLabelText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  data: LabelTextData,
  box: TextBox,
): void {
  const lines = textLines(data.text);
  const { x, firstBaseline, lineHeight, align } = lineLayout(
    box, lines.length, data.fontSize, data.horizontalAlignment, data.verticalAlignment,
  );
  ctx.font = cssFont(data, data.fontSize);
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = data.color;
  lines.forEach((line, i) => {
    ctx.fillText(line, x, box.y + firstBaseline + i * lineHeight);
  });
}
```

Run the tests — PASS.

- [ ] **Step B3: Print path (`src/printing/labelRender.ts`)**

Replace the 'text' case. Print coords are dots with an anisotropic vertical squeeze, so draw in pt space under a transform (imports: `drawLabelText` from `../textRender` — printing module importing an app-level sibling is acceptable here; it already imports `../label` types):

```typescript
      case 'text':
        ctx.save()
        ctx.scale(dotsPerPt, dotsPerPt * verticalScale)
        drawLabelText(ctx, data, {
          x: pose.x,
          y: pose.y,
          width: pose.width,
          height: pose.height,
        })
        ctx.restore()
        break
```

(`fillStyle` is reset to black at the top of the loop each iteration? It is not — it's set once before the loop; `drawLabelText` sets its own `fillStyle`, and the image/rect cases that rely on black set it explicitly or restore it. Verify: the rect case restores `#000000` after a custom fill; drawLabelText changes fillStyle inside save/restore so it's contained. Confirm no other case depends on fillStyle persisting; adjust with save/restore if needed.)

- [ ] **Step B4: Screen path**

Create `src/textBitmapCache.ts` (mirrors `imageBitmapCache.ts`'s spirit; read that file first for style):

```typescript
import type { LabelTextData } from './label';
import { drawLabelText } from './textRender';

/** Supersampling factor for crispness under canvas zoom. */
const SCALE = 4;

const cache = new Map<string, ImageBitmap>();

/**
 * Rasterize a text node to a cached ImageBitmap at SCALE× the pose size.
 * Sync (OffscreenCanvas.transferToImageBitmap), so the first paint already has
 * glyphs. Cache is keyed by the text data + rounded box size; stale entries
 * for a node are overwritten naturally as the key changes (bounded: label
 * documents are small).
 */
export function getTextBitmap(data: LabelTextData, width: number, height: number): ImageBitmap | null {
  const w = Math.max(1, Math.round(width * SCALE));
  const h = Math.max(1, Math.round(height * SCALE));
  const key = JSON.stringify([data, w, h]);
  const hit = cache.get(key);
  if (hit) return hit;
  if (typeof OffscreenCanvas === 'undefined') return null;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(SCALE, SCALE);
  drawLabelText(ctx, data, { x: 0, y: 0, width, height });
  const bitmap = canvas.transferToImageBitmap();
  cache.set(key, bitmap);
  return bitmap;
}
```

`src/App.tsx` `drawLabelNode` 'text' case:

```typescript
    case 'text': {
      const bitmap = getTextBitmap(data, width, height);
      if (bitmap) {
        return [{ kind: 'image', image: bitmap, x, y, w: width, h: height }];
      }
      // Fallback: the old light frame so the node stays visible/selectable
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        stroke: { paint: { color: '#999999' }, width: 0.3 },
      }];
    }
```

(import `getTextBitmap`).

- [ ] **Step B5: Docs**

CLAUDE.md "Current state": replace "Text renders as bounding boxes (waiting on weasel MSDF font support for proper text rendering)" with "Text renders as real glyphs via a canvas rasterizer (`src/textRender.ts`) shared by screen (bitmap cache) and print; weasel MSDF text remains the eventual replacement for the screen path."

- [ ] **Step B6: Verify + commit**

`npm test && npm run build` — 66 tests (62 + 4), clean build. Then in the dev app: text visible on canvas; line + text sanity via a quick screenshot.

```bash
git add src/textRender.ts src/textRender.test.ts src/textBitmapCache.ts src/App.tsx src/printing/labelRender.ts CLAUDE.md
git commit -m "Render real text glyphs on screen and in print"
```
