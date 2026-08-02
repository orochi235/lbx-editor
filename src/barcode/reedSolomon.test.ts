import { describe, it, expect } from 'vitest';
import { gfMul, gfPow, rsGenerator, rsEncode } from './reedSolomon';

describe('GF(256) arithmetic', () => {
  it('multiplies by zero to zero', () => {
    expect(gfMul(0, 5)).toBe(0);
    expect(gfMul(5, 0)).toBe(0);
  });

  it('has 1 as the multiplicative identity', () => {
    for (const a of [1, 2, 37, 128, 255]) expect(gfMul(a, 1)).toBe(a);
  });

  it('commutes', () => {
    expect(gfMul(0x53, 0xca)).toBe(gfMul(0xca, 0x53));
  });

  it('matches a shift-and-xor product in DataMatrix’s field', () => {
    // Cross-checked against a plain peasant multiply mod 0x12D, so this tests
    // the log tables rather than restating them. NOT the AES 0x57*0x83 = 0xc1
    // identity: that one is the 0x11B field's, where 2 has order 51 and a
    // power-of-2 log table cannot represent the field at all.
    expect(gfMul(0x57, 0x83)).toBe(0x72);
    expect(gfMul(0x02, 0x80)).toBe(0x2d); // the reduction step itself
  });

  it('raises 2 through the generator sequence', () => {
    expect(gfPow(2, 0)).toBe(1);
    expect(gfPow(2, 1)).toBe(2);
    expect(gfPow(2, 8)).toBe(0x2d); // wraps by the 0x12D primitive polynomial
  });
});

describe('Reed-Solomon', () => {
  it('builds a generator polynomial of the requested degree', () => {
    expect(rsGenerator(5)).toHaveLength(6);
    expect(rsGenerator(5)[0]).toBe(1); // monic
  });

  it('produces the ECC codewords DataMatrix 10x10 expects', () => {
    // ISO/IEC 16022 Annex O worked example: data "142 164 186" -> ECC
    // "114 25 5 88 102" for a 10x10 symbol (3 data, 5 ECC).
    expect(rsEncode([142, 164, 186], 5)).toEqual([114, 25, 5, 88, 102]);
  });

  it('returns exactly the requested number of ECC codewords', () => {
    expect(rsEncode([1, 2, 3, 4, 5], 7)).toHaveLength(7);
  });
});
