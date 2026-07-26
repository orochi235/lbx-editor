/**
 * Test-only cross-check against bwip-js's encoder.
 *
 * A barcode with a wrong check digit or a transposed pattern looks perfectly
 * fine on screen and prints unscannable, and hand-transcribed symbology tables
 * are exactly where that error enters. So every encoder here is diffed against
 * an independent implementation rather than against patterns typed from memory.
 *
 * bwip-js is a devDependency — nothing in this module ships to the browser.
 */
// The `bwip-js/node` subpath, not the root: the root's conditional exports are
// gated on `browser`/`node` conditions this tsconfig ("moduleResolution":
// "bundler") doesn't supply, so it resolves to nothing. This helper only ever
// runs under vitest.
import bwipjs from 'bwip-js/node';
import type { Symbol1D } from './types';

/** Our symbol as a flat module bitstring, quiet zones trimmed. */
export function bitstring(sym: Symbol1D): string {
  const bits = new Array<string>(sym.totalModules).fill('0');
  for (const bar of sym.bars) {
    for (let i = 0; i < bar.width; i++) bits[bar.x + i] = '1';
  }
  return bits.join('').replace(/^0+|0+$/g, '');
}

/**
 * bwip-js's raw encoding as the same bitstring. `sbs` is the symbol's
 * alternating run lengths starting with a bar, so even indices are dark.
 */
export function oracle(bcid: string, text: string, opts: Record<string, unknown> = {}): string {
  const [enc] = bwipjs.raw(bcid, text, opts as never) as Array<{ sbs: number[] }>;
  let bits = '';
  enc!.sbs.forEach((run, i) => {
    bits += (i % 2 === 0 ? '1' : '0').repeat(run);
  });
  return bits.replace(/^0+|0+$/g, '');
}
