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
