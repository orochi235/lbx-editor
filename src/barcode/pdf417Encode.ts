/**
 * PDF417 byte compaction and error correction.
 *
 * Byte compaction only. PDF417 also has Text and Numeric modes, which reach
 * roughly two characters per codeword against Byte's ~1.2 codewords per byte —
 * pure density, at the cost of a mode-switching surface where PDF417
 * implementations characteristically go wrong. Byte encodes any payload and
 * produces a fully valid symbol, and density only matters once a real payload
 * proves too wide for the tape.
 *
 * The error correction is Reed-Solomon over GF(929) — a prime field, unlike
 * DataMatrix's GF(2^8), so none of `reedSolomon.ts` applies here. Its
 * primitive element is 3.
 */

const MODULUS = 929;

/** Byte-compaction latch. */
const LATCH_BYTE = 901;

/**
 * The alternate byte-compaction latch, for a byte count that divides by six.
 * The two latches encode the same codewords; what differs is what a decoder
 * does with the tail. Under 901 a trailing partial group is read back as one
 * literal byte per codeword, so a payload whose length is an exact multiple
 * of six — which leaves no partial group — has to say so up front. BWIPP
 * picks between them on exactly that condition (`barlen 6 mod 0 eq {924}
 * {901} ifelse`), and a symbol latched 901 on a multiple of six decodes to
 * the wrong bytes while looking entirely well-formed.
 */
const LATCH_BYTE_SIX = 924;

/** Codewords for `data` under byte compaction, including the opening latch. */
export function byteCompaction(data: string): number[] {
  const bytes = new TextEncoder().encode(data);
  const out: number[] = [bytes.length % 6 === 0 ? LATCH_BYTE_SIX : LATCH_BYTE];

  let i = 0;
  while (i + 6 <= bytes.length) {
    // Six bytes as one big-endian integer, re-expressed in base 900.
    let value = 0n;
    for (let k = 0; k < 6; k++) value = value * 256n + BigInt(bytes[i + k]!);
    const group: number[] = [];
    for (let k = 0; k < 5; k++) {
      group.unshift(Number(value % 900n));
      value /= 900n;
    }
    out.push(...group);
    i += 6;
  }

  // A trailing partial group stays one codeword per byte.
  for (; i < bytes.length; i++) out.push(bytes[i]!);

  return out;
}

/**
 * ECC codewords for a data length, per the standard's recommended error
 * correction level: level 2 up to 40 codewords, 3 to 160, 4 to 320, 5 beyond.
 * Level n carries 2^(n+1) ECC codewords, so that reads 8, 16, 32, 64.
 *
 * `dataLength` is the encoded payload alone — not the symbol length
 * descriptor that precedes it, nor the 900 padding that follows. A layout
 * pass may raise the level further to fill a row it would otherwise pad;
 * this is the floor.
 */
export function eccCountFor(dataLength: number): number {
  const level =
    dataLength <= 40 ? 2 : dataLength <= 160 ? 3 : dataLength <= 320 ? 4 : 5;
  return 2 ** (level + 1);
}

/**
 * `count` Reed-Solomon codewords over GF(929) for `data`, which must be the
 * whole codeword block the symbol carries — length descriptor and padding
 * included.
 *
 * A streaming LFSR: the register holds the running remainder, and each data
 * codeword shifts it once. The negation the ECC codewords need is folded into
 * the generator's coefficients rather than applied as a pass at the end, so
 * the register's final contents are the answer in order.
 */
export function pdf417Ecc(data: readonly number[], count: number): number[] {
  const gen = generatorPoly(count);
  const reg = new Array<number>(count).fill(0);

  for (const cw of data) {
    const feedback = (cw - reg[0]! + MODULUS) % MODULUS;
    for (let j = 0; j < count - 1; j++) {
      reg[j] = (reg[j + 1]! + gen[count - 1 - j]! * feedback) % MODULUS;
    }
    reg[count - 1] = (gen[0]! * feedback) % MODULUS;
  }

  return reg;
}

/**
 * The generator polynomial for `degree` ECC codewords, low-order coefficient
 * first, with the monic leading term dropped — the LFSR never needs it.
 *
 * The product is built as ∏(x + 3^i), whose coefficient of x^j is the
 * elementary symmetric polynomial e_(degree-j). The wanted ∏(x - 3^i) differs
 * from it by (-1)^(degree-j), so negating every other coefficient down from
 * degree-1 converts one into the other.
 */
function generatorPoly(degree: number): number[] {
  const coeffs = new Array<number>(degree + 1).fill(0);
  coeffs[0] = 1;

  let root = 1;
  for (let i = 1; i <= degree; i++) {
    coeffs[i] = coeffs[i - 1]!;
    root = (root * 3) % MODULUS;
    for (let j = i - 1; j >= 1; j--) {
      coeffs[j] = (coeffs[j]! * root + coeffs[j - 1]!) % MODULUS;
    }
    coeffs[0] = (coeffs[0]! * root) % MODULUS;
  }

  const out = coeffs.slice(0, degree);
  for (let i = degree - 1; i >= 0; i -= 2) out[i] = (MODULUS - out[i]!) % MODULUS;
  return out;
}
