# Barcode Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Barcodes in .lbx files import, render on screen and on tape, export losslessly, and can be created from the tool palette.

**Architecture:** `.lbx` stores barcodes semantically (protocol + payload + parameters, no raster), so we encode them ourselves. Each symbology encoder is a pure function producing a resolution-independent symbol (1D bar runs in narrow-module units, or a 2D module matrix). A geometry layer turns a symbol plus the node's pose into rectangles in pt, which `drawLabelNode` emits as weasel path commands — so barcodes are vector on screen and at printer resolution, and print stays WYSIWYG by construction with no rasterize step. Protocols we don't encode keep their data and draw a placeholder, and block printing rather than printing a box where bars belong.

**Tech Stack:** TypeScript, vitest, weasel `defineTool` + `insertNodeFactories` (both public API), `qrcode-generator` (MIT, zero deps) for QR module matrices, `bwip-js` as a dev-only encoding oracle in tests.

---

## Design decisions locked in

**The pose is authoritative for geometry.** A symbol's module count is fixed by its payload; the drawn module width is `pose.width / totalModules`. This makes resize behave, keeps relative bar widths exact (all that scanners require), and preserves import fidelity because P-touch already sized `position.width` from its own `barWidth`. On export, `barWidth` is recomputed as `pose.width / totalModules` so P-touch redraws it identically.

**1D symbols** fill `pose.height`, less the human-readable text band when enabled. **2D symbols** draw as a centered square of side `min(pose.width, pose.height)`.

**Supported now:** CODE39, CODE128, GS1-128, EAN13, EAN8, UPCA, UPCE, QRCODE.
**Placeholder + print block:** ITF, CODABAR, DATAMATRIX, PDF417, MAXICODE, GS1DATABAR — and any supported protocol whose payload is invalid (bad length, bad characters, bad check digit).

**Why a dev-only oracle:** a barcode that looks right but carries a wrong check digit prints an unscannable label, and hand-transcribed bit patterns are exactly where that error enters. Every encoder is cross-checked against `bwip-js`'s raw encoder rather than against patterns typed from memory.

## File structure

| File | Responsibility |
|---|---|
| `src/barcode/types.ts` | `Symbol1D`, `Symbol2D`, `BarcodeSymbol`, `EncodeFailure` |
| `src/barcode/code39.ts` | Code 39 encoder |
| `src/barcode/code128.ts` | Code 128 + GS1-128 encoder |
| `src/barcode/ean.ts` | EAN-13/8, UPC-A/E encoder + check digits |
| `src/barcode/qr.ts` | QR module matrix via `qrcode-generator` |
| `src/barcode/encode.ts` | protocol dispatcher → `BarcodeSymbol \| EncodeFailure` |
| `src/barcode/geometry.ts` | symbol + pose + options → rects in pt, human-readable text box |
| `src/barcode/index.ts` | barrel |
| `src/label.ts` | add `LabelBarcodeData` to the `LabelNodeData` union |
| `src/lbxImport.ts` | map `BarcodeObject` → node |
| `src/lbxExport.ts` | map node → `BarcodeObject`, deriving `barWidth` |
| `src/App.tsx` | `drawLabelNode` barcode case, barcode tool, insert factory |
| `src/BarcodeIcon.tsx` | palette icon |
| `src/PropertyPanel.tsx` | protocol / data / human-readable / check-digit editing |
| `src/printPreflight.ts` | `unrenderableBarcodeMessage(count)` |

---

### Task 1: Model barcodes and stop losing them

Closes the data-loss hole first: a barcode survives import → edit → export even before anything renders.

**Files:**
- Modify: `src/label.ts`
- Modify: `src/lbxImport.ts:42-110` (`lbxObjectToNode`)
- Modify: `src/lbxExport.ts:36-85` (the object switch)
- Test: `src/lbxImport.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lbxImport.test.ts`:

```ts
import type { BarcodeObject } from 'bil-lbx';

describe('barcode objects', () => {
  const barcode: BarcodeObject = {
    type: 'barcode',
    position: { x: 20, y: 4, width: 60, height: 24 },
    protocol: 'CODE128',
    data: 'ABC-123',
    barWidth: 1.2,
    barRatio: '1:3',
    humanReadable: true,
    humanReadableAlignment: 'CENTER',
    checkDigit: false,
    zeroFill: false,
  };

  it('imports a barcode as a node instead of dropping it', async () => {
    const config = label({ autoLength: false, paperHeight: 200, rightEdge: 100 });
    config.objects = [barcode];
    const result = await importLbx(toArrayBuffer(await buildLbx(config)));

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]!.data).toMatchObject({
      kind: 'barcode',
      protocol: 'CODE128',
      data: 'ABC-123',
      humanReadable: true,
    });
    expect(result.nodes[0]!.pose).toEqual({ x: 20, y: 4, width: 60, height: 24 });
  });

  it('round-trips a barcode back out to .lbx', async () => {
    const config = label({ autoLength: false, paperHeight: 200, rightEdge: 100 });
    config.objects = [barcode];
    const imported = await importLbx(toArrayBuffer(await buildLbx(config)));

    const out = await exportLbx(
      imported.nodes.map((n) => ({ id: n.id, data: n.data, pose: n.pose })),
      '12mm',
      false,
      200,
      [],
    );
    const reimported = await importLbx(toArrayBuffer(out));

    expect(reimported.nodes[0]!.data).toMatchObject({
      kind: 'barcode',
      protocol: 'CODE128',
      data: 'ABC-123',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lbxImport.test.ts -t barcode`
Expected: FAIL — `expect(received).toHaveLength(1)` gets 0, because `lbxObjectToNode` returns `null` for barcodes.

- [ ] **Step 3: Add the data type**

In `src/label.ts`, add above `LabelNodeData` and include it in the union:

```ts
import type { BarcodeProtocol, QrEccLevel } from 'bil-lbx';

/** Mirrors bil-lbx's BarcodeObject minus `type`/`position` — those live in
 *  the node's kind and pose. Kept field-for-field so import/export is a
 *  rename, not a lossy projection. */
export interface LabelBarcodeData {
  kind: 'barcode';
  protocol: BarcodeProtocol;
  data: string;
  /** Narrow-module width in pt as the file recorded it. Geometry uses the
   *  pose instead (see the plan's design notes); this is re-derived on export. */
  barWidth: number;
  barRatio: string;
  humanReadable: boolean;
  humanReadableAlignment: 'LEFT' | 'CENTER' | 'RIGHT';
  checkDigit: boolean;
  zeroFill: boolean;
  qrCode?: { model?: number; eccLevel?: QrEccLevel; cellSize?: number; version?: string };
}

export type LabelNodeData =
  | LabelTextData | LabelRectData | LabelLineData | LabelImageData | LabelBarcodeData;
```

- [ ] **Step 4: Map it on import**

In `src/lbxImport.ts`, add to the switch in `lbxObjectToNode`:

```ts
    case 'barcode':
      return {
        id: genId(),
        pose,
        data: {
          kind: 'barcode',
          protocol: obj.protocol,
          data: obj.data,
          barWidth: obj.barWidth ?? 1.2,
          barRatio: obj.barRatio ?? '1:3',
          humanReadable: obj.humanReadable ?? false,
          humanReadableAlignment: obj.humanReadableAlignment ?? 'CENTER',
          checkDigit: obj.checkDigit ?? false,
          zeroFill: obj.zeroFill ?? false,
          ...(obj.qrCode ? { qrCode: obj.qrCode } : {}),
        },
      };
```

- [ ] **Step 5: Map it on export**

In `src/lbxExport.ts`, add to the object switch (`barWidth` is re-derived in Task 6 once `totalModules` exists; until then carry the imported value through):

```ts
      case 'barcode': {
        objects.push({
          type: 'barcode',
          position: { x: pose.x, y: pose.y, width: pose.width, height: pose.height },
          protocol: data.protocol,
          data: data.data,
          barWidth: data.barWidth,
          barRatio: data.barRatio,
          humanReadable: data.humanReadable,
          humanReadableAlignment: data.humanReadableAlignment,
          checkDigit: data.checkDigit,
          zeroFill: data.zeroFill,
          ...(data.qrCode ? { qrCode: data.qrCode } : {}),
        });
        break;
      }
```

- [ ] **Step 6: Give `drawLabelNode` a placeholder so the union stays exhaustive**

In `src/App.tsx` `drawLabelNode`, before `default:`:

```ts
    case 'barcode':
      // Real rendering lands in Task 6; until then a visible box beats an
      // invisible node the user can't select or move.
      return [{
        kind: 'path',
        path: rectPath(x, y, width, height),
        fill: { fill: 'solid', color: '#f6f6f6' },
        stroke: { paint: { color: '#999999' }, width: 0.5 },
      }];
```

- [ ] **Step 7: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, including the two new barcode tests. `tsc` catches any other place the widened union needs a case.

- [ ] **Step 8: Commit**

```bash
git add src/label.ts src/lbxImport.ts src/lbxExport.ts src/App.tsx src/lbxImport.test.ts
git commit -m "Preserve barcode objects through import and export"
```

---

### Task 2: Symbol types and the encode dispatcher

**Files:**
- Create: `src/barcode/types.ts`, `src/barcode/encode.ts`, `src/barcode/index.ts`
- Test: `src/barcode/encode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { encodeBarcode } from './encode';

describe('encodeBarcode', () => {
  it('reports unsupported protocols instead of throwing', () => {
    const result = encodeBarcode({ protocol: 'MAXICODE', data: '123' });
    expect(result).toEqual({ ok: false, reason: 'unsupported', detail: 'MAXICODE' });
  });

  it('reports invalid payloads', () => {
    const result = encodeBarcode({ protocol: 'EAN13', data: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/barcode/encode.test.ts`
Expected: FAIL — cannot resolve `./encode`.

- [ ] **Step 3: Write the types**

`src/barcode/types.ts`:

```ts
/**
 * Resolution-independent barcode symbols. Encoders emit these; geometry.ts
 * turns them into pt rectangles. Nothing here knows about pt, poses, or canvas.
 */

/** A 1D symbol as bar runs measured in narrow modules from the symbol's left
 *  edge, quiet zones included. */
export interface Symbol1D {
  kind: '1d';
  /** Dark runs. `x` and `width` are in narrow-module units. */
  bars: Array<{ x: number; width: number }>;
  /** Total symbol width in narrow-module units, quiet zones included. */
  totalModules: number;
  /** What a scanner reads back — the payload plus any computed check digit.
   *  This is what the human-readable band shows, not the raw input. */
  text: string;
}

/** A 2D symbol as a square module matrix. `modules[row][col]` is true for dark. */
export interface Symbol2D {
  kind: '2d';
  size: number;
  modules: boolean[][];
  text: string;
}

export type BarcodeSymbol = Symbol1D | Symbol2D;

export interface EncodeFailure {
  ok: false;
  /** `unsupported` — we don't implement this symbology.
   *  `invalid` — we do, but the payload can't be encoded in it. */
  reason: 'unsupported' | 'invalid';
  detail: string;
}

export type EncodeResult = ({ ok: true } & BarcodeSymbol) | EncodeFailure;
```

- [ ] **Step 4: Write the dispatcher**

`src/barcode/encode.ts` — each `case` is filled in by Tasks 3-6; ship it failing-closed first:

```ts
import type { BarcodeProtocol } from 'bil-lbx';
import type { EncodeResult } from './types';

export interface EncodeRequest {
  protocol: BarcodeProtocol;
  data: string;
  checkDigit?: boolean;
  zeroFill?: boolean;
  barRatio?: string;
  qrCode?: { eccLevel?: string; version?: string };
}

/** Encode a payload, or say why we can't. Never throws — a bad payload is a
 *  normal state the canvas renders as a placeholder. */
export function encodeBarcode(req: EncodeRequest): EncodeResult {
  switch (req.protocol) {
    default:
      return { ok: false, reason: 'unsupported', detail: req.protocol };
  }
}
```

`src/barcode/index.ts`:

```ts
export { encodeBarcode, type EncodeRequest } from './encode';
export type { BarcodeSymbol, Symbol1D, Symbol2D, EncodeResult, EncodeFailure } from './types';
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/barcode/encode.test.ts`
Expected: the `MAXICODE` test PASSES; the `EAN13` test FAILS with `reason: 'unsupported'` instead of `'invalid'`. Mark that one `it.skip` with a `// unskipped in Task 5` comment — do not weaken the assertion to match the stub.

- [ ] **Step 6: Commit**

```bash
git add src/barcode
git commit -m "Add barcode symbol types and encode dispatcher"
```

---

### Task 3: Code 39

**Files:**
- Create: `src/barcode/code39.ts`, `src/barcode/code39.test.ts`
- Modify: `src/barcode/encode.ts`
- Modify: `package.json` (devDependency)

- [ ] **Step 1: Install the test oracle**

```bash
npm install --save-dev bwip-js
```

- [ ] **Step 2: Write the failing test**

`src/barcode/code39.test.ts`. `toBwipModules` converts our symbol to the run-length string bwip-js reports, so the two are compared on identical ground:

```ts
import { describe, it, expect } from 'vitest';
import bwipjs from 'bwip-js';
import { encodeCode39 } from './code39';
import type { Symbol1D } from './types';

/** Our symbol as a flat module bitstring, quiet zones trimmed. */
function bitstring(sym: Symbol1D): string {
  const bits = new Array<string>(sym.totalModules).fill('0');
  for (const bar of sym.bars) {
    for (let i = 0; i < bar.width; i++) bits[bar.x + i] = '1';
  }
  return bits.join('').replace(/^0+|0+$/g, '');
}

/** bwip-js's raw encoder, as the same bitstring. */
function oracle(bcid: string, text: string, opts: Record<string, unknown> = {}): string {
  const [enc] = bwipjs.raw(bcid, text, opts as never);
  return enc.bbs
    .map((bar: number, i: number) => '1'.repeat(bar) + '0'.repeat(enc.bhs[i] ?? 0))
    .join('')
    .replace(/^0+|0+$/g, '');
}

describe('encodeCode39', () => {
  it('matches the reference encoder', () => {
    for (const payload of ['A', 'ABC-123', 'HELLO WORLD', '0123456789']) {
      const sym = encodeCode39(payload, { ratio: 3 });
      expect(sym.ok).toBe(true);
      if (!sym.ok) return;
      expect(bitstring(sym)).toBe(oracle('code39', payload));
    }
  });

  it('rejects characters outside the Code 39 alphabet', () => {
    const sym = encodeCode39('lower', { ratio: 3 });
    expect(sym).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('honors the narrow:wide ratio', () => {
    const narrow = encodeCode39('A', { ratio: 2 });
    const wide = encodeCode39('A', { ratio: 3 });
    expect(narrow.ok && wide.ok).toBe(true);
    if (!narrow.ok || !wide.ok) return;
    expect(wide.totalModules).toBeGreaterThan(narrow.totalModules);
  });
});
```

If `bwipjs.raw`'s shape differs from the above at implementation time, adapt `oracle()` to whatever it returns — but keep the cross-check. Do not replace it with hand-typed bit patterns.

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/barcode/code39.test.ts`
Expected: FAIL — cannot resolve `./code39`.

- [ ] **Step 4: Implement**

`src/barcode/code39.ts`. Code 39 encodes each character as 9 elements (5 bars, 4 spaces) of which exactly 3 are wide, with a 1-narrow-module gap between characters and `*` as start/stop:

```ts
import type { EncodeResult } from './types';

/** Element widths per character: 9 elements, bar-first, alternating.
 *  'n' = narrow (1 module), 'w' = wide (ratio modules). */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export interface Code39Options {
  /** Wide-element width in narrow modules (the "1:N" bar ratio). */
  ratio: number;
}

export function encodeCode39(data: string, opts: Code39Options): EncodeResult {
  const payload = data.toUpperCase();
  for (const ch of payload) {
    if (!(ch in PATTERNS) || ch === '*') {
      return { ok: false, reason: 'invalid', detail: `Code 39 can't encode "${ch}"` };
    }
  }

  const bars: Array<{ x: number; width: number }> = [];
  let x = 0;
  const chars = `*${payload}*`;
  for (let c = 0; c < chars.length; c++) {
    const pattern = PATTERNS[chars[c]!]!;
    for (let e = 0; e < pattern.length; e++) {
      const width = pattern[e] === 'w' ? opts.ratio : 1;
      if (e % 2 === 0) bars.push({ x, width }); // even elements are bars
      x += width;
    }
    if (c < chars.length - 1) x += 1; // inter-character gap
  }

  return { ok: true, kind: '1d', bars, totalModules: x, text: payload };
}
```

If the cross-check fails on a specific character, the `PATTERNS` entry for it is wrong — fix the table, never the assertion.

- [ ] **Step 5: Wire it into the dispatcher**

In `src/barcode/encode.ts`, add above `default:`:

```ts
    case 'CODE39':
      return encodeCode39(req.data, { ratio: parseRatio(req.barRatio) });
```

and add the helper plus its import:

```ts
import { encodeCode39 } from './code39';

/** ".lbx records the bar ratio as "1:N"; default 1:3 when absent or unparseable. */
export function parseRatio(barRatio: string | undefined): number {
  const n = Number(barRatio?.split(':')[1]);
  return Number.isFinite(n) && n >= 2 && n <= 3 ? n : 3;
}
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/barcode/`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/barcode package.json package-lock.json
git commit -m "Encode Code 39"
```

---

### Task 4: Code 128 and GS1-128

**Files:**
- Create: `src/barcode/code128.ts`, `src/barcode/code128.test.ts`
- Modify: `src/barcode/encode.ts`

- [ ] **Step 1: Write the failing test**

`src/barcode/code128.test.ts` — reuse the `bitstring` / `oracle` helpers from `code39.test.ts` by extracting them first into `src/barcode/testOracle.ts` (do that extraction now, and update `code39.test.ts` to import from it):

```ts
import { describe, it, expect } from 'vitest';
import { encodeCode128 } from './code128';
import { bitstring, oracle } from './testOracle';

describe('encodeCode128', () => {
  it('matches the reference encoder across code sets', () => {
    for (const payload of ['ABC-123', '0123456789', 'Mixed Case 42', ' abc']) {
      const sym = encodeCode128(payload, { gs1: false });
      expect(sym.ok).toBe(true);
      if (!sym.ok) return;
      expect(bitstring(sym)).toBe(oracle('code128', payload));
    }
  });

  it('encodes numeric runs in code set C', () => {
    // Twelve digits pack two-per-symbol in C, so the symbol is far shorter
    // than the same payload forced through B.
    const numeric = encodeCode128('123456789012', { gs1: false });
    const alpha = encodeCode128('abcdefghijkl', { gs1: false });
    expect(numeric.ok && alpha.ok).toBe(true);
    if (!numeric.ok || !alpha.ok) return;
    expect(numeric.totalModules).toBeLessThan(alpha.totalModules);
  });

  it('matches the reference encoder for GS1-128', () => {
    const sym = encodeCode128('(01)09501101020917', { gs1: true });
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(bitstring(sym)).toBe(oracle('gs1-128', '(01)09501101020917'));
  });

  it('rejects characters outside Latin-1', () => {
    expect(encodeCode128('emoji 🙂', { gs1: false })).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/barcode/code128.test.ts`
Expected: FAIL — cannot resolve `./code128`.

- [ ] **Step 3: Implement**

`src/barcode/code128.ts`. Structure:

1. `WIDTHS: string[]` — the 107 Code 128 patterns, each 6 digits of element widths (e.g. `'212222'` for value 0), plus the stop pattern `'2331112'`.
2. `chooseCodeSet(data)` — start in C if the payload opens with 4+ digits (2+ if the whole payload is digits), else B; switch into C on any run of 6+ digits and back to B after.
3. Accumulate symbol values, compute the checksum as `(start + Σ value_i × position_i) mod 103`, append it, then the stop pattern.
4. Expand the width digits into `bars` exactly as Code 39 does (even elements are bars), plus a 10-module quiet zone at each end.
5. GS1: emit FNC1 (value 102) as the first symbol after start, strip the `(NN)` AI parentheses from the encoded payload but keep them in `text`.

Return `{ ok: false, reason: 'invalid', detail }` for any code point above 255.

- [ ] **Step 4: Wire it into the dispatcher**

```ts
    case 'CODE128':
      return encodeCode128(req.data, { gs1: false });
    case 'GS1-128':
      return encodeCode128(req.data, { gs1: true });
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/barcode/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/barcode
git commit -m "Encode Code 128 and GS1-128"
```

---

### Task 5: EAN and UPC

**Files:**
- Create: `src/barcode/ean.ts`, `src/barcode/ean.test.ts`
- Modify: `src/barcode/encode.ts`, `src/barcode/encode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { encodeEan, eanCheckDigit } from './ean';
import { bitstring, oracle } from './testOracle';

describe('eanCheckDigit', () => {
  it('computes the published check digit', () => {
    // GS1's own worked example.
    expect(eanCheckDigit('629104150021')).toBe(3);
  });
});

describe('encodeEan', () => {
  it('matches the reference encoder', () => {
    const cases: Array<[Parameters<typeof encodeEan>[1], string, string]> = [
      ['EAN13', '5901234123457', 'ean13'],
      ['EAN8', '96385074', 'ean8'],
      ['UPCA', '036000291452', 'upca'],
      ['UPCE', '01234565', 'upce'],
    ];
    for (const [protocol, payload, bcid] of cases) {
      const sym = encodeEan(payload, protocol, { zeroFill: false });
      expect(sym.ok, `${protocol} ${payload}`).toBe(true);
      if (!sym.ok) return;
      expect(bitstring(sym), protocol).toBe(oracle(bcid, payload));
    }
  });

  it('appends the check digit when the payload omits it', () => {
    const sym = encodeEan('590123412345', 'EAN13', { zeroFill: false });
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(sym.text).toBe('5901234123457');
  });

  it('rejects a wrong check digit', () => {
    expect(encodeEan('5901234123450', 'EAN13', { zeroFill: false }))
      .toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects non-digits and wrong lengths', () => {
    expect(encodeEan('59012341234A', 'EAN13', { zeroFill: false })).toMatchObject({ ok: false });
    expect(encodeEan('123', 'EAN13', { zeroFill: false })).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/barcode/ean.test.ts`
Expected: FAIL — cannot resolve `./ean`.

- [ ] **Step 3: Implement**

`src/barcode/ean.ts`:

- `eanCheckDigit(digits)` — sum from the right, alternating ×3 and ×1, then `(10 - sum % 10) % 10`.
- `L`, `G`, `R` digit patterns (7 modules each) and the EAN-13 parity table selecting L/G per first digit.
- Guard patterns: start/end `101`, centre `01010`; EAN-8 uses the same guards with 4+4 digits; UPC-A is EAN-13 with a leading `0`; UPC-E expands to its UPC-A equivalent before encoding.
- Accept the payload with or without the trailing check digit: if the length matches the symbology *including* the check digit, verify it and fail on mismatch; if it's one short, compute and append.
- `zeroFill: true` left-pads a short numeric payload with zeros before the length check.
- Quiet zones: 9 modules leading, 7 trailing (EAN-13/8), 9 both sides for UPC.

- [ ] **Step 4: Wire it into the dispatcher and unskip the Task 2 test**

```ts
    case 'EAN13': case 'EAN8': case 'UPCA': case 'UPCE':
      return encodeEan(req.data, req.protocol, { zeroFill: req.zeroFill ?? false });
```

Remove the `.skip` from the `EAN13` invalid-payload test in `src/barcode/encode.test.ts` if Task 2 skipped it.

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/barcode/`
Expected: PASS, including the previously-failing dispatcher test.

- [ ] **Step 6: Commit**

```bash
git add src/barcode
git commit -m "Encode EAN-13/8 and UPC-A/E"
```

---

### Task 6: QR codes

**Files:**
- Create: `src/barcode/qr.ts`, `src/barcode/qr.test.ts`
- Modify: `src/barcode/encode.ts`, `package.json`

- [ ] **Step 1: Install the encoder**

```bash
npm install qrcode-generator
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { encodeQr } from './qr';

describe('encodeQr', () => {
  it('produces a square module matrix', () => {
    const sym = encodeQr('https://example.com', {});
    expect(sym.ok).toBe(true);
    if (!sym.ok || sym.kind !== '2d') return;
    expect(sym.modules).toHaveLength(sym.size);
    expect(sym.modules[0]).toHaveLength(sym.size);
  });

  it('places the three finder patterns', () => {
    const sym = encodeQr('TEST', {});
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2d symbol');
    const corner = (r0: number, c0: number) => sym.modules[r0]!.slice(c0, c0 + 7).every(Boolean);
    expect(corner(0, 0)).toBe(true);                    // top-left
    expect(corner(0, sym.size - 7)).toBe(true);         // top-right
    expect(corner(sym.size - 7, 0)).toBe(true);         // bottom-left
  });

  it('grows with payload length', () => {
    const short = encodeQr('A', {});
    const long = encodeQr('A'.repeat(200), {});
    if (!short.ok || !long.ok || short.kind !== '2d' || long.kind !== '2d') throw new Error('bad');
    expect(long.size).toBeGreaterThan(short.size);
  });

  it('rejects a payload too large for any version', () => {
    expect(encodeQr('A'.repeat(10000), {})).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/barcode/qr.test.ts`
Expected: FAIL — cannot resolve `./qr`.

- [ ] **Step 4: Implement**

`src/barcode/qr.ts`:

```ts
import qrcode from 'qrcode-generator';
import type { EncodeResult } from './types';

const ECC: Record<string, 'L' | 'M' | 'Q' | 'H'> = {
  '7%': 'L', '15%': 'M', '25%': 'Q', '30%': 'H',
};

export interface QrOptions {
  /** .lbx records ECC as a percentage string; default 15% (M), P-touch's default. */
  eccLevel?: string;
  /** .lbx version, "auto" or "1".."40". */
  version?: string;
}

export function encodeQr(data: string, opts: QrOptions): EncodeResult {
  const level = ECC[opts.eccLevel ?? '15%'] ?? 'M';
  const typeNumber = Number(opts.version);
  try {
    // 0 = auto-select the smallest version that fits.
    const qr = qrcode(Number.isInteger(typeNumber) ? (typeNumber as never) : 0, level);
    qr.addData(data);
    qr.make();
    const size = qr.getModuleCount();
    const modules = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) => qr.isDark(r, c)),
    );
    return { ok: true, kind: '2d', size, modules, text: data };
  } catch (err) {
    return { ok: false, reason: 'invalid', detail: String(err) };
  }
}
```

- [ ] **Step 5: Wire it into the dispatcher**

```ts
    case 'QRCODE':
      return encodeQr(req.data, { eccLevel: req.qrCode?.eccLevel, version: req.qrCode?.version });
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/barcode/ && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/barcode package.json package-lock.json
git commit -m "Encode QR codes"
```

---

### Task 7: Geometry and rendering

**Files:**
- Create: `src/barcode/geometry.ts`, `src/barcode/geometry.test.ts`
- Modify: `src/App.tsx` (`drawLabelNode`), `src/lbxExport.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { barcodeRects, HUMAN_READABLE_HEIGHT_PT } from './geometry';
import type { Symbol1D, Symbol2D } from './types';

const oneD: Symbol1D = {
  kind: '1d',
  bars: [{ x: 0, width: 1 }, { x: 2, width: 2 }],
  totalModules: 10,
  text: 'X',
};

describe('barcodeRects', () => {
  it('scales modules to fill the pose width', () => {
    const rects = barcodeRects(oneD, { x: 0, y: 0, width: 20, height: 10 }, false);
    // 10 modules across 20pt = 2pt per module.
    expect(rects).toEqual([
      { x: 0, y: 0, width: 2, height: 10 },
      { x: 4, y: 0, width: 4, height: 10 },
    ]);
  });

  it('offsets by the pose origin', () => {
    const rects = barcodeRects(oneD, { x: 5, y: 3, width: 20, height: 10 }, false);
    expect(rects[0]).toEqual({ x: 5, y: 3, width: 2, height: 10 });
  });

  it('shortens the bars to make room for human-readable text', () => {
    const rects = barcodeRects(oneD, { x: 0, y: 0, width: 20, height: 10 }, true);
    expect(rects[0]!.height).toBe(10 - HUMAN_READABLE_HEIGHT_PT);
  });

  it('draws a 2d symbol as a centered square', () => {
    const twoD: Symbol2D = {
      kind: '2d',
      size: 2,
      modules: [[true, false], [false, true]],
      text: 'X',
    };
    const rects = barcodeRects(twoD, { x: 0, y: 0, width: 20, height: 10 }, false);
    // Square side = min(20, 10) = 10, centered horizontally at x=5, module = 5pt.
    expect(rects).toEqual([
      { x: 5, y: 0, width: 5, height: 5 },
      { x: 10, y: 5, width: 5, height: 5 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/barcode/geometry.test.ts`
Expected: FAIL — cannot resolve `./geometry`.

- [ ] **Step 3: Implement**

`src/barcode/geometry.ts`:

```ts
import type { BarcodeSymbol } from './types';

/** Height reserved below a 1D symbol for its human-readable text, in pt. */
export const HUMAN_READABLE_HEIGHT_PT = 8;

export interface Rect { x: number; y: number; width: number; height: number }

/**
 * Lay a symbol out inside `pose`. The pose is authoritative: 1D modules scale
 * to fill its width, 2D symbols draw as a centered square of the smaller
 * dimension. Returns the dark rectangles in pt, in label coordinates.
 */
export function barcodeRects(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
  humanReadable: boolean,
): Rect[] {
  if (symbol.kind === '2d') {
    const side = Math.min(pose.width, pose.height);
    const module = side / symbol.size;
    const originX = pose.x + (pose.width - side) / 2;
    const originY = pose.y + (pose.height - side) / 2;
    const rects: Rect[] = [];
    for (let r = 0; r < symbol.size; r++) {
      for (let c = 0; c < symbol.size; c++) {
        if (symbol.modules[r]![c]) {
          rects.push({
            x: originX + c * module,
            y: originY + r * module,
            width: module,
            height: module,
          });
        }
      }
    }
    return rects;
  }

  const module = pose.width / symbol.totalModules;
  const barsHeight = humanReadable
    ? Math.max(0, pose.height - HUMAN_READABLE_HEIGHT_PT)
    : pose.height;
  return symbol.bars.map((bar) => ({
    x: pose.x + bar.x * module,
    y: pose.y,
    width: bar.width * module,
    height: barsHeight,
  }));
}
```

- [ ] **Step 4: Render it**

In `src/App.tsx`, replace the Task 1 placeholder case with:

```ts
    case 'barcode': {
      const symbol = encodeBarcode({
        protocol: data.protocol,
        data: data.data,
        checkDigit: data.checkDigit,
        zeroFill: data.zeroFill,
        barRatio: data.barRatio,
        ...(data.qrCode ? { qrCode: data.qrCode } : {}),
      });
      if (!symbol.ok) {
        // Can't encode it — draw a box so the node stays visible and
        // selectable. printPreflight blocks the job rather than printing this.
        return [{
          kind: 'path',
          path: rectPath(x, y, width, height),
          fill: { fill: 'solid', color: '#f6f6f6' },
          stroke: { paint: { color: '#999999' }, width: 0.5 },
        }];
      }
      const commands: DrawCommand[] = barcodeRects(symbol, pose, data.humanReadable).map((r) => ({
        kind: 'path',
        path: rectPath(r.x, r.y, r.width, r.height),
        fill: { fill: 'solid', color: '#000000' },
      }));
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
            fill: { fill: 'solid', color: '#000000' },
          },
          width,
          HUMAN_READABLE_HEIGHT_PT,
          toWeaselVerticalAlign('BOTTOM'),
        ));
      }
      return commands;
    }
```

Add the imports: `import { encodeBarcode, barcodeRects, HUMAN_READABLE_HEIGHT_PT } from './barcode';` (re-export `barcodeRects` and `HUMAN_READABLE_HEIGHT_PT` from `src/barcode/index.ts`).

- [ ] **Step 5: Derive `barWidth` on export**

In `src/lbxExport.ts`'s barcode case, replace `barWidth: data.barWidth` with a value computed from the pose so P-touch redraws the symbol at the size we drew it:

```ts
        // The pose is authoritative for us; P-touch sizes from barWidth. Derive
        // it so the two agree. Falls back to the imported value when the payload
        // doesn't encode (nothing better to say).
        const encoded = encodeBarcode({
          protocol: data.protocol, data: data.data,
          checkDigit: data.checkDigit, zeroFill: data.zeroFill, barRatio: data.barRatio,
          ...(data.qrCode ? { qrCode: data.qrCode } : {}),
        });
        const barWidth = encoded.ok && encoded.kind === '1d'
          ? pose.width / encoded.totalModules
          : data.barWidth;
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Verify on screen**

Start the dev server (`npm run dev`, port 5180) and follow `.claude/skills/verify/SKILL.md` to load a label. Build a fixture .lbx containing a CODE128 and a QRCODE object, import it, and screenshot the canvas. A barcode that renders as a grey box means `encodeBarcode` rejected it — read the `detail`.

- [ ] **Step 8: Commit**

```bash
git add src/barcode src/App.tsx src/lbxExport.ts
git commit -m "Render barcodes as vector modules"
```

---

### Task 8: Block printing unrenderable barcodes

**Files:**
- Modify: `src/printPreflight.ts`, `src/printPreflight.test.ts`, `src/App.tsx` (`handlePrint`)

- [ ] **Step 1: Write the failing test**

```ts
import { unrenderableBarcodeMessage } from './printPreflight';

describe('unrenderableBarcodeMessage', () => {
  it('blocks when a barcode could not be encoded', () => {
    expect(unrenderableBarcodeMessage(1)).toContain('1 barcode');
  });

  it('pluralizes', () => {
    expect(unrenderableBarcodeMessage(3)).toContain('3 barcodes');
  });

  it('passes when everything encoded', () => {
    expect(unrenderableBarcodeMessage(0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/printPreflight.test.ts`
Expected: FAIL — `unrenderableBarcodeMessage` is not exported.

- [ ] **Step 3: Implement**

```ts
/**
 * Alert copy when the label carries barcodes this editor can't encode. They
 * draw as placeholder boxes; printing would put a grey box on the tape where
 * bars belong, so block the job instead.
 */
export function unrenderableBarcodeMessage(count: number): string | null {
  if (count <= 0) return null;
  const noun = count === 1 ? '1 barcode' : `${count} barcodes`;
  return (
    `This label has ${noun} the editor can't draw — either an unsupported ` +
    `symbology or a payload that doesn't encode. They'd print as empty boxes. ` +
    `Fix or remove them, then print again.`
  );
}
```

- [ ] **Step 4: Wire it into `handlePrint`**

In `src/App.tsx`'s `handlePrint`, alongside the existing tape-mismatch check:

```ts
    let unrenderable = 0;
    for (const [, node] of scene.nodes) {
      if (node.data.kind === 'barcode') {
        const sym = encodeBarcode({
          protocol: node.data.protocol, data: node.data.data,
          checkDigit: node.data.checkDigit, zeroFill: node.data.zeroFill,
          barRatio: node.data.barRatio,
          ...(node.data.qrCode ? { qrCode: node.data.qrCode } : {}),
        });
        if (!sym.ok) unrenderable++;
      }
    }
    const barcodeProblem = unrenderableBarcodeMessage(unrenderable);
    if (barcodeProblem) { alert(barcodeProblem); return; }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/printPreflight.ts src/printPreflight.test.ts src/App.tsx
git commit -m "Block printing labels with unrenderable barcodes"
```

---

### Task 9: Barcode tool in the palette

**Files:**
- Create: `src/BarcodeIcon.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Confirm `defineTool` is public API**

Run: `grep -n "defineTool" /Users/mike/src/weasel/src/tools/index.ts /Users/mike/src/weasel/src/index.ts`
Expected: `src/tools/index.ts` re-exports it and `src/index.ts` does `export * from './tools'`, so `import { defineTool } from '@weasel-js/core'` is a public surface. **If it turns out to be reachable only through the `routing` namespace marked experimental in `src/index.ts:228`, stop and ask** — per CLAUDE.md, don't import non-public kit API; the fix is a real public surface in weasel, which its governing rule permits.

- [ ] **Step 2: Write the icon**

`src/BarcodeIcon.tsx`:

```tsx
/** Palette icon: a few bars of varying width. */
export function BarcodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <rect x="2" y="3" width="1.5" height="14" />
      <rect x="5" y="3" width="1" height="14" />
      <rect x="8" y="3" width="2" height="14" />
      <rect x="11.5" y="3" width="1" height="14" />
      <rect x="14" y="3" width="1.5" height="14" />
      <rect x="17" y="3" width="1" height="14" />
    </svg>
  );
}
```

- [ ] **Step 3: Define the tool**

In `src/App.tsx`, next to `useImageTool`:

```ts
  // Drag-to-insert barcode. Mirrors the kit's image tool: a declarative
  // drag binding routes through the dispatcher's insert action, and
  // `insertNodeFactories.barcode` mints the node (the kit explicitly
  // supports factories for kinds it doesn't ship).
  const barcodeTool = useMemo(
    () => defineTool<null>({
      id: 'barcode',
      capabilities: ['creates-shapes'],
      hookName: 'useBarcodeTool',
      cursor: 'crosshair',
      presentation: { label: 'Barcode', group: 'shape', icon: <BarcodeIcon /> },
      bindings: [{ spec: { kind: 'drag' }, actionId: 'insert', opts: { params: { kind: 'barcode' } } }],
      initial: {},
    }),
    [],
  );
  const toolsPatch = useMemo(() => ({ image: imageTool, barcode: barcodeTool }), [imageTool, barcodeTool]);
```

- [ ] **Step 4: Add the insert factory**

In `insertNodeFactories`:

```ts
    barcode: (b) => ({
      pose: {
        x: b.x,
        y: b.y,
        width: Math.max(b.width, 40),
        height: Math.max(b.height, 16),
      },
      data: {
        kind: 'barcode',
        protocol: 'CODE128',
        data: '12345678',
        barWidth: 1.2,
        barRatio: '1:3',
        humanReadable: true,
        humanReadableAlignment: 'CENTER',
        checkDigit: false,
        zeroFill: false,
      } satisfies LabelNodeData,
    }),
```

- [ ] **Step 5: Verify in the app**

Run `npm run dev`, then via the chrome-devtools MCP tools: take a snapshot and confirm a **Barcode** button sits in the tool palette; select it, drag on the canvas, and screenshot. Expected: a Code 128 symbol reading `12345678` with the human-readable text beneath it. **Look at the screenshot** — a grey box means the default payload didn't encode.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/BarcodeIcon.tsx
git commit -m "Add a barcode tool to the palette"
```

---

### Task 10: Edit barcode properties

**Files:**
- Modify: `src/PropertyPanel.tsx`, `src/propertyPanel.css`

- [ ] **Step 1: Read the existing panel**

Read `src/PropertyPanel.tsx` in full and follow its established shape for a per-kind section (how the text and rect cases lay out their fields, how changes are committed to the scene). Match it — do not invent a second pattern.

- [ ] **Step 2: Add the barcode section**

Fields, in order:
- **Symbology** — `<select>` over the 8 supported protocols plus the 6 unsupported ones, the unsupported ones labeled `"DataMatrix (not rendered)"` etc. so the placeholder box is explained rather than mysterious.
- **Data** — text input, the payload.
- **Human-readable text** — checkbox, bound to `humanReadable`.
- **Check digit** — checkbox, bound to `checkDigit`.
- **Encoding error** — when `encodeBarcode` fails for the current values, show `detail` as inline error text. This is the panel's most useful job: it turns "why is my barcode a grey box" into "EAN13 needs 12 or 13 digits".

Use CSS classes in `src/propertyPanel.css` for layout — no inline styles.

- [ ] **Step 3: Verify in the app**

With the dev server running, insert a barcode, select it, and via the chrome-devtools MCP tools: change Symbology to `EAN13` and Data to `590123412345`, then screenshot. Expected: an EAN-13 symbol with `5901234123457` beneath it (check digit appended). Then set Data to `abc` and confirm the panel shows an encoding error and the canvas shows the placeholder.

- [ ] **Step 4: Commit**

```bash
git add src/PropertyPanel.tsx src/propertyPanel.css
git commit -m "Edit barcode symbology and payload in the property panel"
```

---

### Task 11: Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update the Current state section**

Add a bullet after the images one:

```markdown
- Barcodes render as vector modules (`src/barcode/`): the .lbx stores them
  semantically (protocol + payload + params, no raster), so we encode them —
  Code 39, Code 128/GS1-128, EAN-13/8, UPC-A/E hand-rolled and cross-checked
  against bwip-js in tests, QR via `qrcode-generator`. Geometry treats the
  pose as authoritative (module width = pose.width / totalModules), so resize
  works and `barWidth` is re-derived on export. Symbologies we don't encode
  (ITF, Codabar, DataMatrix, PDF417, MaxiCode, GS1 DataBar) and payloads that
  don't encode keep their data, draw a placeholder box, and block printing via
  `printPreflight`. The palette's Barcode tool drag-inserts a Code 128.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "Document barcode support"
```

---

## Verification checklist

- [ ] `npx vitest run` — all green in lbx-editor
- [ ] `npx tsc --noEmit` — clean
- [ ] A .lbx exported from P-touch Editor containing a QR code and a Code 128 imports, renders, and re-exports without loss
- [ ] Print preview (Printer panel → Print preview) shows the barcode dithered onto the printable band
- [ ] A real print scans — this is the only test that matters for a barcode, and no unit test substitutes for it
