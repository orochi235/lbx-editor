/**
 * DataMatrix ECC200.
 *
 * Square symbols only, 10x10 through 144x144, auto-sized to the smallest that
 * holds the payload. `.lbx` records `datamatrixStyle model="square"` and has no
 * field asking for a rectangular symbol, so there is nothing to honor.
 *
 * The pieces live apart because each is worth testing on its own: field
 * arithmetic in `reedSolomon.ts`, the size table in `datamatrixTables.ts`,
 * encodation in `datamatrixEncode.ts`, the bit walk in `datamatrixPlace.ts`,
 * block interleaving and region tiling in `datamatrixBlocks.ts`. What is here
 * is assembly -- and `datamatrix.test.ts` diffs the whole thing against
 * bwip-js at every size, which is what actually proves it.
 */
import type { EncodeResult } from './types';
import { uniformQuiet } from './types';
import { smallestSymbolFor } from './datamatrixTables';
import { encodeAscii, padCodewords } from './datamatrixEncode';
import { placeCodewords } from './datamatrixPlace';
import { interleaveEcc, tileRegions } from './datamatrixBlocks';

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

  const padded = padCodewords(codewords, symbol.dataCodewords);
  const side = symbol.region * symbol.regions;
  const mapping = placeCodewords(interleaveEcc(padded, symbol), side, side);

  return {
    ok: true,
    kind: '2d',
    cols: symbol.size,
    rows: symbol.size,
    rowHeightModules: 1,
    modules: tileRegions(mapping, symbol),
    quiet: uniformQuiet(1),
    text: data,
  };
}
