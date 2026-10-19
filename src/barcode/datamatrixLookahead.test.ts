import { describe, it, expect } from 'vitest';
import { chooseMode } from './datamatrixLookahead';

describe('DataMatrix mode look-ahead', () => {
  it('stays in ASCII for digits, which it packs two to a codeword', () => {
    expect(chooseMode('0123456789', 0, 'ascii')).toBe('ascii');
    expect(chooseMode('0123456789', 0, 'c40')).toBe('ascii');
  });

  it('stays in ASCII for a payload too short to repay a latch', () => {
    expect(chooseMode('ABC', 0, 'ascii')).toBe('ascii');
    expect(chooseMode('abc', 0, 'ascii')).toBe('ascii');
  });

  it('latches to C40 for a run of uppercase', () => {
    expect(chooseMode('ABCDEFGHIJKL', 0, 'ascii')).toBe('c40');
  });

  it('latches to Text for a run of lowercase', () => {
    expect(chooseMode('abcdefghijkl', 0, 'ascii')).toBe('text');
  });

  it('decides from where it stands, not from the start', () => {
    expect(chooseMode('abcdefghijkl0123456789012345', 12, 'text')).toBe('ascii');
  });

  it('latches to C40 once a latch plus its triplets beat one codeword a character', () => {
    // ASCII spends 6; C40 spends a latch plus two triplets, 5.
    expect(chooseMode('ABCDEF', 0, 'ascii')).toBe('c40');
  });

  // The walk tallies X12 and EDIFACT, which this encoder doesn't write; where
  // one of them would win, it has to fall back to a mode that it does write.
  it('never picks a mode the encoder cannot write', () => {
    // bwip-js encodes this one in EDIFACT, and this one in X12.
    for (const payload of ['A-B-C/D.E-F-G/H.I-J-K/L.M-N', 'ABC*DEF>GHI*JKL>MNO*PQR\rSTU']) {
      expect(['ascii', 'c40', 'text']).toContain(chooseMode(payload, 0, 'ascii'));
    }
  });
});
