/**
 * Choosing a PDF417 symbol's shape, and the error correction that fills it.
 *
 * A symbol is `columns` codewords across by `rows` down, so its capacity is
 * their product and many shapes hold the same payload. Left free, we pick the
 * shape BWIPP picks — `round(sqrt((data + ecc) / 3))` columns — which targets
 * roughly a 17:9 data area. Nothing here sees the pose, so there is no better
 * aspect to aim at: `barcodeModulePt` scales a 2D symbol to whichever axis
 * binds and centers it, so a shape that doesn't match the pose letterboxes but
 * never distorts. `targetAspect` is the opt-in for a caller that does know a
 * pose, and it deliberately leaves bwip-js parity — see below.
 *
 * An explicit column or row count overrides that, because a file states the
 * layout it was drawn with, and no two implementations pick the same one —
 * P-touch's auto-selection is neither ours nor BWIPP's, so reopening a file
 * whose counts we discarded would redraw the symbol a different size.
 *
 * ## This module owns the error correction *level*, not just the shape
 *
 * `eccCountFor` in `pdf417Encode.ts` is the standard's recommended level for a
 * payload length, and that is all it is. BWIPP moves the level twice more, and
 * both moves need the shape:
 *
 *   - **Before** choosing columns it *lowers* the level so the ECC codewords
 *     can't push the symbol past its 928-codeword ceiling (`barcode.ps`
 *     23317–23320). This one has to happen first, because the column heuristic
 *     divides by the ECC count.
 *   - **After** rows and columns are fixed it *raises* the level to whatever
 *     the matrix will hold, capped at 8 (`barcode.ps` 23346–23352), spending
 *     cells that would otherwise be 900 padding on error correction instead.
 *
 * Neither can live in `pdf417Encode.ts` (it never sees a shape) and neither
 * should live in `pdf417.ts` (the first would have to run before layout and
 * the second after, so assembly would be interleaved with a decision it isn't
 * making). Crucially the raise **cannot** feed back into the shape — BWIPP
 * fixes `c` and `r` and never recomputes them, so all the raise does is move
 * the boundary between padding and ECC inside a matrix that is already
 * decided. That makes it a closed step, and this module is the only place both
 * of its inputs exist at once.
 *
 * It also settles a question the caller can't answer: the row indicators
 * encode the *level* (`eclevel*3 + ...`), so a symbol can't be drawn without
 * it. `Pdf417Layout` therefore reports the whole codeword budget — level,
 * count, data region and padding — and a caller must use those rather than
 * calling `eccCountFor` again.
 *
 * Everything here is diffed against bwip-js in `pdf417Layout.test.ts`, by
 * reading the columns, rows and error correction level back off the symbols it
 * renders.
 */
import { eccCountFor } from './pdf417Encode';

/** ISO 15438: 1 to 30 data columns. BWIPP validates the same range. */
export const MAX_COLUMNS = 30;
/** ISO 15438: 3 to 90 rows. BWIPP validates the same range. */
export const MAX_ROWS = 90;
export const MIN_ROWS = 3;

/** ISO 15438: a symbol holds at most 928 codewords. */
export const MAX_CODEWORDS = 928;
/** Two of those are spoken for in the worst case, leaving 926 for the payload. */
export const MAX_DATA_CODEWORDS = 926;
/** Error correction levels run 0 to 8, level n carrying 2^(n+1) codewords. */
export const MAX_ECC_LEVEL = 8;

export interface Pdf417Layout {
  columns: number;
  rows: number;
  /**
   * Total symbol width in modules: a 17-module start pattern, a 17-module left
   * row indicator, 17 per data column, a 17-module right row indicator, and an
   * 18-module stop pattern — 17 plus the single closing bar every PDF417
   * symbol terminates with. That is `17 * (columns + 4) + 1`, and it matches
   * BWIPP's `rwid` (`17 c mul 17 add 17 add 17 add 18 add`) exactly.
   */
  moduleWidth: number;
  /** The error correction level, 0 to 8. The row indicators encode it. */
  eccLevel: number;
  /** ECC codewords, `2 ** (eccLevel + 1)`. The last cells of the matrix. */
  eccCount: number;
  /**
   * The data region: every cell that isn't ECC — the symbol length descriptor,
   * the payload, and the 900 padding between them. This is also the *value* of
   * the length descriptor, which is codeword 0.
   */
  dataRegion: number;
  /** 900 pad codewords sitting between the payload and the ECC block. */
  padCount: number;
}

export interface LayoutOptions {
  /** Exact data column count, 1 to 30. */
  columns?: number;
  /**
   * Row count, 3 to 90. With `columns`, a *floor* — if the payload no longer
   * fits the stated rows the symbol grows rather than failing, which is what
   * BWIPP does and what a file whose text has since been edited needs. Alone,
   * it is exact and the columns are the fewest that hold the payload; BWIPP
   * instead keeps its own column heuristic there, so this case diverges.
   */
  rows?: number;
  /**
   * Width-to-height ratio to aim for when choosing freely, replacing BWIPP's
   * fixed heuristic with a search. Supplying it means bwip-js will not agree
   * on the shape, so a caller diffing against bwip-js must pin `columns`.
   */
  targetAspect?: number;
  /** Row height in modules, for `targetAspect` only. 3 is PDF417's minimum. */
  rowHeightModules?: number;
  /**
   * Starting error correction level, replacing the recommendation for the
   * payload length. Like BWIPP's `eclevel` this is still subject to the cap
   * and the raise; `fixedEccLevel` is what pins it.
   */
  eccLevel?: number;
  /** Suppress both the cap and the raise, as BWIPP's `fixedeclevel` does. */
  fixedEccLevel?: boolean;
}

/**
 * A shape and a codeword budget for a payload of `dataCodewords`, or null if
 * no legal symbol holds it.
 *
 * `dataCodewords` is the compacted payload alone — what `byteCompaction`
 * returns, opening latch included. It is **not** the total: the symbol length
 * descriptor and the ECC block are added here, since their size is what this
 * function decides.
 */
export function chooseLayout(
  dataCodewords: number,
  opts: LayoutOptions = {},
): Pdf417Layout | null {
  const m = dataCodewords;
  if (!Number.isInteger(m) || m < 1 || m > MAX_DATA_CODEWORDS) return null;

  const { columns, rows } = opts;
  if (columns !== undefined && (columns < 1 || columns > MAX_COLUMNS)) return null;
  if (rows !== undefined && (rows < MIN_ROWS || rows > MAX_ROWS)) return null;

  const fixed = opts.fixedEccLevel ?? false;
  // The recommendation comes from `eccCountFor` rather than a second copy of
  // its thresholds; it reports a count, and the level is what moves.
  let level = opts.eccLevel ?? log2Floor(eccCountFor(m)) - 1;
  if (!Number.isInteger(level) || level < 0 || level > MAX_ECC_LEVEL) return null;

  // Cap: keep the ECC block from pushing the symbol past 928 codewords. The
  // level can go transiently negative here — at m = 926 it lands on -1, and
  // the raise below brings it back to 2. Clamping it at 0 would change the
  // column count, since the heuristic divides by the ECC codeword count.
  if (!fixed) level = Math.min(level, log2Floor(MAX_CODEWORDS - 1 - m) - 1);
  const ecc = 2 ** (level + 1);

  // The descriptor, the payload and the ECC block: what the matrix must hold.
  const total = m + ecc + 1;

  const finish = (c: number, r: number): Pdf417Layout | null => {
    if (c < 1 || c > MAX_COLUMNS || r < MIN_ROWS || r > MAX_ROWS) return null;
    const cells = c * r;
    if (cells < total) return null;

    // Raise: spend cells that would be 900 padding on error correction. Only
    // upward, and only to what the matrix already holds, so it can never
    // invalidate the shape it was computed from.
    let finalLevel = level;
    if (!fixed) {
      const raised = Math.min(log2Floor(cells - 1 - m) - 1, MAX_ECC_LEVEL);
      if (raised > finalLevel) finalLevel = raised;
    }
    const eccCount = 2 ** (finalLevel + 1);
    const dataRegion = cells - eccCount;
    if (dataRegion > MAX_CODEWORDS) return null;

    return {
      columns: c,
      rows: r,
      moduleWidth: 17 * (c + 4) + 1,
      eccLevel: finalLevel,
      eccCount,
      dataRegion,
      padCount: dataRegion - m - 1,
    };
  };

  if (columns !== undefined) {
    const required = Math.max(MIN_ROWS, Math.ceil(total / columns));
    return finish(columns, Math.max(required, rows ?? 0));
  }

  if (rows !== undefined) {
    return finish(Math.max(1, Math.ceil(total / rows)), rows);
  }

  if (opts.targetAspect !== undefined) {
    const target = opts.targetAspect;
    if (!(target > 0)) return null;
    const rowHeight = opts.rowHeightModules ?? 3;
    let best: Pdf417Layout | null = null;
    let bestError = Infinity;
    for (let c = 1; c <= MAX_COLUMNS; c++) {
      const candidate = finish(c, Math.max(MIN_ROWS, Math.ceil(total / c)));
      if (!candidate) continue;
      const aspect = candidate.moduleWidth / (candidate.rows * rowHeight);
      const error = Math.abs(Math.log(aspect / target));
      if (error < bestError) {
        bestError = error;
        best = candidate;
      }
    }
    return best;
  }

  // BWIPP's heuristic, verbatim: the data area is 17 modules wide per column
  // and 3 tall per row, so this lands the *data* near a 17:9 aspect.
  const c = Math.max(1, Math.round(Math.sqrt((m + ecc) / 3)));
  return finish(c, Math.max(MIN_ROWS, Math.ceil(total / c)));
}

/**
 * floor(log2(x)) for x >= 1, exactly.
 *
 * BWIPP computes this in floating point (`x ln 2 ln div cvi`). The two agree
 * over every x the caller can reach — pinned in the tests across 1..4000,
 * which covers the whole 30x90 matrix — and the integer form can't be caught
 * out by an `ln` that lands a hair under an exact power of two.
 */
function log2Floor(x: number): number {
  let n = 0;
  while (2 ** (n + 1) <= x) n++;
  return n;
}
