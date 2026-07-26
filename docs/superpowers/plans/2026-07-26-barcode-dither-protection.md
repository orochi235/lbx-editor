# Plan — keep dithering off barcodes

## The failure

`ditherToMask` quantizes the whole label with one algorithm. Error diffusion
(Floyd–Steinberg, Atkinson) walks the image in raster order and pushes each
pixel's quantization error into its neighbors; the WebGL render antialiases bar
edges, so every edge pixel carries up to ±127 of error into the pixel beside it
— which is inside a bar or inside a space. Bayer varies the threshold per pixel
from a 4×4 matrix, so one bar edge resolves black on one row and white on the
next: ragged, row-dependent bar widths.

It only bites a label carrying both a photo (the reason to pick a diffusing
algorithm) and a barcode. Threshold — the default — is unaffected.

## Shape

obwat gains a **generic** protection list: rectangles that quantize by plain
threshold with no dithering across them. It stays geometry-only — obwat never
learns what a barcode is. The editor decides what goes in the list, and today
that's barcodes.

### obwat

`DitherOptions.protect?: readonly PixelRect[]`, in image orientation (the
dither's own space, before `rgbaToRaster` rotates into raster lines). Reaches
both surfaces at once: `rgbaToRaster` already forwards `DitherOptions` to
`ditherToMask`, so print and preview pick it up from one field.

Semantics:

- A pixel inside any protected rect quantizes at `threshold`, whatever the
  algorithm says.
- Error diffusion neither writes into nor reads out of a protected pixel:
  incoming error is dropped, and a protected pixel contributes none. Stopping
  it at the boundary is the whole point — a splice after the fact still leaves
  the specks the diffuser pushed into the quiet zone.
- Rects round outward to whole pixels and clip to the image, so a fractional
  rect covers every pixel it touches.

Absent or empty `protect` must be byte-identical to today's output.

### lbx-editor

`src/ditherProtect.ts` — `protectedRegions(scene, geometry)` maps barcode poses
into dot-space rects through the same `printableBandPt` + `dpi/72` math the
renderer uses, padded by the symbology's quiet zone (10 modules for 1D, 4 for
2D, per GS1 and the QR spec). Barcodes that don't encode draw as a placeholder
box and are skipped — there's no symbol to protect.

Wired at both call sites: the preview effect and `handlePrint`.

## Steps

1. obwat: tests for the contract above, then `protect` in `dither.ts`; export
   `PixelRect`. Bump 0.2.0 → 0.3.0, build `dist/`.
2. lbx-editor: `npm link ../obwat`; `ditherProtect.ts` + tests; wire both call
   sites.
3. Verify in the app: a label with a photo and a barcode under Floyd–Steinberg
   — the barcode's columns must match the threshold render exactly while the
   photo still dithers.

## Blocker to flag

obwat is an npm dependency (`^0.2.0`), not a linked one. The branch builds
locally against the link, but CI installs the published package and will fail
to typecheck `protect` until obwat 0.3.0 is published. Publishing is not part
of this work.
