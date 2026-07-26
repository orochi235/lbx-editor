/**
 * Codabar (NW-7, USS-Codabar).
 *
 * Sixteen data characters plus four interchangeable start/stop guards (A-D).
 * Each character is 7 elements — 4 bars, 3 spaces, alternating bar-first —
 * separated by a one-module gap.
 *
 * The pattern table was derived from bwip-js rather than transcribed, and
 * codabar.test.ts re-verifies every character against it.
 */
import type { EncodeResult } from './types';

const PATTERNS: Record<string, string> = {
  '0': 'nnnnnww', '1': 'nnnnwwn', '2': 'nnnwnnw', '3': 'wwnnnnn',
  '4': 'nnwnnwn', '5': 'wnnnnwn', '6': 'nwnnnnw', '7': 'nwnnwnn',
  '8': 'nwwnnnn', '9': 'wnnwnnn', '-': 'nnnwwnn', '$': 'nnwwnnn',
  ':': 'wnnnwnw', '/': 'wnwnnnw', '.': 'wnwnwnn', '+': 'nnwnwnw',
  'A': 'nnwwnwn', 'B': 'nwnwnnw', 'C': 'nnnwnww', 'D': 'nnnwwwn',
};

const GUARDS = 'ABCD';

/**
 * Encode a Codabar payload. Guards may be included by the caller; a payload
 * without them gets the conventional A…B pair, since a Codabar symbol is
 * invalid without guards and silently emitting one would be worse.
 */
export function encodeCodabar(data: string, ratio = 3): EncodeResult {
  let payload = data.toUpperCase();
  const hasGuards =
    payload.length >= 2 &&
    GUARDS.includes(payload[0]!) &&
    GUARDS.includes(payload[payload.length - 1]!);
  if (!hasGuards) payload = `A${payload}B`;

  const body = payload.slice(1, -1);
  if (body.length === 0) {
    return { ok: false, reason: 'invalid', detail: 'Codabar needs at least one character' };
  }
  for (const ch of body) {
    if (!(ch in PATTERNS) || GUARDS.includes(ch)) {
      return { ok: false, reason: 'invalid', detail: `Codabar can't encode "${ch}"` };
    }
  }

  const bars: Array<{ x: number; width: number }> = [];
  let x = 0;
  for (let c = 0; c < payload.length; c++) {
    const pattern = PATTERNS[payload[c]!]!;
    for (let e = 0; e < pattern.length; e++) {
      const width = pattern[e] === 'w' ? ratio : 1;
      if (e % 2 === 0) bars.push({ x, width }); // even elements are bars
      x += width;
    }
    if (c < payload.length - 1) x += 1; // inter-character gap
  }

  return { ok: true, kind: '1d', bars, totalModules: x, text: payload };
}
