/**
 * Resolution-independent barcode symbols. Encoders emit these; geometry.ts
 * turns them into pt rectangles. Nothing here knows about pt, poses, or canvas.
 */

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
   * The quiet zone is added outside the pose by `quietZonePt`, uniformly for
   * every symbology. `encode.test.ts` pins `[0, totalModules]` across all of
   * them — the EAN family baked in 9 and drew ~19% narrow for it.
   */
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
