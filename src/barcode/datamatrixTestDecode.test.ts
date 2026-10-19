import { describe, it, expect } from 'vitest';
import { decodeDataMatrix, readCodewords } from './datamatrixTestDecode';
import { oracle2d } from './testOracle';

// The decoder is only as good as its agreement with an encoder it didn't come
// from: every payload here is bwip-js's symbol, read back to text. Between
// them these make bwip-js use ASCII, C40, Text, X12 and EDIFACT, with shifts
// straddling triplets and each of its end-of-data cases.
const PAYLOADS = [
  '12345678',
  'HELLO WORLD',
  'hello world, this is text mode',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  'ABC*DEF>GHI*JKL>MNO*PQR\rSTU',
  'A-B-C/D.E-F-G/H.I-J-K/L.M-N',
  'AB!CD"EF#GH$IJ%KL&MN',
  'Lorem Ipsum Dolor Sit Amet',
  'abc~def{ghi}jkl|mno`pqr',
  'MIXED case Text 12345 with Numbers 67890',
  'A',
  'AB',
  'ABC',
  'ABCD',
  'ABCDE',
  'ABCDEF',
  'abcdef',
  'abcdefg',
  'ABCDEFG!',
  'SN:ABC-12345/X',
];

describe('the test-only DataMatrix decoder', () => {
  it.each(PAYLOADS)('reads bwip-js\'s symbol for "%s" back to its payload', (payload) => {
    const cws = readCodewords(oracle2d('datamatrix', payload));
    expect(decodeDataMatrix(cws).text).toBe(payload);
  });

  it('counts data codewords up to the first pad', () => {
    // 'A' is one codeword; the rest of a 10x10's three is pad.
    expect(decodeDataMatrix([66, 129, 70])).toEqual({ text: 'A', length: 1 });
  });

  it('reads a C40 triplet', () => {
    // ISO 16022's own example: "AIM" is C40 values 14, 22, 26.
    expect(decodeDataMatrix([230, 91, 11, 254, 129]).text).toBe('AIM');
  });

  it('rejects a shift left dangling at an unlatch', () => {
    // Values 14, 15, 1: "AB" then a Shift 2 with no value before the unlatch.
    const v = 1600 * 14 + 40 * 15 + 1 + 1;
    expect(() => decodeDataMatrix([230, v >> 8, v & 255, 254, 129])).toThrow(/dangling/);
  });
});
