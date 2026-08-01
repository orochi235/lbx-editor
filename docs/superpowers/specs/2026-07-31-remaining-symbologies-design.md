# The remaining symbologies: GS1 DataBar, DataMatrix, PDF417

Four symbologies still fail closed. They import, draw as a placeholder box, and
block printing: `DATAMATRIX`, `PDF417`, `MAXICODE`, `GS1DATABAR`. This settles
three of them, and settles the fourth as one we will not build.

The design also pays a debt the backgrounds spec deferred — the quiet zone is
a flat constant per *kind* today — and fixes a shipping bug that the
measurements below turned up.

> **Revised 2026-08-01** against a second P-touch-authored file,
> `~/src/bil-lbx/docs/samples/barcode2.lbx`. That file overturned four claims
> in the first draft: the 2D quiet zone, the DataMatrix rectangular-variant
> claim, PDF417's row aspect as a constant, and the entire GS1 DataBar section.
> See **Measured against P-touch**.

## MaxiCode is not deferred, it's declined

MaxiCode is a fixed-size symbology. ISO/IEC 16023 pins the symbol at
**28.14 × 26.91 mm**, tolerance ±3%; there is no version ladder to size down.
The widest tape this printer takes is 24 mm, whose printable band is 128 dots
at 180 dpi — **18.06 mm**. A compliant MaxiCode is half again taller than the
tallest thing the hardware can print. No amount of encoder work changes that.

Two further costs, either of which would be reason enough on its own:

- Its modules are **hexagons on an offset honeycomb**, around a bullseye of
  concentric circles. `barcodeRects` returns `Rect[]`, and that array is
  consumed by `drawLabelNode`, `barcodeBackgroundRect`, `ditherProtect`, and
  the print raster. MaxiCode would turn that into a shape union across all four.
- A fixed physical size contradicts the rule the whole barcode module is built
  on: *the pose is authoritative*. Every other symbology scales with its pose.
  MaxiCode cannot, so resizing it would have to either lie or refuse.

So `MAXICODE` stays out of `SUPPORTED_PROTOCOLS`. What changes is the message:
today the `unsupported` failure carries the bare protocol name as its detail.
It should instead say that a MaxiCode is 26.9 mm tall and the widest printable
band is 18.1 mm — the user asking "why not?" deserves the answer, and it is not
one that will change.

## Hand-written encoders, with bwip-js as the oracle

`bwip-js` is already a devDependency and already the oracle for all six
existing encoders (`testOracle.ts`). It also implements all four of the
remaining symbologies, so shipping it at runtime was a real option. Measured
with esbuild, `--bundle --minify`, bytes:

| bundle | minified | gzip |
|---|---:|---:|
| bwip-js, DataMatrix alone | 142,783 | 54,160 |
| bwip-js, all four + two DataBar variants | 329,086 | 105,693 |
| bwip-js, everything | 964,234 | 259,725 |
| **our entire barcode subsystem today** | **28,759** | **10,606** |

Measured standalone, QR alone is 7,820 gzip — essentially all of it the
`qrcode-generator` dependency, since `qr.ts` is about forty lines. The five
hand-written 1D encoder modules are 509–1,027 bytes gzip apiece.

The argument for hand-writing is **bundle size and consistency with the
existing six** — not output fidelity. bwip-js would if anything be more
faithful, since it is the reference the tests already check against, and
hand-transcribed symbology tables are exactly where errors enter. That is why
the oracle exists, and why it must cover the new encoders too.

Lazy-loading bwip-js behind a dynamic import was considered and rejected: it
would erase most of the size cost for documents with no such barcode, but it
makes `encodeBarcode` async, and that function is called synchronously from
`drawLabelNode`. The redraw-on-resolve machinery that would require is real
architecture to buy back a cost we can simply not incur.

## Measured against P-touch (2026-08-01)

`barcode2.lbx` holds three DataMatrix objects (two cell sizes), two PDF417
objects (two module widths), and three GS1 DataBar objects, all authored in
P-touch Editor with the PT-P710BT selected.

### Each symbology has its own style element

Beside `barcodeStyle`, exactly as QR has `qrcodeStyle`:

```xml
<barcode:datamatrixStyle model="square" cellSize="1.6pt" macro="none" fnc01="false" joint="1"/>
<barcode:pdf417Style model="standard" width="0.8pt" aspect="3" row="auto" column="auto" eccLevel="auto" joint="1"/>
<barcode:rssStyle model="RSSExpandedStacked" margin="true" autoLengths="true" lengths="14"
                  barWidth="0.1pt" column="4" humanReadable="true"
                  humanReadableAlignment="LEFT" autoAdd01="false"/>
```

bil-lbx models none of these. Each carries the 2D module size under a different
attribute name — `cellSize`, `width`, `barWidth` — which is why export cannot
simply reuse the QR path.

### The 2D object box includes a 2-module quiet zone per side

| object | box | module size | box ÷ module | true symbol | difference |
|---|---:|---:|---:|---:|---:|
| DataMatrix #1 | 25.6pt | 1.6pt | 16 | 12 | +4 |
| DataMatrix #2 | 38.4pt | 2.4pt | 16 | 12 | +4 |
| PDF417 #1 | 85.6pt | 0.8pt | 107 | 103 | +4 |
| PDF417 #2 | 128.4pt | 1.2pt | 107 | 103 | +4 |
| QR (`barcodes.lbx`) | 40pt | 1.6pt | 25 | 21 | +4 |

Invariant across two symbologies, two cell sizes each, plus QR from the earlier
file. PDF417's heights confirm it on the other axis independently:
`(20 − 2×2×0.8) / (3 × 0.8) = 7` rows, and `(30 − 2×2×1.2) / (3 × 1.2) = 7`.

**This is a different mechanism from 1D.** Under `margin="true"` a 1D box gains
a *fixed* 36.8pt regardless of bar width; a 2D box gains 2 modules per side,
which scales with the module. And under the `margin="false"` we always export,
a 1D box is the bars alone.

Note what this is and is not. P-touch's box convention is a **file-format
fact**, not a symbology fact — it belongs in `lbxImport`/`lbxExport`. The
scanning requirement each symbology declares is a separate number that happens
to share a unit. They must not be collapsed into one constant.

### PDF417's row aspect is a file field

`aspect="3"` is P-touch's own name for what this design calls
`rowHeightModules`, defaulting to exactly the ISO 15438 minimum of 3. It is
therefore a value to read and round-trip, not a constant to hardcode.

### P-touch's PDF417 auto-selection is not ours

For the same payload at the same 2 data columns, P-touch chose **7 rows** where
bwip-js chooses 21 — a different automatic ECC and compaction decision. The
file records `row="auto" column="auto" eccLevel="auto"`, so P-touch recomputes
on open. If our auto-selection differs from its, P-touch redraws a symbol a
different size than the one we drew — the WYSIWYG break this work exists to
prevent.

The fix is available in the format: **write explicit `row`, `column` and
`eccLevel` rather than `auto`**, so the file states the symbol we drew instead
of inviting P-touch to pick its own.

### DataMatrix rectangular variants are expressible

`model="square"` implies a counterpart value for the rectangular sizes. The
first draft claimed no `.lbx` field requested them; that was wrong. They stay
out of scope, but as a choice rather than a limitation.

## The QR import bug this exposes

`barcodeModulePt`'s 2D branch is `Math.min(pose.width, pose.height) / size`,
and import takes P-touch's object box as the pose. Since that box carries 2
modules of quiet zone per side, **every QR code imported from a P-touch file
renders 19% too large**: 40/21 = 1.905pt per module against the file's stated
1.6pt.

The error is `(size + 4) / size`, so it grows as symbols get smaller — 19% for
a 21-module QR, 33% for a 12-module DataMatrix, 4% for a 103-module PDF417.

This is the same shape as the EAN defect the backgrounds work fixed, where a
baked-in quiet zone made the symbol draw ~19% narrow. It is fixed here because
this branch is already rewriting the 2D pose convention, and leaving a known
19% error in code being rewritten is not defensible.

The fix belongs at the file boundary: **import shrinks a 2D pose by 2 modules
per side; export grows it back.** Internally the pose stays the symbol alone,
matching 1D, so exactly one convention exists inside the app.

Blast radius is narrower than it looks. Documents we authored store poses that
already mean the symbol, so they are unaffected. Export already survives
because P-touch recomputes its own box from `cellSize` and the data. Only
P-touch-imported 2D barcodes change — and they change to correct.

## The symbol model

`types.ts` gains a quiet zone and loses the square assumption.

```ts
/** Blank margin a scanner needs, in modules, per side — the symbology's own
 *  scanning requirement, NOT P-touch's object-box convention. Only the encoder
 *  knows its symbology, so the encoder states it. */
export interface QuietZone {
  left: number; right: number; top: number; bottom: number;
}

export interface Symbol1D {
  kind: '1d';
  bars: Array<{ x: number; width: number }>;
  totalModules: number;
  quiet: QuietZone;
  text: string;
}

export interface Symbol2D {
  kind: '2d';
  cols: number;          // was: size
  rows: number;
  /** Row height as a multiple of module width. 1 for QR and DataMatrix;
   *  3 for PDF417, matching pdf417Style's `aspect` field, which is the
   *  ISO 15438 minimum and P-touch's default. */
  rowHeightModules: number;
  modules: boolean[][];  // modules[row][col], unchanged
  quiet: QuietZone;
  text: string;
}
```

### The quiet zone moves onto the encoder

`QUIET_ZONE_MODULES_1D` (10) and `QUIET_ZONE_MODULES_2D` (4) are deleted.
`quietZonePt` reads `symbol.quiet` and returns pt per side, instead of
branching on `kind` and returning a single number.

The flat constants cannot survive the new three. DataMatrix asks for 1 module,
PDF417 for 2, and the unstacked DataBar variants for none at all — they are
designed to be read without one. Applying the 2D constant of 4 to a DataMatrix
would blank four times more artwork than the symbology needs and inflate its
dither-protected region to match.

This is the change the backgrounds spec already said was owed, for the same
reason it gave: *only the encoder knows its symbology*. Doing it now means
touching the six existing encoder modules — which cover ten protocols between
them — once rather than twice.

| symbology | left | right | top | bottom |
|---|---:|---:|---:|---:|
| CODE39, CODE128, GS1-128, ITF, CODABAR | 10 | 10 | 0 | 0 |
| EAN-13 | 11 | 7 | 0 | 0 |
| EAN-8 | 7 | 7 | 0 | 0 |
| UPC-A | 9 | 9 | 0 | 0 |
| UPC-E | 9 | 7 | 0 | 0 |
| QR | 4 | 4 | 4 | 4 |
| DataMatrix | 1 | 1 | 1 | 1 |
| PDF417 | 2 | 2 | 2 | 2 |
| GS1 DataBar, unstacked | 0 | 0 | 0 | 0 |

**These are the standards' scanning requirements, and they are to be verified
against bwip-js during implementation, not transcribed from this table.** The
table is the intent; the encoder's declared quiet zone is the artifact, and a
hand-typed constant that looks right is precisely the failure mode the
follow-up warned about.

They are deliberately *not* P-touch's uniform 2-modules-per-side, which is a
box convention handled at the file boundary. QR's 4 exceeds it; DataMatrix's 1
is under it. Both are correct for their own purpose.

Two visible changes fall out, both corrections rather than regressions:

- **EAN-13 goes from a flat 10/10 to the standard 11/7.** Its background rect
  and dither-protected region shift accordingly. This closes the item the
  backgrounds spec deferred with "the EAN family is asymmetric".
- **1D symbols get a zero vertical quiet zone.** The standards ask for none —
  the requirement above and below the bars is bar *height*, not blank margin.
  Today `barcodeBackgroundRect` applies the quiet zone uniformly on all four
  sides, so existing 1D barcodes' backgrounds shrink vertically to the pose.

  Dithering stays safe under that change. The protected region still covers the
  bars themselves, and `ditherProtect` stops error diffusion at the region
  boundary, so artwork immediately above a barcode cannot diffuse into it.

## Geometry

`barcodeModulePt`'s 2D branch becomes:

```
Math.min(pose.width / cols, pose.height / (rows * rowHeightModules))
```

For a square symbol with `rowHeightModules === 1`, `cols === rows === size` and
this is `Math.min(pose.width, pose.height) / size` — exactly what it computes
today. Square behavior is preserved by construction, not by agreement, and
`geometry.test.ts` pins it.

`barcodeRects` centers the `cols × rows` grid in the pose the way it centers a
square today, emitting cells `module` wide by `module * rowHeightModules` tall.
Nothing stretches to fill: a 103 × 21 PDF417 in a square pose renders as a wide
strip with space above and below, rather than a distorted symbol no scanner
reads.

`barcodeBackgroundRect` takes the four per-side quiet values instead of one,
and `ditherProtect` follows automatically — it already calls
`barcodeBackgroundRect` rather than computing its own rect, which is what keeps
the masked region and the dither-exempt region one definition.

### Blast radius

The two type changes reach further than `src/barcode/`. Everything that
touches `Symbol2D.size` or the deleted constants:

| site | change |
|---|---|
| `barcode/index.ts` | drops `QUIET_ZONE_MODULES_1D`/`_2D` from the barrel, adds `QuietZone` |
| `barcode/qr.ts` | returns `cols`/`rows`/`rowHeightModules: 1` and a `quiet` of 4 |
| `barcode/qr.test.ts` | `sym.size` → `sym.cols` throughout |
| `barcode/geometry.test.ts` | imports the constant; rewrites against per-symbol quiet |
| `ditherProtect.test.ts` | computes its expectation from `QUIET_ZONE_MODULES_1D` |
| `barcodeExport.test.ts` | `46 / symbol.size` → `46 / symbol.cols` |
| `lbxImport.ts` | shrinks a 2D pose by 2 modules per side (the QR bug above) |
| `lbxExport.ts` | grows it back; the `kind === '2d'` → `qrcodeStyle` bug below |

`PropertyPanel.tsx` and `diagnostics.ts` both branch on `kind === '2d'` to
decide whether to say "W" or "W and H", and both stay correct for a non-square
2D symbol without modification.

`ditherProtect.ts` itself needs no change: it calls `barcodeBackgroundRect`
rather than computing a rect of its own, which is exactly the property that
keeps the masked region and the dither-exempt region one definition.

## The encoders

### `datamatrix.ts`

ECC200 only. The older ECC000–140 versions are obsolete and modern scanners
read ECC200; there is no reason to carry the others.

Square symbols only, 10×10 through 144×144, auto-sized to the smallest that
fits the payload — `model="square"`, which is what P-touch wrote for all three
sample objects.

Reed–Solomon over GF(256) with the DataMatrix generator polynomial, and the
ISO 16022 default bit placement algorithm.

**ASCII encodation only.** It covers the full character set and already
compacts digit pairs into single codewords. C40, Text and Base256 buy density
for particular payload shapes at the cost of a mode-switching surface — and a
mode-switch bug produces a symbol that encodes the wrong thing while looking
entirely correct, which is the class of failure hardest to catch.

### `pdf417.ts`

The largest of the three. Column count is auto-chosen to best match the pose's
aspect ratio, which minimizes letterboxing and respects the pose being
authoritative. Error correction level is auto-selected from the codeword count
per the standard's recommendation table. Row height comes from
`pdf417Style`'s `aspect`, defaulting to 3.

Whatever those auto-selections produce is then **written explicitly** into
`row`, `column` and `eccLevel` on export, so P-touch redraws our symbol rather
than recomputing its own — see the measurement above.

**Byte compaction only**, initially. PDF417 has three compaction modes — Text,
Numeric and Byte. Byte alone encodes any payload and produces a fully valid,
scannable symbol; Text and Numeric are density optimizations (Text reaches
about two characters per codeword against Byte's ~1.2 codewords per byte).
Mode-switching is where PDF417 implementations characteristically go wrong, and
the density only matters if a real payload proves too wide for the tape. If one
does, Text and Numeric are an additive follow-up with the oracle already in
place to check them.

### `databar.ts` — and what remains unknown about it

The first draft called this the easy one. The sample says otherwise.

**The protocol is `RSS`, not `GS1DATABAR`.** P-touch writes DataBar's former
name, Reduced Space Symbology. bil-lbx's `BarcodeProtocol` union contains
`GS1DATABAR` and no `RSS`, so these objects currently parse into a protocol its
own type says cannot exist.

**The variant lives in `rssStyle`'s `model` attribute.** The sample carries
`RSSExpanded` and `RSSExpandedStacked`; the family also includes `RSS14`,
truncated, stacked, stacked-omnidirectional and limited forms.

**`RSSExpandedStacked` is two-dimensional** — bwip-js reports 102 × 71 modules
for the sample payload. So DataBar is not uniformly a `Symbol1D`, and the
"drops into the existing oracle unchanged" claim holds only for the unstacked
variants.

**The box arithmetic does not resolve.** `rssStyle barWidth="0.1pt"` cannot be
the module width — it would make the 157.6pt Expanded box 1,576 modules against
a real count near 134. The payload form differs too: P-touch accepts bare
digits with `autoAdd01="false"`, while bwip-js requires AI parentheses and
rejects `00012345678905` outright. Until that is settled, no DataBar encoder
can be checked against the oracle.

DataBar is therefore **the last piece to build**, after DataMatrix and PDF417,
and it is gated on the open questions below.

## Export and round-trip

There is a latent bug in `lbxExport.ts` that the new symbologies would walk
straight into:

```ts
const qrCode = encoded.ok && encoded.kind === '2d'
  ? { ...data.qrCode, cellSize: modulePt! }
  : data.qrCode;
```

Today `kind === '2d'` implies QR, so restating the pose as `qrCode.cellSize` is
correct by accident. Once DataMatrix and PDF417 exist, this stamps a
`<barcode:qrcodeStyle>` element onto symbols that are not QR codes. The
condition must key on the protocol, and each symbology's module size must go to
its own attribute — `cellSize`, `width` or `barWidth` respectively.

## bil-lbx changes

Adding the style elements to bil-lbx was chosen over an editor-side workaround,
because without them export drops the module size, the row aspect, and PDF417's
row/column/ECC selection — which is the WYSIWYG break the measurements above
identified. Required there, as a sibling-repo change and a version bump this
branch then depends on:

- `RSS` added to the `BarcodeProtocol` union.
- `datamatrixStyle`, `pdf417Style` and `rssStyle` parsed and emitted, modeled
  as optional fields on `BarcodeObject` beside the existing `qrCode`.
- Unknown attributes on those elements preserved verbatim where practical, so a
  round-trip does not silently drop `macro`, `fnc01`, `joint` or `autoAdd01`.

## Diagnostics and the property panel

**No new diagnostics.** The PDF417 row-height constraint became geometry rather
than a warning. Everything else that can go wrong is an `invalid` encode
result, which already draws a placeholder and blocks the job through
`printPreflight`: a payload too long for a 144×144 DataMatrix, a malformed GTIN
handed to DataBar. The module-under-a-dot and printable-band-overhang checks
apply to the new symbologies unchanged.

**No new controls**, on this branch. This follows the reasoning that closed the
QR `model` question: a control must change something the file can carry and the
canvas can show. Once bil-lbx models the style elements several *become*
expressible — DataMatrix square/rectangular, PDF417 aspect and ECC level, the
DataBar variant — so they are a deliberate follow-up rather than a permanent
exclusion. Adding them here would mean designing three property-panel sections
on top of three new encoders and a file-format change.

## Testing

`testOracle.ts` gains `oracle2d()` beside `oracle()`, turning bwip-js's
`pixs`/`pixx`/`pixy` into a module matrix for diffing. Unstacked DataBar reuses
the `sbs` path unchanged.

- Per-encoder diffs against bwip-js for all three, across a spread of payload
  contents and lengths.
- A new invariant pinning every symbology's declared `quiet` values. These are
  hand-typed constants, which is the transcription-error surface the follow-up
  named.
- `geometry.test.ts` regression pins showing square symbols produce identical
  rects after the `cols`/`rows` generalization, plus cases for a non-square
  grid and for `rowHeightModules`.
- `encode.test.ts`'s `SUPPORTED_PROTOCOLS` pin extended to the three.
- **A `barcode2.lbx` import fixture** pinning the measured module sizes —
  1.6pt and 2.4pt for the DataMatrix objects, 0.8pt and 1.2pt for the PDF417
  objects. That is the regression test for the 19% QR bug, and the only test
  that checks our reading of a real P-touch file rather than our own output.
- `barcodeExport.test.ts` gaining a case that a DataMatrix or PDF417 export
  does **not** emit a `qrcodeStyle`, and that PDF417 exports explicit
  `row`/`column`/`eccLevel` rather than `auto`.

And a hardware step that carries more weight here than usual: print one of each
through `.claude/skills/verify`, then **scan the printed tape with a phone**.
The oracle proves the module pattern matches a reference implementation. It
does not prove that 180 dpi thermal output of that pattern survives contact
with a real scanner, and these are the symbologies where a render that looks
perfect can be unreadable.

## Out of scope

- **MaxiCode** — declined, not deferred. See above.
- **DataMatrix rectangular variants.** Expressible via `datamatrixStyle`'s
  `model`, so this is a choice, not a limitation.
- **DataMatrix C40 / Text / Base256 encodation.** Density optimizations.
- **PDF417 Text and Numeric compaction.** Density optimizations; additive
  later, with the oracle already in place to check them.
- **Property-panel controls** for the new symbologies. A follow-up once
  bil-lbx models the style elements that would back them.

## Open, pending a second sample

Two questions remain, and both are cheap to answer in P-touch Editor:

1. **What does `margin="false"` do to a 2D box?** Every object in
   `barcode2.lbx` has `margin="true"` — the intended margins-off DataMatrix
   came out byte-identical to the margins-on one. If margins-off drops the box
   to the symbol alone, the import/export conversion above disappears entirely
   and we simply always write `margin="false"`, as we already do for 1D. This
   is worth answering before implementing the conversion.

2. **Why is OK greyed out for the unstacked DataBar variants?** The dialog
   lists them but only accepts the bottom two. The payload `00012345678905` is
   a valid GTIN-14 — its check digit computes to 5 — so a malformed payload is
   not the cause. The likeliest explanation is that the `RSS14` family expects
   **13 digits** and appends the check digit itself. A retry with
   `0001234567890` would confirm it, and would produce the unstacked,
   cleanly-1D variant this design most wants.
