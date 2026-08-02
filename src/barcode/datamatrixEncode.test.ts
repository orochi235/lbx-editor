import { describe, it, expect } from 'vitest';
import { encodeAscii, padCodewords } from './datamatrixEncode';

describe('DataMatrix ASCII encodation', () => {
  it('encodes a byte as its value plus one', () => {
    expect(encodeAscii('A')).toEqual([66]); // 'A' is 65
  });

  it('packs a digit pair into one codeword', () => {
    // Digit pairs encode as 130 + the two-digit value.
    expect(encodeAscii('42')).toEqual([130 + 42]);
    expect(encodeAscii('00')).toEqual([130]);
    expect(encodeAscii('99')).toEqual([229]);
  });

  it('packs eight digits into four codewords', () => {
    expect(encodeAscii('12345678')).toEqual([130 + 12, 130 + 34, 130 + 56, 130 + 78]);
  });

  it('leaves an odd trailing digit as a single byte', () => {
    expect(encodeAscii('123')).toEqual([130 + 12, 52]); // '3' is 51
  });

  it('rejects a codepoint ASCII encodation cannot carry', () => {
    expect(() => encodeAscii('€')).toThrow(/cannot encode/i);
  });

  it('pads with 129 then the randomized 253-state', () => {
    // 129 is the pad codeword; subsequent pads are randomized by position.
    const padded = padCodewords([66], 3);
    expect(padded).toHaveLength(3);
    expect(padded[0]).toBe(66);
    expect(padded[1]).toBe(129);
    expect(padded[2]).toBeGreaterThanOrEqual(1);
    expect(padded[2]).toBeLessThanOrEqual(254);
  });

  it('leaves an exactly-full codeword list alone', () => {
    expect(padCodewords([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  // The loose range check above would pass for almost any off-by-one in the
  // position convention, and that convention is the only non-obvious thing in
  // this file. Every expectation below is BWIPP's own output, read out of a
  // running bwip-js via its `debugcws` option, not recomputed from the formula
  // the implementation uses.
  it("reproduces BWIPP's pad sequence for a one-codeword payload", () => {
    // bwip-js `{ bcid: 'datamatrix', text: 'A', debugcws: true }` at each
    // forced symbol size. 'A' is 66; the rest is pad.
    expect(padCodewords([66], 3)).toEqual([66, 129, 70]);
    expect(padCodewords([66], 5)).toEqual([66, 129, 70, 220, 115]);
    expect(padCodewords([66], 12)).toEqual([
      66, 129, 70, 220, 115, 11, 161, 56, 206, 101, 251, 147,
    ]);
  });

  it('counts pad position from the start of the codeword sequence', () => {
    // The discriminating case: 'A' and '12345678' put their first pad at
    // different indices, yet BWIPP gives both the same value at each absolute
    // position (index 5 is 11 in both, index 8 is 206 in both). A convention
    // counting from the first pad instead would shift the second sequence.
    const a = padCodewords([66], 22);
    const digits = padCodewords([142, 164, 186, 208], 22);
    expect(a).toEqual([
      66, 129, 70, 220, 115, 11, 161, 56, 206, 101, 251, 147, 42, 192, 87, 237, 133, 28, 178,
      73, 223, 118,
    ]);
    expect(digits).toEqual([
      142, 164, 186, 208, 129, 11, 161, 56, 206, 101, 251, 147, 42, 192, 87, 237, 133, 28, 178,
      73, 223, 118,
    ]);
    expect(digits.slice(5)).toEqual(a.slice(5));
  });

  it('wraps a randomized pad that would exceed 254', () => {
    // Position 3 gives 129 + 195 = 324, which BWIPP wraps to 70 rather than
    // letting it overflow the codeword range. Position 5 wraps too (369 -> 115).
    expect(padCodewords([1], 5)).toEqual([1, 129, 70, 220, 115]);
    expect(padCodewords([1], 5).every((cw) => cw >= 1 && cw <= 254)).toBe(true);
  });
});
