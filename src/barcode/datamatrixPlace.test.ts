import { describe, it, expect } from 'vitest';
import { placeCodewords } from './datamatrixPlace';
import { SQUARE_SIZES } from './datamatrixTables';

/** The data area of a symbol: every region's modules, finder pattern removed. */
const dataArea = (s: (typeof SQUARE_SIZES)[number]) => s.region * s.regions;

describe('DataMatrix bit placement', () => {
  it('fills every cell of the data area exactly once', () => {
    // A 10x10 symbol has an 8x8 data area = 64 bits = 8 codewords, of which
    // 3 are data and 5 ECC.
    const grid = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    expect(grid).toHaveLength(8);
    for (const row of grid) {
      expect(row).toHaveLength(8);
      for (const cell of row) expect(typeof cell).toBe('boolean');
    }
  });

  it('places the same codewords the same way every time', () => {
    const a = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    const b = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    expect(a).toEqual(b);
  });

  it('changes the grid when a codeword changes', () => {
    const a = placeCodewords([1, 2, 3, 4, 5, 6, 7, 8], 8, 8);
    const b = placeCodewords([1, 2, 3, 4, 5, 6, 7, 9], 8, 8);
    expect(a).not.toEqual(b);
  });

  it('handles a 12x12 symbol, whose data area is 10x10', () => {
    const grid = placeCodewords(new Array(12).fill(0).map((_, i) => i + 1), 10, 10);
    expect(grid).toHaveLength(10);
    expect(grid[0]).toHaveLength(10);
  });

  // The four tests above would pass for a walk that scribbles. These two are
  // what the walk can actually be held to before Task C5 diffs it against
  // bwip-js module for module: the placement writes exactly 8 cells per
  // codeword and never reads back, so if every cell of the data area is
  // written and the write count equals the cell count, the walk is a bijection
  // onto the area. Both halves are asserted below.

  describe('is total and exclusive over the data area', () => {
    for (const symbol of SQUARE_SIZES) {
      const side = dataArea(symbol);
      const area = side * side;
      const count = Math.floor(area / 8);
      // The four sizes whose area isn't a multiple of 8 lose the standard's
      // unused 2x2 corner, which the placement fills with a fixed checkerboard
      // rather than data: two dark, two light.
      const cornerCells = area % 8 === 4 ? 4 : 0;
      expect(area % 8 === 0 || area % 8 === 4).toBe(true);

      it(`covers every cell of the ${side}x${side} area in a ${symbol.size}x${symbol.size} symbol`, () => {
        // All bits set: every cell the walk writes goes dark, so a light cell
        // is one the walk never reached.
        const grid = placeCodewords(new Array(count).fill(0xff), side, side);
        const light: string[] = [];
        for (let r = 0; r < side; r += 1) {
          for (let c = 0; c < side; c += 1) if (!grid[r]![c]) light.push(`${r},${c}`);
        }
        // Only the checkerboard corner's two light cells may remain.
        expect(light).toEqual(
          cornerCells === 0 ? [] : [`${side - 2},${side - 1}`, `${side - 1},${side - 2}`],
        );
        // 8 writes per codeword, and they land on area - corner cells; with
        // every one of those cells covered, no cell can be written twice.
        expect(count * 8).toBe(area - cornerCells);
      });
    }
  });

  describe('gives each codeword its own eight cells', () => {
    // O(codewords) placements per size, so only the single-region sizes; the
    // sweep above already covers the rest for totality.
    for (const symbol of SQUARE_SIZES.filter((s) => s.regions === 1)) {
      const side = dataArea(symbol);
      const count = Math.floor((side * side) / 8);

      it(`in a ${symbol.size}x${symbol.size} symbol`, () => {
        const base = placeCodewords(new Array(count).fill(0), side, side);
        const seen = new Set<string>();
        for (let i = 0; i < count; i += 1) {
          const cws = new Array(count).fill(0);
          cws[i] = 0xff;
          const grid = placeCodewords(cws, side, side);
          const changed: string[] = [];
          for (let r = 0; r < side; r += 1) {
            for (let c = 0; c < side; c += 1) {
              if (grid[r]![c] !== base[r]![c]) changed.push(`${r},${c}`);
            }
          }
          // Every codeword is consumed, and all eight of its bits land.
          expect(changed).toHaveLength(8);
          for (const cell of changed) seen.add(cell);
        }
        // No two codewords share a cell.
        expect(seen.size).toBe(count * 8);
      });
    }
  });
});
