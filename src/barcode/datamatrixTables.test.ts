import { describe, it, expect } from 'vitest';
import { SQUARE_SIZES, remainingAfter, smallestSymbolFor } from './datamatrixTables';

describe('DataMatrix square symbol sizes', () => {
  it('lists sizes in ascending capacity', () => {
    for (let i = 1; i < SQUARE_SIZES.length; i++) {
      expect(SQUARE_SIZES[i]!.dataCodewords).toBeGreaterThan(SQUARE_SIZES[i - 1]!.dataCodewords);
    }
  });

  it('gives every size an even module count, as the standard requires', () => {
    for (const s of SQUARE_SIZES) expect(s.size % 2).toBe(0);
  });

  it('picks the smallest symbol that fits', () => {
    expect(smallestSymbolFor(3)!.size).toBe(10);
    expect(smallestSymbolFor(4)!.size).toBe(12);
    expect(smallestSymbolFor(5)!.size).toBe(12);
    expect(smallestSymbolFor(6)!.size).toBe(14);
    expect(smallestSymbolFor(44)!.size).toBe(26);
  });

  it('counts the room left in the symbol the next codeword lands in', () => {
    expect(remainingAfter(0)).toBe(3);
    expect(remainingAfter(1)).toBe(2);
    expect(remainingAfter(2)).toBe(1);
    expect(remainingAfter(3)).toBe(2); // 10x10 is full; 12x12 holds 5
    expect(remainingAfter(1557)).toBe(1);
    expect(remainingAfter(1558)).toBe(Infinity);
  });

  it('returns null when nothing holds the payload', () => {
    expect(smallestSymbolFor(99999)).toBeNull();
  });

  // The four tests above check shape, not content: a mistyped capacity passes
  // all of them and yields a symbol that scans as nothing. These two pin the
  // rows against arithmetic the standard's geometry forces, so a typo in any
  // one field has to be matched by a compensating typo in another to survive.
  it('spends the whole mapping matrix on codewords', () => {
    for (const s of SQUARE_SIZES) {
      // The mapping matrix is the symbol minus each region's 2-module
      // finder/clock border; every one of its modules is a codeword bit,
      // save the unused 2x2 corner that appears when its area isn't a
      // multiple of 8 (10x10, 14x14, 18x18 and 22x22 mapping matrices).
      const mapping = s.region * s.regions;
      const area = mapping * mapping;
      expect(Math.floor(area / 8) - s.eccCodewords).toBe(s.dataCodewords);
      expect(area % 8 === 0 || area % 8 === 4).toBe(true);
    }
  });

  it('tiles each symbol out of bordered regions', () => {
    for (const s of SQUARE_SIZES) {
      expect(s.regions * (s.region + 2)).toBe(s.size);
      // Blocks divide the ECC codewords evenly — the generator polynomial is
      // chosen by eccCodewords/blocks, so a row where they don't is unusable.
      expect(s.eccCodewords % s.blocks).toBe(0);
    }
  });
});
