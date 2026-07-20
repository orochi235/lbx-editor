import { describe, it, expect } from 'vitest';
import { equalCutMarks, sliceRasterAtCuts } from './cutMarks';
import type { Raster1bpp } from 'obwat';

function raster(lineCount: number): Raster1bpp {
  return {
    lineBytes: 2,
    lineCount,
    rows: Array.from({ length: lineCount }, (_, i) => Uint8Array.from([i & 0xff, 0])),
  };
}

describe('equalCutMarks', () => {
  it('splits a label into equal segments', () => {
    expect(equalCutMarks(300, 3)).toEqual([100, 200]);
  });

  it('returns no marks for a single label', () => {
    expect(equalCutMarks(300, 1)).toEqual([]);
    expect(equalCutMarks(300, 0)).toEqual([]);
  });
});

describe('sliceRasterAtCuts', () => {
  // 180 dpi → 2.5 dots per pt.
  it('slices rows into pages at the cut dots', () => {
    const pages = sliceRasterAtCuts(raster(100), [20], 180); // cut at dot 50
    expect(pages).toHaveLength(2);
    expect(pages[0]!.lineCount).toBe(50);
    expect(pages[1]!.lineCount).toBe(50);
    // Row content is preserved across the boundary.
    expect(pages[1]!.rows[0]![0]).toBe(50);
  });

  it('drops out-of-range and duplicate marks', () => {
    const pages = sliceRasterAtCuts(raster(100), [-5, 0, 20, 20, 400], 180);
    expect(pages).toHaveLength(2);
  });

  it('returns the raster unsliced when there are no usable marks', () => {
    const pages = sliceRasterAtCuts(raster(100), [], 180);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.lineCount).toBe(100);
  });
});
