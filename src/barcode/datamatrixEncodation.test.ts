import { describe, it, expect } from 'vitest';
import { encodeDataMatrix } from './datamatrix';
import { encodeAscii } from './datamatrixEncode';
import { decodeDataMatrix, readCodewords } from './datamatrixTestDecode';
import { oracle2d } from './testOracle';

const C40_LATCH = 230;
const TEXT_LATCH = 239;

function encode(payload: string) {
  const sym = encodeDataMatrix(payload);
  if (!sym.ok || sym.kind !== '2d') throw new Error(`expected a 2D symbol for ${payload}`);
  return sym;
}

describe('DataMatrix C40 and Text encodation', () => {
  // A C40/Text segment can end in any of these ways, and each is a place an
  // encoder writes a symbol that looks right and decodes as something else.
  // Every payload was found to drive its case, and bwip-js encodes it the same
  // way module for module.
  it.each([
    ['ABCDE1', 'a last triplet fills the symbol, so the unlatch is dropped'],
    ['12ABCDEFAB', 'a last pair fills the symbol, padded out with Shift 1'],
    ['12ABCDEAB', 'a lone last character after an explicit unlatch'],
    ['ABCDEFG!A', 'a lone last character in implied ASCII'],
    ['ABCDEAB', 'characters past the last triplet given back to ASCII'],
    ['ABCDEF!A', 'data ends on a triplet boundary and unlatches'],
    ['abcdefg!A', 'Text switches out mid-data'],
    ['HELLO WORLD', 'a C40 run'],
    ['hello world, this is text mode', 'a Text run with a shifted comma'],
    ['Kitchen Spices', 'mixed case in Text'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(12), 'C40 across four data regions'],
  ])('matches the reference encoder for %j: %s', (payload) => {
    const sym = encode(payload);
    const cws = readCodewords(sym.modules);
    expect(cws.some((cw) => cw === C40_LATCH || cw === TEXT_LATCH)).toBe(true);
    expect(sym.modules).toEqual(oracle2d('datamatrix', payload));
  });

  it('packs a run of uppercase smaller than ASCII would', () => {
    const payload = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const cws = readCodewords(encode(payload).modules);
    // A latch, eight triplets, an unlatch and two ASCII characters: 20, not 26.
    expect(decodeDataMatrix(cws).length).toBeLessThan(encodeAscii(payload).length);
  });

  // Random payloads drawn from runs of each character class. Where bwip-js
  // stays in ASCII, C40 and Text, it runs the same look-ahead, so the symbols
  // must match -- unless ours is shorter, which the fall-back to plain ASCII
  // allows. Where bwip-js reaches for X12 or EDIFACT, which this encoder
  // doesn't write, ours may be longer; it must still decode and never lose to
  // ASCII alone.
  describe('on random payloads', () => {
    const payloads = randomPayloads(400, 7);
    const cases = payloads.map((p, n) => [n, p] as const);
    it.each(cases)('payload %i decodes and holds its size', (_, payload) => {
      const sym = encode(payload);
      const ours = decodeDataMatrix(readCodewords(sym.modules));
      expect(ours.text).toBe(payload);
      expect(ours.length).toBeLessThanOrEqual(encodeAscii(payload).length);

      const reference = oracle2d('datamatrix', payload);
      const refCodewords = readCodewords(reference);
      const ref = decodeDataMatrix(refCodewords);
      const refData = refCodewords.slice(0, ref.length);
      if (refData.some((cw) => cw === 238 || cw === 240)) return; // X12 or EDIFACT
      if (ours.length < ref.length) return;
      expect(sym.modules).toEqual(reference);
    });
  });
});

const CLASSES = [
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'abcdefghijklmnopqrstuvwxyz',
  '0123456789',
  ' ',
  '-./:',
  '!@#$%^&*()_+=[]{}|;,<>?~`\'"\\',
  '\r\n\t',
];

/** Seeded (mulberry32), so a failure names the same payload every run. */
function randomPayloads(count: number, seed: number): string[] {
  let state = seed;
  const next = () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const out: string[] = [];
  for (let n = 0; n < count; n++) {
    const length = 1 + Math.floor(next() * 60);
    let s = '';
    while (s.length < length) {
      // Skewed toward the letter and digit classes, as label payloads are.
      const chars = CLASSES[Math.floor(next() ** 1.5 * CLASSES.length)]!;
      const run = 1 + Math.floor(next() * 10);
      for (let k = 0; k < run; k++) s += chars[Math.floor(next() * chars.length)];
    }
    out.push(s.slice(0, length));
  }
  return out;
}
