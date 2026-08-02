# DataMatrix and PDF417 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode, draw, print and round-trip DataMatrix and PDF417 barcodes, hand-written and diffed against bwip-js, and fix the 19% size error on every 2D barcode imported from a P-touch file.

**Architecture:** Two repos in sequence. `bil-lbx` learns the `datamatrixStyle` and `pdf417Style` elements and ships 0.3.0; `lbx-editor` then raises its floor and builds on it. Inside lbx-editor the work is three layers: `Symbol2D` loses its square assumption and every encoder starts declaring its own quiet zone; two new encoder modules land behind the existing `encodeBarcode` dispatcher; and the file boundary gains a pose conversion, because P-touch's 2D object box includes a 2-module quiet zone per side and ours does not.

**Tech Stack:** TypeScript, Vitest, `bwip-js` (devDependency, test oracle only), `fast-xml-parser` (inside bil-lbx).

**Spec:** `docs/superpowers/specs/2026-07-31-remaining-symbologies-design.md`

**Reference file:** `~/src/bil-lbx/docs/samples/barcode2.lbx` — three DataMatrix objects (cell sizes 1.6pt and 2.4pt), two PDF417 (module widths 0.8pt and 1.2pt), three GS1 DataBar. Every measurement in the spec comes from it.

---

## Scope notes before starting

**GS1 DataBar and MaxiCode are not built.** Both stay in the `unsupported` branch. Their only change is a better failure message (Task E2). The spec explains why: MaxiCode cannot be printed at any size on this hardware, and DataBar has neither a working oracle nor an obtainable sample of the variant we would want.

**DataMatrix symbol sizes are staged.** Tasks C1–C5 build sizes 10×10 through 26×26 — one data region, one ECC block — which holds 44 codewords, roughly 88 digits or 44 ASCII characters. Task C6 adds 32×32 through 144×144, which need region splitting and, at 104×104 and above, ECC block interleaving. C6 is separable: if it is dropped, the encoder must still fail cleanly with the message from C5's oversize test, never silently emit a wrong symbol.

**PDF417 carries a ~14 KB codeword table.** That is inherent to the symbology — 929 codewords × 3 clusters × 17 bits — and is why PDF417 is the larger of the two encoders. Task D1 covers sourcing it and the exhaustive oracle sweep that proves it.

---

## File Structure

**bil-lbx** (`~/src/bil-lbx`):

| File | Responsibility |
|---|---|
| `src/types.ts` | `BarcodeObject` gains `dataMatrix?` and `pdf417?`; `BarcodeProtocol` gains `RSS` |
| `src/parse.ts` | Read `barcode:datamatrixStyle` / `barcode:pdf417Style` into those fields |
| `src/serialize.ts` | Emit both elements; move all style children before `pt:data` |
| `test/parse.test.ts` | Parsing the two new elements |
| `test/roundtrip.test.ts` | Both survive a serialize→parse cycle |
| `docs/samples/barcode2.lbx` | Commit the reference file (currently untracked) |

**lbx-editor** (`~/src/lbx-editor`):

| File | Responsibility |
|---|---|
| `src/barcode/types.ts` | `QuietZone`; `Symbol2D` gains `cols`/`rows`/`rowHeightModules`, loses `size`; both symbols gain `quiet` |
| `src/barcode/geometry.ts` | Per-side quiet zone; non-square 2D module math |
| `src/barcode/datamatrix.ts` | **new** — ECC200 encoder |
| `src/barcode/datamatrixTables.ts` | **new** — symbol size table, log/antilog tables |
| `src/barcode/pdf417.ts` | **new** — PDF417 encoder |
| `src/barcode/pdf417Table.ts` | **new** — the 929×3 codeword pattern table |
| `src/barcode/reedSolomon.ts` | **new** — GF(256) arithmetic, shared by both encoders |
| `src/barcode/encode.ts` | Dispatch the two new protocols; better messages for the two declined ones |
| `src/barcode/testOracle.ts` | `oracle2d()` beside the existing `oracle()` |
| `src/label.ts` | `LabelBarcodeData` gains `dataMatrix?` and `pdf417?` |
| `src/lbxImport.ts` | Shrink a 2D pose by 2 modules per side |
| `src/lbxExport.ts` | Grow it back; route module size per protocol |

`reedSolomon.ts` is shared deliberately: both encoders need GF(256) with the same primitive polynomial (0x11D), and one tested implementation is better than two.

---

# Phase A — bil-lbx

Work in `~/src/bil-lbx` on a branch. Run tests with `npm test` from that directory.

### Task A1: Commit the reference sample

**Files:**
- Add: `docs/samples/barcode2.lbx`

- [ ] **Step 1: Confirm the file is present and untracked**

```bash
cd ~/src/bil-lbx && git status --short docs/samples/
```

Expected: `?? docs/samples/barcode2.lbx`

- [ ] **Step 2: Commit it**

```bash
cd ~/src/bil-lbx
git checkout -b barcode-2d-styles
git add docs/samples/barcode2.lbx
git commit -m "Add the 2D barcode sample every measurement came from

P-touch Editor, PT-P710BT selected: three DataMatrix at two cell sizes,
two PDF417 at two module widths, three GS1 DataBar. It is what settled
that a 2D object box carries a 2-module quiet zone per side."
```

---

### Task A2: `RSS` joins the protocol union

A DataBar object currently parses into a protocol the union says cannot exist. Nothing will encode it, but the type should stop lying.

**Files:**
- Modify: `src/types.ts:142`
- Test: `test/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/parse.test.ts`:

```ts
describe("GS1 DataBar / RSS", () => {
  it("parses P-touch's RSS protocol without inventing a name for it", async () => {
    const xml = barcodeXml(`
      <barcode:barcodeStyle protocol="RSS" lengths="0" barWidth="0.8pt"
        humanReadable="true" checkDigit="false" zeroFill="false"/>
      <barcode:rssStyle model="RSSExpanded" barWidth="0.1pt" column="4"/>
      <pt:data>00012345678905</pt:data>`);
    const doc = await parseLabelXml(xml);
    const obj = doc.objects[0];
    expect(obj?.type).toBe("barcode");
    if (obj?.type !== "barcode") return;
    expect(obj.protocol).toBe("RSS");
  });
});
```

If `barcodeXml` and `parseLabelXml` are not already helpers in that file, read the file's existing tests first and follow whatever construction they use to build a document around one object — do not invent a second helper.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/src/bil-lbx && npx vitest run test/parse.test.ts -t "RSS protocol"
```

Expected: FAIL — a TypeScript error that `"RSS"` is not assignable to `BarcodeProtocol`.

- [ ] **Step 3: Add `RSS` to the union**

In `src/types.ts:142`, change:

```ts
export type BarcodeProtocol = "CODE39" | "CODE128" | "EAN13" | "EAN8" | "UPCA" | "UPCE" | "ITF" | "CODABAR" | "QRCODE" | "DATAMATRIX" | "PDF417" | "MAXICODE" | "GS1-128" | "GS1DATABAR";
```

to:

```ts
/** Barcode symbologies P-touch writes. `RSS` is what it actually stamps for
 *  every GS1 DataBar variant — DataBar's former name, Reduced Space Symbology
 *  — with the variant itself in `barcode:rssStyle`'s `model` attribute, which
 *  this library does not model yet. `GS1DATABAR` has never been observed in a
 *  P-touch-authored file and is kept only because it was published. */
export type BarcodeProtocol = "CODE39" | "CODE128" | "EAN13" | "EAN8" | "UPCA" | "UPCE" | "ITF" | "CODABAR" | "QRCODE" | "DATAMATRIX" | "PDF417" | "MAXICODE" | "GS1-128" | "GS1DATABAR" | "RSS";
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd ~/src/bil-lbx && npx vitest run test/parse.test.ts -t "RSS protocol"
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/src/bil-lbx
git add src/types.ts test/parse.test.ts
git commit -m "Admit RSS, the protocol P-touch actually writes for DataBar"
```

---

### Task A3: Model and parse `datamatrixStyle`

**Files:**
- Modify: `src/types.ts` (inside `BarcodeObject`, after `qrCode`)
- Modify: `src/parse.ts` (after the QR block at line 670)
- Test: `test/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("DataMatrix style", () => {
  it("reads every attribute P-touch writes", async () => {
    const xml = barcodeXml(`
      <barcode:barcodeStyle protocol="DATAMATRIX" lengths="0" barWidth="0.8pt"
        humanReadable="false" checkDigit="false" zeroFill="false"/>
      <barcode:datamatrixStyle model="square" cellSize="1.6pt" macro="none"
        fnc01="false" joint="1"/>
      <pt:data>12345678</pt:data>`);
    const doc = await parseLabelXml(xml);
    const obj = doc.objects[0];
    if (obj?.type !== "barcode") throw new Error("expected a barcode");
    expect(obj.dataMatrix).toEqual({
      model: "square",
      cellSize: 1.6,
      macro: "none",
      fnc01: false,
      joint: 1,
    });
  });

  it("leaves dataMatrix undefined when the element is absent", async () => {
    const xml = barcodeXml(`
      <barcode:barcodeStyle protocol="CODE128" lengths="8" barWidth="0.8pt"
        humanReadable="true" checkDigit="true" zeroFill="false"/>
      <pt:data>12345678</pt:data>`);
    const doc = await parseLabelXml(xml);
    const obj = doc.objects[0];
    if (obj?.type !== "barcode") throw new Error("expected a barcode");
    expect(obj.dataMatrix).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/src/bil-lbx && npx vitest run test/parse.test.ts -t "DataMatrix style"
```

Expected: FAIL — `dataMatrix` does not exist on `BarcodeObject`.

- [ ] **Step 3: Add the type**

In `src/types.ts`, immediately after the `qrCode` field of `BarcodeObject`:

```ts
  /** DataMatrix options, from `barcode:datamatrixStyle`. `cellSize` is the
   *  module width in pt — the 2D counterpart of `barWidth`, and the number the
   *  object box is measured in. */
  dataMatrix?: {
    model?: "square" | "rectangle";
    cellSize?: number;
    macro?: string;
    fnc01?: boolean;
    joint?: number;
  };
```

- [ ] **Step 4: Parse it**

In `src/parse.ts`, directly after the closing brace of the `if (qrStyleNode) { ... }` block:

```ts
  // DataMatrix specific
  const dmStyleNode = node["barcode:datamatrixStyle"] as Record<string, unknown> | undefined;
  if (dmStyleNode) {
    obj.dataMatrix = {
      model: (attr(dmStyleNode, "model") ?? "square") as "square" | "rectangle",
      cellSize: ptAttr(dmStyleNode, "cellSize") ?? 2,
      macro: attr(dmStyleNode, "macro") ?? "none",
      fnc01: boolAttr(dmStyleNode, "fnc01") ?? false,
      joint: numAttr(dmStyleNode, "joint") ?? 1,
    };
  }
```

- [ ] **Step 5: Run it and watch it pass**

```bash
cd ~/src/bil-lbx && npx vitest run test/parse.test.ts -t "DataMatrix style"
```

Expected: PASS, both cases.

- [ ] **Step 6: Commit**

```bash
cd ~/src/bil-lbx
git add src/types.ts src/parse.ts test/parse.test.ts
git commit -m "Parse datamatrixStyle, where a DataMatrix keeps its cell size"
```

---

### Task A4: Model and parse `pdf417Style`

`row`, `column` and `eccLevel` are strings because the file's value is `"auto"` — the same reason `qrCode.version` is a string.

**Files:**
- Modify: `src/types.ts` (after `dataMatrix`)
- Modify: `src/parse.ts` (after the DataMatrix block)
- Test: `test/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("PDF417 style", () => {
  it("reads every attribute P-touch writes, keeping auto as auto", async () => {
    const xml = barcodeXml(`
      <barcode:barcodeStyle protocol="PDF417" lengths="0" barWidth="0.8pt"
        humanReadable="false" checkDigit="false" zeroFill="false"/>
      <barcode:pdf417Style model="standard" width="0.8pt" aspect="3"
        row="auto" column="auto" eccLevel="auto" joint="1"/>
      <pt:data>12345678</pt:data>`);
    const doc = await parseLabelXml(xml);
    const obj = doc.objects[0];
    if (obj?.type !== "barcode") throw new Error("expected a barcode");
    expect(obj.pdf417).toEqual({
      model: "standard",
      width: 0.8,
      aspect: 3,
      row: "auto",
      column: "auto",
      eccLevel: "auto",
      joint: 1,
    });
  });

  it("keeps an explicit row/column/eccLevel rather than normalizing it", async () => {
    const xml = barcodeXml(`
      <barcode:barcodeStyle protocol="PDF417" lengths="0" barWidth="0.8pt"
        humanReadable="false" checkDigit="false" zeroFill="false"/>
      <barcode:pdf417Style model="standard" width="0.8pt" aspect="3"
        row="7" column="2" eccLevel="1" joint="1"/>
      <pt:data>12345678</pt:data>`);
    const doc = await parseLabelXml(xml);
    const obj = doc.objects[0];
    if (obj?.type !== "barcode") throw new Error("expected a barcode");
    expect(obj.pdf417?.row).toBe("7");
    expect(obj.pdf417?.column).toBe("2");
    expect(obj.pdf417?.eccLevel).toBe("1");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/src/bil-lbx && npx vitest run test/parse.test.ts -t "PDF417 style"
```

Expected: FAIL — `pdf417` does not exist on `BarcodeObject`.

- [ ] **Step 3: Add the type**

In `src/types.ts`, after the `dataMatrix` field:

```ts
  /** PDF417 options, from `barcode:pdf417Style`. `width` is the module width in
   *  pt and `aspect` the row height as a multiple of it — PDF417 rows are
   *  taller than they are wide, 3x by default and by ISO 15438's minimum.
   *
   *  `row`, `column` and `eccLevel` are strings because P-touch writes the
   *  literal `"auto"`, the same reason `qrCode.version` is one. A writer that
   *  states them explicitly pins the symbol it drew; leaving them `"auto"`
   *  invites the reader to choose its own and redraw a different size. */
  pdf417?: {
    model?: string;
    width?: number;
    aspect?: number;
    row?: string;
    column?: string;
    eccLevel?: string;
    joint?: number;
  };
```

- [ ] **Step 4: Parse it**

In `src/parse.ts`, directly after the DataMatrix block:

```ts
  // PDF417 specific
  const pdfStyleNode = node["barcode:pdf417Style"] as Record<string, unknown> | undefined;
  if (pdfStyleNode) {
    obj.pdf417 = {
      model: attr(pdfStyleNode, "model") ?? "standard",
      width: ptAttr(pdfStyleNode, "width") ?? 0.8,
      aspect: numAttr(pdfStyleNode, "aspect") ?? 3,
      row: attr(pdfStyleNode, "row") ?? "auto",
      column: attr(pdfStyleNode, "column") ?? "auto",
      eccLevel: attr(pdfStyleNode, "eccLevel") ?? "auto",
      joint: numAttr(pdfStyleNode, "joint") ?? 1,
    };
  }
```

- [ ] **Step 5: Run it and watch it pass**

```bash
cd ~/src/bil-lbx && npx vitest run test/parse.test.ts -t "PDF417 style"
```

Expected: PASS, both cases.

- [ ] **Step 6: Commit**

```bash
cd ~/src/bil-lbx
git add src/types.ts src/parse.ts test/parse.test.ts
git commit -m "Parse pdf417Style, including the row aspect and an explicit layout"
```

---

### Task A5: Serialize both, with style elements before the data

P-touch writes `barcodeStyle`, then the per-symbology style element, then `pt:data`. `serializeBarcode` currently pushes `data` before `qrcodeStyle`. Fix the ordering while adding the new elements, so all three follow the file we are imitating.

**Files:**
- Modify: `src/serialize.ts:280-322`
- Test: `test/roundtrip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe("2D barcode styles round-trip", () => {
  it("carries a DataMatrix cell size through serialize and back", async () => {
    const doc = minimalDoc({
      type: "barcode",
      position: { x: 5.6, y: 8.4, width: 25.6, height: 25.6 },
      protocol: "DATAMATRIX",
      data: "12345678",
      dataMatrix: { model: "square", cellSize: 1.6, macro: "none", fnc01: false, joint: 1 },
    });
    const reparsed = await parseLabelXml(serializeLabelXml(doc));
    const obj = reparsed.objects[0];
    if (obj?.type !== "barcode") throw new Error("expected a barcode");
    expect(obj.dataMatrix?.cellSize).toBe(1.6);
    expect(obj.dataMatrix?.model).toBe("square");
  });

  it("carries an explicit PDF417 layout through serialize and back", async () => {
    const doc = minimalDoc({
      type: "barcode",
      position: { x: 5.6, y: 8.4, width: 85.6, height: 20 },
      protocol: "PDF417",
      data: "12345678",
      pdf417: { model: "standard", width: 0.8, aspect: 3, row: "7", column: "2", eccLevel: "1", joint: 1 },
    });
    const reparsed = await parseLabelXml(serializeLabelXml(doc));
    const obj = reparsed.objects[0];
    if (obj?.type !== "barcode") throw new Error("expected a barcode");
    expect(obj.pdf417).toMatchObject({ width: 0.8, aspect: 3, row: "7", column: "2", eccLevel: "1" });
  });

  it("puts style elements before the data, as P-touch does", () => {
    const doc = minimalDoc({
      type: "barcode",
      position: { x: 0, y: 0, width: 40, height: 40 },
      protocol: "QRCODE",
      data: "12345678",
      qrCode: { model: 2, eccLevel: "15%", cellSize: 1.6, version: "auto" },
    });
    const xml = serializeLabelXml(doc);
    expect(xml.indexOf("qrcodeStyle")).toBeLessThan(xml.indexOf("pt:data"));
  });
});
```

Read the existing `test/roundtrip.test.ts` first and reuse whatever it already has for building a one-object document and for the serialize/parse entry points. Only add a `minimalDoc` helper if no equivalent exists.

- [ ] **Step 2: Run it and watch it fail**

```bash
cd ~/src/bil-lbx && npx vitest run test/roundtrip.test.ts -t "2D barcode styles"
```

Expected: FAIL — the two new elements are never emitted, and the ordering assertion fails.

- [ ] **Step 3: Rewrite the tail of `serializeBarcode`**

In `src/serialize.ts`, replace everything from `const data = el("pt:data", {}, obj.data);` to the closing `return el("barcode:barcode", {}, ...children);` with:

```ts
  const children: (XmlNode | string)[] = [
    objectStyleNode(obj.position, obj.pen, obj.brush, obj.objectName, obj.lock),
    barcodeStyle,
  ];

  // Per-symbology style elements sit between barcodeStyle and pt:data, which is
  // the order P-touch writes them in. Each carries the module size under its own
  // attribute name, so there is no shared path to fold these into.
  if (obj.protocol === "QRCODE" && obj.qrCode) {
    children.push(el("barcode:qrcodeStyle", {
      model: obj.qrCode.model ?? 2,
      eccLevel: obj.qrCode.eccLevel ?? "15%",
      cellSize: p(obj.qrCode.cellSize ?? 2),
      mbcs: "932",
      removeCharKind: "0",
      removeCharString: "",
      joint: "1",
      jointSpace: "8",
      jointVertically: "false",
      version: obj.qrCode.version ?? "auto",
      changeVersionDrag: "false",
    }));
  }

  if (obj.protocol === "DATAMATRIX" && obj.dataMatrix) {
    children.push(el("barcode:datamatrixStyle", {
      model: obj.dataMatrix.model ?? "square",
      cellSize: p(obj.dataMatrix.cellSize ?? 2),
      macro: obj.dataMatrix.macro ?? "none",
      fnc01: obj.dataMatrix.fnc01 ?? false,
      joint: obj.dataMatrix.joint ?? 1,
    }));
  }

  if (obj.protocol === "PDF417" && obj.pdf417) {
    children.push(el("barcode:pdf417Style", {
      model: obj.pdf417.model ?? "standard",
      width: p(obj.pdf417.width ?? 0.8),
      aspect: obj.pdf417.aspect ?? 3,
      row: obj.pdf417.row ?? "auto",
      column: obj.pdf417.column ?? "auto",
      eccLevel: obj.pdf417.eccLevel ?? "auto",
      joint: obj.pdf417.joint ?? 1,
    }));
  }

  children.push(el("pt:data", {}, obj.data));

  return el("barcode:barcode", {}, ...children);
```

- [ ] **Step 4: Run the full suite**

```bash
cd ~/src/bil-lbx && npm test
```

Expected: all pass. The ordering change touches existing QR round-trip tests — if any asserts on child order, it should now expect `qrcodeStyle` before `pt:data`.

- [ ] **Step 5: Commit**

```bash
cd ~/src/bil-lbx
git add src/serialize.ts test/roundtrip.test.ts
git commit -m "Write the 2D style elements, in the place P-touch writes them

The per-symbology element belongs between barcodeStyle and pt:data.
qrcodeStyle had been going out after the data; it moves too, so all
three follow the same file we are imitating."
```

---

### Task A6: Ship 0.3.0

- [ ] **Step 1: Verify a clean build and suite**

```bash
cd ~/src/bil-lbx && npm run build && npm test
```

Expected: build clean, all tests pass.

- [ ] **Step 2: Merge to main**

```bash
cd ~/src/bil-lbx
git checkout main
git merge --no-ff barcode-2d-styles -m "Merge barcode-2d-styles: DataMatrix and PDF417 keep their options"
```

- [ ] **Step 3: Version and publish**

New optional fields on an existing type, no breaking change, so minor:

```bash
cd ~/src/bil-lbx && npm version minor && npm publish
```

Expected: publishes `bil-lbx@0.3.0`. `prepublishOnly` reruns build and tests; `postversion` pushes the tag.

- [ ] **Step 4: Confirm it is live**

```bash
npm view bil-lbx version
```

Expected: `0.3.0`

---

# Phase B — lbx-editor foundation

Work in `~/src/lbx-editor` on the existing `remaining-symbologies` branch. **No new symbology in this phase** — it ends with the same barcodes working as before, drawn from a generalized model, plus the QR import bug fixed.

### Task B1: Raise the bil-lbx floor

**Files:**
- Modify: `package.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Install**

```bash
cd ~/src/lbx-editor && npm install bil-lbx@^0.3.0
```

- [ ] **Step 2: Verify nothing broke**

```bash
cd ~/src/lbx-editor && npm test && npm run build
```

Expected: 262 tests pass, build clean.

- [ ] **Step 3: Record why the floor moved**

In `CLAUDE.md`, replace the `bil-lbx` bullet:

```markdown
- `bil-lbx` (from npm, `^0.3.0`) — .lbx serialization/parsing. 0.2.2 was the
  floor for the barcode background round-trip, which reads
  `LabelConfig.generator`. 0.3.0 is the floor now because DataMatrix and
  PDF417 keep their options in their own style elements —
  `barcode:datamatrixStyle` and `barcode:pdf417Style` — and without those
  fields an export drops the module size, the row aspect, and PDF417's
  row/column/ECC choice. It also admits `RSS`, which is what P-touch actually
  stamps for GS1 DataBar.
```

- [ ] **Step 4: Commit**

```bash
cd ~/src/lbx-editor
git add package.json package-lock.json CLAUDE.md
git commit -m "Take bil-lbx 0.3.0, for the 2D style elements"
```

---

### Task B2: `QuietZone`, and a `Symbol2D` that is not square

**Files:**
- Modify: `src/barcode/types.ts`
- Test: `src/barcode/geometry.test.ts` (later tasks); this task is types only

- [ ] **Step 1: Rewrite the symbol types**

In `src/barcode/types.ts`, replace the `Symbol1D` and `Symbol2D` interfaces with:

```ts
/**
 * Blank margin a scanner needs, in modules, per side.
 *
 * This is the symbology's own **scanning requirement**, and it is not
 * P-touch's object-box convention — that one is a flat 2 modules per side for
 * every 2D symbology and lives in `lbxImport`/`lbxExport`. The two share a
 * unit and nothing else; collapsing them into one number would be wrong in
 * both directions, since QR asks for 4 and DataMatrix for 1.
 *
 * Only the encoder knows its symbology, so the encoder states this.
 */
export interface QuietZone {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** A 1D symbol as bar runs measured in narrow modules from the symbol's left
 *  edge — the bars alone, with **no quiet zone**. */
export interface Symbol1D {
  kind: '1d';
  /** Dark runs. `x` and `width` are in narrow-module units. */
  bars: Array<{ x: number; width: number }>;
  /**
   * Total symbol width in narrow-module units — the bars only.
   *
   * Do not bake a quiet zone in here. `barcodeModulePt` is
   * `pose.width / totalModules`, so this defines what a barcode's pose *means*,
   * and the pose means the bars (measured against a P-touch-authored file).
   * `encode.test.ts` pins `[0, totalModules]` across every symbology — the EAN
   * family baked in 9 and drew ~19% narrow for it.
   */
  totalModules: number;
  quiet: QuietZone;
  /** What a scanner reads back — the payload plus any computed check digit. */
  text: string;
}

/** A 2D symbol as a module grid. `modules[row][col]` is true for dark. */
export interface Symbol2D {
  kind: '2d';
  cols: number;
  rows: number;
  /**
   * Row height as a multiple of module width. 1 for QR and DataMatrix, whose
   * cells are square; 3 for PDF417, whose rows are taller than they are wide —
   * ISO 15438's minimum, and the value P-touch's `pdf417Style` defaults its
   * `aspect` attribute to.
   *
   * A constraint we satisfy by construction rather than report: with square
   * cells a PDF417 would render one module tall per row at every pose size, out
   * of spec in every document, with nothing the user could do about it.
   */
  rowHeightModules: number;
  modules: boolean[][];
  quiet: QuietZone;
  text: string;
}
```

- [ ] **Step 2: Confirm the compiler now lists every call site to fix**

```bash
cd ~/src/lbx-editor && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors in `qr.ts`, `geometry.ts`, and the five 1D encoders — each missing `quiet`, plus `size` no longer existing. That error list is Task B3's worklist.

- [ ] **Step 3: Do not commit yet** — the tree does not compile until B3.

---

### Task B3: Every encoder declares its own quiet zone

Values below are the standards' scanning requirements. **Verify each against bwip-js while implementing rather than trusting this table** — a hand-typed constant that looks right is the exact failure the backgrounds spec warned about.

**Files:**
- Modify: `src/barcode/code39.ts`, `code128.ts`, `ean.ts`, `itf.ts`, `codabar.ts`, `qr.ts`

- [ ] **Step 1: Add a shared helper to `types.ts`**

```ts
/** A quiet zone that is horizontal only — every 1D symbology here. The
 *  standards ask for no vertical margin: the requirement above and below the
 *  bars is bar *height*, not blank space. */
export function horizontalQuiet(left: number, right: number): QuietZone {
  return { left, right, top: 0, bottom: 0 };
}

/** A quiet zone equal on all four sides — the 2D symbologies. */
export function uniformQuiet(modules: number): QuietZone {
  return { left: modules, right: modules, top: modules, bottom: modules };
}
```

- [ ] **Step 2: Populate each encoder**

| File | Return-value change |
|---|---|
| `code39.ts` | add `quiet: horizontalQuiet(10, 10)` |
| `code128.ts` | add `quiet: horizontalQuiet(10, 10)` |
| `itf.ts` | add `quiet: horizontalQuiet(10, 10)` |
| `codabar.ts` | add `quiet: horizontalQuiet(10, 10)` |
| `qr.ts` | add `cols: size, rows: size, rowHeightModules: 1, quiet: uniformQuiet(4)`; drop `size` |

In `ean.ts` the value depends on the symbology, so key it off the protocol already in scope:

```ts
/** Per-symbology quiet zones. The EAN family's requirement is asymmetric —
 *  EAN-13 is 11 left and 7 right — where a flat 10 was both too wide on one
 *  side and a module short on the other. */
const EAN_QUIET: Record<string, { left: number; right: number }> = {
  EAN13: { left: 11, right: 7 },
  EAN8: { left: 7, right: 7 },
  UPCA: { left: 9, right: 9 },
  UPCE: { left: 9, right: 7 },
};
```

and in the return: `quiet: horizontalQuiet(q.left, q.right)` where `q = EAN_QUIET[protocol] ?? { left: 10, right: 10 }`.

For `qr.ts`, the return becomes:

```ts
    return {
      ok: true,
      kind: '2d',
      cols: size,
      rows: size,
      rowHeightModules: 1,
      modules,
      quiet: uniformQuiet(4),
      text: data,
    };
```

- [ ] **Step 3: Fix `qr.test.ts`**

Replace every `sym.size` with `sym.cols`. There are six occurrences across lines 9–39.

- [ ] **Step 4: Compile**

```bash
cd ~/src/lbx-editor && npx tsc --noEmit 2>&1 | head -20
```

Expected: only `geometry.ts` and its test still failing — Task B4.

- [ ] **Step 5: Do not commit yet** — B4 completes the change.

---

### Task B4: Geometry reads the per-side quiet zone

**Files:**
- Modify: `src/barcode/geometry.ts`
- Modify: `src/barcode/index.ts`
- Test: `src/barcode/geometry.test.ts`, `src/ditherProtect.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/barcode/geometry.test.ts`:

```ts
describe('non-square 2D symbols', () => {
  const wide = {
    kind: '2d' as const,
    cols: 100,
    rows: 10,
    rowHeightModules: 3,
    modules: Array.from({ length: 10 }, () => Array.from({ length: 100 }, () => true)),
    quiet: { left: 2, right: 2, top: 2, bottom: 2 },
    text: '',
  };

  it('sizes the module so the whole grid fits, rows included', () => {
    // 100 cols and 10 rows of 3 modules each = 30 module-heights.
    // A 300x300 pose fits 3pt per module across, 10pt down -> the smaller wins.
    expect(barcodeModulePt(wide, { width: 300, height: 300 })).toBe(3);
  });

  it('draws cells rowHeightModules tall', () => {
    const rects = barcodeRects(wide, { x: 0, y: 0, width: 300, height: 300 }, false);
    expect(rects[0]!.width).toBe(3);
    expect(rects[0]!.height).toBe(9);
  });

  it('centres the grid in the pose rather than stretching it', () => {
    const rects = barcodeRects(wide, { x: 0, y: 0, width: 300, height: 300 }, false);
    // Grid is 300 wide and 90 tall, so it letterboxes vertically by 105 each side.
    expect(rects[0]!.x).toBe(0);
    expect(rects[0]!.y).toBe(105);
  });
});

describe('square symbols are unchanged by the generalization', () => {
  it('gives a square 2D symbol the same module size as before', () => {
    const square = {
      kind: '2d' as const,
      cols: 21,
      rows: 21,
      rowHeightModules: 1,
      modules: Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => true)),
      quiet: { left: 4, right: 4, top: 4, bottom: 4 },
      text: '',
    };
    // The old formula was min(w, h) / size.
    expect(barcodeModulePt(square, { width: 42, height: 84 })).toBe(2);
  });
});

describe('per-side quiet zones', () => {
  it('gives an asymmetric 1D symbol an asymmetric background', () => {
    const ean = {
      kind: '1d' as const,
      bars: [{ x: 0, width: 1 }],
      totalModules: 95,
      quiet: { left: 11, right: 7, top: 0, bottom: 0 },
      text: '',
    };
    const pose = { x: 100, y: 50, width: 95, height: 40 };
    const rect = barcodeBackgroundRect(ean, pose);
    // One module is 1pt here, so the margins are 11pt and 7pt.
    expect(rect.x).toBe(89);
    expect(rect.width).toBe(95 + 11 + 7);
    // No vertical quiet zone: the background is exactly the pose tall.
    expect(rect.y).toBe(50);
    expect(rect.height).toBe(40);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/geometry.test.ts
```

Expected: FAIL — `barcodeModulePt` still reads `symbol.size`.

- [ ] **Step 3: Rewrite the three functions**

In `src/barcode/geometry.ts`, delete `QUIET_ZONE_MODULES_1D` and `QUIET_ZONE_MODULES_2D`, and replace `quietZonePt`, `barcodeModulePt`, `barcodeRects` and `barcodeBackgroundRect`:

```ts
/** The quiet zone for `symbol` drawn at `pose`, in pt, per side. */
export function quietZonePt(
  symbol: BarcodeSymbol,
  pose: { width: number; height: number },
): QuietZone {
  const module = barcodeModulePt(symbol, pose);
  return {
    left: symbol.quiet.left * module,
    right: symbol.quiet.right * module,
    top: symbol.quiet.top * module,
    bottom: symbol.quiet.bottom * module,
  };
}

/**
 * The pt size of one module for `symbol` drawn at `pose`: the narrow-bar width
 * for 1D, the cell width for 2D.
 *
 * Export restates the pose in these terms, because P-touch redraws a barcode
 * from `barWidth` / `cellSize` / `pdf417Style.width` rather than from its
 * bounding box. Sharing this with the drawing below is what keeps a symbol
 * resized here the same size when P-touch reopens it.
 */
export function barcodeModulePt(
  symbol: BarcodeSymbol,
  pose: { width: number; height: number },
): number {
  if (symbol.kind === '1d') return pose.width / symbol.totalModules;
  return Math.min(
    pose.width / symbol.cols,
    pose.height / (symbol.rows * symbol.rowHeightModules),
  );
}

export function barcodeRects(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
  humanReadable: boolean,
): Rect[] {
  const module = barcodeModulePt(symbol, pose);

  if (symbol.kind === '2d') {
    // A 2D symbol's cells must keep their proportions to scan, so the grid takes
    // whichever axis binds and centres in the pose rather than stretching to it.
    const cellH = module * symbol.rowHeightModules;
    const gridW = symbol.cols * module;
    const gridH = symbol.rows * cellH;
    const originX = pose.x + (pose.width - gridW) / 2;
    const originY = pose.y + (pose.height - gridH) / 2;
    const rects: Rect[] = [];
    for (let r = 0; r < symbol.rows; r++) {
      for (let c = 0; c < symbol.cols; c++) {
        if (symbol.modules[r]![c]) {
          rects.push({
            x: originX + c * module,
            y: originY + r * cellH,
            width: module,
            height: cellH,
          });
        }
      }
    }
    return rects;
  }

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

/**
 * The region a barcode masks: its pose plus the quiet zone, per side.
 *
 * Shared by the drawn background and `ditherProtect.protectedRegions`, so the
 * area we blank and the area we exempt from dithering are the same rectangle
 * by construction rather than by two copies agreeing.
 */
export function barcodeBackgroundRect(
  symbol: BarcodeSymbol,
  pose: { x: number; y: number; width: number; height: number },
): Rect {
  const q = quietZonePt(symbol, pose);
  return {
    x: pose.x - q.left,
    y: pose.y - q.top,
    width: pose.width + q.left + q.right,
    height: pose.height + q.top + q.bottom,
  };
}
```

- [ ] **Step 4: Update the barrel**

In `src/barcode/index.ts`, drop `QUIET_ZONE_MODULES_1D` and `QUIET_ZONE_MODULES_2D` from the geometry export block, and add `QuietZone`, `horizontalQuiet`, `uniformQuiet` to the types export block.

- [ ] **Step 5: Fix `ditherProtect.test.ts`**

It computes its expectation from the deleted constant at line 33. Replace with the symbol's own value:

```ts
import { encodeBarcode, barcodeRequest, barcodeModulePt } from './barcode';
// ...
const quiet = symbol.quiet.left * barcodeModulePt(symbol, pose);
```

- [ ] **Step 6: Run everything**

```bash
cd ~/src/lbx-editor && npm test
```

Expected: all pass. Any failure in `ditherProtect.test.ts` or `barcodeExport.test.ts` that traces to EAN's new 11/7 margins is a *correct* change — update the expectation, and say so in the commit.

- [ ] **Step 7: Commit B2 + B3 + B4 together**

They are one change; the tree does not compile between them.

```bash
cd ~/src/lbx-editor
git add src/barcode/ src/ditherProtect.test.ts
git commit -m "Let each encoder state its own quiet zone

The flat per-kind constants cannot survive a DataMatrix, which asks for
1 module where QR asks for 4. Only the encoder knows its symbology, so
the encoder says.

Two visible corrections come with it. EAN-13 goes from a flat 10/10 to
the standard 11/7. And 1D symbols lose their vertical quiet zone, which
the standards never asked for -- the requirement above and below the
bars is bar height, not blank margin. Dithering is unaffected: the
protected region still covers the bars and diffusion stops at its edge.

Symbol2D also loses its square assumption, ahead of a PDF417 that is
103 modules wide and 21 tall."
```

---

### Task B5: Fix the 19% error on imported 2D barcodes

P-touch's 2D object box carries 2 modules of quiet zone per side; ours means the symbol. Convert at the file boundary so exactly one convention exists inside the app.

**Files:**
- Create: `src/barcode/poseBox.ts`
- Modify: `src/lbxImport.ts`
- Test: `src/barcode/poseBox.test.ts`, `src/lbxImport.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/barcode/poseBox.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { symbolPoseFromBox, boxFromSymbolPose, POSE_QUIET_MODULES_2D } from './poseBox';

describe('2D pose <-> P-touch object box', () => {
  it('strips the 2 modules per side that P-touch bakes into the box', () => {
    // barcodes.lbx: a 21-module QR at cellSize 1.6pt sits in a 40pt box.
    // 40 / 1.6 = 25 = 21 + 2 per side.
    const pose = symbolPoseFromBox({ x: 100, y: 50, width: 40, height: 40 }, 1.6);
    expect(pose.width).toBeCloseTo(33.6, 6); // 21 * 1.6
    expect(pose.height).toBeCloseTo(33.6, 6);
    expect(pose.x).toBeCloseTo(103.2, 6);   // inset by 2 * 1.6
    expect(pose.y).toBeCloseTo(53.2, 6);
  });

  it('round-trips a box through the pose and back', () => {
    const box = { x: 5.6, y: 8.4, width: 25.6, height: 25.6 };
    const back = boxFromSymbolPose(symbolPoseFromBox(box, 1.6), 1.6);
    expect(back.x).toBeCloseTo(box.x, 6);
    expect(back.y).toBeCloseTo(box.y, 6);
    expect(back.width).toBeCloseTo(box.width, 6);
    expect(back.height).toBeCloseTo(box.height, 6);
  });

  it('leaves the box alone when the file states no module size', () => {
    const box = { x: 1, y: 2, width: 30, height: 40 };
    expect(symbolPoseFromBox(box, undefined)).toEqual(box);
  });

  it('refuses to invert a box smaller than its own quiet zone', () => {
    // 4 modules of 10pt is 40pt of margin in a 30pt box. Shrinking would give a
    // negative width, so the box is returned untouched.
    const box = { x: 0, y: 0, width: 30, height: 30 };
    expect(symbolPoseFromBox(box, 10)).toEqual(box);
  });

  it('keeps the module size the pose implies equal to the file's', () => {
    // The point of the conversion: a 12-module DataMatrix at 1.6pt in P-touch's
    // 25.6pt box must come out as a pose 12 modules wide.
    const pose = symbolPoseFromBox({ x: 0, y: 0, width: 25.6, height: 25.6 }, 1.6);
    expect(pose.width / 12).toBeCloseTo(1.6, 6);
  });
});

it('exports the measured constant', () => {
  expect(POSE_QUIET_MODULES_2D).toBe(2);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/poseBox.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

Create `src/barcode/poseBox.ts`:

```ts
/**
 * P-touch's 2D object box, and ours.
 *
 * For a 2D symbology, P-touch's `objectStyle` box is the symbol **plus a flat
 * 2 modules of quiet zone per side**. Ours is the symbol alone, matching what a
 * 1D box means under the `margin="false"` we always export. So the two differ
 * by a fixed inset and the file boundary converts.
 *
 * Measured against `~/src/bil-lbx/docs/samples/barcode2.lbx`: two DataMatrix at
 * cell sizes 1.6pt and 2.4pt both give `box / cellSize === 16` for a 12-module
 * symbol, two PDF417 at 0.8pt and 1.2pt both give 107 for a 103-module symbol,
 * and the QR in `barcodes.lbx` gives 25 for 21. Four modules every time,
 * scaling with the module rather than fixed in pt — which is the opposite of
 * how a 1D `margin="true"` behaves, where the box gains a flat 36.8pt.
 *
 * Not to be confused with `Symbol2D.quiet`, the symbology's own scanning
 * requirement. QR asks for 4 and DataMatrix for 1; neither is this 2. They
 * share a unit and nothing else.
 *
 * Without this conversion every P-touch 2D barcode drew `(n + 4) / n` too
 * large — 19% for a 21-module QR, 33% for a 12-module DataMatrix.
 */

export const POSE_QUIET_MODULES_2D = 2;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The symbol's own rect, given P-touch's box and the module size the file
 *  states. Returns the box unchanged when there is no module size to work
 *  from, or when the inset would leave nothing. */
export function symbolPoseFromBox(box: Box, modulePt: number | undefined): Box {
  if (modulePt === undefined || modulePt <= 0) return box;
  const inset = POSE_QUIET_MODULES_2D * modulePt;
  const width = box.width - inset * 2;
  const height = box.height - inset * 2;
  if (width <= 0 || height <= 0) return box;
  return { x: box.x + inset, y: box.y + inset, width, height };
}

/** P-touch's box, given the symbol's own rect and our module size. */
export function boxFromSymbolPose(pose: Box, modulePt: number): Box {
  const inset = POSE_QUIET_MODULES_2D * modulePt;
  return {
    x: pose.x - inset,
    y: pose.y - inset,
    width: pose.width + inset * 2,
    height: pose.height + inset * 2,
  };
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/poseBox.test.ts
```

Expected: PASS, all six.

- [ ] **Step 5: Wire it into import**

In `src/lbxImport.ts`, the `case 'barcode':` branch at line 123 uses `pose` computed upstream. Before the `return`, add:

```ts
    case 'barcode': {
      // P-touch's 2D box carries 2 modules of quiet zone per side; ours is the
      // symbol. The file states the module size, so convert from that rather
      // than from our own encode -- our symbol may differ from the one the file
      // was drawn with (P-touch picks its own PDF417 row count).
      const filedModulePt =
        obj.protocol === 'QRCODE' ? obj.qrCode?.cellSize
        : obj.protocol === 'DATAMATRIX' ? obj.dataMatrix?.cellSize
        : obj.protocol === 'PDF417' ? obj.pdf417?.width
        : undefined;
      const barcodePose = symbolPoseFromBox(pose, filedModulePt);
      return {
        id: genId(),
        pose: barcodePose,
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
          opaqueBackground: brushIsMeaningful ? obj.brush?.style === 'SOLID' : true,
          ...(obj.qrCode ? { qrCode: obj.qrCode } : {}),
          ...(obj.dataMatrix ? { dataMatrix: obj.dataMatrix } : {}),
          ...(obj.pdf417 ? { pdf417: obj.pdf417 } : {}),
        },
      };
    }
```

Add the import at the top: `import { symbolPoseFromBox } from './barcode/poseBox';`

- [ ] **Step 6: Extend `LabelBarcodeData`**

In `src/label.ts`, after the `qrCode` field at line 69:

```ts
  dataMatrix?: { model?: 'square' | 'rectangle'; cellSize?: number; macro?: string; fnc01?: boolean; joint?: number };
  pdf417?: { model?: string; width?: number; aspect?: number; row?: string; column?: string; eccLevel?: string; joint?: number };
```

- [ ] **Step 7: Pin the fix against the real file**

Add to `src/lbxImport.test.ts`:

```ts
it('reads a P-touch QR at the cell size the file states, not 19% larger', async () => {
  // barcodes.lbx's QR: 40pt box, cellSize 1.6pt, 21-module symbol.
  // Taking the box as the symbol gave 40/21 = 1.905pt per module.
  const doc = await importLbx(await readFixture('barcodes.lbx'));
  const qr = doc.nodes.find((n) => n.data.kind === 'barcode' && n.data.protocol === 'QRCODE');
  expect(qr).toBeDefined();
  expect(qr!.pose.width).toBeCloseTo(33.6, 3); // 21 * 1.6
});
```

Follow whatever fixture-loading helper `lbxImport.test.ts` already uses; if the repo has no copy of `barcodes.lbx`, copy it from `~/src/bil-lbx/docs/samples/` into the repo's fixture directory first and commit it.

- [ ] **Step 8: Run everything**

```bash
cd ~/src/lbx-editor && npm test
```

Expected: all pass.

- [ ] **Step 9: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/poseBox.ts src/barcode/poseBox.test.ts src/lbxImport.ts src/lbxImport.test.ts src/label.ts
git commit -m "Stop drawing imported 2D barcodes 19% too large

P-touch's 2D object box is the symbol plus a flat 2 modules of quiet
zone per side; ours is the symbol. Import had been taking the box as
the symbol, so a 21-module QR in a 40pt box came out at 1.905pt per
module against the 1.6pt the file plainly stated.

Measured across two DataMatrix at two cell sizes, two PDF417 at two
module widths, and the QR from the earlier sample: four modules every
time, scaling with the module. The conversion lives at the file
boundary so exactly one convention exists inside the app.

Same shape as the EAN defect the backgrounds work fixed, which also
came to ~19%."
```

---

# Phase C — DataMatrix

### Task C1: GF(256) arithmetic

**Files:**
- Create: `src/barcode/reedSolomon.ts`
- Test: `src/barcode/reedSolomon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { gfMul, gfPow, rsGenerator, rsEncode } from './reedSolomon';

describe('GF(256) arithmetic', () => {
  it('multiplies by zero to zero', () => {
    expect(gfMul(0, 5)).toBe(0);
    expect(gfMul(5, 0)).toBe(0);
  });

  it('has 1 as the multiplicative identity', () => {
    for (const a of [1, 2, 37, 128, 255]) expect(gfMul(a, 1)).toBe(a);
  });

  it('commutes', () => {
    expect(gfMul(0x53, 0xca)).toBe(gfMul(0xca, 0x53));
  });

  it('matches the known AES-field product', () => {
    // 0x57 * 0x83 = 0xc1 in GF(2^8) with the 0x11D primitive polynomial.
    expect(gfMul(0x57, 0x83)).toBe(0xc1);
  });

  it('raises 2 through the generator sequence', () => {
    expect(gfPow(2, 0)).toBe(1);
    expect(gfPow(2, 1)).toBe(2);
    expect(gfPow(2, 8)).toBe(0x1d); // wraps by the primitive polynomial
  });
});

describe('Reed-Solomon', () => {
  it('builds a generator polynomial of the requested degree', () => {
    expect(rsGenerator(5)).toHaveLength(6);
    expect(rsGenerator(5)[0]).toBe(1); // monic
  });

  it('produces the ECC codewords DataMatrix 10x10 expects', () => {
    // ISO/IEC 16022 Annex O worked example: data "142 164 186" -> ECC
    // "114 25 5 88 102" for a 10x10 symbol (3 data, 5 ECC).
    expect(rsEncode([142, 164, 186], 5)).toEqual([114, 25, 5, 88, 102]);
  });

  it('returns exactly the requested number of ECC codewords', () => {
    expect(rsEncode([1, 2, 3, 4, 5], 7)).toHaveLength(7);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/reedSolomon.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * Reed-Solomon over GF(2^8), shared by DataMatrix and PDF417.
 *
 * Both use the same field and the same primitive polynomial (0x11D), so one
 * tested implementation serves both. PDF417's codeword arithmetic is mod 929
 * rather than in this field and lives in `pdf417.ts`; what it borrows from here
 * is nothing — this module is DataMatrix's, and is kept separate only because
 * field arithmetic is worth testing on its own.
 */

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return EXP[(LOG[a]! * n) % 255]!;
}

/** The monic generator polynomial for `degree` ECC codewords, highest power
 *  first: (x - a^1)(x - a^2)...(x - a^degree). */
export function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] = (next[i] ?? 0) ^ poly[i]!;
      next[i + 1] = (next[i + 1] ?? 0) ^ gfMul(poly[i]!, EXP[d + 1]!);
    }
    poly = next;
  }
  return poly;
}

/** `count` error-correction codewords for `data`. */
export function rsEncode(data: readonly number[], count: number): number[] {
  const gen = rsGenerator(count);
  const rem = new Array<number>(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0]!;
    rem.shift();
    rem.push(0);
    if (factor !== 0) {
      for (let i = 0; i < count; i++) {
        rem[i] = rem[i]! ^ gfMul(gen[i + 1]!, factor);
      }
    }
  }
  return rem;
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/reedSolomon.test.ts
```

Expected: PASS, all eight.

If the Annex O case fails, the bug is in `rsGenerator`'s root ordering, not in `gfMul` — the field tests above would have caught that. Do not adjust the expected values; they are the standard's.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/reedSolomon.ts src/barcode/reedSolomon.test.ts
git commit -m "Add GF(256) Reed-Solomon, checked against the standard's worked example"
```

---

### Task C2: DataMatrix symbol sizes

**Files:**
- Create: `src/barcode/datamatrixTables.ts`
- Test: `src/barcode/datamatrixTables.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SQUARE_SIZES, smallestSymbolFor } from './datamatrixTables';

describe('DataMatrix square symbol sizes', () => {
  it('lists sizes in ascending capacity', () => {
    for (let i = 1; i < SQUARE_SIZES.length; i++) {
      expect(SQUARE_SIZES[i]!.dataCodewords).toBeGreaterThan(SQUARE_SIZES[i - 1]!.dataCodewords);
    }
  });

  it('gives every size an even module count, as the standard requires', () => {
    for (const s of SQUARE_SIZES) expect(s.size % 2).toBe(0);
  });

  it('picks the smallest symbol that fits', () => {
    expect(smallestSymbolFor(3)!.size).toBe(10);
    expect(smallestSymbolFor(4)!.size).toBe(12);
    expect(smallestSymbolFor(5)!.size).toBe(12);
    expect(smallestSymbolFor(6)!.size).toBe(14);
    expect(smallestSymbolFor(44)!.size).toBe(26);
  });

  it('returns null when nothing holds the payload', () => {
    expect(smallestSymbolFor(99999)).toBeNull();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrixTables.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * ECC200 square symbol sizes.
 *
 * Only the square family: `.lbx` records `datamatrixStyle model="square"`, and
 * a rectangular symbol would need the file to ask for one.
 *
 * `size` is the module count per side including the finder pattern. `region`
 * is the module count per side of one data region, excluding it — symbols at
 * 32x32 and above split into a grid of regions, each with its own finder.
 * `blocks` is the number of interleaved error-correction blocks, which is 1
 * until 104x104.
 */
export interface DataMatrixSymbol {
  size: number;
  dataCodewords: number;
  eccCodewords: number;
  region: number;
  regions: number;
  blocks: number;
}

export const SQUARE_SIZES: readonly DataMatrixSymbol[] = [
  { size: 10, dataCodewords: 3, eccCodewords: 5, region: 8, regions: 1, blocks: 1 },
  { size: 12, dataCodewords: 5, eccCodewords: 7, region: 10, regions: 1, blocks: 1 },
  { size: 14, dataCodewords: 8, eccCodewords: 10, region: 12, regions: 1, blocks: 1 },
  { size: 16, dataCodewords: 12, eccCodewords: 12, region: 14, regions: 1, blocks: 1 },
  { size: 18, dataCodewords: 18, eccCodewords: 14, region: 16, regions: 1, blocks: 1 },
  { size: 20, dataCodewords: 22, eccCodewords: 18, region: 18, regions: 1, blocks: 1 },
  { size: 22, dataCodewords: 30, eccCodewords: 20, region: 20, regions: 1, blocks: 1 },
  { size: 24, dataCodewords: 36, eccCodewords: 24, region: 22, regions: 1, blocks: 1 },
  { size: 26, dataCodewords: 44, eccCodewords: 28, region: 24, regions: 1, blocks: 1 },
  { size: 32, dataCodewords: 62, eccCodewords: 36, region: 14, regions: 2, blocks: 1 },
  { size: 36, dataCodewords: 86, eccCodewords: 42, region: 16, regions: 2, blocks: 1 },
  { size: 40, dataCodewords: 114, eccCodewords: 48, region: 18, regions: 2, blocks: 1 },
  { size: 44, dataCodewords: 144, eccCodewords: 56, region: 20, regions: 2, blocks: 1 },
  { size: 48, dataCodewords: 174, eccCodewords: 68, region: 22, regions: 2, blocks: 1 },
  { size: 52, dataCodewords: 204, eccCodewords: 84, region: 24, regions: 2, blocks: 2 },
  { size: 64, dataCodewords: 280, eccCodewords: 112, region: 14, regions: 4, blocks: 2 },
  { size: 72, dataCodewords: 368, eccCodewords: 144, region: 16, regions: 4, blocks: 4 },
  { size: 80, dataCodewords: 456, eccCodewords: 192, region: 18, regions: 4, blocks: 4 },
  { size: 88, dataCodewords: 576, eccCodewords: 224, region: 20, regions: 4, blocks: 4 },
  { size: 96, dataCodewords: 696, eccCodewords: 272, region: 22, regions: 4, blocks: 4 },
  { size: 104, dataCodewords: 816, eccCodewords: 336, region: 24, regions: 4, blocks: 6 },
  { size: 120, dataCodewords: 1050, eccCodewords: 408, region: 18, regions: 6, blocks: 6 },
  { size: 132, dataCodewords: 1304, eccCodewords: 496, region: 20, regions: 6, blocks: 8 },
  { size: 144, dataCodewords: 1558, eccCodewords: 620, region: 22, regions: 6, blocks: 10 },
];

/** The smallest square symbol holding `codewords` data codewords, or null if
 *  none does. */
export function smallestSymbolFor(codewords: number): DataMatrixSymbol | null {
  return SQUARE_SIZES.find((s) => s.dataCodewords >= codewords) ?? null;
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrixTables.test.ts
```

Expected: PASS, all four.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/datamatrixTables.ts src/barcode/datamatrixTables.test.ts
git commit -m "Table the ECC200 square symbol sizes"
```

---

### Task C3: ASCII encodation

**Files:**
- Create: `src/barcode/datamatrixEncode.ts`
- Test: `src/barcode/datamatrixEncode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { encodeAscii, padCodewords } from './datamatrixEncode';

describe('DataMatrix ASCII encodation', () => {
  it('encodes a byte as its value plus one', () => {
    expect(encodeAscii('A')).toEqual([66]); // 'A' is 65
  });

  it('packs a digit pair into one codeword', () => {
    // Digit pairs encode as 130 + the two-digit value.
    expect(encodeAscii('42')).toEqual([130 + 42]);
    expect(encodeAscii('00')).toEqual([130]);
    expect(encodeAscii('99')).toEqual([229]);
  });

  it('packs eight digits into four codewords', () => {
    expect(encodeAscii('12345678')).toEqual([130 + 12, 130 + 34, 130 + 56, 130 + 78]);
  });

  it('leaves an odd trailing digit as a single byte', () => {
    expect(encodeAscii('123')).toEqual([130 + 12, 52]); // '3' is 51
  });

  it('rejects a codepoint ASCII encodation cannot carry', () => {
    expect(() => encodeAscii('€')).toThrow(/cannot encode/i);
  });

  it('pads with 129 then the randomized 253-state', () => {
    // 129 is the pad codeword; subsequent pads are randomized by position.
    const padded = padCodewords([66], 3);
    expect(padded).toHaveLength(3);
    expect(padded[0]).toBe(66);
    expect(padded[1]).toBe(129);
    expect(padded[2]).toBeGreaterThanOrEqual(1);
    expect(padded[2]).toBeLessThanOrEqual(254);
  });

  it('leaves an exactly-full codeword list alone', () => {
    expect(padCodewords([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrixEncode.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * ECC200 ASCII encodation.
 *
 * The one mode this encoder implements. It carries the whole ASCII range and
 * already packs digit pairs two-to-a-codeword, which is where label payloads
 * spend most of their length. C40, Text and Base256 buy density for particular
 * payload shapes at the cost of a mode-switching surface, and a mode-switch bug
 * yields a symbol that encodes the wrong thing while looking entirely correct.
 */

/** Codewords for `data` under ASCII encodation. Throws for a codepoint the
 *  mode cannot carry — the caller turns that into an `invalid` result. */
export function encodeAscii(data: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i]!;
    const next = data[i + 1];
    if (isDigit(ch) && next !== undefined && isDigit(next)) {
      out.push(130 + Number(ch + next));
      i += 2;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code > 127) {
      throw new Error(`DataMatrix ASCII encodation cannot encode "${ch}"`);
    }
    out.push(code + 1);
    i += 1;
  }
  return out;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Pad `codewords` out to `capacity`.
 *
 * The first pad is 129. Every later pad is 129 randomized by its own position,
 * per ISO 16022's 253-state algorithm — a run of identical pads would otherwise
 * produce a large blank region that reads as damage.
 */
export function padCodewords(codewords: readonly number[], capacity: number): number[] {
  const out = [...codewords];
  if (out.length >= capacity) return out.slice(0, capacity);
  out.push(129);
  while (out.length < capacity) {
    const position = out.length + 1;
    const pseudoRandom = ((149 * position) % 253) + 1;
    const value = 129 + pseudoRandom;
    out.push(value <= 254 ? value : value - 254);
  }
  return out;
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrixEncode.test.ts
```

Expected: PASS, all seven.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/datamatrixEncode.ts src/barcode/datamatrixEncode.test.ts
git commit -m "Encode DataMatrix payloads in ASCII mode, digit pairs included"
```

---

### Task C4: Module placement

The ISO 16022 default placement walks an L-shaped path, wrapping by rules that depend only on the matrix dimensions. This task builds it for a single data region.

**Files:**
- Create: `src/barcode/datamatrixPlace.ts`
- Test: `src/barcode/datamatrixPlace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { placeCodewords } from './datamatrixPlace';

describe('DataMatrix bit placement', () => {
  it('fills every cell of the data area exactly once', () => {
    // A 10x10 symbol has an 8x8 data area = 64 bits = 8 codewords, of which
    // 3 are data and 5 ECC.
    const grid = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    expect(grid).toHaveLength(8);
    for (const row of grid) {
      expect(row).toHaveLength(8);
      for (const cell of row) expect(typeof cell).toBe('boolean');
    }
  });

  it('places the same codewords the same way every time', () => {
    const a = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    const b = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    expect(a).toEqual(b);
  });

  it('changes the grid when a codeword changes', () => {
    const a = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    const b = placeCodewords([1, 2, 3, 4, 5, 6, 7, 9], 8, 8);
    expect(a).not.toEqual(b);
  });

  it('handles a 12x12 symbol, whose data area is 10x10', () => {
    const grid = placeCodewords(new Array(12).fill(0).map((_, i) => i + 1), 10, 10);
    expect(grid).toHaveLength(10);
    expect(grid[0]).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrixPlace.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * ISO/IEC 16022 default bit placement.
 *
 * Each codeword's 8 bits go into an L-shaped "utah" pattern that walks the
 * matrix diagonally, wrapping at the edges by four corner-case rules that
 * depend only on the matrix dimensions. The algorithm is the standard's, and
 * the corner cases are the part worth reading twice — they exist because the
 * diagonal walk does not tile a rectangle evenly.
 *
 * Coordinates are (row, col) into the data area, with the finder pattern and
 * any region separators added by the caller.
 */

export function placeCodewords(codewords: readonly number[], rows: number, cols: number): boolean[][] {
  const grid: (boolean | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );

  const bit = (r: number, c: number, value: boolean) => {
    let row = r;
    let col = c;
    if (row < 0) {
      row += rows;
      col += 4 - ((rows + 4) % 8);
    }
    if (col < 0) {
      col += cols;
      row += 4 - ((cols + 4) % 8);
    }
    grid[row]![col] = value;
  };

  const utah = (r: number, c: number, cw: number) => {
    const b = (n: number) => (cw & (1 << (8 - n))) !== 0;
    bit(r - 2, c - 2, b(1));
    bit(r - 2, c - 1, b(2));
    bit(r - 1, c - 2, b(3));
    bit(r - 1, c - 1, b(4));
    bit(r - 1, c, b(5));
    bit(r, c - 2, b(6));
    bit(r, c - 1, b(7));
    bit(r, c, b(8));
  };

  const corner1 = (cw: number) => {
    const b = (n: number) => (cw & (1 << (8 - n))) !== 0;
    bit(rows - 1, 0, b(1));
    bit(rows - 1, 1, b(2));
    bit(rows - 1, 2, b(3));
    bit(0, cols - 2, b(4));
    bit(0, cols - 1, b(5));
    bit(1, cols - 1, b(6));
    bit(2, cols - 1, b(7));
    bit(3, cols - 1, b(8));
  };

  const corner2 = (cw: number) => {
    const b = (n: number) => (cw & (1 << (8 - n))) !== 0;
    bit(rows - 3, 0, b(1));
    bit(rows - 2, 0, b(2));
    bit(rows - 1, 0, b(3));
    bit(0, cols - 4, b(4));
    bit(0, cols - 3, b(5));
    bit(0, cols - 2, b(6));
    bit(0, cols - 1, b(7));
    bit(1, cols - 1, b(8));
  };

  const corner3 = (cw: number) => {
    const b = (n: number) => (cw & (1 << (8 - n))) !== 0;
    bit(rows - 3, 0, b(1));
    bit(rows - 2, 0, b(2));
    bit(rows - 1, 0, b(3));
    bit(0, cols - 2, b(4));
    bit(0, cols - 1, b(5));
    bit(1, cols - 1, b(6));
    bit(2, cols - 1, b(7));
    bit(3, cols - 1, b(8));
  };

  const corner4 = (cw: number) => {
    const b = (n: number) => (cw & (1 << (8 - n))) !== 0;
    bit(rows - 1, 0, b(1));
    bit(rows - 1, cols - 1, b(2));
    bit(0, cols - 3, b(3));
    bit(0, cols - 2, b(4));
    bit(0, cols - 1, b(5));
    bit(1, cols - 3, b(6));
    bit(1, cols - 2, b(7));
    bit(1, cols - 1, b(8));
  };

  let index = 0;
  let row = 4;
  let col = 0;
  do {
    if (row === rows && col === 0) corner1(codewords[index++] ?? 0);
    else if (row === rows - 2 && col === 0 && cols % 4 !== 0) corner2(codewords[index++] ?? 0);
    else if (row === rows - 2 && col === 0 && cols % 8 === 4) corner3(codewords[index++] ?? 0);
    else if (row === rows + 4 && col === 2 && cols % 8 === 0) corner4(codewords[index++] ?? 0);

    // Sweep up and to the right.
    do {
      if (row < rows && col >= 0 && grid[row]![col] === null) {
        utah(row, col, codewords[index++] ?? 0);
      }
      row -= 2;
      col += 2;
    } while (row >= 0 && col < cols);
    row += 1;
    col += 3;

    // Sweep down and to the left.
    do {
      if (row >= 0 && col < cols && grid[row]![col] === null) {
        utah(row, col, codewords[index++] ?? 0);
      }
      row += 2;
      col -= 2;
    } while (row < rows && col >= 0);
    row += 3;
    col += 1;
  } while (row < rows || col < cols);

  // The bottom-right corner is unused in symbols whose area is not a multiple
  // of 8; the standard fills it with a fixed checkerboard.
  if (grid[rows - 1]![cols - 1] === null) {
    grid[rows - 1]![cols - 1] = true;
    grid[rows - 2]![cols - 2] = true;
    grid[rows - 1]![cols - 2] = false;
    grid[rows - 2]![cols - 1] = false;
  }

  return grid.map((r) => r.map((cell) => cell ?? false));
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrixPlace.test.ts
```

Expected: PASS, all four. These tests prove the walk is total and deterministic, not that it matches the standard — Task C5's oracle diff is what proves that.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/datamatrixPlace.ts src/barcode/datamatrixPlace.test.ts
git commit -m "Walk the ECC200 default bit placement"
```

---

### Task C5: Assemble the encoder, and diff it against bwip-js

**Files:**
- Create: `src/barcode/datamatrix.ts`
- Modify: `src/barcode/testOracle.ts`
- Test: `src/barcode/datamatrix.test.ts`

- [ ] **Step 1: Add `oracle2d` to `testOracle.ts`**

```ts
/**
 * bwip-js's 2D encoding as a module matrix. `pixs` is the grid row-major,
 * `pixx` and `pixy` its dimensions — and like `sbs` for 1D, it is the symbol
 * alone with no quiet zone.
 */
export function oracle2d(bcid: string, text: string, opts: Record<string, unknown> = {}): boolean[][] {
  const [enc] = bwipjs.raw(bcid, text, opts as never) as Array<{
    pixs: number[]; pixx: number; pixy: number;
  }>;
  const { pixs, pixx, pixy } = enc!;
  return Array.from({ length: pixy }, (_, r) =>
    Array.from({ length: pixx }, (_, c) => pixs[r * pixx + c] === 1),
  );
}
```

- [ ] **Step 2: Write the failing test**

Create `src/barcode/datamatrix.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encodeDataMatrix } from './datamatrix';
import { oracle2d } from './testOracle';

describe('encodeDataMatrix', () => {
  it('matches the reference encoder', () => {
    for (const payload of ['12345678', 'HELLO', 'A', 'Test-1234', '0123456789012345']) {
      const sym = encodeDataMatrix(payload);
      expect(sym.ok, payload).toBe(true);
      if (!sym.ok || sym.kind !== '2d') return;
      expect(sym.modules, payload).toEqual(oracle2d('datamatrix', payload));
    }
  });

  it('reports a square grid with square cells', () => {
    const sym = encodeDataMatrix('12345678');
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.cols).toBe(sym.rows);
    expect(sym.rowHeightModules).toBe(1);
  });

  it('asks for the 1-module quiet zone the standard specifies', () => {
    const sym = encodeDataMatrix('12345678');
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.quiet).toEqual({ left: 1, right: 1, top: 1, bottom: 1 });
  });

  it('grows the symbol as the payload grows', () => {
    const small = encodeDataMatrix('1');
    const large = encodeDataMatrix('0123456789012345678901234567890123456789');
    if (!small.ok || small.kind !== '2d' || !large.ok || large.kind !== '2d') {
      throw new Error('expected 2D symbols');
    }
    expect(large.cols).toBeGreaterThan(small.cols);
  });

  it('rejects an empty payload', () => {
    expect(encodeDataMatrix('')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a payload no square symbol can hold', () => {
    const result = encodeDataMatrix('0'.repeat(4000));
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (result.ok) return;
    expect(result.detail).toMatch(/too long|does not fit/i);
  });

  it('rejects a codepoint ASCII encodation cannot carry', () => {
    const result = encodeDataMatrix('café €');
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('reports the payload as the scanned text', () => {
    const sym = encodeDataMatrix('12345678');
    if (!sym.ok) throw new Error('expected success');
    expect(sym.text).toBe('12345678');
  });
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrix.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Write it**

```ts
/**
 * DataMatrix ECC200.
 *
 * Square symbols only, 10x10 through 144x144, auto-sized to the smallest that
 * holds the payload. `.lbx` records `datamatrixStyle model="square"` and has no
 * field asking for a rectangular symbol, so there is nothing to honor.
 *
 * The pieces live apart because each is worth testing on its own: field
 * arithmetic in `reedSolomon.ts`, the size table in `datamatrixTables.ts`,
 * encodation in `datamatrixEncode.ts`, the bit walk in `datamatrixPlace.ts`.
 * What is here is assembly, plus the finder pattern -- and `datamatrix.test.ts`
 * diffs the whole thing against bwip-js, which is what actually proves it.
 */
import type { EncodeResult } from './types';
import { uniformQuiet } from './types';
import { smallestSymbolFor, type DataMatrixSymbol } from './datamatrixTables';
import { encodeAscii, padCodewords } from './datamatrixEncode';
import { placeCodewords } from './datamatrixPlace';
import { rsEncode } from './reedSolomon';

export function encodeDataMatrix(data: string): EncodeResult {
  if (data.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'DataMatrix needs a payload' };
  }

  let codewords: number[];
  try {
    codewords = encodeAscii(data);
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const symbol = smallestSymbolFor(codewords.length);
  if (!symbol) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `Payload is too long for a DataMatrix: ${codewords.length} codewords, and the largest square symbol holds 1558`,
    };
  }
  if (symbol.regions > 1 || symbol.blocks > 1) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `Payload needs a ${symbol.size}x${symbol.size} DataMatrix, which splits into data regions this encoder does not build yet`,
    };
  }

  const padded = padCodewords(codewords, symbol.dataCodewords);
  const all = [...padded, ...rsEncode(padded, symbol.eccCodewords)];
  const placed = placeCodewords(all, symbol.region, symbol.region);
  const modules = addFinderPattern(placed, symbol);

  return {
    ok: true,
    kind: '2d',
    cols: symbol.size,
    rows: symbol.size,
    rowHeightModules: 1,
    modules,
    quiet: uniformQuiet(1),
    text: data,
  };
}

/**
 * Wrap a data region in its finder pattern: a solid L up the left side and
 * along the bottom, and an alternating "clock track" along the top and right.
 * The scanner finds the symbol by the L and reads its dimensions off the clock.
 */
function addFinderPattern(region: boolean[][], symbol: DataMatrixSymbol): boolean[][] {
  const n = symbol.size;
  const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  for (let r = 0; r < symbol.region; r++) {
    for (let c = 0; c < symbol.region; c++) {
      grid[r + 1]![c + 1] = region[r]![c]!;
    }
  }

  for (let i = 0; i < n; i++) {
    grid[n - 1]![i] = true;              // solid bottom
    grid[i]![0] = true;                  // solid left
    grid[0]![i] = i % 2 === 0;           // clock track along the top
    grid[i]![n - 1] = (n - 1 - i) % 2 === 0; // clock track up the right
  }

  return grid;
}
```

- [ ] **Step 5: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrix.test.ts
```

Expected: PASS, all eight.

If the oracle diff fails, print both grids as `.map(r => r.map(c => c ? '#' : '.').join('')).join('\n')` and compare visually. A whole-symbol transpose or mirror means the finder pattern is oriented wrong; scattered differences mean the placement walk is off; an all-different symbol means the codewords are wrong, which `reedSolomon.test.ts` and `datamatrixEncode.test.ts` would already have caught.

- [ ] **Step 6: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/datamatrix.ts src/barcode/datamatrix.test.ts src/barcode/testOracle.ts
git commit -m "Encode DataMatrix, diffed module-for-module against bwip-js

Sizes 10x10 through 26x26 -- one data region, one ECC block. Anything
larger needs region splitting and fails closed with a message saying so,
rather than emitting a symbol that looks right and scans as nothing."
```

---

### Task C6: The multi-region sizes

**Optional, and separable.** Everything through C5 ships a working DataMatrix for payloads to 44 codewords, ~88 digits. This extends it to 144×144.

**Files:**
- Modify: `src/barcode/datamatrix.ts`
- Modify: `src/barcode/datamatrixPlace.ts`
- Test: `src/barcode/datamatrix.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('builds the multi-region sizes', () => {
  // 62 data codewords needs 32x32, which is 2x2 regions of 14x14.
  const payload = '0'.repeat(120);
  const sym = encodeDataMatrix(payload);
  expect(sym.ok).toBe(true);
  if (!sym.ok || sym.kind !== '2d') return;
  expect(sym.cols).toBe(32);
  expect(sym.modules).toEqual(oracle2d('datamatrix', payload));
});

it('interleaves error-correction blocks above 52x52', () => {
  const payload = '0'.repeat(420);
  const sym = encodeDataMatrix(payload);
  expect(sym.ok).toBe(true);
  if (!sym.ok || sym.kind !== '2d') return;
  expect(sym.modules).toEqual(oracle2d('datamatrix', payload));
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrix.test.ts -t "multi-region"
```

Expected: FAIL — the guard added in C5 rejects it.

- [ ] **Step 3: Interleave the ECC blocks**

In `datamatrix.ts`, replace the single `rsEncode` call with block interleaving. The standard splits the data codewords round-robin across `blocks` blocks, computes ECC per block, then interleaves the ECC the same way:

```ts
/** Data and ECC codewords for a symbol, interleaved across its ECC blocks.
 *  Below 52x52 there is one block and this is a plain append. */
function withErrorCorrection(data: readonly number[], symbol: DataMatrixSymbol): number[] {
  if (symbol.blocks === 1) return [...data, ...rsEncode(data, symbol.eccCodewords)];

  const eccPerBlock = symbol.eccCodewords / symbol.blocks;
  const blocks: number[][] = Array.from({ length: symbol.blocks }, () => []);
  data.forEach((cw, i) => blocks[i % symbol.blocks]!.push(cw));

  const ecc = blocks.map((block) => rsEncode(block, eccPerBlock));
  const interleaved: number[] = [];
  for (let i = 0; i < eccPerBlock; i++) {
    for (const block of ecc) interleaved.push(block[i]!);
  }
  return [...data, ...interleaved];
}
```

- [ ] **Step 4: Place across regions**

Replace the single `placeCodewords` call. The bit walk runs once over the full data area — `symbol.region * symbol.regions` per side — and the region separators are inserted afterward when the finder pattern is drawn:

```ts
const dataSide = symbol.region * symbol.regions;
const placed = placeCodewords(all, dataSide, dataSide);
```

and extend `addFinderPattern` to draw one finder per region rather than one per symbol:

```ts
function addFinderPattern(region: boolean[][], symbol: DataMatrixSymbol): boolean[][] {
  const n = symbol.size;
  const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const per = symbol.region; // data modules per region, per side

  for (let br = 0; br < symbol.regions; br++) {
    for (let bc = 0; bc < symbol.regions; bc++) {
      const top = br * (per + 2);
      const left = bc * (per + 2);
      for (let r = 0; r < per; r++) {
        for (let c = 0; c < per; c++) {
          grid[top + r + 1]![left + c + 1] = region[br * per + r]![bc * per + c]!;
        }
      }
      for (let i = 0; i < per + 2; i++) {
        grid[top + per + 1]![left + i] = true;
        grid[top + i]![left] = true;
        grid[top]![left + i] = i % 2 === 0;
        grid[top + i]![left + per + 1] = (per + 1 - i) % 2 === 0;
      }
    }
  }

  return grid;
}
```

- [ ] **Step 5: Remove the guard**

Delete the `if (symbol.regions > 1 || symbol.blocks > 1)` block from `encodeDataMatrix`.

- [ ] **Step 6: Run the whole DataMatrix suite**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/datamatrix.test.ts
```

Expected: PASS, all ten. If the multi-region diff fails, the likely cause is region ordering in the placement-to-grid copy — the bit walk numbers the whole data area continuously, and regions are filled row-major from it.

- [ ] **Step 7: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/datamatrix.ts src/barcode/datamatrixPlace.ts src/barcode/datamatrix.test.ts
git commit -m "Reach the multi-region DataMatrix sizes, up to 144x144"
```

---

# Phase D — PDF417

### Task D1: The codeword pattern table

**Files:**
- Create: `src/barcode/pdf417Table.ts`
- Test: `src/barcode/pdf417Table.test.ts`

PDF417 has 929 codewords, each with a distinct 17-module pattern in each of 3 clusters — 2,787 patterns, and the bulk of this encoder's size.

**Sourcing: take the table from zxing, not from bwip-js.** Both are permissively licensed and either would work legally, but bwip-js is the oracle. A table ported from bwip-js and then verified against bwip-js is a circular check on exactly the data most likely to be wrong — a paste error would still be caught by the diff, but a bug in bwip-js's own table would be invisible. zxing's `PDF417Common.CODEWORD_TABLE` keeps the two independent, which is the property `testOracle.ts` exists to preserve.

Do **not** hand-type it. The oracle sweep in Task D4 is what proves it landed correctly.

**Attribution** (zxing is Apache 2.0, so this is required, not courtesy):

- Add `licenses/zxing-APACHE-2.0.txt` with the full licence text. Both Apache 2.0 and MIT require the text travel with copied source; a README mention alone does not satisfy either.
- Add a **Third-party code** section to `README.md` naming what was taken, from where, and pointing at that file.
- Put the copyright line and licence in `pdf417Table.ts`'s header, plus a note that the data was reformatted from the original Java into TypeScript arrays — Apache 2.0 §4(b) requires stating that a file was modified.
- **Check whether zxing ships a `NOTICE` file.** If it does, §4(d) requires carrying its contents too. Verify this against the actual repository rather than assuming, and copy the real copyright line rather than writing one from memory.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { CODEWORD_PATTERNS, patternFor } from './pdf417Table';

describe('PDF417 codeword table', () => {
  it('has 929 codewords in each of 3 clusters', () => {
    expect(CODEWORD_PATTERNS).toHaveLength(3);
    for (const cluster of CODEWORD_PATTERNS) expect(cluster).toHaveLength(929);
  });

  it('gives every pattern exactly 17 modules', () => {
    for (const cluster of CODEWORD_PATTERNS) {
      for (const pattern of cluster) {
        // A 17-module pattern stored MSB-first occupies bits 16..0, so it is at
        // least 2^16 and under 2^17. Anything else is a truncated or shifted
        // paste.
        expect(pattern).toBeGreaterThanOrEqual(1 << 16);
        expect(pattern).toBeLessThan(1 << 17);
      }
    }
  });

  it('gives every pattern 4 bars and 4 spaces', () => {
    for (const cluster of CODEWORD_PATTERNS) {
      for (const pattern of cluster) {
        expect(runsIn(pattern)).toHaveLength(8);
      }
    }
  });

  it('starts every pattern with a bar and ends with a space', () => {
    // A PDF417 codeword is always 4 bars and 4 spaces, bar first.
    for (const cluster of CODEWORD_PATTERNS) {
      for (const pattern of cluster) {
        expect(pattern & (1 << 16)).toBeTruthy();
        expect(pattern & 1).toBeFalsy();
      }
    }
  });

  it('looks a pattern up by cluster and codeword', () => {
    expect(patternFor(0, 0)).toBe(CODEWORD_PATTERNS[0]![0]);
    expect(patternFor(2, 928)).toBe(CODEWORD_PATTERNS[2]![928]);
  });
});

/** The pattern's alternating bar/space run lengths, MSB first. */
function runsIn(pattern: number): number[] {
  const runs: number[] = [];
  let current = (pattern & (1 << 16)) !== 0;
  let length = 0;
  for (let b = 16; b >= 0; b--) {
    const bit = (pattern & (1 << b)) !== 0;
    if (bit === current) {
      length++;
    } else {
      runs.push(length);
      current = bit;
      length = 1;
    }
  }
  runs.push(length);
  return runs;
}
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417Table.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * PDF417 codeword patterns: 929 codewords in each of 3 clusters, 17 modules
 * apiece, stored as 17-bit integers with the most significant bit leftmost.
 *
 * Every symbol row belongs to cluster `(rowIndex % 3) * 3`, which is how a
 * scanner recovers row order from a partial read. Every pattern is 4 bars and
 * 4 spaces starting with a bar, so bit 16 is always set and bit 0 never is —
 * pinned in the test, because a table this size is exactly where a transcription
 * error hides.
 *
 * Ported from a reference implementation rather than typed. `pdf417.test.ts`
 * diffs whole symbols against bwip-js, which transitively checks every pattern
 * a real payload reaches.
 */

export const CODEWORD_PATTERNS: readonly (readonly number[])[] = [
  // cluster 0
  [/* 929 entries, ported */],
  // cluster 3
  [/* 929 entries, ported */],
  // cluster 6
  [/* 929 entries, ported */],
];

export function patternFor(cluster: number, codeword: number): number {
  return CODEWORD_PATTERNS[cluster]![codeword]!;
}
```

The three arrays are filled from the reference source during this step. They are data, not logic; do not attempt to derive them.

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417Table.test.ts
```

Expected: PASS, all four. The bar-first and space-last assertions catch a table pasted with the bit order reversed, which is the most likely porting mistake.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/pdf417Table.ts src/barcode/pdf417Table.test.ts
git commit -m "Port the PDF417 codeword patterns, and pin their shape"
```

---

### Task D2: Byte compaction and error correction

PDF417's error correction is over GF(929), not GF(256) — a different field from DataMatrix's, so it does not share `reedSolomon.ts`.

**Files:**
- Create: `src/barcode/pdf417Encode.ts`
- Test: `src/barcode/pdf417Encode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { byteCompaction, eccCountFor, pdf417Ecc } from './pdf417Encode';

describe('PDF417 byte compaction', () => {
  it('opens with the byte-compaction latch', () => {
    const cws = byteCompaction('abcdef');
    expect(cws[0]).toBe(901);
  });

  it('packs six bytes into five codewords', () => {
    // Byte compaction takes groups of 6 bytes to 5 base-900 codewords.
    expect(byteCompaction('abcdef')).toHaveLength(1 + 5);
  });

  it('carries a remainder group as one codeword per byte', () => {
    // 8 bytes = one group of 6 plus 2 left over.
    expect(byteCompaction('abcdefgh')).toHaveLength(1 + 5 + 2);
  });

  it('uses the alternate latch when the length is a multiple of six', () => {
    // 924 latches byte compaction when the count divides by 6 exactly.
    expect(byteCompaction('abcdef')[0]).toBe(901);
    expect(byteCompaction('abcdefghijkl')[0]).toBe(901);
  });
});

describe('PDF417 error correction', () => {
  it('sizes the ECC level to the data length', () => {
    expect(eccCountFor(10)).toBe(4);    // level 1 -> 2^2
    expect(eccCountFor(60)).toBe(8);    // level 2 -> 2^3
    expect(eccCountFor(200)).toBe(16);  // level 3 -> 2^4
    expect(eccCountFor(500)).toBe(32);  // level 4 -> 2^5
  });

  it('returns exactly the requested number of ECC codewords', () => {
    expect(pdf417Ecc([1, 2, 3, 4, 5], 8)).toHaveLength(8);
  });

  it('produces every codeword inside the base-929 alphabet', () => {
    for (const cw of pdf417Ecc([100, 200, 300, 400], 16)) {
      expect(cw).toBeGreaterThanOrEqual(0);
      expect(cw).toBeLessThan(929);
    }
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417Encode.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * PDF417 byte compaction and error correction.
 *
 * Byte compaction only. PDF417 also has Text and Numeric modes, which reach
 * roughly two characters per codeword against Byte's ~1.2 codewords per byte —
 * pure density, at the cost of a mode-switching surface where PDF417
 * implementations characteristically go wrong. Byte encodes any payload and
 * produces a fully valid symbol, and density only matters once a real payload
 * proves too wide for the tape.
 *
 * The error correction is Reed-Solomon over GF(929) — a prime field, unlike
 * DataMatrix's GF(2^8), so none of `reedSolomon.ts` applies here.
 */

const MODULUS = 929;
const LATCH_BYTE = 901;

/** Codewords for `data` under byte compaction, including the opening latch. */
export function byteCompaction(data: string): number[] {
  const bytes = new TextEncoder().encode(data);
  const out: number[] = [LATCH_BYTE];

  let i = 0;
  while (i + 6 <= bytes.length) {
    // Six bytes as one big-endian integer, re-expressed in base 900.
    let value = 0n;
    for (let k = 0; k < 6; k++) value = value * 256n + BigInt(bytes[i + k]!);
    const group: number[] = [];
    for (let k = 0; k < 5; k++) {
      group.unshift(Number(value % 900n));
      value /= 900n;
    }
    out.push(...group);
    i += 6;
  }

  // A trailing partial group stays one codeword per byte.
  for (; i < bytes.length; i++) out.push(bytes[i]!);

  return out;
}

/**
 * ECC codewords for a data length, per the standard's recommendation: level 1
 * to 40 codewords, 2 to 160, 3 to 320, 4 beyond. Each level n contributes
 * 2^(n+1) ECC codewords.
 */
export function eccCountFor(dataLength: number): number {
  const level = dataLength <= 40 ? 1 : dataLength <= 160 ? 2 : dataLength <= 320 ? 3 : 4;
  return 2 ** (level + 1);
}

/** `count` Reed-Solomon codewords over GF(929) for `data`. */
export function pdf417Ecc(data: readonly number[], count: number): number[] {
  const gen = generatorPoly(count);
  const rem = new Array<number>(count).fill(0);

  for (const cw of data) {
    const factor = (cw + rem[count - 1]!) % MODULUS;
    for (let i = count - 1; i > 0; i--) {
      rem[i] = (rem[i - 1]! + MODULUS - (factor * gen[i]!) % MODULUS) % MODULUS;
    }
    rem[0] = (MODULUS - (factor * gen[0]!) % MODULUS) % MODULUS;
  }

  return rem.map((v) => (v === 0 ? 0 : MODULUS - v)).reverse();
}

/** The generator polynomial's coefficients for `degree` ECC codewords. */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  let root = 1;
  for (let d = 0; d < degree; d++) {
    root = (root * 3) % MODULUS;
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] = (next[i]! + poly[i]! * root) % MODULUS;
      next[i + 1] = (next[i + 1]! + poly[i]!) % MODULUS;
    }
    poly = next;
  }
  return poly.slice(0, degree);
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417Encode.test.ts
```

Expected: PASS, all seven. If `pdf417Ecc` produces out-of-range values the generator polynomial's root sequence is wrong — PDF417 uses 3 as its primitive element, not 2.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/pdf417Encode.ts src/barcode/pdf417Encode.test.ts
git commit -m "Compact PDF417 payloads as bytes, and protect them over GF(929)"
```

---

### Task D3: Symbol layout

**Files:**
- Create: `src/barcode/pdf417Layout.ts`
- Test: `src/barcode/pdf417Layout.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { chooseLayout, MAX_COLUMNS, MAX_ROWS } from './pdf417Layout';

describe('PDF417 layout', () => {
  it('picks a layout holding every codeword', () => {
    const layout = chooseLayout(14, 1);
    expect(layout).not.toBeNull();
    expect(layout!.columns * layout!.rows).toBeGreaterThanOrEqual(14);
  });

  it('honors an explicit column count', () => {
    const layout = chooseLayout(14, 1, { columns: 2 });
    expect(layout!.columns).toBe(2);
    expect(layout!.rows).toBe(7);
  });

  it('honors an explicit row count', () => {
    const layout = chooseLayout(14, 1, { rows: 7 });
    expect(layout!.rows).toBe(7);
  });

  it('targets the requested aspect ratio when choosing freely', () => {
    // A wide target should yield more columns than a narrow one.
    const wide = chooseLayout(60, 1, { targetAspect: 6 });
    const narrow = chooseLayout(60, 1, { targetAspect: 0.5 });
    expect(wide!.columns).toBeGreaterThan(narrow!.columns);
  });

  it('stays inside the symbology limits', () => {
    const layout = chooseLayout(900, 1);
    expect(layout!.columns).toBeLessThanOrEqual(MAX_COLUMNS);
    expect(layout!.rows).toBeLessThanOrEqual(MAX_ROWS);
  });

  it('returns null when no layout holds the payload', () => {
    expect(chooseLayout(100000, 1)).toBeNull();
  });

  it('reports the module width a symbol will occupy', () => {
    // Width is 17 modules per data column, plus start, stop and two indicators.
    const layout = chooseLayout(14, 1, { columns: 2 });
    expect(layout!.moduleWidth).toBe(17 * (2 + 4) + 1);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417Layout.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * Choosing a PDF417 symbol's shape.
 *
 * A symbol is `columns` data codewords across by `rows` down, so its capacity
 * is their product and many shapes hold the same payload. Left free, we pick
 * the one closest to the pose's aspect ratio, which minimizes letterboxing.
 *
 * An explicit column or row count overrides that, because a file we wrote
 * states the layout it was drawn with — P-touch would otherwise recompute its
 * own and redraw a symbol a different size. Its auto-selection is not ours: for
 * the same payload at the same 2 columns it chose 7 rows where bwip-js chooses
 * 21.
 */

export const MAX_COLUMNS = 30;
export const MAX_ROWS = 90;
const MIN_ROWS = 3;

export interface Pdf417Layout {
  columns: number;
  rows: number;
  /** Total symbol width in modules: 17 per data column, plus a start pattern,
   *  a stop pattern, two row indicators, and the single closing module. */
  moduleWidth: number;
}

export interface LayoutOptions {
  columns?: number;
  rows?: number;
  /** Width-to-height ratio to aim for when choosing freely. */
  targetAspect?: number;
}

export function chooseLayout(
  codewords: number,
  rowHeightModules: number,
  opts: LayoutOptions = {},
): Pdf417Layout | null {
  const build = (columns: number, rows: number): Pdf417Layout => ({
    columns,
    rows,
    moduleWidth: 17 * (columns + 4) + 1,
  });

  if (opts.columns !== undefined) {
    const columns = opts.columns;
    const rows = opts.rows ?? Math.max(MIN_ROWS, Math.ceil(codewords / columns));
    if (columns < 1 || columns > MAX_COLUMNS || rows > MAX_ROWS) return null;
    if (columns * rows < codewords) return null;
    return build(columns, rows);
  }

  if (opts.rows !== undefined) {
    const rows = opts.rows;
    const columns = Math.max(1, Math.ceil(codewords / rows));
    if (rows < MIN_ROWS || rows > MAX_ROWS || columns > MAX_COLUMNS) return null;
    return build(columns, rows);
  }

  const target = opts.targetAspect ?? 2;
  let best: Pdf417Layout | null = null;
  let bestError = Infinity;
  for (let columns = 1; columns <= MAX_COLUMNS; columns++) {
    const rows = Math.max(MIN_ROWS, Math.ceil(codewords / columns));
    if (rows > MAX_ROWS) continue;
    const candidate = build(columns, rows);
    const aspect = candidate.moduleWidth / (rows * rowHeightModules);
    const error = Math.abs(Math.log(aspect / target));
    if (error < bestError) {
      bestError = error;
      best = candidate;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417Layout.test.ts
```

Expected: PASS, all seven.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/pdf417Layout.ts src/barcode/pdf417Layout.test.ts
git commit -m "Choose a PDF417 shape, or take the one the file states"
```

---

### Task D4: Assemble the encoder, and diff it against bwip-js

**Files:**
- Create: `src/barcode/pdf417.ts`
- Test: `src/barcode/pdf417.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { encodePdf417 } from './pdf417';
import { oracle2d } from './testOracle';

describe('encodePdf417', () => {
  it('matches the reference encoder at a pinned layout', () => {
    // bwip-js picks its own layout, so both sides are pinned to compare at all.
    for (const payload of ['12345678', 'HELLO WORLD', 'Test-1234']) {
      const sym = encodePdf417(payload, { columns: 2, aspect: 3 });
      expect(sym.ok, payload).toBe(true);
      if (!sym.ok || sym.kind !== '2d') return;
      const expected = oracle2d('pdf417', payload, { columns: 2, eclevel: 1 });
      expect(sym.modules, payload).toEqual(expected);
    }
  });

  it('reports rows three modules tall', () => {
    const sym = encodePdf417('12345678', { aspect: 3 });
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.rowHeightModules).toBe(3);
  });

  it('takes the row aspect the file states', () => {
    const sym = encodePdf417('12345678', { aspect: 4 });
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.rowHeightModules).toBe(4);
  });

  it('asks for the 2-module quiet zone the standard specifies', () => {
    const sym = encodePdf417('12345678', {});
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.quiet).toEqual({ left: 2, right: 2, top: 2, bottom: 2 });
  });

  it('is 17 modules per column plus the fixed overhead wide', () => {
    const sym = encodePdf417('12345678', { columns: 2 });
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.cols).toBe(103); // 17 * (2 + 4) + 1
  });

  it('rejects an empty payload', () => {
    expect(encodePdf417('', {})).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a payload no layout holds', () => {
    const result = encodePdf417('x'.repeat(20000), {});
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write it**

```ts
/**
 * PDF417.
 *
 * A stacked symbology: `columns` data codewords across by `rows` down, each row
 * bracketed by a start pattern, two row indicators and a stop pattern. Rows are
 * three modules tall by default -- ISO 15438's minimum, and P-touch's
 * `pdf417Style` default for its `aspect` attribute -- which is why `Symbol2D`
 * carries `rowHeightModules` at all.
 */
import type { EncodeResult } from './types';
import { uniformQuiet } from './types';
import { byteCompaction, eccCountFor, pdf417Ecc } from './pdf417Encode';
import { chooseLayout } from './pdf417Layout';
import { patternFor } from './pdf417Table';

const START = 0b11111111010101000;
const STOP = 0b111111101000101001;

export interface Pdf417Options {
  columns?: number;
  rows?: number;
  eccCodewords?: number;
  /** Row height as a multiple of module width. Defaults to 3. */
  aspect?: number;
  /** Width-to-height ratio to aim for when choosing the layout freely. */
  targetAspect?: number;
}

export function encodePdf417(data: string, opts: Pdf417Options): EncodeResult {
  if (data.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'PDF417 needs a payload' };
  }

  const rowHeightModules = opts.aspect ?? 3;
  const payload = byteCompaction(data);
  const eccCount = opts.eccCodewords ?? eccCountFor(payload.length);

  // The first codeword is the symbol's own length, itself included.
  const withLength = [payload.length + 1, ...payload];
  const total = withLength.length + eccCount;

  const layout = chooseLayout(total, rowHeightModules, {
    ...(opts.columns !== undefined ? { columns: opts.columns } : {}),
    ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
    ...(opts.targetAspect !== undefined ? { targetAspect: opts.targetAspect } : {}),
  });
  if (!layout) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `Payload is too long for a PDF417: ${total} codewords needs more than 30 columns of 90 rows`,
    };
  }

  // Pad to fill the grid, then restate the length over the padded total.
  const capacity = layout.columns * layout.rows - eccCount;
  const padded = [...withLength];
  while (padded.length < capacity) padded.push(900);
  padded[0] = padded.length;

  const codewords = [...padded, ...pdf417Ecc(padded, eccCount)];
  const modules = drawRows(codewords, layout.columns, layout.rows, eccCount);

  return {
    ok: true,
    kind: '2d',
    cols: layout.moduleWidth,
    rows: layout.rows,
    rowHeightModules,
    modules,
    quiet: uniformQuiet(2),
    text: data,
  };
}

/**
 * One module row per codeword row: start, left indicator, the row's data
 * codewords, right indicator, stop.
 *
 * The row indicators carry the symbol's dimensions and error-correction level,
 * which is how a scanner reassembles a symbol read out of order. Each row's
 * three indicator values rotate by row group, and every codeword in a row is
 * drawn from cluster `row % 3`.
 */
function drawRows(
  codewords: readonly number[],
  columns: number,
  rows: number,
  eccCount: number,
): boolean[][] {
  // The indicators carry the ECC *level*, not the codeword count: level n
  // contributes 2^(n+1) codewords, so the level is log2(count) - 1.
  const eccLevel = Math.log2(eccCount) - 1;
  const grid: boolean[][] = [];

  for (let r = 0; r < rows; r++) {
    const cluster = r % 3;
    const group = Math.floor(r / 3);
    const left =
      cluster === 0 ? group * 30 + Math.floor((rows - 1) / 3)
      : cluster === 1 ? group * 30 + eccLevel * 3 + ((rows - 1) % 3)
      : group * 30 + (columns - 1);
    const right =
      cluster === 0 ? group * 30 + (columns - 1)
      : cluster === 1 ? group * 30 + Math.floor((rows - 1) / 3)
      : group * 30 + eccLevel * 3 + ((rows - 1) % 3);

    const row: number[] = [START, patternFor(cluster, left)];
    for (let c = 0; c < columns; c++) {
      row.push(patternFor(cluster, codewords[r * columns + c]!));
    }
    row.push(patternFor(cluster, right), STOP);

    grid.push(rowModules(row));
  }

  return grid;
}

/** Expand a row's patterns into modules. START is 17 wide, STOP is 18. */
function rowModules(patterns: readonly number[]): boolean[] {
  const out: boolean[] = [];
  patterns.forEach((pattern, i) => {
    const width = i === patterns.length - 1 ? 18 : 17;
    for (let b = width - 1; b >= 0; b--) out.push((pattern & (1 << b)) !== 0);
  });
  return out;
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/pdf417.test.ts
```

Expected: PASS, all seven.

The oracle diff is the hard one. If it fails, check in this order: symbol **width** wrong means the start/stop/indicator count is off; every row wrong but the width right means the cluster selection or the row-indicator formula is wrong; one row wrong means a codeword is wrong, which `pdf417Encode.test.ts` should have caught; the whole grid inverted means `rowModules` has its bit order reversed, which `pdf417Table.test.ts`'s bar-first assertion should have caught.

Do not adjust the expected values to make it pass. bwip-js is the reference.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/pdf417.ts src/barcode/pdf417.test.ts
git commit -m "Encode PDF417, diffed against bwip-js at a pinned layout

Both sides have to be pinned to compare at all -- for the same payload
at 2 columns, P-touch picks 7 rows and bwip-js picks 21. Which is also
why export states row, column and eccLevel rather than writing auto."
```

---

# Phase E — Wiring, file format, verification

### Task E1: Dispatch the two new protocols

**Files:**
- Modify: `src/barcode/encode.ts`
- Modify: `src/barcode/request.ts`
- Test: `src/barcode/encode.test.ts`

- [ ] **Step 1: Write the failing test**

Update `src/barcode/encode.test.ts`'s supported-protocol pin and add:

```ts
it('encodes a DataMatrix through the dispatcher', () => {
  const result = encodeBarcode({ protocol: 'DATAMATRIX', data: '12345678' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.kind).toBe('2d');
});

it('encodes a PDF417 through the dispatcher', () => {
  const result = encodeBarcode({ protocol: 'PDF417', data: '12345678' });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.kind).toBe('2d');
});

it('passes an explicit PDF417 layout through from the file', () => {
  const result = encodeBarcode({
    protocol: 'PDF417',
    data: '12345678',
    pdf417: { column: '2', row: '7', aspect: 3 },
  });
  expect(result.ok).toBe(true);
  if (!result.ok || result.kind !== '2d') return;
  expect(result.rows).toBe(7);
  expect(result.cols).toBe(103);
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/encode.test.ts
```

Expected: FAIL — both protocols return `unsupported`.

- [ ] **Step 3: Extend the dispatcher**

In `src/barcode/encode.ts`, add `'DATAMATRIX'` and `'PDF417'` to `SUPPORTED_PROTOCOLS` after `'QRCODE'`, extend `EncodeRequest`:

```ts
  dataMatrix?: { model?: string; cellSize?: number };
  pdf417?: { row?: string; column?: string; eccLevel?: string; aspect?: number };
```

and add the two cases before `default:`:

```ts
    case 'DATAMATRIX':
      return encodeDataMatrix(req.data);
    case 'PDF417': {
      // "auto" is P-touch's way of saying "reader, pick one". A number means the
      // file states the symbol it was drawn with, and we draw that one.
      const asCount = (v: string | undefined) => {
        const n = Number(v);
        return Number.isInteger(n) && n > 0 ? n : undefined;
      };
      const columns = asCount(req.pdf417?.column);
      const rows = asCount(req.pdf417?.row);
      const ecc = asCount(req.pdf417?.eccLevel);
      return encodePdf417(req.data, {
        ...(columns !== undefined ? { columns } : {}),
        ...(rows !== undefined ? { rows } : {}),
        ...(ecc !== undefined ? { eccCodewords: 2 ** (ecc + 1) } : {}),
        ...(req.pdf417?.aspect !== undefined ? { aspect: req.pdf417.aspect } : {}),
      });
    }
```

with the imports at the top.

- [ ] **Step 4: Pass the options through `barcodeRequest`**

In `src/barcode/request.ts`, add before the closing brace:

```ts
    ...(data.dataMatrix ? { dataMatrix: data.dataMatrix } : {}),
    ...(data.pdf417 ? { pdf417: data.pdf417 } : {}),
```

- [ ] **Step 5: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/encode.ts src/barcode/request.ts src/barcode/encode.test.ts
git commit -m "Dispatch DataMatrix and PDF417, honoring a layout the file states"
```

---

### Task E2: Say why the two declined symbologies are declined

**Files:**
- Modify: `src/barcode/encode.ts`
- Test: `src/barcode/encode.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('says why a MaxiCode will never work here, not just that it does not', () => {
  const result = encodeBarcode({ protocol: 'MAXICODE', data: '123' });
  expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
  if (result.ok) return;
  expect(result.detail).toMatch(/fixed size|26\.9|18\.1/i);
});

it('says a DataBar is unsupported by name', () => {
  for (const protocol of ['GS1DATABAR', 'RSS'] as const) {
    const result = encodeBarcode({ protocol, data: '00012345678905' });
    expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
    if (result.ok) return;
    expect(result.detail).toMatch(/DataBar/i);
  }
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/encode.test.ts -t "MaxiCode"
```

Expected: FAIL — the detail is the bare protocol name.

- [ ] **Step 3: Write the messages**

In `src/barcode/encode.ts`, replace the `default:` case:

```ts
    default:
      return { ok: false, reason: 'unsupported', detail: unsupportedReason(req.protocol) };
```

and add:

```ts
/**
 * Why a symbology we don't encode isn't coming. Two of these are permanent
 * enough to deserve a reason rather than a name.
 */
function unsupportedReason(protocol: BarcodeProtocol): string {
  switch (protocol) {
    case 'MAXICODE':
      // ISO/IEC 16023 fixes the symbol at 28.14 x 26.91mm and offers no smaller
      // version. The widest tape this printer takes is 24mm, whose printable
      // band is 128 dots at 180dpi -- 18.1mm. It cannot be printed at any size.
      return 'MaxiCode is a fixed size (26.9mm tall) and the widest printable band on this printer is 18.1mm, so it cannot be printed';
    case 'GS1DATABAR':
    case 'RSS':
      return 'GS1 DataBar is not supported yet';
    default:
      return protocol;
  }
}
```

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcode/encode.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/barcode/encode.ts src/barcode/encode.test.ts
git commit -m "Say why a MaxiCode can't be printed, rather than just its name"
```

---

### Task E3: Export each symbology's module size to its own attribute

**Files:**
- Modify: `src/lbxExport.ts:79-108`
- Test: `src/barcodeExport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
describe('2D barcode export', () => {
  it('does not stamp a qrcodeStyle onto a DataMatrix', () => {
    const node = barcodeNode({ protocol: 'DATAMATRIX', data: '12345678' });
    const out = exportOne(node, { x: 0, y: 0, width: 25.6, height: 25.6 });
    expect(out.qrCode).toBeUndefined();
    expect(out.dataMatrix).toBeDefined();
  });

  it('does not stamp a qrcodeStyle onto a PDF417', () => {
    const node = barcodeNode({ protocol: 'PDF417', data: '12345678' });
    const out = exportOne(node, { x: 0, y: 0, width: 85.6, height: 20 });
    expect(out.qrCode).toBeUndefined();
    expect(out.pdf417).toBeDefined();
  });

  it('states the PDF417 layout it drew, rather than auto', () => {
    const node = barcodeNode({ protocol: 'PDF417', data: '12345678' });
    const out = exportOne(node, { x: 0, y: 0, width: 85.6, height: 20 });
    expect(out.pdf417?.column).not.toBe('auto');
    expect(out.pdf417?.row).not.toBe('auto');
    expect(Number(out.pdf417!.column)).toBeGreaterThan(0);
    expect(Number(out.pdf417!.row)).toBeGreaterThan(0);
  });

  it('grows the exported box by the 2 modules per side P-touch expects', () => {
    const node = barcodeNode({ protocol: 'DATAMATRIX', data: '12345678' });
    const pose = { x: 20, y: 20, width: 19.2, height: 19.2 }; // 12 modules at 1.6pt
    const out = exportOne(node, pose);
    expect(out.dataMatrix!.cellSize).toBeCloseTo(1.6, 6);
    expect(out.position.width).toBeCloseTo(25.6, 6); // 16 modules
    expect(out.position.x).toBeCloseTo(16.8, 6);     // inset back out by 3.2
  });
});
```

Reuse `barcodeExport.test.ts`'s existing `exportOne` helper and follow its `barcodeNode` construction; if the file names them differently, use its names rather than introducing these.

- [ ] **Step 2: Run and watch it fail**

```bash
cd ~/src/lbx-editor && npx vitest run src/barcodeExport.test.ts -t "2D barcode export"
```

Expected: FAIL — a DataMatrix currently gets a `qrCode` and no `dataMatrix`.

- [ ] **Step 3: Rewrite the barcode export branch**

In `src/lbxExport.ts`, replace the `case 'barcode':` body from `const encoded =` through the `objects.push({...})` call:

```ts
      case 'barcode': {
        // The pose is authoritative for us; P-touch sizes from a module width
        // recorded under a different attribute per symbology -- barWidth for
        // 1D, qrcodeStyle cellSize, datamatrixStyle cellSize, pdf417Style
        // width. Restate the pose in whichever one applies so the two agree on
        // the drawn size. Falls back to the imported values when the payload
        // doesn't encode -- nothing better to say.
        const encoded = encodeBarcode(barcodeRequest(data));
        const modulePt = encoded.ok ? barcodeModulePt(encoded, pose) : undefined;
        const is2d = encoded.ok && encoded.kind === '2d';

        // P-touch's 2D object box is the symbol plus 2 modules per side.
        const position = is2d && modulePt !== undefined
          ? boxFromSymbolPose(pose, modulePt)
          : { x: pose.x, y: pose.y, width: pose.width, height: pose.height };

        const barWidth = encoded.ok && encoded.kind === '1d' ? modulePt! : data.barWidth;

        const qrCode = data.protocol === 'QRCODE' && is2d
          ? { ...data.qrCode, cellSize: modulePt! }
          : data.protocol === 'QRCODE' ? data.qrCode : undefined;

        const dataMatrix = data.protocol === 'DATAMATRIX' && is2d
          ? { ...data.dataMatrix, model: 'square' as const, cellSize: modulePt! }
          : data.protocol === 'DATAMATRIX' ? data.dataMatrix : undefined;

        // Write the layout we drew rather than "auto": P-touch's own choice
        // differs from ours, and an "auto" invites it to redraw a symbol a
        // different size than the one on screen.
        const pdf417 = data.protocol === 'PDF417' && encoded.ok && encoded.kind === '2d'
          ? {
              ...data.pdf417,
              model: 'standard',
              width: modulePt!,
              aspect: encoded.rowHeightModules,
              row: String(encoded.rows),
              column: String((encoded.cols - 1) / 17 - 4),
              eccLevel: data.pdf417?.eccLevel ?? 'auto',
            }
          : data.protocol === 'PDF417' ? data.pdf417 : undefined;

        objects.push({
          type: 'barcode',
          position,
          protocol: data.protocol,
          data: data.data,
          barWidth,
          barRatio: data.barRatio,
          humanReadable: data.humanReadable,
          humanReadableAlignment: data.humanReadableAlignment,
          checkDigit: data.checkDigit,
          zeroFill: data.zeroFill,
          brush: data.opaqueBackground
            ? { style: 'SOLID' as const, color: '#FFFFFF' }
            : { style: 'NULL' as const },
          ...(qrCode ? { qrCode } : {}),
          ...(dataMatrix ? { dataMatrix } : {}),
          ...(pdf417 ? { pdf417 } : {}),
        });
        break;
      }
```

Add `import { boxFromSymbolPose } from './barcode/poseBox';` at the top.

- [ ] **Step 4: Run and watch it pass**

```bash
cd ~/src/lbx-editor && npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
cd ~/src/lbx-editor
git add src/lbxExport.ts src/barcodeExport.test.ts
git commit -m "Send each symbology's module size to its own attribute

kind === '2d' meant QR only by accident, so a DataMatrix would have gone
out wearing a qrcodeStyle. And PDF417 now exports the row and column
count it was drawn with instead of auto, because P-touch's automatic
choice is not ours -- 7 rows against bwip-js's 21 for the same payload."
```

---

### Task E4: Pin the whole thing against the real P-touch file

The one test that checks our reading of a file we did not write.

**Files:**
- Add: a copy of `barcode2.lbx` in the repo's fixture directory
- Test: `src/lbxImport.test.ts`

- [ ] **Step 1: Copy the fixture**

```bash
cd ~/src/lbx-editor
cp ~/src/bil-lbx/docs/samples/barcode2.lbx <the directory lbxImport.test.ts already loads fixtures from>
```

- [ ] **Step 2: Write the test**

```ts
describe('barcode2.lbx, authored in P-touch Editor', () => {
  it('reads each 2D barcode at the module size the file states', async () => {
    const doc = await importLbx(await readFixture('barcode2.lbx'));
    const barcodes = doc.nodes.filter((n) => n.data.kind === 'barcode');

    // Three DataMatrix at cellSize 1.6, 2.4, 1.6 -- all 12-module symbols.
    const dm = barcodes.filter((n) => n.data.protocol === 'DATAMATRIX');
    expect(dm).toHaveLength(3);
    expect(dm.map((n) => n.pose.width / 12).map((v) => Number(v.toFixed(4))))
      .toEqual([1.6, 2.4, 1.6]);

    // Two PDF417 at width 0.8 and 1.2 -- both 103 modules across.
    const pdf = barcodes.filter((n) => n.data.protocol === 'PDF417');
    expect(pdf).toHaveLength(2);
    expect(pdf.map((n) => n.pose.width / 103).map((v) => Number(v.toFixed(4))))
      .toEqual([0.8, 1.2]);
  });

  it('carries the row aspect P-touch recorded', async () => {
    const doc = await importLbx(await readFixture('barcode2.lbx'));
    const pdf = doc.nodes.find((n) => n.data.kind === 'barcode' && n.data.protocol === 'PDF417');
    expect(pdf!.data.kind === 'barcode' && pdf!.data.pdf417?.aspect).toBe(3);
  });

  it('leaves the DataBar objects unsupported rather than mis-drawn', async () => {
    const doc = await importLbx(await readFixture('barcode2.lbx'));
    const rss = doc.nodes.filter((n) => n.data.kind === 'barcode' && n.data.protocol === 'RSS');
    expect(rss).toHaveLength(3);
    for (const node of rss) {
      const result = encodeBarcode(barcodeRequest(node.data as LabelBarcodeData));
      expect(result).toMatchObject({ ok: false, reason: 'unsupported' });
    }
  });
});
```

- [ ] **Step 3: Run it**

```bash
cd ~/src/lbx-editor && npx vitest run src/lbxImport.test.ts -t "barcode2"
```

Expected: PASS. A failure on the module-size assertions means the `symbolPoseFromBox` conversion is not reaching these protocols — check the `filedModulePt` switch in `lbxImport.ts`.

- [ ] **Step 4: Commit**

```bash
cd ~/src/lbx-editor
git add src/lbxImport.test.ts <fixture path>
git commit -m "Pin the 2D pose conversion against the file it was measured from"
```

---

### Task E5: Round-trip through P-touch Editor

The tests prove we agree with ourselves and with bwip-js. This proves P-touch agrees.

- [ ] **Step 1: Build a label**

```bash
cd ~/src/lbx-editor && npm run dev
```

Place a DataMatrix and a PDF417 on a 24mm label. Export to `.lbx`.

- [ ] **Step 2: Open the export in P-touch Editor**

Confirm, and write the answers into the spec's **Measured against P-touch** section:

- Does the file open at all? (A file with `protocol="DATAMATRIX"` and a style element it did not write is the untested case.)
- Does each symbol draw at the size we drew it?
- Does the PDF417 keep our row and column count, or does P-touch redraw its own?

- [ ] **Step 3: Re-import P-touch's re-save**

Save from P-touch, reopen in the editor, confirm both barcodes come back the same size. This is the round-trip the `margin` question could not be settled for — if P-touch rewrites the box differently than it reads it, this is where it shows.

- [ ] **Step 4: Record the result**

Append the findings to `docs/superpowers/specs/2026-07-31-remaining-symbologies-design.md` and commit. A failure here is a finding, not a blocker — record it and decide what it changes.

---

### Task E6: Print, and scan the tape

The oracle proves the module pattern. It does not prove that 180 dpi thermal output of that pattern survives contact with a scanner, and these are the symbologies where a render that looks perfect can be unreadable.

- [ ] **Step 1: Print**

Use `.claude/skills/verify` to drive the real print flow. Print a label carrying a DataMatrix and a PDF417 at a comfortable size — module width at least 3 dots, well clear of the 2-dot warning.

- [ ] **Step 2: Scan the printed tape with a phone**

Confirm both decode, and that the decoded text is the payload.

- [ ] **Step 3: Find the floor**

Print again at successively smaller module sizes until scanning fails. Record where — that number is what the `MIN_RELIABLE_MODULE_DOTS` warning should mean for 2D symbologies, and today's 2-dot threshold was reasoned about for 1D bars.

- [ ] **Step 4: Record it**

Append to the spec. If the 2D floor differs materially from 1D's, that is a follow-up for `scannability.ts`, not a change to make here.

- [ ] **Step 5: Update CLAUDE.md**

Add to the barcode section of `docs`-adjacent notes in `CLAUDE.md`:

```markdown
- DataMatrix (ECC200, square, ASCII encodation) and PDF417 (byte compaction)
  encode in `src/barcode/`, each diffed module-for-module against bwip-js.
  MaxiCode and GS1 DataBar still fail closed, for opposite reasons: MaxiCode is
  a fixed 26.9mm tall against an 18.1mm printable band, and DataBar has neither
  a working oracle nor an obtainable sample of an unstacked variant. Both say so
  rather than reporting a bare protocol name.
- A 2D barcode's pose means the symbol; P-touch's object box means the symbol
  plus 2 modules of quiet zone per side. `src/barcode/poseBox.ts` converts at
  the file boundary, so one convention holds inside the app. Before it, every
  imported P-touch QR drew 19% too large.
```

- [ ] **Step 6: Commit and finish the branch**

```bash
cd ~/src/lbx-editor
git add CLAUDE.md docs/
git commit -m "Record what the printed DataMatrix and PDF417 actually scanned"
```

Then use `superpowers:finishing-a-development-branch`.

---

## Self-review notes

**Spec coverage.** Every section of the spec maps to a task: MaxiCode's message → E2; the bundle-size decision → the hand-written encoders in C and D; the style elements → A3–A5; the 2-module box → B5 and E3; the row aspect as a file field → A4, D3, D4, E3; P-touch's differing auto-selection → E3's explicit `row`/`column`; the QR import bug → B5; encoder-owned quiet zones → B3; `Symbol2D` generalization → B2 and B4; no new diagnostics and no new controls → nothing to do, deliberately; the testing section → C5, D4, E4, E6; DataBar cut → E2 and E4's unsupported assertion.

**Two things the spec named that this plan deliberately stages.** DataMatrix's 32×32-and-up sizes are Task C6, separable, with a clean failure below it. PDF417's Text and Numeric compaction stay out entirely, as the spec's out-of-scope section says.

**One risk worth naming up front.** Task D4's oracle diff is the hardest step in the plan, because PDF417's row indicators encode the symbol's own dimensions and an error there produces a symbol that is wrong in every row at once. The debugging order in that task's Step 4 is written for exactly that.
