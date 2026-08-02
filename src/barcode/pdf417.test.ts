import { describe, it, expect } from 'vitest';
import bwipjs from 'bwip-js/node';
import { encodePdf417 } from './pdf417';
import { byteCompaction } from './pdf417Encode';
import { chooseLayout } from './pdf417Layout';

/**
 * The payloads the oracle diff runs. Each is here for a reason: 'A' is the
 * smallest symbol there is, 'abcdef' takes the 924 latch (its length divides
 * by six), the URL is long enough to need several rows at any width, and the
 * 120-byte one crosses into a second error correction level.
 */
const PAYLOADS = [
  'A',
  'abcdef',
  'HELLO WORLD',
  '12345678901234567890',
  'https://example.com/label/42',
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna.',
];

describe('encodePdf417 against bwip-js', () => {
  // Free choice: no shape stated on either side. This diffs the shape
  // heuristic and the assembly at once -- our `chooseLayout` reproduces
  // BWIPP's column formula, so a disagreement here is a real one.
  it.each(PAYLOADS)('matches the reference encoder for %s', (payload) => {
    expectMatchesOracle(payload, {});
  });

  // Pinned widths. One column is the tallest, narrowest symbol PDF417 has;
  // 12 columns is wide enough that every row carries a dozen codewords, so a
  // cluster mistake in the data region shows up as well as in the indicators.
  it.each([1, 2, 3, 4, 8, 12])('matches the reference encoder at %i columns', (columns) => {
    for (const payload of PAYLOADS) {
      const dataCodewords = byteCompaction(payload).length;
      if (!chooseLayout(dataCodewords, { columns })) continue;
      expectMatchesOracle(payload, { columns });
    }
  });

  // A stated row count alongside a stated width, which is what a `.lbx` file
  // carries. `rows` is a floor, so the two sides have to agree about when the
  // symbol grows past it as well as when it doesn't.
  it.each([
    [3, 3],
    [4, 10],
    [2, 20],
    [6, 30],
  ])('matches the reference encoder at %i columns by %i rows', (columns, rows) => {
    for (const payload of PAYLOADS) {
      const dataCodewords = byteCompaction(payload).length;
      if (!chooseLayout(dataCodewords, { columns, rows })) continue;
      expectMatchesOracle(payload, { columns, rows });
    }
  });

  // Where the opportunistic ECC raise fires: a matrix far bigger than the
  // payload spends the cells it would otherwise pad on error correction, which
  // moves the boundary between padding and ECC *and* the level the row
  // indicators encode. Every row is wrong if we take the level from anywhere
  // but the layout.
  it('matches the reference encoder where the ECC level is raised', () => {
    const cases: Array<[string, { columns: number; rows: number }, number]> = [
      // 'A' compacts to 2 codewords; 10x20 leaves room for 128 ECC.
      ['A', { columns: 10, rows: 20 }, 6],
      // The level-8 ceiling, which the raise clamps to rather than overshooting.
      ['A', { columns: 30, rows: 20 }, 8],
      ['HELLO WORLD', { columns: 8, rows: 12 }, 5],
      ['https://example.com/label/42', { columns: 6, rows: 20 }, 5],
    ];
    for (const [payload, opts, eccLevel] of cases) {
      const layout = chooseLayout(byteCompaction(payload).length, opts)!;
      // The raise is what is under test, so pin the level it lands on -- and
      // that it is above 2, the recommendation every one of these short
      // payloads would otherwise take, so the case can't quietly stop
      // exercising the raise.
      const where = `${payload} at ${opts.columns}x${opts.rows}`;
      expect(layout.eccLevel, where).toBe(eccLevel);
      expect(layout.eccLevel, `${where} should be raised`).toBeGreaterThan(2);
      expectMatchesOracle(payload, opts);
    }
  });

  // A level the caller asks for, which BWIPP still caps and raises. Reopening
  // a file that states one has to redraw the symbol it was drawn from.
  it.each([0, 2, 4])('matches the reference encoder at requested level %i', (eccLevel) => {
    for (const payload of PAYLOADS) {
      const dataCodewords = byteCompaction(payload).length;
      if (!chooseLayout(dataCodewords, { columns: 4, eccLevel })) continue;
      expectMatchesOracle(payload, { columns: 4, eccLevel });
    }
  });
});

describe('encodePdf417', () => {
  it('stacks rows three modules tall by default', () => {
    const sym = symbolFor('HELLO WORLD');
    expect(sym.rowHeightModules).toBe(3);
  });

  it('takes the row height the file states', () => {
    const sym = symbolFor('HELLO WORLD', { aspect: 5 });
    expect(sym.rowHeightModules).toBe(5);
    // The aspect is a rendering height, not a shape: the modules are unchanged.
    expect(sym.modules).toEqual(symbolFor('HELLO WORLD').modules);
  });

  it('asks for the 2-module quiet zone the standard specifies', () => {
    expect(symbolFor('HELLO WORLD').quiet).toEqual({
      left: 2,
      right: 2,
      top: 2,
      bottom: 2,
    });
  });

  it('reports the full symbol width, indicators and stop pattern included', () => {
    const sym = symbolFor('HELLO WORLD', { columns: 2 });
    const layout = chooseLayout(byteCompaction('HELLO WORLD').length, { columns: 2 })!;
    expect(sym.cols).toBe(layout.moduleWidth);
    // 17 modules for each of 2 data columns, a start, a stop and two row
    // indicators, plus the symbol's single closing bar.
    expect(sym.cols).toBe(17 * (2 + 4) + 1);
    expect(sym.cols).toBe(103);
    expect(sym.rows).toBe(layout.rows);
    for (const row of sym.modules) expect(row).toHaveLength(103);
  });

  it('rejects an empty payload', () => {
    expect(encodePdf417('')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a payload no layout holds', () => {
    // 2000 bytes compact to 1668 codewords, and a symbol holds 926.
    expect(encodePdf417('0'.repeat(2000))).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
    // A single column tops out at 90 rows, which this payload passes.
    expect(encodePdf417('0'.repeat(200), { columns: 1 })).toMatchObject({
      ok: false,
      reason: 'invalid',
    });
  });

  it('reports the payload as the scanned text', () => {
    expect(symbolFor('HELLO WORLD').text).toBe('HELLO WORLD');
  });
});

/** Our symbol for a payload, narrowed to 2D. */
function symbolFor(payload: string, opts: Parameters<typeof encodePdf417>[1] = {}) {
  const sym = encodePdf417(payload, opts);
  if (!sym.ok || sym.kind !== '2d') throw new Error(`expected a 2D symbol for ${payload}`);
  return sym;
}

/** Diff a whole symbol against bwip-js, module for module. */
function expectMatchesOracle(
  payload: string,
  opts: { columns?: number; rows?: number; eccLevel?: number },
): void {
  const sym = symbolFor(payload, opts);
  const expected = oracle(byteCompaction(payload), {
    ...(opts.columns !== undefined ? { columns: opts.columns } : {}),
    ...(opts.rows !== undefined ? { rows: opts.rows } : {}),
    ...(opts.eccLevel !== undefined ? { eclevel: opts.eccLevel } : {}),
  });
  const where = `${payload} at ${JSON.stringify(opts)}`;
  expect(sym.modules.length, `row count for ${where}`).toBe(expected.length);
  expect(sym.cols, `width for ${where}`).toBe(expected[0]!.length);
  expect(render(sym.modules), where).toBe(render(expected));
}

/**
 * bwip-js's symbol for the same codewords.
 *
 * `raw` feeds BWIPP codewords directly, which is the only way to compare at
 * all: BWIPP chooses Text and Numeric compaction where it can and this encoder
 * is Byte-only, so the same payload otherwise produces different codewords and
 * a different symbol that is equally correct.
 *
 * Note `pixs` holds one array row per *codeword* row. `pixy` is `rows * 3`,
 * the height the symbol renders at once each row is drawn three modules tall,
 * and reading `pixs` by it walks off the end.
 */
function oracle(codewords: readonly number[], opts: Record<string, unknown>): boolean[][] {
  const text = codewords.map((cw) => '^' + String(cw).padStart(3, '0')).join('');
  const [enc] = bwipjs.raw('pdf417', text, { ...opts, raw: true } as never) as Array<{
    pixs: number[];
    pixx: number;
  }>;
  const { pixs, pixx } = enc!;
  return Array.from({ length: pixs.length / pixx }, (_, r) =>
    Array.from({ length: pixx }, (_, c) => pixs[r * pixx + c] === 1),
  );
}

/** A grid as `#`/`.` lines, so a mismatch prints as two readable symbols. */
function render(grid: boolean[][]): string {
  return grid.map((row) => row.map((on) => (on ? '#' : '.')).join('')).join('\n');
}
