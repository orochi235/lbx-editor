import { describe, it, expect } from 'vitest';
import { interleaveEcc, tileRegions } from './datamatrixBlocks';
import { SQUARE_SIZES } from './datamatrixTables';
import { rsEncode } from './reedSolomon';

const symbol = (size: number) => SQUARE_SIZES.find((s) => s.size === size)!;
const ramp = (n: number) => Array.from({ length: n }, (_, i) => ((i * 37 + 11) % 254) + 1);

describe('DataMatrix error-correction blocks', () => {
  it('appends one plain Reed-Solomon run to a single-block symbol', () => {
    const s = symbol(26);
    const data = ramp(s.dataCodewords);
    expect(interleaveEcc(data, s)).toEqual([...data, ...rsEncode(data, s.eccCodewords)]);
  });

  // Codeword i belongs to block i mod blocks, in the data run and the ECC run
  // alike; each block's ECC is computed over its own data alone.
  it.each(SQUARE_SIZES.filter((s) => s.blocks > 1).map((s) => s.size))(
    'interleaves the blocks of a size %i symbol',
    (size) => {
      const s = symbol(size);
      const data = ramp(s.dataCodewords);
      const out = interleaveEcc(data, s);
      expect(out).toHaveLength(s.dataCodewords + s.eccCodewords);
      expect(out.slice(0, s.dataCodewords)).toEqual(data);
      const ecc = out.slice(s.dataCodewords);
      const perBlock = s.eccCodewords / s.blocks;
      // 144x144 writes the ECC runs rotated by two blocks.
      const rotate = size === 144 ? 2 : 0;
      for (let b = 0; b < s.blocks; b++) {
        const blockData = data.filter((_, i) => i % s.blocks === b);
        const blockEcc = ecc.filter((_, i) => i % s.blocks === (b + rotate) % s.blocks);
        expect(blockEcc).toEqual(rsEncode(blockData, perBlock));
      }
    },
  );

  it('splits 144x144 into eight blocks of 156 data codewords and two of 155', () => {
    const s = symbol(144);
    const sizes = Array.from(
      { length: s.blocks },
      (_, b) => ramp(s.dataCodewords).filter((_, i) => i % s.blocks === b).length,
    );
    expect(sizes).toEqual([156, 156, 156, 156, 156, 156, 156, 156, 155, 155]);
  });
});

describe('DataMatrix region tiling', () => {
  const mappingOf = (
    s: (typeof SQUARE_SIZES)[number],
    fill: (r: number, c: number) => boolean,
  ) => {
    const side = s.region * s.regions;
    return Array.from({ length: side }, (_, r) =>
      Array.from({ length: side }, (_, c) => fill(r, c)),
    );
  };

  const sizes = SQUARE_SIZES.map((s) => s.size);
  it.each(sizes)('carries every mapping module into a size %i symbol', (size) => {
    const s = symbol(size);
    const mapping = mappingOf(s, (r, c) => (r * 31 + c * 17) % 3 === 0);
    const grid = tileRegions(mapping, s);
    expect(grid).toHaveLength(size);
    const step = s.region + 2;
    const lost: string[] = [];
    for (let r = 0; r < mapping.length; r++) {
      for (let c = 0; c < mapping.length; c++) {
        const gr = Math.floor(r / s.region) * step + 1 + (r % s.region);
        const gc = Math.floor(c / s.region) * step + 1 + (c % s.region);
        if (grid[gr]![gc] !== mapping[r]![c]) lost.push(`${r},${c}`);
      }
    }
    expect(lost).toEqual([]);
  });

  // Each region carries its own finder: a solid L on its left and bottom, a
  // clock track on its top and right, starting dark at the L's corner.
  it('borders every region of a 64x64 symbol with its own finder', () => {
    const s = symbol(64);
    const grid = tileRegions(mappingOf(s, () => false), s);
    const step = s.region + 2;
    for (let R = 0; R < s.regions; R++) {
      for (let C = 0; C < s.regions; C++) {
        const top = R * step;
        const left = C * step;
        for (let i = 0; i < step; i++) {
          expect(grid[top + i]![left]).toBe(true);
          expect(grid[top + step - 1]![left + i]).toBe(true);
          expect(grid[top]![left + i]).toBe(i % 2 === 0);
          expect(grid[top + i]![left + step - 1]).toBe(i % 2 === 1);
        }
      }
    }
  });
});
