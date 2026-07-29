# Barcode backgrounds and cassette ink — design

Two changes to how barcodes draw, sharing one piece of plumbing:

1. **Opaque background.** A barcode masks the label under it, so nothing
   intrudes into its spaces or its quiet zone.
2. **Cassette ink.** Barcode bars follow the cassette's ink color on screen,
   the way text, rects, and lines already do.

They ship together because they pull the same node in opposite directions: the
bars are ink, the background is paper. Doing one without the other would leave
that split undocumented and easy to get backwards.

## Why an opaque background

A scanner reads a barcode as alternating dark and light runs bounded by a blank
margin. Anything printed into a space or into the quiet zone is read as a bar.
Today a barcode over an image composites with it — the image shows through the
spaces, and the label prints something no scanner will read.

This is a class of failure the canvas cannot show as wrong, because the canvas
draws it correctly: the barcode really is on top of the image, and that really
is what would print. The same reason `diagnostics.ts` exists.

P-touch Editor treats barcodes as opaque objects — confirmed by observation in
P-touch itself, not inferred. Matching that is both the correct behavior and
the familiar one.

## The node field

`LabelBarcodeData` gains:

```ts
/** Mask the label under the symbol and its quiet zone, so nothing prints
 *  into a space a scanner reads as light. */
opaqueBackground: boolean;
```

### Round-trip: on is persisted, off is not

`.lbx`'s `BarcodeObject` carries a `brush`, and `BrushStyle` is
`"NULL" | "SOLID" | "HATCHED"` — which is exactly this distinction, and it does
survive: `SOLID` parses back as `{ style: 'SOLID', color }`, `NULL` as
`undefined`. (Only NULL-vs-*absent* collapses, since bil-lbx serializes an
absent brush as `style="NULL"` and `parseBrush` maps both to `undefined` — but
every real file carries the element, so that pair never arises.)

What blocks a lossless round-trip is not the encoding, it's that **P-touch
writes `NULL` on every barcode it authors**, so reading `NULL` as "off" would
make every P-touch barcode import transparent — and they draw opaque. Until we
can tell whose file we're reading, `NULL` has to mean "on", which is the same
value our own "off" writes.

Therefore, as shipped:

| direction | behavior |
|---|---|
| export, on | `brush: { style: 'SOLID', color: '#FFFFFF' }` |
| export, off | `brush: { style: 'NULL' }` |
| import, P-touch file | `opaqueBackground: true` — they draw opaque |
| import, our file | today `true`; see "Making it lossless" below |

**Off survives the session and the localStorage autosave, but not an `.lbx`
round-trip.** A file exported with the background off reopens with it on.

That is the safe direction to be lossy in: a reopened barcode is opaque, which
is scannable, where the reverse prints unscannable labels.

Export still writes `SOLID`/`NULL` faithfully rather than always writing
`SOLID`, so the file states what we drew — which is what makes the lossless
version below a read-side change only.

**Resolved (2026-07-28): P-touch ignores `brush` on a barcode.** It writes
`style="NULL"` on every barcode it authors *and* draws those barcodes opaque.
Both halves are observed, so the deduction is safe: the attribute does not
control the background there. That makes it inert in P-touch — writing `SOLID`
changes nothing on their side — and therefore free for us to use as our own
channel in files we write.

### Making it lossless (unblocked, not done here)

The obstacle was never `parseBrush`. `SOLID` and `NULL` already survive
distinctly (verified by round-trip); only NULL-vs-absent collapses, and every
real file has the element, so that pair never arises. The real obstacle was
telling *our* files from P-touch's, since P-touch's universal `NULL` would
otherwise read as "off".

`pt:document`'s `generator` attribute already distinguishes them —
`com.brother.PtouchEditor` vs `brother-lbx` — and bil-lbx now surfaces it on
`LabelConfig` (commit `4cc6471`, unpublished). The import rule becomes:

```ts
opaqueBackground: config.generator === 'brother-lbx'
  ? obj.brush?.style === 'SOLID'   // our file: the field means what it says
  : true                           // P-touch's: boilerplate, and they draw opaque
```

Principled rather than a hack: P-touch writes boilerplate for what it doesn't
use — every `pt:brush` is `NULL`, every `objectStyle` carries
`backColor="#FFFFFF"`, including on text and image objects where a fill means
nothing — so the field carries no information in their files and exactly what
the caller set in ours.

Needs a bil-lbx version bump and publish (or `npm link` for development).

## Geometry

One new function in `src/barcode/geometry.ts`, beside `barcodeRects`:

```ts
/** The region a barcode masks: its pose plus the quiet zone a scanner needs
 *  to find the symbol's edges. */
export function barcodeBackgroundRect(symbol: BarcodeSymbol, pose: Rect): Rect
```

The pose inflated by `quietZonePt(symbol, pose)` on all four sides.

`ditherProtect.protectedRegions` today open-codes that same inflation. It
switches to calling `barcodeBackgroundRect`, so **the region we mask and the
region we exempt from dithering are the same rect by construction** rather than
by two copies happening to agree. That convergence is the reason this belongs in
`geometry.ts` and not inline in `drawLabelNode`.

## Drawing: ink and paper

`drawLabelNode` is shared by the screen and the print raster
(`renderLabelToRgba` passes it as `drawOne`), which is what makes print WYSIWYG.
The two colors on a barcode take opposite paths through that sharing:

| | in node data | screen | print |
|---|---|---|---|
| bars, human-readable text | `#000000` | cassette ink | `#000000` |
| background | — | tape color | `#ffffff` |

### Why not `remapNodeInk` for either of them

`remapNodeInk` (`src/tapeColors.ts`) is the existing screen-only recolor: it
swaps any color the printer would lay down as ink (`printsAsInk`, luminance
< 128) for the cassette's ink color. It handles `text`, `rect`, and `line`;
`barcode` falls through to the default case, which is why bars stay black on a
blue-ink cassette today.

**It stays that way.** `remapNodeInk` recolors colors *stored on the node* —
the ones the user chose. A barcode has none: the bars and the human-readable
band are hardcoded `#000000` in `drawLabelNode`, and the background color isn't
in the node data at all. Adding a `barcode` case would mean inventing node
fields for two colors the user can't set, purely to have something to remap.

That is the clean split, and it is worth stating once:

- **`remapNodeInk`** — colors the *document* carries.
- **`drawLabelNode`'s color parameter** — colors the *renderer* picks.

Barcodes are entirely the second kind, so both their colors arrive the same
way.

Print deliberately keeps the raw node data, exactly as it does today: a
white-ink remap would push the label above the `<128` luminance threshold and
erase it. The parameter defaults preserve that for barcodes.

### One color parameter, both directions

`drawLabelNode` gains an optional trailing options argument:

```ts
function drawLabelNode(
  node: LabelNode,
  pose: LabelPose,
  view: View,
  colors?: { ink?: string; paper?: string },  // defaults: '#000000', '#ffffff'
): DrawCommand[]
```

- The screen wrapper (`drawScreenNode`, `App.tsx:1244`) passes
  `{ ink: inkCss, paper: tapeCss }`.
- Print passes nothing and gets print behavior from the defaults —
  `#ffffff` renders at luminance 255, which the downstream threshold turns into
  no dots.

Defaulting to the print values is the safety property: a new call site that
forgets the argument prints correctly rather than printing a black box.

### Draw order and opacity

The background is prepended to the barcode's command list. Paint order within a
node is z-order, so it masks everything below the barcode in the scene and
nothing above it. That is the right asymmetry — an object deliberately placed on
top of a barcode is the user's business.

**Full opacity, including on clear tape**, where the paper layer draws the strip
at `opacity: 0.45`. In the print raster the white rect genuinely erases the
nodes beneath it, so an opaque patch on screen is the WYSIWYG answer: it reads
as "these objects are gone here," which is true. Matching the strip's
translucency would let masked objects show through at 55% and misreport what
prints.

### Unencodable barcodes

A barcode that doesn't encode already draws as a placeholder box and is skipped
by `protectedRegions`. It gets no background either — there is no symbol, so no
quiet zone to compute, and `printPreflight` blocks the job regardless.

## UI

One checkbox in `BarcodeFields` (`PropertyPanel.tsx`), labeled **Opaque
background**, above **Human readable**. It applies to every symbology, so it
sits with the universal controls rather than the per-encoder ones.

## Testing

| file | what it pins |
|---|---|
| `geometry.test.ts` | `barcodeBackgroundRect` = pose + quiet zone, 1D and 2D |
| `ditherProtect.test.ts` | protected regions unchanged — the point is they now come from one place |
| `barcodeExport.test.ts` | on → `SOLID`, off → `NULL` |
| `lbxImport.test.ts` | `SOLID`, `NULL`, and absent all → on — pinning the lossy direction as deliberate |

The color parameter has no unit seam today, and exporting `drawLabelNode` from
`App.tsx` doesn't create one: a test that imports `./App` fails before it runs,
because `App.tsx` imports obwat and obwat's `dist` uses extensionless relative
imports that vitest's node resolution won't follow. (Existing tests only import
obwat *types*, which are erased at compile time.) So `drawLabelNode` moves to
its own `src/drawLabelNode.ts` — every one of its own dependencies was checked
and imports cleanly. That is a prerequisite for testing it at all, not a
stylistic split, though `App.tsx` is 60KB and the node→commands mapping is a
self-contained unit that belongs on its own regardless.

`drawLabelNode.test.ts` then covers the property the defaults exist for —
**omitting `colors` yields `#000000` bars on an `#ffffff` background**, i.e. a
call site that forgets the argument still prints correctly. Passing
`{ ink, paper }` yields those instead. Cheap, and it pins the one mistake that
would otherwise print a black box over the label.

Visual confirmation through `.claude/skills/verify`: a barcode over an image,
printed, should show blank tape in the spaces and the quiet zone; and a
non-black cassette should show colored bars on screen while the print raster
stays black.

## Follow-up: the quiet zone is inconsistent between encoders

**Deferred, but no longer undecided — see "Measured against P-touch" below,
which settles the direction the fix has to go.**

`quietZonePt` returns a flat 10 modules for every 1D symbology and applies it
*outside* the pose. But the encoders disagree about where the quiet zone lives:

| encoder | quiet zone in `totalModules`? |
|---|---|
| `ean.ts` | **yes** — `QUIET = 9` baked into `bars[].x` and `totalModules` |
| `code128.ts`, `code39.ts`, `itf.ts`, `codabar.ts` | no |

So on the EAN family the quiet zone is counted twice: 9 modules inside the pose
plus 10 outside it. The background rect and the dither-protected region are
therefore roughly twice as wide as they need to be on EAN-13, EAN-8, UPC-A, and
UPC-E. Conservative — a wider blank margin never hurts scanning — but it masks
more artwork than it should.

Fixing it is not local, which is why it is deferred:

- `barcodeModulePt` is `pose.width / totalModules`. Stripping EAN's baked-in
  9+9 drops `totalModules` from 113 to 95 for EAN-13, making every module ~19%
  wider for the same pose. Existing EAN labels would redraw with visibly wider
  bars and export a ~19% larger `barWidth`.
- Which direction is *correct* depends on whether P-touch's barcode object box
  includes the quiet zone or stops at the bars. There are no `.lbx` fixtures in
  this repo to settle it. A P-touch-authored EAN label answers it outright:
  `position.width / barWidth` is ~95 if the box stops at the bars, ~113 if it
  includes them.
- The standard quiet zone is also not a flat 10 — the EAN family is
  asymmetric (EAN-13 is 11 left / 7 right). Doing this properly means the
  encoder owning its own quiet zone, e.g. `Symbol1D.quiet: { left, right }`,
  since only the encoder knows its symbology. Those per-symbology values should
  be checked against bwip-js rather than transcribed.

A comment at `QUIET_ZONE_MODULES_1D` in `geometry.ts` should point here, so the
constant carries its own caveat.

## Out of scope

- The quiet-zone fix above.
- A barcode near the tail under auto-length has its background clipped at the
  label end. Non-issue: past the label end there are no objects to mask.
- No diagnostic for "this background is hiding something." The mask is visible
  on canvas, so unlike the barcode size and clipping checks, the screen does
  show it.

## Measured against P-touch (2026-07-28)

The question the follow-up above couldn't answer — does P-touch's barcode
object box include the quiet zone? — is now settled empirically, against a
P-touch Editor-authored file: `~/src/bil-lbx/docs/samples/barcodes.lbx`,
five barcodes chosen to separate the variables.

`box` is `position.width`; `bars` is our encoder's `totalModules × barWidth`.

| protocol | `margin` | `barWidth` | box | bars | extra |
|---|---|---|---|---|---|
| CODE128 | true | 0.8pt | 100pt | 63.2pt | **36.8pt** |
| CODE128 | true | **1.6pt** | 163.2pt | 126.4pt | **36.8pt** |
| EAN13 | true | 0.8pt | 112.8pt | 76pt (95 mod) | **36.8pt** |
| CODE128 | **false** | 0.8pt | 64pt | 63.2pt | 0.8pt |
| QRCODE | true | (cell 1.6pt) | 40pt | 33.6pt (21 cells) | 6.4pt = 4 cells |

Three conclusions:

1. **The 1D margin is a fixed 36.8pt, not a module count.** Doubling
   `barWidth` left the extra unchanged at 36.8pt — 46 modules at 0.8pt, 23 at
   1.6pt. So P-touch's box never encodes a quiet zone in module terms, and the
   "~95 vs ~113" test proposed earlier was asking the wrong question.
2. **With `margin="false"` the box is the bars** (64pt vs our 63.2pt — one
   module of slop, most likely P-touch counting the stop pattern as 14 rather
   than 13). Our exporter already hardcodes `margin="false"`.
3. **EAN13's box is bars + the same fixed 36.8pt**, with no module-proportional
   component — the row that rules out the alternative directly.

**Therefore the pose means bars only, and `ean.ts`'s baked-in `QUIET = 9` is
wrong.** Under `margin="false"` P-touch fits the 95 bars to whatever box we
give it, and we size that box for 113 modules, so a round-tripped EAN draws
~19% narrower here than P-touch will redraw it. Code 128, Code 39, ITF and
Codabar were correct already.

The fix, now unblocked:

- Strip `QUIET = 9` from `ean.ts` — `totalModules` becomes `modules.length`,
  and `bars[].x` loses the offset.
- `quietZonePt` becomes the only quiet zone, applied outside the pose, uniform
  across every 1D symbology. `barcodeBackgroundRect` and `protectedRegions`
  then stop double-counting on the EAN family.
- The oracle tests in `ean.test.ts` are insensitive to this: `bitstring()`
  trims leading and trailing zeros.
- **Existing EAN labels will redraw ~19% wider and export a ~19% larger
  `barWidth`.** That is the correction, not a regression, but it changes
  documents that already exist.

Two things this also turned up, both separate work:

- **QR's margin is proportional** — 4 cells total, 2 per side — where 1D's is
  fixed pt. `QUIET_ZONE_MODULES_2D = 4` is per side, so ours is 8 total: wider
  than P-touch's, and wider than the QR spec's 4-per-side is *not*, so ours
  matches the spec and P-touch is the tight one. No action, but don't "fix"
  ours to match P-touch.
- **We hardcode `margin="false"` on export** and never read it on import. That
  is currently load-bearing for conclusion 2. If it ever becomes settable, the
  pose's meaning changes with it.
