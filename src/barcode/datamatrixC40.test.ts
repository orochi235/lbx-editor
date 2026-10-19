import { describe, it, expect } from 'vitest';
import { ctxValues, packTriplets } from './datamatrixC40';

describe('C40 and Text values', () => {
  it('gives the basic set one value each', () => {
    expect(ctxValues(' ', 'c40')).toEqual([3]);
    expect(ctxValues('0', 'c40')).toEqual([4]);
    expect(ctxValues('9', 'c40')).toEqual([13]);
    expect(ctxValues('A', 'c40')).toEqual([14]);
    expect(ctxValues('Z', 'c40')).toEqual([39]);
    expect(ctxValues('a', 'text')).toEqual([14]);
    expect(ctxValues('z', 'text')).toEqual([39]);
  });

  it('shifts control characters with Shift 1', () => {
    expect(ctxValues('\0', 'c40')).toEqual([0, 0]);
    expect(ctxValues('\r', 'text')).toEqual([0, 13]);
  });

  it('shifts punctuation with Shift 2, in three runs', () => {
    expect(ctxValues('!', 'c40')).toEqual([1, 0]);
    expect(ctxValues('/', 'c40')).toEqual([1, 14]);
    expect(ctxValues(':', 'c40')).toEqual([1, 15]);
    expect(ctxValues('@', 'text')).toEqual([1, 21]);
    expect(ctxValues('[', 'c40')).toEqual([1, 22]);
    expect(ctxValues('_', 'text')).toEqual([1, 26]);
  });

  // Shift 3 is where the two sets differ: each holds the other's case.
  it('shifts the other case with Shift 3', () => {
    expect(ctxValues('`', 'c40')).toEqual([2, 0]);
    expect(ctxValues('a', 'c40')).toEqual([2, 1]);
    expect(ctxValues('z', 'c40')).toEqual([2, 26]);
    expect(ctxValues('A', 'text')).toEqual([2, 1]);
    expect(ctxValues('Z', 'text')).toEqual([2, 26]);
    expect(ctxValues('{', 'text')).toEqual([2, 27]);
    expect(ctxValues('\x7f', 'c40')).toEqual([2, 31]);
  });

  it('packs a triplet into two codewords', () => {
    // ISO 16022's example: "AIM" is 14, 22, 26 -> 1600*14 + 40*22 + 26 + 1.
    expect(packTriplets([14, 22, 26])).toEqual([91, 11]);
    expect(packTriplets([14, 22, 26, 3, 3, 3])).toEqual([91, 11, 19, 60]);
  });
});
