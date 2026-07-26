/**
 * Code 128 and GS1-128.
 *
 * Each symbol value maps to six element widths (bar, space, bar, space, bar,
 * space) summing to 11 modules; the stop pattern is seven elements summing to
 * 13. A symbol is: start value, payload values, checksum, stop.
 *
 * Only ASCII 32..126 is encoded. Latin-1 above 126 would need FNC4 shifting,
 * and silently mis-encoding it would print a label that scans as the wrong
 * text — worse than refusing it.
 *
 * The pattern table is cross-checked against bwip-js in code128.test.ts.
 */
import type { EncodeResult } from './types';

/** Element widths for symbol values 0..106; index 106 is the stop pattern. */
const WIDTHS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312',
  '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222',
  '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321',
  '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321',
  '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224',
  '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112',
  '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412',
  '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const CODE_B = 100; // when read in code set C
const CODE_C = 99; // when read in code set B
const FNC1 = 102;
const STOP = 106;

export interface Code128Options {
  /** GS1-128: emit FNC1 after the start symbol and strip AI parentheses. */
  gs1: boolean;
}

/** How many digits run consecutively from `i`. */
function digitRun(data: string, i: number): number {
  let n = 0;
  while (i + n < data.length && data[i + n]! >= '0' && data[i + n]! <= '9') n++;
  return n;
}

/**
 * Symbol values for the payload, switching between code sets B and C the way
 * the standard recommends: start in C when the payload opens with an even
 * all-digit run or 4+ digits, and switch into C mid-string for runs of 6+.
 */
function toValues(data: string, gs1: boolean): number[] {
  const values: number[] = [];
  const leading = digitRun(data, 0);
  const allDigits = leading === data.length && data.length > 0;
  let inC = allDigits ? data.length % 2 === 0 : leading >= 4;

  values.push(inC ? START_C : START_B);
  if (gs1) values.push(FNC1);

  let i = 0;
  while (i < data.length) {
    if (inC) {
      const run = digitRun(data, i);
      if (run >= 2) {
        values.push(Number(data.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      inC = false;
      continue;
    }

    const run = digitRun(data, i);
    // Switch to C for a long even run, or for an even run that finishes the
    // payload — both save symbols over staying in B.
    if (run >= 6 && run % 2 === 0) {
      values.push(CODE_C);
      inC = true;
      continue;
    }
    if (run >= 4 && i + run === data.length && run % 2 === 0) {
      values.push(CODE_C);
      inC = true;
      continue;
    }
    values.push(data.charCodeAt(i) - 32);
    i++;
  }

  return values;
}

export function encodeCode128(data: string, opts: Code128Options): EncodeResult {
  // GS1 AIs are written with parentheses for humans; they aren't encoded.
  const payload = opts.gs1 ? data.replace(/[()]/g, '') : data;

  for (const ch of payload) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      return { ok: false, reason: 'invalid', detail: `Code 128 can't encode "${ch}"` };
    }
  }
  if (payload.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'Code 128 needs at least one character' };
  }

  const values = toValues(payload, opts.gs1);

  // Checksum: start value plus each subsequent value weighted by its position.
  let sum = values[0]!;
  for (let i = 1; i < values.length; i++) sum += values[i]! * i;
  values.push(sum % 103);
  values.push(STOP);

  const bars: Array<{ x: number; width: number }> = [];
  let x = 0;
  for (const value of values) {
    const widths = WIDTHS[value]!;
    for (let e = 0; e < widths.length; e++) {
      const width = Number(widths[e]);
      if (e % 2 === 0) bars.push({ x, width }); // even elements are bars
      x += width;
    }
  }

  return { ok: true, kind: '1d', bars, totalModules: x, text: data };
}
