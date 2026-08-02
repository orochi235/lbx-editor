/**
 * Reed-Solomon over GF(2^8) for DataMatrix ECC200.
 *
 * The primitive polynomial is 0x12D (x^8 + x^5 + x^3 + x^2 + 1), which is
 * ISO/IEC 16022's, and NOT the 0x11D that QR and most "GF(256)" snippets use —
 * the two fields disagree on nearly every product, so a 0x11D table produces
 * ECC codewords no DataMatrix reader accepts. The test pins this to the
 * standard's own Annex O worked example, which only reproduces under 0x12D.
 *
 * PDF417's codeword arithmetic is mod 929 rather than in this field and lives
 * in `pdf417.ts`; what it borrows from here is nothing. This module is kept
 * separate only because field arithmetic is worth testing on its own.
 *
 * The log/antilog tables below assume 2 generates the multiplicative group.
 * That holds for 0x12D (and 0x11D) but not for every irreducible polynomial —
 * AES's 0x11B, for one, gives 2 an order of 51 — so this construction is not
 * transplantable to another field without rechecking that.
 */

const PRIMITIVE = 0x12d;

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= PRIMITIVE;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]!;
}

export function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return EXP[LOG[a]! + LOG[b]!]!;
}

export function gfPow(a: number, n: number): number {
  if (n === 0) return 1;
  if (a === 0) return 0;
  return EXP[(LOG[a]! * n) % 255]!;
}

/** The monic generator polynomial for `degree` ECC codewords, highest power
 *  first: (x - a^1)(x - a^2)...(x - a^degree). */
export function rsGenerator(degree: number): number[] {
  let poly = [1];
  for (let d = 0; d < degree; d++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let i = 0; i < poly.length; i++) {
      next[i] = (next[i] ?? 0) ^ poly[i]!;
      next[i + 1] = (next[i + 1] ?? 0) ^ gfMul(poly[i]!, EXP[d + 1]!);
    }
    poly = next;
  }
  return poly;
}

/** `count` error-correction codewords for `data`. */
export function rsEncode(data: readonly number[], count: number): number[] {
  const gen = rsGenerator(count);
  const rem = new Array<number>(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem[0]!;
    rem.shift();
    rem.push(0);
    if (factor !== 0) {
      for (let i = 0; i < count; i++) {
        rem[i] = rem[i]! ^ gfMul(gen[i + 1]!, factor);
      }
    }
  }
  return rem;
}
