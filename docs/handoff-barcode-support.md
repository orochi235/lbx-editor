# Handoff — `barcode-support`

Branch: `barcode-support` (16 commits ahead of `main`, tree clean)
Status: all green — `npx tsc --noEmit` clean, 191/191 tests pass.
One dependency: **weasel commit `98b3ddab`** must be present (see [Cross-repo](#cross-repo-dependency)).

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

Pure geometry in, findings out. Two checks today:

| code | severity | condition |
|---|---|---|
| `barcode-unprintable` | error | module < 1 printer dot |
| `barcode-marginal` | warning | module < 2 printer dots |
| `clipped` | warning | object overhangs the printable band or label length |

Both are conditions the canvas draws *correctly* — crisp sub-pixel bars, an
object past the head's reach — so the screen can't show them.

### 5. Reporting surfaces

Deliberate split:

- **Callout** (weasel-ui, anchored) for problems with an object to point at.
  One at a time — a stack of popovers would cover the objects they're about.
  Errors first, then document order.
- **Toast** for results of actions — print failed, file wouldn't parse.
  Every `alert()` is gone (`grep -c "alert(" src/App.tsx` → 0).

Callout dismissal is **ours, not RAC's** — see [Gotchas](#gotchas).
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

## Cross-repo dependency

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

**Callout dismissal can't go through `onOpenChange`.** A non-modal RAC popover
closes when interaction *or focus* leaves it — in a canvas app that's every
click on the artwork. `shouldCloseOnInteractOutside={() => false}` alone does
not hold: the popover survives the click and then closes a few hundred ms later
on focus. The working shape is `isOpen` pinned true while the finding stands,
plus an app-owned footer button. Don't "simplify" this back to `showCloseButton`.

**Dismissal is keyed per problem, not per callout** — `nodeId:code`, with keys
pruned when no live finding matches. That's what makes fixing an object and
re-breaking it raise the warning again instead of staying silenced.

**`parseInt(tapeSize, 10)` is how the tape reaches obwat's media lookup.** It
works only because every `TAPE_SIZES` key is `"<integer>mm"`. bil-lbx carries a
`3.5mm` tape that would parse to `3` and silently select the wrong media.
`tapeSize.test.ts` fails loudly if a non-integer key is ever added.

**`detectTapeSize` is unbounded nearest-match** — any paper width maps to *some*
tape (a 3.5mm file lands on 6mm). Deliberate: a label that opens on the wrong
tape is recoverable where a refused import isn't.

**Test fixtures**: `TAPE`'s keys are `'24mm'`, not `W24`. `TAPE.W24` is
`undefined` and `buildLbx` silently falls back to 12mm — this cost real
debugging time and looked like an import bug.

**`.tmp-*` files** in the repo root are scratch (generated .lbx, screenshots).
Delete them; they're untracked.

---

## Not done

In the order previously agreed (reverse of how they were listed):

1. ~~Minimum-size guard~~ — done.
2. **QR `model` has no UI.** `qrCode.model` (QR Model 1/2) round-trips through
   import and export untouched but isn't editable. Small: one more control in
   `BarcodeFields`, alongside ECC and version.
3. **Four symbologies still fail closed**: `DATAMATRIX`, `PDF417`, `MAXICODE`,
   `GS1DATABAR`. They import, draw as a placeholder box, and block printing.
   Each is a real encoder's worth of work — this is the big remaining chunk.
   Add to `SUPPORTED_PROTOCOLS` and the dispatcher; `encode.test.ts` will then
   require them to actually encode.

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
