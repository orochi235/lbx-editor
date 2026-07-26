/**
 * Code 39 (USS-39): 43 characters plus `*` as start/stop. Every character is
 * 9 elements — 5 bars, 4 spaces, alternating bar-first — of which exactly 3
 * are wide, separated by a one-module gap.
 *
 * The pattern table is verified character-by-character against bwip-js in
 * code39.test.ts; if a cross-check fails, the table entry is wrong.
 */
import type { EncodeResult } from './types';

/** Element widths per character: 'n' = narrow (1 module), 'w' = wide (ratio). */
const PATTERNS: Record<string, string> = {
  '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn',
  '4': 'nnnwwnnnw', '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw',
  '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', 'A': 'wnnnnwnnw', 'B': 'nnwnnwnnw',
  'C': 'wnwnnwnnn', 'D': 'nnnnwwnnw', 'E': 'wnnnwwnnn', 'F': 'nnwnwwnnn',
  'G': 'nnnnnwwnw', 'H': 'wnnnnwwnn', 'I': 'nnwnnwwnn', 'J': 'nnnnwwwnn',
  'K': 'wnnnnnnww', 'L': 'nnwnnnnww', 'M': 'wnwnnnnwn', 'N': 'nnnnwnnww',
  'O': 'wnnnwnnwn', 'P': 'nnwnwnnwn', 'Q': 'nnnnnnwww', 'R': 'wnnnnnwwn',
  'S': 'nnwnnnwwn', 'T': 'nnnnwnwwn', 'U': 'wwnnnnnnw', 'V': 'nwwnnnnnw',
  'W': 'wwwnnnnnn', 'X': 'nwnnwnnnw', 'Y': 'wwnnwnnnn', 'Z': 'nwwnwnnnn',
  '-': 'nwnnnnwnw', '.': 'wwnnnnwnn', ' ': 'nwwnnnwnn', '$': 'nwnwnwnnn',
  '/': 'nwnwnnnwn', '+': 'nwnnnwnwn', '%': 'nnnwnwnwn', '*': 'nwnnwnwnn',
};

export interface Code39Options {
  /** Wide-element width in narrow modules (the "1:N" bar ratio). */
  ratio: number;
}

export function encodeCode39(data: string, opts: Code39Options): EncodeResult {
  const payload = data.toUpperCase();
  for (const ch of payload) {
    if (!(ch in PATTERNS) || ch === '*') {
      return { ok: false, reason: 'invalid', detail: `Code 39 can't encode "${ch}"` };
    }
  }

  const bars: Array<{ x: number; width: number }> = [];
  let x = 0;
  const chars = `*${payload}*`;
  for (let c = 0; c < chars.length; c++) {
    const pattern = PATTERNS[chars[c]!]!;
    for (let e = 0; e < pattern.length; e++) {
      const width = pattern[e] === 'w' ? opts.ratio : 1;
      if (e % 2 === 0) bars.push({ x, width }); // even elements are bars
      x += width;
    }
    if (c < chars.length - 1) x += 1; // inter-character gap
  }

  return { ok: true, kind: '1d', bars, totalModules: x, text: payload };
}
