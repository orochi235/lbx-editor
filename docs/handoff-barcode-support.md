# Handoff — `barcode-support`

Branch: `barcode-support` (18 commits ahead of `main`)
Status: all green — `npx tsc --noEmit` clean, 203/203 tests pass.
Depends on local weasel and bil-lbx — see [Cross-repo](#cross-repo-dependencies).

---

## What the branch does

Adds barcode objects to the editor end to end: import, encode, render, edit,
export, and print — plus a document-checking layer that catches labels which
would print wrong, and the non-modal UI to report it.

### 1. Barcode encoding (`src/barcode/`)

Ten symbologies encode: Code 128, GS1-128, Code 39, ITF, Codabar, EAN-13,
EAN-8, UPC-A, UPC-E, QR. Each has its own module + tests, cross-checked
against bwip-js where a reference mattered (`testOracle.ts`).

- `types.ts` — resolution-independent `Symbol1D` (bar runs in module units) /
  `Symbol2D` (module matrix). Nothing here knows about pt or canvas.
- `encode.ts` — protocol dispatch. **Fails closed**: an unimplemented
  symbology returns `reason: 'unsupported'`, a bad payload `'invalid'`. Never
  throws — a bad payload is a normal editing state.
- `SUPPORTED_PROTOCOLS` is the single source of truth for what renders;
  `encode.test.ts` probes all 14 protocols `.lbx` can carry and pins the list
  against the dispatcher, so the two cannot drift.
- `geometry.ts` — symbol → pt rectangles. **`barcodeModulePt` is the one
  definition of the pose→module relationship** (narrow bar for 1D, cell for
  2D); both drawing and export go through it.
- `scannability.ts` — size limits in *printer dots*, the unit the failure
  happens in. Under 1 dot a module can't render at all; under 2 dots
  (0.28mm at 180dpi) it clears neither GS1 general distribution (~0.25mm) nor
  retail POS (0.264mm).
- `request.ts` — the one place node fields become an encode request, shared by
  canvas, exporter, and preflight so they can't disagree.

### 2. Editing

- Barcode tool in the palette (`BarcodeIcon.tsx` is a real Code 128 of `1337`,
  drawn by the same encoder).
- Full property panel (`PropertyPanel.tsx` → `BarcodeFields`): symbology, data,
  and only the options that reach the chosen encoder — bar ratio for
  Code 39/ITF/Codabar, zero-fill for the EAN family, check digit for ITF,
  ECC + version for QR. No control is shown that would do nothing if changed.
- The panel runs the same encode the canvas does, so it reports the real
  result: the rejection reason, or the readback when a check digit is appended
  (`Encodes as 1234567890128`).

### 3. Round-trip fidelity

The pose is authoritative in the editor, but **P-touch redraws from `barWidth`
(1D) and `qrCode.cellSize` (2D)**, so export restates the pose in those terms.
Both go through `barcodeModulePt`. Covered by `barcodeExport.test.ts`.

### 4. Document checks (`src/diagnostics.ts`)

Pure document state in, findings out. Four checks today:

| code | severity | condition |
|---|---|---|
| `barcode-unprintable` | error | module < 1 printer dot |
| `barcode-marginal` | warning | module < 2 printer dots |
| `clipped` | warning | object overhangs the printable band or label length |
| `qr-model-substituted` | warning | file names a QR model we don't encode (i.e. not 2) |

Every one is a condition the canvas draws *correctly* — crisp sub-pixel bars,
an object past the head's reach, a valid QR that isn't the one the file asked
for — so the screen can't show them. That is the entry criterion for this file:
if the canvas can show it, it doesn't belong here.

### 5. Reporting surfaces

Deliberate split:

- **Callout** (weasel-ui, anchored) for problems with an object to point at.
  One at a time — a stack of popovers would cover the objects they're about.
  Errors first, then document order.
- **Toast** for results of actions — print failed, file wouldn't parse.
  Every `alert()` is gone (`grep -c "alert(" src/App.tsx` → 0).

Callout dismissal is **ours, not RAC's** — weasel-ui's `onDismiss`, see
[Gotchas](#gotchas).
A blocked print clears all dismissals, so the reason the job was refused is put
back on the object that caused it.

### 6. Preferences

Two new entries in `src/prefs.ts`, both persisted to localStorage and wired
through `handlePrefChange` like the existing ones:

- **Canvas → Document warnings** (`lbx-editor.documentWarnings`) — turns off the
  anchored callouts entirely.
- **Printing → Pre-print checks** (`lbx-editor.preflightChecks`) — turns off the
  *blocks*: undersized/unencodable barcode refusals, tape-size mismatch, and the
  machine-fonts notice. Genuine failures still report. Verified both ways: with
  it off, a 2pt-wide barcode prints without the "Print blocked" toast.

---

## Cross-repo dependencies

**`~/src/weasel` — two Callout changes, plus a layout move that isn't ours.**

`Callout` gained `onDismiss`: the × or Escape, never the incidental close a
non-modal popover does when focus or interaction leaves. It's what the
diagnostic callout dismisses through.

Separately, weasel's `main` moved `@weasel-js/core` into `packages/core/`
(`core-to-packages`). Nothing in the app changed, but the wiring did:
`tsconfig.json`'s paths and `vitest.config.ts` now point at
`packages/core/src`, and the tests resolve weasel through `weaselAliases()`
like the app does rather than through the linked package root, which is no
longer a package with an entry. **If imports of `@weasel-js/core` stop
resolving, check those two files against `scripts/vite-aliases.ts` first.**

**`~/src/bil-lbx`** — `serializeLabel` derives `paper.format` from the width
and rejects a config without one. Rebuild it (`npm run build`) after pulling;
consumers use its `dist/`.

**`~/src/weasel` commit `98b3ddab` — `fix(ui): re-anchor Callout when anchorRect changes`.**

`Callout`'s `anchorRect` was documented snapshot-only. Anything tracking a scene
node drifted off target. RAC recomputes overlay position on scroll, resize, and a
ResizeObserver on the anchor — so *zoom* happened to work (scaling changes the
anchor's size) while a *pure pan* changed nothing it watches.

Measured before/after in the real app: before, a pan moved the anchor 120px and
the popover 0; after, both move together.

That commit is on weasel `main` with two tests. **If callouts point at nothing,
check weasel is up to date first.**

---

## Gotchas

**Dismissal is keyed per problem, not per callout** — `nodeId:code`, with keys
pruned when no live finding matches. That's what makes fixing an object and
re-breaking it raise the warning again instead of staying silenced.

**Callout dismissal still can't go through `onOpenChange`** — a non-modal RAC
popover fires it when interaction or focus merely leaves, which on a canvas is
every click on the artwork. It now goes through weasel-ui's `onDismiss`
(the × or Escape only), with `isOpen` pinned true while the finding stands.
Don't route it back through `onOpenChange`.

**`detectTapeSize` is unbounded nearest-match** — any paper width maps to *some*
tape (a 3.5mm file lands on 6mm). Deliberate: a label that opens on the wrong
tape is recoverable where a refused import isn't.

### Fixed since the first draft

Kept here because each one names a failure mode that doesn't announce itself.

- **The tape's millimetres are declared, not parsed.** `TAPE_SIZES` carries
  `widthMm` and `tapeWidthMm(size)` reaches obwat's media lookup; the old
  `parseInt(tapeSize, 10)` held only while every key was `"<integer>mm"`, and
  bil-lbx carries a `3.5mm` tape that parses to `3`. `tapeSize.test.ts` pins
  each tape's pt and mm to the same cassette.
- **bil-lbx no longer defaults a missing tape to 12mm.** `paper.format` is
  derived from `paper.width` when absent, and a config with no usable width
  throws instead of building. The shape that cost the debugging time —
  `TAPE.W24` is `undefined`, so a 24mm label built as a 12mm one — now fails
  at the call. The fixture in `lbxImport.test.ts` takes a `TAPE` key, so the
  typo is also a compile error.
- **`.tmp-*` is gitignored.** Scratch (generated .lbx, screenshots) in the repo
  root no longer shows up as untracked noise.

---

## Not done

In the order previously agreed (reverse of how they were listed):

1. ~~Minimum-size guard~~ — done.
2. ~~QR `model` has no UI~~ — closed, but **not** by adding the control.
   `qrcode-generator` builds Model 2 only (`moduleCount = version * 4 + 17`
   plus alignment patterns is the ISO 18004 construction; there is no Model 1
   path). A `model` select would have changed the exported file while the
   canvas and the print raster stayed Model 2 — P-touch would then redraw a
   symbol the user never saw, which is the WYSIWYG break the rest of this work
   exists to prevent, and the panel's own rule against controls that do nothing
   already forbade it.

   The real defect was the silence: a Model 1 file imported today is redrawn
   and printed as Model 2 with nothing said. So it became a diagnostic,
   `qr-model-substituted` — same family as the size and clipping checks, a
   thing the canvas draws correctly and therefore cannot report. `model` still
   round-trips untouched (pinned in `barcodeExport.test.ts`, since the
   message's wording promises it), so P-touch still draws the Model 1 it was
   asked for.

   Reopening the control only makes sense with a real Model 1 encoder behind
   it — different sizing formula, no alignment patterns, its own capacity
   tables, and no oracle to check against, for a 1994 symbology modern
   scanners read poorly.
3. **Four symbologies still fail closed**: `DATAMATRIX`, `PDF417`, `MAXICODE`,
   `GS1DATABAR`. They import, draw as a placeholder box, and block printing.
   Each is a real encoder's worth of work — this is the big remaining chunk.
   Add to `SUPPORTED_PROTOCOLS` and the dispatcher; `encode.test.ts` will then
   require them to actually encode.

4. ~~The quiet zone is inconsistent between encoders~~ — done. `ean.ts`'s
   baked-in `QUIET = 9` is gone, so `quietZonePt` is the only quiet zone and
   every 1D encoder reports bars-only in `totalModules`. Settled against a real
   P-touch file (`~/src/bil-lbx/docs/samples/barcodes.lbx`): its 1D margin is a
   *fixed 36.8pt*, unchanged when `barWidth` doubles, so the box never encoded
   a quiet zone in modules — and with `margin="false"`, which we always export,
   the box is exactly the bars. **Existing EAN labels redraw ~19% wider and
   export a ~19% larger `barWidth`** — the correction, not a regression.
   Measurements and what pins it:
   `docs/superpowers/specs/2026-07-28-barcode-backgrounds-design.md`.

   Still simplified there: the quiet zone is a flat 10 modules per side, where
   EAN-13's standard is 11 left / 7 right. Per-symbology values belong on the
   encoder (`Symbol1D.quiet: { left, right }`) and should be checked against
   bwip-js rather than transcribed.

Also worth considering, not agreed:

- The clipping check runs on every node type but nothing tells the user *which*
  object when several are flagged — the callout points at one and says "N other
  objects need attention". A list or click-through could be better.
- `PrinterPanel` doesn't surface **Pre-print checks**; it's prefs-only, unlike
  Auto cut / Print preview / Dithering which appear in both. Matching the
  existing two-surface pattern would mean adding it there too.

---

## Verifying

`.claude/skills/verify` drives the real print flow without printer hardware.
Dev server on **5180**. The chrome-devtools MCP profile has a WebUSB grant for
localhost:5180.

Quickest barcode check: reload, and if the autosaved doc has a too-small or
clipped object the callout appears immediately. To force one, select a barcode
and set W to ~25 — that drops it under a dot per module.
