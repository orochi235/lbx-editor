import { describe, it, expect } from 'vitest';
import bwipjs from 'bwip-js/node';
import {
  chooseLayout,
  MAX_COLUMNS,
  MAX_ROWS,
  MIN_ROWS,
  MAX_CODEWORDS,
  MAX_DATA_CODEWORDS,
  MAX_ECC_LEVEL,
} from './pdf417Layout';
import { CODEWORD_PATTERNS } from './pdf417Table';

describe('PDF417 layout', () => {
  it('picks a layout holding every codeword', () => {
    const layout = chooseLayout(14)!;
    expect(layout).not.toBeNull();
    // Descriptor, payload, ECC and padding all fit, with nothing left over.
    expect(layout.columns * layout.rows).toBe(
      1 + 14 + layout.padCount + layout.eccCount,
    );
    expect(layout.dataRegion).toBe(layout.columns * layout.rows - layout.eccCount);
    expect(layout.padCount).toBeGreaterThanOrEqual(0);
  });

  it('honors an explicit column count', () => {
    // 14 data codewords take level 2, so 8 ECC, and 23 cells in all.
    const layout = chooseLayout(14, { columns: 2 })!;
    expect(layout.columns).toBe(2);
    expect(layout.rows).toBe(12);
  });

  it('grows past an explicit row count that no longer fits', () => {
    // BWIPP treats `rows` as a floor once `columns` is stated, so a file whose
    // text has since been edited longer widens instead of failing to encode.
    expect(chooseLayout(14, { columns: 2, rows: 5 })!.rows).toBe(12);
    expect(chooseLayout(14, { columns: 2, rows: 20 })!.rows).toBe(20);
  });

  it('honors an explicit row count, fitting the columns to it', () => {
    const layout = chooseLayout(14, { rows: 12 })!;
    expect(layout.rows).toBe(12);
    expect(layout.columns).toBe(2);
  });

  it('targets the requested aspect ratio when asked', () => {
    const wide = chooseLayout(60, { targetAspect: 6 })!;
    const narrow = chooseLayout(60, { targetAspect: 0.5 })!;
    expect(wide.columns).toBeGreaterThan(narrow.columns);
  });

  it('stays inside the symbology limits', () => {
    for (let m = 1; m <= MAX_DATA_CODEWORDS; m++) {
      const layout = chooseLayout(m);
      expect(layout, `no layout for ${m} codewords`).not.toBeNull();
      expect(layout!.columns).toBeGreaterThanOrEqual(1);
      expect(layout!.columns).toBeLessThanOrEqual(MAX_COLUMNS);
      expect(layout!.rows).toBeGreaterThanOrEqual(MIN_ROWS);
      expect(layout!.rows).toBeLessThanOrEqual(MAX_ROWS);
      expect(layout!.dataRegion).toBeLessThanOrEqual(MAX_CODEWORDS);
    }
  });

  it('returns null when no layout holds the payload', () => {
    expect(chooseLayout(MAX_DATA_CODEWORDS + 1)).toBeNull();
    expect(chooseLayout(100000)).toBeNull();
    expect(chooseLayout(0)).toBeNull();
    // 100 data codewords need 117 rows in a single column.
    expect(chooseLayout(100, { columns: 1 })).toBeNull();
    // 30 columns of 90 rows is 2700 cells, and the data region caps at 928.
    expect(chooseLayout(1, { columns: 30, rows: 90 })).toBeNull();
  });

  it('rejects counts outside the symbology limits', () => {
    expect(chooseLayout(14, { columns: 0 })).toBeNull();
    expect(chooseLayout(14, { columns: MAX_COLUMNS + 1 })).toBeNull();
    expect(chooseLayout(14, { rows: MIN_ROWS - 1 })).toBeNull();
    expect(chooseLayout(14, { rows: MAX_ROWS + 1 })).toBeNull();
    expect(chooseLayout(14, { eccLevel: -1 })).toBeNull();
    expect(chooseLayout(14, { eccLevel: 9 })).toBeNull();
  });

  it('reports the module width a symbol will occupy', () => {
    // 17 per data column, plus start, stop and the two row indicators.
    expect(chooseLayout(14, { columns: 2 })!.moduleWidth).toBe(17 * (2 + 4) + 1);
    expect(chooseLayout(14, { columns: 30 })!.moduleWidth).toBe(17 * (30 + 4) + 1);
  });

  it('pins an error correction level when asked to', () => {
    // 1 data codeword in a 30-column symbol has cells to spare, so the level
    // is normally raised to 5. Fixing it spends them on padding instead.
    expect(chooseLayout(1, { columns: 30 })!.eccLevel).toBe(5);
    const pinned = chooseLayout(1, { columns: 30, eccLevel: 2, fixedEccLevel: true })!;
    expect(pinned.eccLevel).toBe(2);
    expect(pinned.eccCount).toBe(8);
    expect(pinned.padCount).toBe(30 * 3 - 8 - 1 - 1);
  });
});

describe('PDF417 layout against bwip-js', () => {
  it('chooses the same shape and error correction level, freely', () => {
    for (const m of SWEEP) {
      expect(chooseLayout(m), `m=${m}`).toEqual(expect.objectContaining(oracle(m, {})));
    }
  });

  it('chooses the same shape and error correction level at a fixed width', () => {
    for (const m of SWEEP) {
      for (const columns of [1, 2, 3, 5, 8, 13, 21, 30]) {
        const expected = oracle(m, { columns });
        const layout = chooseLayout(m, { columns });
        if (!expected) {
          expect(layout, `m=${m} columns=${columns} should not encode`).toBeNull();
          continue;
        }
        expect(layout, `m=${m} columns=${columns}`).toEqual(
          expect.objectContaining(expected),
        );
      }
    }
  });

  it('raises the level the same way into an oversized matrix', () => {
    // A matrix far larger than the payload is where the opportunistic raise
    // does its work, and where it runs into its level-8 ceiling: 20 rows of 30
    // columns leave enough spare cells for 512 ECC codewords and no more.
    for (const m of [1, 5, 20, 60, 150, 400]) {
      for (const columns of [10, 30]) {
        for (const rows of [5, 20, 40, 60, 90]) {
          const expected = oracle(m, { columns, rows });
          const layout = chooseLayout(m, { columns, rows });
          if (!expected) {
            expect(layout, `m=${m} ${columns}x${rows} should not encode`).toBeNull();
            continue;
          }
          expect(layout, `m=${m} ${columns}x${rows}`).toEqual(
            expect.objectContaining(expected),
          );
        }
      }
    }
    expect(chooseLayout(1, { columns: 30, rows: 20 })!.eccLevel).toBe(MAX_ECC_LEVEL);
  });

  it('agrees with BWIPP that a level can be pinned', () => {
    for (const m of [1, 10, 50, 200]) {
      for (const eccLevel of [0, 2, 5, 8]) {
        const expected = oracle(m, { eclevel: eccLevel, fixedeclevel: true });
        const layout = chooseLayout(m, { eccLevel, fixedEccLevel: true });
        if (!expected) {
          expect(layout, `m=${m} eclevel=${eccLevel} should not encode`).toBeNull();
          continue;
        }
        expect(layout, `m=${m} eclevel=${eccLevel}`).toEqual(
          expect.objectContaining(expected),
        );
      }
    }
  });

  it('computes floor(log2) the way BWIPP does', () => {
    // BWIPP takes `x ln 2 ln div cvi`; the module uses exact integer math. The
    // two agree over every value a 30x90 matrix can produce.
    for (let x = 1; x <= 4000; x++) {
      let exact = 0;
      while (2 ** (exact + 1) <= x) exact++;
      expect(Math.trunc(Math.log(x) / Math.log(2)), `x=${x}`).toBe(exact);
    }
  });
});

/**
 * Data codeword counts to sweep: every threshold in the recommended-level
 * table and either side of it, both ends of the range, and a spread between.
 */
const SWEEP = [
  1, 2, 3, 5, 8, 11, 13, 21, 34, 39, 40, 41, 55, 89, 144, 159, 160, 161, 233,
  319, 320, 321, 377, 500, 610, 700, 800, 862, 863, 864, 870, 900, 920, 925, 926,
];

/**
 * What bwip-js builds for `m` raw data codewords: its shape and error
 * correction level, read back off the rendered symbol. Null when BWIPP refuses
 * the combination.
 *
 * `raw` mode feeds BWIPP codewords directly, so the layout is exercised
 * independently of which compaction mode BWIPP would have chosen — ours is
 * always Byte and its default is not.
 */
function oracle(
  m: number,
  opts: Record<string, unknown>,
): { columns: number; rows: number; eccLevel: number; moduleWidth: number } | null {
  const text = Array.from({ length: m }, (_, i) =>
    '^' + String(100 + (i % 800)).padStart(3, '0'),
  ).join('');

  let enc: { pixs: number[]; pixx: number } | undefined;
  try {
    [enc] = bwipjs.raw('pdf417', text, { ...opts, raw: true } as never) as Array<{
      pixs: number[];
      pixx: number;
    }>;
  } catch {
    return null;
  }

  const { pixs, pixx } = enc!;
  const rows = pixs.length / pixx;
  const columns = (pixx - 69) / 17;
  // BWIPP's `rwid` is the module width we claim, so a wrong overhead constant
  // shows up here as a fractional column count.
  expect(Number.isInteger(columns), `pixx=${pixx} is not 17 * (c + 4) + 1`).toBe(true);

  // Codeword at `from` in row `row`, whose cluster is row mod 3.
  const codewordAt = (row: number, from: number): number => {
    let pattern = 0;
    for (let i = 0; i < 17; i++) pattern = (pattern << 1) | pixs[row * pixx + from + i]!;
    return CODEWORD_PATTERNS[row % 3]!.indexOf(pattern);
  };

  // Row 1's left indicator is `eclevel * 3 + (rows - 1) mod 3`; the leading
  // `(row div 3) * 30` term is zero there. Row 0's right indicator is
  // `columns - 1`, which cross-checks the width arithmetic above.
  expect(codewordAt(0, 17 * (columns + 2)), 'right row indicator').toBe(columns - 1);
  const eccLevel = (codewordAt(1, 17) - ((rows - 1) % 3)) / 3;

  return { columns, rows, eccLevel, moduleWidth: pixx };
}
