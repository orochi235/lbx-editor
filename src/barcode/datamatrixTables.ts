/**
 * ECC200 square symbol sizes.
 *
 * Only the square family: `.lbx` records `datamatrixStyle model="square"`, and
 * a rectangular symbol would need the file to ask for one.
 *
 * `size` is the module count per side including the finder pattern. `region`
 * is the module count per side of one data region, excluding it — symbols at
 * 32x32 and above split into a grid of regions, each with its own finder, so
 * `size` is `regions * (region + 2)`. `blocks` is the number of interleaved
 * error-correction blocks, which is 1 until 52x52.
 *
 * Every row here was checked against BWIPP's own `datamatrix.metrics`
 * (`node_modules/bwip-js/barcode.ps`), which records ECC codewords and blocks
 * and *derives* the data capacity as `floor(mapping area / 8) - ecc`. That
 * derivation is reproduced by a test, so a mistyped capacity can't pass
 * unnoticed — the four sizes whose mapping area isn't a multiple of 8 (12x12,
 * 16x16, 20x20, 24x24) lose the standard's unused 2x2 corner to the floor.
 *
 * One wrinkle lives past this table: at 144x144 the ten blocks are not equal —
 * eight hold 156 data codewords and two hold 155 — so block sizes there can't
 * be `dataCodewords / blocks`.
 */
export interface DataMatrixSymbol {
  size: number;
  dataCodewords: number;
  eccCodewords: number;
  region: number;
  regions: number;
  blocks: number;
}

export const SQUARE_SIZES: readonly DataMatrixSymbol[] = [
  { size: 10, dataCodewords: 3, eccCodewords: 5, region: 8, regions: 1, blocks: 1 },
  { size: 12, dataCodewords: 5, eccCodewords: 7, region: 10, regions: 1, blocks: 1 },
  { size: 14, dataCodewords: 8, eccCodewords: 10, region: 12, regions: 1, blocks: 1 },
  { size: 16, dataCodewords: 12, eccCodewords: 12, region: 14, regions: 1, blocks: 1 },
  { size: 18, dataCodewords: 18, eccCodewords: 14, region: 16, regions: 1, blocks: 1 },
  { size: 20, dataCodewords: 22, eccCodewords: 18, region: 18, regions: 1, blocks: 1 },
  { size: 22, dataCodewords: 30, eccCodewords: 20, region: 20, regions: 1, blocks: 1 },
  { size: 24, dataCodewords: 36, eccCodewords: 24, region: 22, regions: 1, blocks: 1 },
  { size: 26, dataCodewords: 44, eccCodewords: 28, region: 24, regions: 1, blocks: 1 },
  { size: 32, dataCodewords: 62, eccCodewords: 36, region: 14, regions: 2, blocks: 1 },
  { size: 36, dataCodewords: 86, eccCodewords: 42, region: 16, regions: 2, blocks: 1 },
  { size: 40, dataCodewords: 114, eccCodewords: 48, region: 18, regions: 2, blocks: 1 },
  { size: 44, dataCodewords: 144, eccCodewords: 56, region: 20, regions: 2, blocks: 1 },
  { size: 48, dataCodewords: 174, eccCodewords: 68, region: 22, regions: 2, blocks: 1 },
  { size: 52, dataCodewords: 204, eccCodewords: 84, region: 24, regions: 2, blocks: 2 },
  { size: 64, dataCodewords: 280, eccCodewords: 112, region: 14, regions: 4, blocks: 2 },
  { size: 72, dataCodewords: 368, eccCodewords: 144, region: 16, regions: 4, blocks: 4 },
  { size: 80, dataCodewords: 456, eccCodewords: 192, region: 18, regions: 4, blocks: 4 },
  { size: 88, dataCodewords: 576, eccCodewords: 224, region: 20, regions: 4, blocks: 4 },
  { size: 96, dataCodewords: 696, eccCodewords: 272, region: 22, regions: 4, blocks: 4 },
  { size: 104, dataCodewords: 816, eccCodewords: 336, region: 24, regions: 4, blocks: 6 },
  { size: 120, dataCodewords: 1050, eccCodewords: 408, region: 18, regions: 6, blocks: 6 },
  { size: 132, dataCodewords: 1304, eccCodewords: 496, region: 20, regions: 6, blocks: 8 },
  { size: 144, dataCodewords: 1558, eccCodewords: 620, region: 22, regions: 6, blocks: 10 },
];

/**
 * Room left once `used` codewords are written, in the smallest symbol with
 * room for at least one more -- so a payload exactly filling a symbol counts
 * the next size up, as BWIPP's `numremcws` does. Infinity past the largest.
 */
export function remainingAfter(used: number): number {
  const symbol = SQUARE_SIZES.find((s) => s.dataCodewords > used);
  return symbol ? symbol.dataCodewords - used : Infinity;
}

/** The smallest square symbol holding `codewords` data codewords, or null if
 *  none does. */
export function smallestSymbolFor(codewords: number): DataMatrixSymbol | null {
  return SQUARE_SIZES.find((s) => s.dataCodewords >= codewords) ?? null;
}
