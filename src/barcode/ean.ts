/**
 * EAN-13, EAN-8, UPC-A and UPC-E.
 *
 * All four are the same machinery: fixed-length digit strings, a mod-10 check
 * digit, and 7-module digit patterns in three alphabets (L, G, R) chosen by a
 * parity table. UPC-A is EAN-13 with a leading zero; UPC-E is a compressed
 * form that expands to a UPC-A for check-digit purposes but has its own
 * parity-only encoding.
 *
 * Tables are cross-checked against bwip-js in ean.test.ts.
 */
import type { EncodeResult } from './types';

export type EanProtocol = 'EAN13' | 'EAN8' | 'UPCA' | 'UPCE';

/** Left-hand odd-parity patterns, digits 0-9. */
const L = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
/** Left-hand even-parity patterns. */
const G = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
/** Right-hand patterns — the complement of L. */
const R = L.map((p) => p.replace(/[01]/g, (b) => (b === '0' ? '1' : '0')));

/** Which of EAN-13's six left digits use even parity, indexed by first digit. */
const EAN13_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

/** UPC-E parity for number system 0, indexed by check digit. Number system 1
 *  uses the inverse. 'G' is even parity here. */
const UPCE_PARITY = [
  'GGGLLL', 'GGLGLL', 'GGLLGL', 'GGLLLG', 'GLGGLL',
  'GLLGGL', 'GLLLGG', 'GLGLGL', 'GLGLLG', 'GLLGLG',
];

/** Total digits including the check digit. */
const LENGTHS: Record<EanProtocol, number> = { EAN13: 13, EAN8: 8, UPCA: 12, UPCE: 8 };

/**
 * The mod-10 check digit for a code stem (everything but the check digit).
 * Weights alternate 3,1 from the right — the same rule for every member of
 * the family, once you count from the right end.
 */
export function eanCheckDigit(stem: string): number {
  let sum = 0;
  for (let i = 0; i < stem.length; i++) {
    const digit = Number(stem[stem.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** Expand a UPC-E body to its UPC-A equivalent (11 digits, no check digit). */
function expandUpce(numberSystem: string, body: string): string {
  const [d1, d2, d3, d4, d5, d6] = body;
  switch (d6) {
    case '0': case '1': case '2':
      return `${numberSystem}${d1}${d2}${d6}0000${d3}${d4}${d5}`;
    case '3':
      return `${numberSystem}${d1}${d2}${d3}00000${d4}${d5}`;
    case '4':
      return `${numberSystem}${d1}${d2}${d3}${d4}00000${d5}`;
    default:
      return `${numberSystem}${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  }
}

interface EanOptions {
  /** Left-pad a short payload with zeros instead of rejecting it. */
  zeroFill: boolean;
}

export function encodeEan(data: string, protocol: EanProtocol, opts: EanOptions): EncodeResult {
  const total = LENGTHS[protocol];
  let digits = data.trim();

  if (!/^\d*$/.test(digits)) {
    return { ok: false, reason: 'invalid', detail: `${protocol} takes digits only` };
  }
  if (opts.zeroFill && digits.length < total - 1) {
    digits = digits.padStart(total - 1, '0');
  }

  // Accept the code with or without its check digit.
  if (digits.length === total - 1) {
    digits += String(checkDigitFor(digits, protocol));
  } else if (digits.length === total) {
    const expected = checkDigitFor(digits.slice(0, -1), protocol);
    if (Number(digits[total - 1]) !== expected) {
      return {
        ok: false,
        reason: 'invalid',
        detail: `${protocol} check digit should be ${expected}, not ${digits[total - 1]}`,
      };
    }
  } else {
    return {
      ok: false,
      reason: 'invalid',
      detail: `${protocol} needs ${total - 1} or ${total} digits, got ${digits.length}`,
    };
  }

  const modules = protocol === 'UPCE' ? upceModules(digits) : linearModules(digits, protocol);
  return { ok: true, ...barsFromModules(modules), text: digits };
}

/** The check digit rule differs only in what stem it's computed over. */
function checkDigitFor(stem: string, protocol: EanProtocol): number {
  if (protocol !== 'UPCE') return eanCheckDigit(stem);
  // UPC-E's check digit belongs to its expanded UPC-A.
  return eanCheckDigit(expandUpce(stem[0]!, stem.slice(1, 7)));
}

/** EAN-13, EAN-8 and UPC-A share one layout: guard, left half, centre, right
 *  half, guard. UPC-A is EAN-13 with a leading zero. */
function linearModules(digits: string, protocol: EanProtocol): string {
  const full = protocol === 'UPCA' ? `0${digits}` : digits;
  const half = protocol === 'EAN8' ? 4 : 6;

  let out = '101';
  if (protocol === 'EAN8') {
    for (let i = 0; i < half; i++) out += L[Number(full[i])];
  } else {
    const parity = EAN13_PARITY[Number(full[0])]!;
    for (let i = 0; i < half; i++) {
      const digit = Number(full[i + 1]);
      out += parity[i] === 'L' ? L[digit] : G[digit];
    }
  }
  out += '01010';
  const rightStart = protocol === 'EAN8' ? half : half + 1;
  for (let i = 0; i < half; i++) out += R[Number(full[rightStart + i])];
  return `${out}101`;
}

/** UPC-E: guard, six parity-selected digits, a six-module trailing guard. */
function upceModules(digits: string): string {
  const numberSystem = Number(digits[0]);
  const body = digits.slice(1, 7);
  const check = Number(digits[7]);
  const parity = UPCE_PARITY[check]!;

  let out = '101';
  for (let i = 0; i < 6; i++) {
    const digit = Number(body[i]);
    // Number system 1 inverts the whole parity pattern.
    const even = numberSystem === 0 ? parity[i] === 'G' : parity[i] !== 'G';
    out += even ? G[digit] : L[digit];
  }
  return `${out}010101`;
}

/**
 * Module string → bar runs.
 *
 * Bars alone, with no quiet zone: `totalModules` is what the pose is measured
 * against, and the pose means the bars (see `encode.test.ts`). The quiet zone
 * is added outside the pose by `quietZonePt`, uniformly for every 1D
 * symbology.
 */
function barsFromModules(modules: string): { kind: '1d'; bars: Array<{ x: number; width: number }>; totalModules: number } {
  const bars: Array<{ x: number; width: number }> = [];
  let run = 0;
  for (let i = 0; i <= modules.length; i++) {
    if (modules[i] === '1') {
      run++;
    } else if (run > 0) {
      bars.push({ x: i - run, width: run });
      run = 0;
    }
  }
  return { kind: '1d', bars, totalModules: modules.length };
}
