/**
 * C40 and Text value sets.
 *
 * Both pack three values from 0..39 into two codewords. The basic set (space,
 * digits, and one case of letters) costs one value a character; the rest of
 * ASCII costs two, a shift and the shifted value. The two modes differ only in
 * which case is basic: C40 holds uppercase, Text lowercase, and each puts the
 * other case in Shift 3.
 */
export type CtxMode = 'c40' | 'text';

const SHIFT2 = '!"#$%&\'()*+,-./:;<=>?@[\\]^_';

/** The values `ch` takes in `mode`. The caller has already rejected
 *  anything past ASCII, which needs the Upper Shift this encoder doesn't
 *  write. */
export function ctxValues(ch: string, mode: CtxMode): number[] {
  const code = ch.charCodeAt(0);
  if (ch === ' ') return [3];
  if (isDigit(ch)) return [code - 44];
  const basic = mode === 'c40' ? code >= 65 && code <= 90 : code >= 97 && code <= 122;
  if (basic) return [code - (mode === 'c40' ? 51 : 83)];
  if (code < 32) return [0, code];
  const s2 = SHIFT2.indexOf(ch);
  if (s2 >= 0) return [1, s2];
  if (code === 96) return [2, 0];
  if (code >= 123) return [2, code - 96];
  // The other case of letter.
  return [2, code - (mode === 'c40' ? 96 : 64)];
}

export function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

export function isBasic(ch: string, mode: CtxMode): boolean {
  return ctxValues(ch, mode).length === 1;
}

/** Pack values, a whole number of triplets, into codewords: 1600a + 40b + c
 *  + 1, high byte first. */
export function packTriplets(values: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < values.length; i += 3) {
    const v = 1600 * values[i]! + 40 * values[i + 1]! + values[i + 2]! + 1;
    out.push(v >> 8, v & 255);
  }
  return out;
}
