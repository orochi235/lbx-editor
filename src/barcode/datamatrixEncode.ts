/**
 * ECC200 encodation: ASCII, C40 and Text.
 *
 * ASCII carries the whole range and packs digit pairs two to a codeword; C40
 * and Text pack runs of uppercase or lowercase three characters to two
 * codewords. `chooseMode` decides where to switch. X12, EDIFACT and Base256 are
 * not written: the first two would save a few codewords on some payloads, and
 * Base256 only pays for bytes past ASCII, which nothing here accepts.
 *
 * The end of data is where a mode-switching encoder goes wrong while looking
 * right, so `encodeCtx` follows BWIPP's `encCTX` case for case: a last triplet
 * that exactly fills the symbol drops its unlatch, a last pair is padded with
 * Shift 1, a lone last character goes back to ASCII, and anything else
 * backtracks to a triplet boundary and unlatches.
 */
import { ctxValues, isDigit, packTriplets, type CtxMode } from './datamatrixC40';
import { chooseMode, type Mode } from './datamatrixLookahead';
import { remainingAfter } from './datamatrixTables';

const LATCH: Record<CtxMode, number> = { c40: 230, text: 239 };
const UNLATCH = 254;

/**
 * Codewords for `data`, before padding. The look-ahead is a heuristic and can
 * lose to plain ASCII, so the shorter of the two wins. Throws for a codepoint
 * none of the modes can carry.
 */
export function encodeCodewords(data: string): number[] {
  const ascii = encodeAscii(data);
  const mixed = encodeMixed(data);
  return mixed.length <= ascii.length ? mixed : ascii;
}

function encodeMixed(data: string): number[] {
  const out: number[] = [];
  let i = 0;
  let mode: Mode = 'ascii';
  while (i < data.length) {
    if (mode !== 'ascii') {
      const step = encodeCtx(data, i, mode, out);
      i = step.i;
      mode = step.mode;
      continue;
    }
    if (isDigitPair(data, i)) {
      i = asciiStep(data, i, out);
      continue;
    }
    const next = chooseMode(data, i, 'ascii');
    if (next !== 'ascii') {
      out.push(LATCH[next]);
      mode = next;
      continue;
    }
    i = asciiStep(data, i, out);
  }
  return out;
}

/** One C40/Text segment, from just after its latch to wherever it ends. */
function encodeCtx(
  data: string,
  start: number,
  mode: CtxMode,
  out: number[],
): { i: number; mode: Mode } {
  const values: number[] = [];
  let i = start;
  while (i < data.length) {
    if (values.length % 3 === 0) {
      if (values.length > 0) {
        const next = chooseMode(data, i, mode);
        if (next !== mode) {
          out.push(...packTriplets(values), UNLATCH);
          if (next !== 'ascii') out.push(LATCH[next]);
          return { i, mode: next };
        }
      }
      if (data.length - i <= 3) {
        const room = remainingAfter(out.length + (values.length / 3) * 2);
        const rest = [...data.slice(i)].flatMap((ch) => ctxValues(ch, mode));
        if (room === 2 && rest.length === 3) {
          out.push(...packTriplets([...values, ...rest]));
          return { i: data.length, mode: 'ascii' };
        }
        if (room === 2 && rest.length === 2) {
          out.push(...packTriplets([...values, ...rest, 0]));
          return { i: data.length, mode: 'ascii' };
        }
        if (room === 2 && rest.length === 1) {
          out.push(...packTriplets(values), UNLATCH);
          asciiStep(data, i, out);
          return { i: data.length, mode: 'ascii' };
        }
        if (room === 1 && rest.length === 1) {
          out.push(...packTriplets(values));
          asciiStep(data, i, out);
          return { i: data.length, mode: 'ascii' };
        }
      }
    }
    values.push(...ctxValues(data[i]!, mode));
    i++;
  }

  // Out of data mid-triplet: give back the characters past the last boundary
  // and finish them in ASCII.
  while (values.length % 3 !== 0) {
    i--;
    values.length -= ctxValues(data[i]!, mode).length;
  }
  out.push(...packTriplets(values), UNLATCH);
  // Something must go out in ASCII first, or the look-ahead latches straight
  // back into the mode just left.
  if (i < data.length) i = asciiStep(data, i, out);
  return { i, mode: 'ascii' };
}

function isDigitPair(data: string, i: number): boolean {
  return isDigit(data[i]!) && i + 1 < data.length && isDigit(data[i + 1]!);
}

/** Encode one ASCII codeword at `i` -- a digit pair where there is one -- and
 *  return the index after it. */
function asciiStep(data: string, i: number, out: number[]): number {
  if (isDigitPair(data, i)) {
    out.push(130 + Number(data.slice(i, i + 2)));
    return i + 2;
  }
  out.push(asciiValue(data[i]!));
  return i + 1;
}

function asciiValue(ch: string): number {
  const code = ch.codePointAt(0)!;
  if (code > 127) throw new Error(`DataMatrix ASCII encodation cannot encode "${ch}"`);
  return code + 1;
}

/** Codewords for `data` under ASCII encodation. Throws for a codepoint the
 *  mode cannot carry — the caller turns that into an `invalid` result. */
export function encodeAscii(data: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) i = asciiStep(data, i, out);
  return out;
}

/**
 * Pad `codewords` out to `capacity`.
 *
 * The first pad is 129. Every later pad is 129 randomized by its own position,
 * per ISO 16022's 253-state algorithm — a run of identical pads would otherwise
 * produce a large blank region that reads as damage.
 *
 * `position` is the pad's **1-based index in the complete codeword sequence**,
 * data included — not its index within the run of pads. `out.length` at the
 * moment of the push is the 0-based index the value is about to take, so
 * `out.length + 1` is that position. BWIPP writes the same thing as
 * `i 1 add 149 mul 253 mod 1 add 129 add` over a `for` running the 0-based
 * array index from `datlen+1` (`node_modules/bwip-js/barcode.ps`, in the
 * datamatrix encoder's padding block). The test pins BWIPP's actual output for
 * two payloads of different length, which is what distinguishes the two
 * conventions: pads at the same absolute position take the same value however
 * much data precedes them.
 */
export function padCodewords(codewords: readonly number[], capacity: number): number[] {
  const out = [...codewords];
  if (out.length >= capacity) return out.slice(0, capacity);
  out.push(129);
  while (out.length < capacity) {
    const position = out.length + 1;
    const pseudoRandom = ((149 * position) % 253) + 1;
    const value = 129 + pseudoRandom;
    out.push(value <= 254 ? value : value - 254);
  }
  return out;
}
