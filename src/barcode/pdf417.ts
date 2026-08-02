/**
 * PDF417.
 *
 * A stacked symbology: `columns` data codewords across by `rows` down, each row
 * bracketed by a start pattern, two row indicators and a stop pattern. Rows are
 * three modules tall by default -- ISO 15438's minimum, and P-touch's
 * `pdf417Style` default for its `aspect` attribute -- which is why `Symbol2D`
 * carries `rowHeightModules` at all.
 *
 * The pieces live apart because each is worth testing on its own: the codeword
 * patterns in `pdf417Table.ts`, compaction and error correction in
 * `pdf417Encode.ts`, the shape and the error correction budget in
 * `pdf417Layout.ts`. What is here is assembly plus the row indicators, and
 * `pdf417.test.ts` diffs whole symbols against bwip-js, which is what actually
 * proves it.
 *
 * ## The row indicators are the part that can be subtly wrong
 *
 * Every row carries two of them, and between them they restate the symbol's
 * own dimensions -- rows, columns and error correction level -- spread across
 * three consecutive rows so that a scanner can recover them from a partial
 * read. Getting one wrong does not corrupt a codeword; it makes the symbol
 * describe a shape it does not have, in every row at once, and a scanner then
 * rejects a symbol whose data region is perfectly intact. So they are
 * transcribed straight out of BWIPP (`barcode.ps` 23415-23430) and left in that
 * shape rather than refactored into something tidier.
 */
import type { EncodeResult } from './types';
import { uniformQuiet } from './types';
import { byteCompaction, pdf417Ecc } from './pdf417Encode';
import { chooseLayout, type Pdf417Layout } from './pdf417Layout';
import { patternFor } from './pdf417Table';

/** The 17-module start pattern every row opens with. */
const START_PATTERN = 0b11111111010101000;
/**
 * The 18-module stop pattern every row closes with: 17 modules plus the single
 * extra bar that terminates the symbol, which is where `moduleWidth`'s trailing
 * `+ 1` comes from.
 */
const STOP_PATTERN = 0b111111101000101001;

/** The 900 codeword, which pads a data region the payload does not fill. */
const PAD_CODEWORD = 900;

export interface Pdf417Options {
  /** Exact data column count, 1 to 30. A file states the shape it was drawn with. */
  columns?: number;
  /** Row count, 3 to 90 — a floor alongside `columns`, exact on its own. */
  rows?: number;
  /**
   * Starting error correction level, 0 to 8. Like BWIPP's `eclevel` this is
   * still subject to the cap and the opportunistic raise, so it is a request
   * rather than a pin. That round-trips: the raise only moves the level up to
   * what the matrix already holds, so re-encoding a symbol at the level it
   * ended on leaves it there.
   */
  eccLevel?: number;
  /** Row height as a multiple of module width. Defaults to 3. */
  aspect?: number;
  /**
   * Width-to-height ratio to aim for when the shape is otherwise free. Opting
   * in leaves bwip-js's shape heuristic behind — see `pdf417Layout.ts`.
   */
  targetAspect?: number;
}

export function encodePdf417(data: string, opts: Pdf417Options = {}): EncodeResult {
  if (data.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'PDF417 needs a payload' };
  }

  const rowHeightModules = opts.aspect ?? 3;
  if (!(rowHeightModules > 0)) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `PDF417 row height must be positive, not ${rowHeightModules}`,
    };
  }

  const dataCodewords = byteCompaction(data);
  const layout = chooseLayout(dataCodewords.length, {
    columns: opts.columns,
    rows: opts.rows,
    eccLevel: opts.eccLevel,
    targetAspect: opts.targetAspect,
    rowHeightModules,
  });
  if (!layout) {
    return {
      ok: false,
      reason: 'invalid',
      detail: `No PDF417 symbol holds this payload at the requested shape: ${dataCodewords.length} data codewords`,
    };
  }

  // The whole codeword block, in the order the matrix reads it. The error
  // correction runs over the length descriptor and the padding too — as far as
  // the LFSR is concerned, everything before the ECC block is data.
  const block = [
    layout.dataRegion,
    ...dataCodewords,
    ...new Array<number>(layout.padCount).fill(PAD_CODEWORD),
  ];
  const codewords = [...block, ...pdf417Ecc(block, layout.eccCount)];

  return {
    ok: true,
    kind: '2d',
    cols: layout.moduleWidth,
    rows: layout.rows,
    rowHeightModules,
    modules: drawRows(codewords, layout),
    quiet: uniformQuiet(2),
    text: data,
  };
}

/** The symbol as one module row per codeword row, top to bottom. */
function drawRows(codewords: readonly number[], layout: Pdf417Layout): boolean[][] {
  return Array.from({ length: layout.rows }, (_, i) => rowModules(i, codewords, layout));
}

/**
 * One codeword row as modules: start, left indicator, the row's data
 * codewords, right indicator, stop. Every codeword in the row is drawn from
 * cluster `i % 3`.
 */
function rowModules(
  i: number,
  codewords: readonly number[],
  layout: Pdf417Layout,
): boolean[] {
  const cluster = i % 3;
  const { columns: c, rows: r, eccLevel: e } = layout;

  // BWIPP `barcode.ps` 23415-23430, verbatim. Every division is integer.
  const base = Math.floor(i / 3) * 30;
  let left: number;
  let right: number;
  if (cluster === 0) {
    left = base + Math.floor((r - 1) / 3);
    right = base + c - 1;
  } else if (cluster === 1) {
    left = base + e * 3 + ((r - 1) % 3);
    right = base + Math.floor((r - 1) / 3);
  } else {
    left = base + c - 1;
    right = base + e * 3 + ((r - 1) % 3);
  }

  const out: boolean[] = [];
  pushBits(out, START_PATTERN, 17);
  pushBits(out, patternFor(cluster, left), 17);
  for (let k = 0; k < c; k++) {
    pushBits(out, patternFor(cluster, codewords[i * c + k]!), 17);
  }
  pushBits(out, patternFor(cluster, right), 17);
  pushBits(out, STOP_PATTERN, 18);
  return out;
}

/** Append `width` bits of `value`, most significant first — the table's order. */
function pushBits(out: boolean[], value: number, width: number): void {
  for (let bit = width - 1; bit >= 0; bit--) out.push(((value >> bit) & 1) === 1);
}
