# The remaining symbologies: GS1 DataBar, DataMatrix, PDF417

Four symbologies still fail closed. They import, draw as a placeholder box, and
block printing: `DATAMATRIX`, `PDF417`, `MAXICODE`, `GS1DATABAR`. This settles
three of them, and settles the fourth as one we will not build.

The design also pays a debt the backgrounds spec deferred — the quiet zone is
a flat constant per *kind* today, and the new symbologies are the ones that
make that untenable.

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

Measured standalone, QR alone is 7,820 gzip of that total — essentially all of
it the `qrcode-generator` dependency, since `qr.ts` is about forty lines. The
five hand-written 1D encoder modules are 509–1,027 bytes gzip apiece.

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

## The symbol model

`types.ts` gains a quiet zone and loses the square assumption.

```ts
/** Blank margin a scanner needs, in modules, per side. Symbology-specific —
 *  only the encoder knows its symbology, so the encoder states it. */
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
   *  PDF417 rows are 3x their module width (ISO 15438 minimum). */
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
PDF417 for 2, and DataBar Omnidirectional for none at all — it is designed to
be read without one. Applying the 2D constant of 4 to a DataMatrix would blank
four times more artwork than the symbology needs and inflate its
dither-protected region to match; applying the 1D constant of 10 to a DataBar
would reserve a margin the standard does not ask for.

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
| GS1 DataBar Omnidirectional | 0 | 0 | 0 | 0 |

**These values are to be verified against bwip-js during implementation, not
transcribed from this table.** The table is the intent; the encoder's own
declared quiet zone is the artifact, and a hand-typed constant that looks right
is precisely the failure mode the follow-up warned about.

Two visible changes fall out, both corrections rather than regressions:

- **EAN-13 goes from a flat 10/10 to the standard 11/7.** Its background rect
  and dither-protected region shift accordingly. This closes the item the
  backgrounds spec deferred with "the EAN family is asymmetric".
- **1D symbols get a zero vertical quiet zone.** The standards ask for none —
  the requirement above and below the bars is bar *height*, not blank margin.
  Today `barcodeBackgroundRect` applies the quiet zone uniformly on all four
  sides, so existing 1D barcodes' backgrounds shrink vertically to exactly the
  pose.

  Dithering stays safe under that change. The protected region still covers the
  bars themselves, and `ditherProtect` stops error diffusion at the region
  boundary, so artwork immediately above a barcode cannot diffuse into it.

### PDF417's rows are not square

I initially generalized `Symbol2D` on the assumption that modules stay square
and the grid letterboxes in the pose. That is right for QR and DataMatrix and
wrong for PDF417, whose row height Y is a dimension distinct from its module
width X, with **Y ≥ 3X** as the ISO 15438 minimum.

Square cells would render every PDF417 with rows exactly one module tall — out
of spec at every pose size, in every document, with nothing the user could do
about it. Hence `rowHeightModules`, which PDF417 sets to 3 and everything else
sets to 1.

Making this a field rather than a diagnostic is deliberate, and follows the
entry criterion the diagnostics module already states: a check earns its place
when the canvas draws the thing correctly and therefore cannot show it as
wrong. A constraint we can satisfy by construction should be satisfied, not
reported.

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
Nothing stretches to fill: a 103 × 18 PDF417 in a square pose renders as a wide
strip with space above and below, rather than a distorted symbol no scanner
reads.

`barcodeBackgroundRect` takes the four per-side quiet values instead of one,
and `ditherProtect` follows automatically — it already calls
`barcodeBackgroundRect` rather than computing its own rect, which is what keeps
the masked region and the dither-exempt region a single definition.

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
| `lbxExport.ts` | the `kind === '2d'` → `qrcodeStyle` bug below |

`PropertyPanel.tsx` and `diagnostics.ts` both branch on `kind === '2d'` to
decide whether to say "W" or "W and H", and both stay correct for a non-square
2D symbol without modification.

`ditherProtect.ts` itself needs no change: it calls `barcodeBackgroundRect`
rather than computing a rect of its own, which is exactly the property that
keeps the masked region and the dither-exempt region one definition.

## The encoders

### `databar.ts` — GS1 DataBar Omnidirectional

A `Symbol1D`, which makes it the smallest of the three. bwip-js's
`raw('databaromni', …)` returns `sbs` run-lengths, so `testOracle.ts`'s
existing `oracle()` and `bitstring()` work against it unchanged.

Encodes a 14-digit GTIN. A payload that is not a valid GTIN is an `invalid`
encode result, which already draws a placeholder and blocks printing.

The DataBar *family* has roughly seven variants (Omnidirectional, Truncated,
Stacked, Stacked Omnidirectional, Limited, Expanded, Expanded Stacked) with
different encodings. `protocol="GS1DATABAR"` alone cannot distinguish them —
see **Open, pending a P-touch sample** below. Omnidirectional is the base
variant and the one this implements.

### `datamatrix.ts`

ECC200 only. The older ECC000–140 versions are obsolete and modern scanners
read ECC200; there is no reason to carry the others.

Square symbols only, 10×10 through 144×144, auto-sized to the smallest that
fits the payload. `.lbx` carries no field requesting a rectangular variant, so
there is nothing to honor and nothing to round-trip.

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
per the standard's recommendation table.

**Byte compaction only**, initially. PDF417 has three compaction modes — Text,
Numeric and Byte. Byte alone encodes any payload and produces a fully valid,
scannable symbol; Text and Numeric are density optimizations (Text reaches
about two characters per codeword against Byte's ~1.2 codewords per byte).
Mode-switching is where PDF417 implementations characteristically go wrong, and
the density only matters if a real payload proves too wide for the tape. If one
does, Text and Numeric are an additive follow-up with the oracle already in
place to check them.

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
condition must key on the protocol rather than the kind.

That leaves the 2D module size for the new protocols with nowhere to go, which
is the honest state of the file-format side. P-touch keeps per-symbology
options in a **sibling element** next to `barcodeStyle` — visible in the sample
we have as `<barcode:qrcodeStyle model= eccLevel= cellSize= version=>` — and
bil-lbx models only `qrcodeStyle`. Whatever P-touch writes for DataMatrix,
PDF417 and DataBar is unknown to us and would be dropped on export.

So the work is staged deliberately: **encoders, canvas and print land now**;
export writes what bil-lbx models (`protocol`, `data`, and the pose), and the
style-element question waits on a real file. This is the same method that
settled the quiet zone — measured against a P-touch-authored file rather than
reasoned about.

## Diagnostics and the property panel

**No new diagnostics.** The PDF417 row-height constraint became geometry rather
than a warning. Everything else that can go wrong is an `invalid` encode
result, which already draws a placeholder and blocks the job through
`printPreflight`: a payload too long for a 144×144 DataMatrix, a non-GTIN
handed to DataBar. The module-under-a-dot and printable-band-overhang checks
apply to the new symbologies unchanged.

**No new controls.** This follows the reasoning that closed the QR `model`
question: `.lbx` carries no field for DataMatrix symbol size, PDF417 column
count or ECC level, or the DataBar variant, so a control would either do
nothing or change the exported file while the canvas kept drawing the
auto-selected value — the WYSIWYG break the barcode work exists to prevent. The
panel's own rule against controls that do nothing already forbids it.

If the sample reveals real attributes in those style elements, controls become
possible as a follow-up, with a file format to justify them.

## Testing

`testOracle.ts` gains `oracle2d()` beside `oracle()`, turning bwip-js's
`pixs`/`pixx`/`pixy` into a module matrix for diffing. DataBar reuses the `sbs`
path unchanged.

- Per-encoder diffs against bwip-js for all three, across a spread of payload
  contents and lengths.
- A new invariant pinning every symbology's declared `quiet` values. These are
  hand-typed constants, which is the transcription-error surface the follow-up
  named.
- `geometry.test.ts` regression pins showing square symbols produce identical
  rects after the `cols`/`rows` generalization, plus cases for a non-square
  grid and for `rowHeightModules`.
- `encode.test.ts`'s `SUPPORTED_PROTOCOLS` pin extended to the three, and the
  bars-only `totalModules` invariant extended to DataBar.
- `barcodeExport.test.ts` gaining a case that a DataMatrix or PDF417 export
  does **not** emit a `qrcodeStyle`.

And a hardware step that carries more weight here than usual: print one of each
through `.claude/skills/verify`, then **scan the printed tape with a phone**.
The oracle proves the module pattern matches a reference implementation. It
does not prove that 180 dpi thermal output of that pattern survives contact
with a real scanner, and these are the symbologies where a render that looks
perfect can be unreadable.

## Out of scope

- **MaxiCode** — declined, not deferred. See above.
- **DataMatrix rectangular variants** (8×18 through 16×48). No `.lbx` field
  requests them.
- **DataMatrix C40 / Text / Base256 encodation.** Density optimizations.
- **PDF417 Text and Numeric compaction.** Density optimizations; additive
  later if a payload needs them.
- **Property-panel controls** for any of the three. No file fields to back them.
- **bil-lbx changes** to model the per-symbology style elements. Blocked on the
  sample below; likely a real follow-up once it exists.

## Open, pending a P-touch sample

A `.lbx` authored in P-touch Editor containing a DataMatrix, a PDF417, and one
or more GS1 DataBar variants answers all of the following at once — the same
way `barcodes.lbx` settled the quiet-zone question:

1. **Which DataBar variant** does `protocol="GS1DATABAR"` mean, and is the
   variant carried in a style element, in the `lengths` attribute, or not at
   all?
2. **What style elements** does P-touch write for these three, and what
   attributes do they carry? That determines whether bil-lbx needs to model
   them and whether any of them can be exposed as a control.
3. **Does a file with `protocol="DATAMATRIX"` and no style element open in
   P-touch at all?** Test by round-tripping our own export back through the
   editor. If it does not, export for these protocols is blocked on a bil-lbx
   change rather than merely lossy.
4. **Is the object box the symbol alone**, as it proved to be for 1D under
   `margin="false"`? Same measurement: divide the recorded box by the recorded
   module size and compare against the symbol's module count.
