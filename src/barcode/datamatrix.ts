/**
 * DataMatrix ECC200.
 *
 * Square symbols only, 10x10 through 144x144, auto-sized to the smallest that
 * holds the payload. `.lbx` records `datamatrixStyle model="square"` and has no
 * field asking for a rectangular symbol, so there is nothing to honor.
 *
 * The pieces live apart because each is worth testing on its own: field
 * arithmetic in `reedSolomon.ts`, the size table in `datamatrixTables.ts`,
 * encodation in `datamatrixEncode.ts`, the bit walk in `datamatrixPlace.ts`.
 * What is here is assembly, plus the finder pattern -- and `datamatrix.test.ts`
 * diffs the whole thing against bwip-js, which is what actually proves it.
 */
import type { EncodeResult } from './types';
import { uniformQuiet } from './types';
import { smallestSymbolFor, type DataMatrixSymbol } from './datamatrixTables';
import { encodeAscii, padCodewords } from './datamatrixEncode';
import { placeCodewords } from './datamatrixPlace';
import { rsEncode } from './reedSolomon';

export function encodeDataMatrix(data: string): EncodeResult {
  if (data.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'DataMatrix needs a payload' };
  }

  let codewords: number[];
  try {
    codewords = encodeAscii(data);
  } catch (err) {
    return {
      ok: false,
      reason: 'invalid',
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  const symbol = smallestSymbolFor(codewords.length);
  if (!symbol) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `Payload is too long for a DataMatrix: ${codewords.length} codewords, and the largest square symbol holds 1558`,
    };
  }
  if (symbol.regions > 1 || symbol.blocks > 1) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `Payload needs a ${symbol.size}x${symbol.size} DataMatrix, which splits into data regions this encoder does not build yet`,
    };
  }

  const padded = padCodewords(codewords, symbol.dataCodewords);
  const all = [...padded, ...rsEncode(padded, symbol.eccCodewords)];
  const placed = placeCodewords(all, symbol.region, symbol.region);
  const modules = addFinderPattern(placed, symbol);

  return {
    ok: true,
    kind: '2d',
    cols: symbol.size,
    rows: symbol.size,
    rowHeightModules: 1,
    modules,
    quiet: uniformQuiet(1),
    text: data,
  };
}

/**
 * Wrap a data region in its finder pattern: a solid L up the left side and
 * along the bottom, and an alternating "clock track" along the top and right.
 * The scanner finds the symbol by the L and reads its dimensions off the clock.
 */
function addFinderPattern(region: boolean[][], symbol: DataMatrixSymbol): boolean[][] {
  const n = symbol.size;
  const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  for (let r = 0; r < symbol.region; r++) {
    for (let c = 0; c < symbol.region; c++) {
      grid[r + 1]![c + 1] = region[r]![c]!;
    }
  }

  for (let i = 0; i < n; i++) {
    grid[n - 1]![i] = true; // solid bottom
    grid[i]![0] = true; // solid left
    grid[0]![i] = i % 2 === 0; // clock track along the top
    grid[i]![n - 1] = (n - 1 - i) % 2 === 0; // clock track up the right
  }

  return grid;
}
