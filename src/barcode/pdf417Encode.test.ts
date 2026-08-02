import { describe, it, expect } from 'vitest';
import { byteCompaction, eccCountFor, pdf417Ecc } from './pdf417Encode';

// Reference values are BWIPP's own, read out of bwip-js by raising its
// `debugcws` / `debugecc` errors: the first is the full codeword array
// (length descriptor, data, padding), the second the ECC codewords it
// derives from them. The payloads below are ones BWIPP itself chooses to
// encode wholly as bytes — a non-ASCII character forces the choice, and its
// UTF-8 bytes are what `byteCompaction` sees too, so the two agree on input.

describe('PDF417 byte compaction', () => {
  it('packs six bytes into five codewords', () => {
    // Byte compaction takes groups of 6 bytes to 5 base-900 codewords.
    expect(byteCompaction('abcdef')).toHaveLength(1 + 5);
  });

  it('carries a remainder group as one codeword per byte', () => {
    // 8 bytes = one group of 6 plus 2 left over.
    expect(byteCompaction('abcdefgh')).toHaveLength(1 + 5 + 2);
  });

  it('latches with 901 when the length is not a multiple of six', () => {
    expect(byteCompaction('abcdefgh')[0]).toBe(901);
    expect(byteCompaction('abcde')[0]).toBe(901);
  });

  it('latches with 924 when the length is a multiple of six', () => {
    // 924 is the standard's alternate byte latch, and BWIPP picks it on
    // exactly this condition: `barlen 6 mod 0 eq {924} {901} ifelse`.
    expect(byteCompaction('abcdef')[0]).toBe(924);
    expect(byteCompaction('abcdefghijkl')[0]).toBe(924);
  });

  it('matches BWIPP on a six-byte payload', () => {
    // 'héllo' is 6 bytes in UTF-8: 104 195 169 108 108 111.
    expect(byteCompaction('héllo')).toEqual([924, 175, 510, 346, 118, 375]);
  });

  it('matches BWIPP when a partial group trails', () => {
    // 7 bytes: the same group, then '!' (33) alone as a literal byte.
    expect(byteCompaction('héllo!')).toEqual([901, 175, 510, 346, 118, 375, 33]);
  });

  it('matches BWIPP across two full groups', () => {
    // 12 bytes: 0xC3 0xBF repeated six times.
    expect(byteCompaction('ÿÿÿÿÿÿ')).toEqual([
      924, 328, 37, 762, 82, 663, 328, 37, 762, 82, 663,
    ]);
  });

  it('matches BWIPP on two groups plus a remainder', () => {
    // 14 bytes: two full groups, then 195 and 191 as literal bytes.
    expect(byteCompaction('ÿÿÿÿÿÿÿ')).toEqual([
      901, 328, 37, 762, 82, 663, 328, 37, 762, 82, 663, 195, 191,
    ]);
  });
});

describe('PDF417 error correction', () => {
  it('sizes the ECC level to the data length', () => {
    // Probed against BWIPP at each boundary: 46/48, 190/192 and 382/384
    // bytes give data lengths of 40/41, 160/161 and 320/321, and BWIPP
    // returns 8/16, 16/32 and 32/64 ECC codewords across them.
    expect(eccCountFor(40)).toBe(8); // level 2 -> 2^3
    expect(eccCountFor(41)).toBe(16); // level 3 -> 2^4
    expect(eccCountFor(160)).toBe(16);
    expect(eccCountFor(161)).toBe(32); // level 4 -> 2^5
    expect(eccCountFor(320)).toBe(32);
    expect(eccCountFor(321)).toBe(64); // level 5 -> 2^6
  });

  it('returns exactly the requested number of ECC codewords', () => {
    expect(pdf417Ecc([1, 2, 3, 4, 5], 8)).toHaveLength(8);
  });

  it('produces every codeword inside the base-929 alphabet', () => {
    for (const cw of pdf417Ecc([100, 200, 300, 400], 16)) {
      expect(cw).toBeGreaterThanOrEqual(0);
      expect(cw).toBeLessThan(929);
    }
  });

  it('matches BWIPP codeword for codeword', () => {
    // Each pair is one `debugcws` array and the `debugecc` array BWIPP
    // derived from it — length descriptor and 900 padding included, since
    // those are data as far as the LFSR is concerned.
    expect(pdf417Ecc([8, 924, 175, 510, 346, 118, 375, 900], 8)).toEqual([
      506, 827, 742, 325, 112, 490, 771, 139,
    ]);
    expect(pdf417Ecc([8, 901, 175, 510, 346, 118, 375, 33], 8)).toEqual([
      161, 881, 146, 364, 17, 466, 389, 573,
    ]);
    expect(
      pdf417Ecc([13, 924, 328, 37, 762, 82, 663, 328, 37, 762, 82, 663, 900], 8),
    ).toEqual([131, 718, 765, 765, 305, 156, 606, 246]);
    expect(
      pdf417Ecc([16, 901, 328, 37, 762, 82, 663, 328, 37, 762, 82, 663, 195, 191, 900, 900], 8),
    ).toEqual([278, 906, 892, 696, 599, 888, 107, 358]);
  });

  it('matches BWIPP on a payload BWIPP gave a longer generator', () => {
    // 48 bytes of ^200.. crosses the 40-codeword line, so BWIPP raises the
    // level and derives 16 ECC codewords over the same 44-codeword block.
    const cws = [
      44, 924, 336, 438, 141, 139, 465, 346, 523, 111, 60, 51, 356, 608, 80, 880, 537, 366, 693,
      50, 801, 123, 376, 778, 20, 721, 609, 386, 862, 890, 642, 195, 397, 47, 860, 562, 681, 407,
      132, 830, 483, 267, 900, 900,
    ];
    expect(pdf417Ecc(cws, 16)).toEqual([
      187, 480, 673, 220, 52, 267, 104, 926, 507, 92, 611, 316, 338, 509, 399, 514,
    ]);
  });
});
