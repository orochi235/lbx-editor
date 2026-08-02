import { describe, it, expect } from 'vitest';
import { CODEWORD_PATTERNS, patternFor } from './pdf417Table';

describe('PDF417 codeword table', () => {
  it('has 929 codewords in each of 3 clusters', () => {
    expect(CODEWORD_PATTERNS).toHaveLength(3);
    for (const cluster of CODEWORD_PATTERNS) expect(cluster).toHaveLength(929);
  });

  it('gives every pattern exactly 17 modules', () => {
    for (const cluster of CODEWORD_PATTERNS) {
      for (const pattern of cluster) {
        // A 17-module pattern stored MSB-first occupies bits 16..0, so it is at
        // least 2^16 and under 2^17. Anything else is a truncated or shifted
        // paste.
        expect(pattern).toBeGreaterThanOrEqual(1 << 16);
        expect(pattern).toBeLessThan(1 << 17);
      }
    }
  });

  it('gives every pattern 4 bars and 4 spaces', () => {
    for (const cluster of CODEWORD_PATTERNS) {
      for (const pattern of cluster) {
        expect(runsIn(pattern)).toHaveLength(8);
      }
    }
  });

  it('starts every pattern with a bar and ends with a space', () => {
    // A PDF417 codeword is always 4 bars and 4 spaces, bar first.
    for (const cluster of CODEWORD_PATTERNS) {
      for (const pattern of cluster) {
        expect(pattern & (1 << 16)).toBeTruthy();
        expect(pattern & 1).toBeFalsy();
      }
    }
  });

  it('looks a pattern up by cluster and codeword', () => {
    expect(patternFor(0, 0)).toBe(CODEWORD_PATTERNS[0]![0]);
    expect(patternFor(2, 928)).toBe(CODEWORD_PATTERNS[2]![928]);
  });
});

/** The pattern's alternating bar/space run lengths, MSB first. */
function runsIn(pattern: number): number[] {
  const runs: number[] = [];
  let current = (pattern & (1 << 16)) !== 0;
  let length = 0;
  for (let b = 16; b >= 0; b--) {
    const bit = (pattern & (1 << b)) !== 0;
    if (bit === current) {
      length++;
    } else {
      runs.push(length);
      current = bit;
      length = 1;
    }
  }
  runs.push(length);
  return runs;
}
