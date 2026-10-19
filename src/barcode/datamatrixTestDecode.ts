/**
 * Test-only DataMatrix reading: codewords back out of a module grid, and data
 * codewords back into text.
 *
 * An encodation bug yields a symbol that looks right and scans as the wrong
 * thing, and where our mode choice differs from bwip-js's a module diff can't
 * say whether both are right. Decoding can. The decoder is deliberately strict:
 * a shift left dangling anywhere but the symbol's last triplet, or a codeword
 * outside the modes it knows, throws rather than being skipped. It reads X12
 * and EDIFACT too, which this encoder never writes, so that bwip-js's symbols
 * can be decoded and their codeword counts compared.
 */
import { SQUARE_SIZES } from './datamatrixTables';
import { placementMap } from './datamatrixPlace';

/** The data codewords of a square symbol, in sequence, pad included. */
export function readCodewords(modules: boolean[][]): number[] {
  const symbol = SQUARE_SIZES.find((s) => s.size === modules.length);
  if (!symbol) throw new Error(`no ${modules.length}x${modules.length} DataMatrix`);
  const step = symbol.region + 2;
  const side = symbol.region * symbol.regions;
  const map = placementMap(side, side);
  const out = new Array<number>(Math.floor((side * side) / 8)).fill(0);
  for (let r = 0; r < side; r++) {
    for (let c = 0; c < side; c++) {
      const cell = map[r]![c];
      if (!cell) continue;
      const gr = Math.floor(r / symbol.region) * step + 1 + (r % symbol.region);
      const gc = Math.floor(c / symbol.region) * step + 1 + (c % symbol.region);
      if (modules[gr]![gc]) out[cell[0]]! |= 1 << (8 - cell[1]);
    }
  }
  return out.slice(0, symbol.dataCodewords);
}

export interface Decoded {
  text: string;
  /** Codewords spent on data: everything before the first pad. */
  length: number;
}

const C40_BASIC = ' 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const TEXT_BASIC = ' 0123456789abcdefghijklmnopqrstuvwxyz';
const X12 = '\r*> 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SHIFT2 = '!"#$%&\'()*+,-./:;<=>?@[\\]^_';

/** Decode a symbol's full data-codeword sequence, pad included. */
export function decodeDataMatrix(cws: readonly number[]): Decoded {
  let text = '';
  let i = 0;
  type Mode = 'ascii' | 'c40' | 'text' | 'x12' | 'edifact';
  let mode: Mode = 'ascii';
  let shift = 0;

  while (i < cws.length) {
    if (mode === 'ascii') {
      const cw = cws[i++]!;
      if (cw >= 1 && cw <= 128) text += String.fromCharCode(cw - 1);
      else if (cw === 129) return { text, length: i - 1 };
      else if (cw >= 130 && cw <= 229) text += String(cw - 130).padStart(2, '0');
      else if (cw === 230) mode = 'c40';
      else if (cw === 239) mode = 'text';
      else if (cw === 238) mode = 'x12';
      else if (cw === 240) mode = 'edifact';
      else throw new Error(`unsupported ASCII codeword ${cw} at ${i - 1}`);
      continue;
    }

    if (mode === 'edifact') {
      // Fewer than three codewords left: the symbol ends in implied ASCII.
      if (cws.length - i <= 2) {
        mode = 'ascii';
        continue;
      }
      let unlatched = false;
      for (let v = 0; v < 4 && !unlatched; v++) {
        const bitPos = v * 6;
        const word = (cws[i]! << 16) | (cws[i + 1]! << 8) | cws[i + 2]!;
        const value = (word >> (18 - bitPos)) & 0x3f;
        if (value === 31) {
          unlatched = true;
          i += Math.ceil((bitPos + 6) / 8);
        } else {
          text += String.fromCharCode(value < 32 ? value + 64 : value);
        }
      }
      if (unlatched) mode = 'ascii';
      else i += 3;
      continue;
    }

    // C40, Text, X12: two codewords per triplet of values. A shift may sit
    // at the end of one triplet and its value open the next.
    if (cws[i] === 254 || cws.length - i === 1) {
      if (shift !== 0) throw new Error('shift left dangling at an unlatch');
      mode = 'ascii';
      if (cws[i] === 254) i++;
      continue;
    }
    const v = cws[i]! * 256 + cws[i + 1]! - 1;
    i += 2;
    for (const value of [Math.floor(v / 1600), Math.floor(v / 40) % 40, v % 40]) {
      if (mode === 'x12') {
        if (value >= X12.length) throw new Error(`bad X12 value ${value}`);
        text += X12[value];
      } else if (shift === 0) {
        if (value <= 2) shift = value + 1;
        else text += (mode === 'c40' ? C40_BASIC : TEXT_BASIC)[value - 3];
      } else {
        text += shifted(shift, value, mode);
        shift = 0;
      }
    }
  }
  // A Shift 1 with nothing after it pads the last triplet of a full symbol.
  if (shift > 1) throw new Error('shift left dangling at the end of the symbol');
  return { text, length: cws.length };
}

function shifted(shift: number, value: number, mode: 'c40' | 'text'): string {
  if (shift === 1) return String.fromCharCode(value);
  if (shift === 2) {
    if (value >= SHIFT2.length) throw new Error(`unsupported Shift 2 value ${value}`);
    return SHIFT2[value]!;
  }
  if (value === 0) return '`';
  if (value <= 26) return String.fromCharCode((mode === 'c40' ? 96 : 64) + value);
  return String.fromCharCode(123 + value - 27);
}
