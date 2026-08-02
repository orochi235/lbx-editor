/**
 * ECC200 ASCII encodation.
 *
 * The one mode this encoder implements. It carries the whole ASCII range and
 * already packs digit pairs two-to-a-codeword, which is where label payloads
 * spend most of their length. C40, Text and Base256 buy density for particular
 * payload shapes at the cost of a mode-switching surface, and a mode-switch bug
 * yields a symbol that encodes the wrong thing while looking entirely correct.
 */

/** Codewords for `data` under ASCII encodation. Throws for a codepoint the
 *  mode cannot carry — the caller turns that into an `invalid` result. */
export function encodeAscii(data: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i]!;
    const next = data[i + 1];
    if (isDigit(ch) && next !== undefined && isDigit(next)) {
      out.push(130 + Number(ch + next));
      i += 2;
      continue;
    }
    const code = ch.codePointAt(0)!;
    if (code > 127) {
      throw new Error(`DataMatrix ASCII encodation cannot encode "${ch}"`);
    }
    out.push(code + 1);
    i += 1;
  }
  return out;
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

/**
 * Pad `codewords` out to `capacity`.
 *
 * The first pad is 129. Every later pad is 129 randomized by its own position,
 * per ISO 16022's 253-state algorithm — a run of identical pads would otherwise
 * produce a large blank region that reads as damage.
 *
 * `position` is the pad's **1-based index in the complete codeword sequence**,
 * data included — not its index within the run of pads. `out.length` at the
 * moment of the push is the 0-based index the value is about to take, so
 * `out.length + 1` is that position. BWIPP writes the same thing as
 * `i 1 add 149 mul 253 mod 1 add 129 add` over a `for` running the 0-based
 * array index from `datlen+1` (`node_modules/bwip-js/barcode.ps`, in the
 * datamatrix encoder's padding block). The test pins BWIPP's actual output for
 * two payloads of different length, which is what distinguishes the two
 * conventions: pads at the same absolute position take the same value however
 * much data precedes them.
 */
export function padCodewords(codewords: readonly number[], capacity: number): number[] {
  const out = [...codewords];
  if (out.length >= capacity) return out.slice(0, capacity);
  out.push(129);
  while (out.length < capacity) {
    const position = out.length + 1;
    const pseudoRandom = ((149 * position) % 253) + 1;
    const value = 129 + pseudoRandom;
    out.push(value <= 254 ? value : value - 254);
  }
  return out;
}
