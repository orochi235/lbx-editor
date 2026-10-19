/**
 * The two ways a large ECC200 symbol is split up.
 *
 * Its codewords split into interleaved Reed-Solomon blocks, and its modules
 * into a grid of data regions, each bordered by its own finder pattern. The
 * two splits are independent: 52x52 has two blocks and four regions, 64x64
 * two blocks and sixteen.
 */
import type { DataMatrixSymbol } from './datamatrixTables';
import { rsEncode } from './reedSolomon';

/**
 * `data` followed by its error correction. Codeword i belongs to block
 * `i % blocks`, in the data run and the ECC run alike, so the blocks need not
 * be equal: 144x144's 1558 data codewords give eight blocks of 156 and two of
 * 155, while every block's ECC is the same length.
 *
 * 144x144 also writes its ECC runs rotated by two -- the two short blocks'
 * ECC first. That is BWIPP's "Strange fixup for 144x144 symbols"
 * (`node_modules/bwip-js/barcode.ps`), and the module diff against bwip-js
 * fails at 144x144 without it.
 */
export function interleaveEcc(data: readonly number[], symbol: DataMatrixSymbol): number[] {
  const { blocks } = symbol;
  const perBlock = symbol.eccCodewords / blocks;
  const rotate = symbol.size === 144 ? 2 : 0;
  const out = [...data, ...new Array<number>(symbol.eccCodewords).fill(0)];
  for (let b = 0; b < blocks; b++) {
    const ecc = rsEncode(
      data.filter((_, i) => i % blocks === b),
      perBlock,
    );
    const slot = (b + rotate) % blocks;
    ecc.forEach((cw, j) => {
      out[data.length + j * blocks + slot] = cw;
    });
  }
  return out;
}

/**
 * Cut the mapping matrix into `regions x regions` data regions and wrap each
 * in its finder: a solid L up the left and along the bottom, and a clock
 * track along the top and down the right that starts dark at the L's corner.
 * The scanner finds the symbol by the L and reads its dimensions off the clock.
 */
export function tileRegions(mapping: boolean[][], symbol: DataMatrixSymbol): boolean[][] {
  const n = symbol.size;
  const step = symbol.region + 2;
  const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const lr = r % step;
      const lc = c % step;
      if (lc === 0 || lr === step - 1) grid[r]![c] = true;
      else if (lr === 0) grid[r]![c] = lc % 2 === 0;
      else if (lc === step - 1) grid[r]![c] = lr % 2 === 1;
      else {
        const mr = Math.floor(r / step) * symbol.region + lr - 1;
        const mc = Math.floor(c / step) * symbol.region + lc - 1;
        grid[r]![c] = mapping[mr]![mc]!;
      }
    }
  }
  return grid;
}
