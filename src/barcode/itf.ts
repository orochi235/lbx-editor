/**
 * ITF — Interleaved 2 of 5.
 *
 * Digits are encoded in pairs: the first digit's five elements become bars,
 * the second's become the spaces between them, interleaved. Each digit is five
 * elements of which exactly two are wide. Only digits, and only an even count —
 * an odd payload takes a leading zero.
 *
 * Cross-checked against bwip-js in itf.test.ts.
 */
import type { EncodeResult } from './types';
import { eanCheckDigit } from './ean';

/** Element widths per digit: 'n' narrow, 'w' wide — two wide of five. */
const PATTERNS = [
  'nnwwn', 'wnnnw', 'nwnnw', 'wwnnn', 'nnwnw',
  'wnwnn', 'nwwnn', 'nnnww', 'wnnwn', 'nwnwn',
];

export interface ItfOptions {
  /** Wide-element width in narrow modules. */
  ratio: number;
  /** Append a mod-10 check digit (the same rule EAN uses). */
  checkDigit: boolean;
}

export function encodeItf(data: string, opts: ItfOptions): EncodeResult {
  if (!/^\d+$/.test(data)) {
    return { ok: false, reason: 'invalid', detail: 'ITF takes digits only' };
  }

  let digits = data;
  if (opts.checkDigit) digits += String(eanCheckDigit(digits));
  // Pairs, so an odd count gets a leading zero rather than a trailing one —
  // padding on the right would change the value.
  if (digits.length % 2 === 1) digits = `0${digits}`;

  const bars: Array<{ x: number; width: number }> = [];
  let x = 0;
  const push = (width: number, dark: boolean) => {
    if (dark) bars.push({ x, width });
    x += width;
  };

  // Start guard: narrow bar, narrow space, narrow bar, narrow space.
  for (let i = 0; i < 4; i++) push(1, i % 2 === 0);

  for (let i = 0; i < digits.length; i += 2) {
    const barPattern = PATTERNS[Number(digits[i])]!;
    const spacePattern = PATTERNS[Number(digits[i + 1])]!;
    for (let e = 0; e < 5; e++) {
      push(barPattern[e] === 'w' ? opts.ratio : 1, true);
      push(spacePattern[e] === 'w' ? opts.ratio : 1, false);
    }
  }

  // Stop guard: wide bar, narrow space, narrow bar.
  push(opts.ratio, true);
  push(1, false);
  push(1, true);

  return { ok: true, kind: '1d', bars, totalModules: x, text: digits };
}
