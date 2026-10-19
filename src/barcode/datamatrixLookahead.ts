/**
 * ISO 16022's look-ahead test for which encodation mode to use next.
 *
 * It walks forward from `i` tallying what each mode would spend, and decides
 * once one mode is clearly cheaper, or the data runs out. This is BWIPP's
 * `lookup` step for step, costs for all six modes included, because the costs
 * of X12, EDIFACT and Base256 decide when the walk stops even though this
 * encoder never writes those modes. When the walk picks one of them, it is
 * rerun without them.
 *
 * The arithmetic is BWIPP's too: costs in float32, with its rounded thirds
 * (0.6666667, 1.3333334, 3.3333334). They drift off whole numbers -- a latch
 * plus three C40 characters comes to 3.0000002 -- and the end-of-data ceiling
 * turns that drift into a different choice now and then. Exact thirds were
 * tried, and came out longer than bwip-js on payloads where float32 matches it.
 */
import { isBasic, isDigit, type CtxMode } from './datamatrixC40';

export type Mode = 'ascii' | CtxMode;
type AnyMode = Mode | 'x12' | 'edifact' | 'base256';

const isX12Terminator = (ch: string) => ch === '\r' || ch === '*' || ch === '>';
const isX12 = (ch: string) => isX12Terminator(ch) || isBasic(ch, 'c40');
const isEdifact = (ch: string) => ch >= ' ' && ch <= '^';

/** float32 addition, as BWIPP's compiled PostScript does it. */
const add = (v: number, d: number) => {
  const sum = v + d;
  return (sum | 0) === sum ? sum : Math.fround(sum);
};

export function chooseMode(data: string, i: number, mode: Mode): Mode {
  const choice = lookup(data, i, mode, true);
  if (choice === 'ascii' || choice === 'c40' || choice === 'text') return choice;
  return lookup(data, i, mode, false) as Mode;
}

function lookup(data: string, i: number, mode: Mode, allModes: boolean): AnyMode {
  const off = allModes ? 0 : Infinity;
  const fromAscii = mode === 'ascii';
  let a = fromAscii ? 0 : 1;
  let c = mode === 'c40' ? 0 : fromAscii ? 1 : 2;
  let t = mode === 'text' ? 0 : fromAscii ? 1 : 2;
  let x = (fromAscii ? 1 : 2) + off;
  let e = (fromAscii ? 1 : 2) + off;
  let b = (fromAscii ? 1.25 : 2.25) + off;

  const below = (v: number, others: number[]) => others.every((o) => v < o);
  for (let k = 0; ; k++) {
    if (i + k === data.length) {
      a = Math.ceil(a);
      c = Math.ceil(c);
      t = Math.ceil(t);
      x = Math.ceil(x);
      e = Math.ceil(e);
      b = Math.ceil(b);
      if ([c, t, x, e, b].every((o) => a <= o)) return 'ascii';
      if (below(b, [a, c, t, x, e])) return 'base256';
      if (below(e, [a, c, t, x, b])) return 'edifact';
      if (below(t, [a, c, x, e, b])) return 'text';
      if (below(x, [a, c, t, e, b])) return 'x12';
      return 'c40';
    }
    const ch = data[i + k]!;
    a = isDigit(ch) ? add(a, 0.5) : Math.ceil(a) + 1;
    c = add(c, isBasic(ch, 'c40') ? 0.6666667 : 1.3333334);
    t = add(t, isBasic(ch, 'text') ? 0.6666667 : 1.3333334);
    x = add(x, isX12(ch) ? 0.6666667 : 3.3333334);
    e = add(e, isEdifact(ch) ? 0.75 : 3.25);
    b += 1;
    if (k >= 4) {
      if ([c, t, x, e, b].every((o) => a + 1 <= o)) return 'ascii';
      if (b + 1 <= a || below(b + 1, [c, t, x, e])) return 'base256';
      if (below(e + 1, [a, c, t, x, b])) return 'edifact';
      if (below(t + 1, [a, c, x, e, b])) return 'text';
      if (below(x + 1, [a, c, t, e, b])) return 'x12';
      if (below(c + 1, [a, t, e, b])) {
        if (c < x) return 'c40';
        if (c === x) return x12TerminatorFirst(data, i + k + 1) ? 'x12' : 'c40';
      }
    }
  }
}

/** Whether an X12 terminator (CR, `*` or `>`) comes before any character X12
 *  can't encode. */
function x12TerminatorFirst(data: string, from: number): boolean {
  for (let j = from; j < data.length; j++) {
    if (isX12Terminator(data[j]!)) return true;
    if (!isX12(data[j]!)) return false;
  }
  return false;
}
