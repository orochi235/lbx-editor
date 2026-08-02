/**
 * Resolution-independent barcode symbols. Encoders emit these; geometry.ts
 * turns them into pt rectangles. Nothing here knows about pt, poses, or canvas.
 */

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

export type BarcodeSymbol = Symbol1D | Symbol2D;

export interface EncodeFailure {
  ok: false;
  /** `unsupported` — we don't implement this symbology.
   *  `invalid` — we do, but the payload can't be encoded in it. */
  reason: 'unsupported' | 'invalid';
  detail: string;
}

export type EncodeResult = ({ ok: true } & BarcodeSymbol) | EncodeFailure;
