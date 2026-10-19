import { describe, it, expect } from 'vitest';
import { encodeDataMatrix } from './datamatrix';
import { SQUARE_SIZES } from './datamatrixTables';
import { oracle2d } from './testOracle';

describe('encodeDataMatrix', () => {
  // One case per payload rather than a loop: a loop stops at the first
  // mismatch, and which payloads diverge is the diagnosis — a single failing
  // payload points at encodation, all five at the placement walk.
  it.each(['12345678', 'HELLO', 'A', 'Test-1234', '0123456789012345'])(
    'matches the reference encoder for %s',
    (payload) => {
      const sym = encodeDataMatrix(payload);
      expect(sym.ok).toBe(true);
      if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
      expect(sym.modules).toEqual(oracle2d('datamatrix', payload));
    },
  );

  // The payloads above only reach 10x10, 12x12 and 14x14. The placement
  // walk's corner cases key off the mapping matrix's side mod 8, past 26x26
  // the symbol splits into regions, and from 52x52 the codewords interleave
  // across Reed-Solomon blocks -- unevenly at 144x144. A pure-digit payload
  // keeps both encoders in ASCII, so this fills every square size exactly.
  it.each(SQUARE_SIZES.map((s) => s.size).filter((n) => n > 10))(
    'matches the reference encoder at size %i',
    (size) => {
      const dataCodewords = SQUARE_SIZES.find((s) => s.size === size)!.dataCodewords;
      const payload = Array.from({ length: dataCodewords * 2 }, (_, i) => String(i % 10)).join('');
      const sym = encodeDataMatrix(payload);
      if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
      expect(sym.cols).toBe(size);
      expect(sym.modules).toEqual(oracle2d('datamatrix', payload));
    },
  );

  // A full symbol is all data; a part-full one also interleaves pad.
  it.each([52, 104, 144])('matches the reference encoder for a part-full size %i', (size) => {
    const i = SQUARE_SIZES.findIndex((s) => s.size === size);
    const codewords = SQUARE_SIZES[i - 1]!.dataCodewords + 3;
    const payload = Array.from({ length: codewords * 2 }, (_, k) => String((k * 7) % 10)).join('');
    const sym = encodeDataMatrix(payload);
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.cols).toBe(size);
    expect(sym.modules).toEqual(oracle2d('datamatrix', payload));
  });

  it('reports a square grid with square cells', () => {
    const sym = encodeDataMatrix('12345678');
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.cols).toBe(sym.rows);
    expect(sym.rowHeightModules).toBe(1);
  });

  it('asks for the 1-module quiet zone the standard specifies', () => {
    const sym = encodeDataMatrix('12345678');
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
    expect(sym.quiet).toEqual({ left: 1, right: 1, top: 1, bottom: 1 });
  });

  // The corner modules are written more than once by the finder pattern's
  // loop, so their final value depends on the order of those writes. Pinned
  // here because a corner error passes on one size and fails on another.
  it('closes the finder pattern at every corner', () => {
    for (const payload of ['A', '12345678', 'Test-1234']) {
      const sym = encodeDataMatrix(payload);
      if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2D symbol');
      const n = sym.rows;
      expect([
        sym.modules[0]![0], // top-left: the L's corner
        sym.modules[n - 1]![0], // bottom-left: the L
        sym.modules[n - 1]![n - 1], // bottom-right: the L meets the clock
        sym.modules[0]![n - 1], // top-right: both clock tracks start light
      ]).toEqual([true, true, true, false]);
    }
  });

  it('grows the symbol as the payload grows', () => {
    const small = encodeDataMatrix('1');
    const large = encodeDataMatrix('0123456789012345678901234567890123456789');
    if (!small.ok || small.kind !== '2d' || !large.ok || large.kind !== '2d') {
      throw new Error('expected 2D symbols');
    }
    expect(large.cols).toBeGreaterThan(small.cols);
  });

  it('rejects an empty payload', () => {
    expect(encodeDataMatrix('')).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects a payload no square symbol can hold', () => {
    const result = encodeDataMatrix('0'.repeat(4000));
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (result.ok) return;
    expect(result.detail).toMatch(/too long|does not fit/i);
  });

  it('fails closed one codeword past the largest symbol', () => {
    expect(encodeDataMatrix('0'.repeat(1558 * 2)).ok).toBe(true);
    const result = encodeDataMatrix('0'.repeat(1559 * 2));
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    if (result.ok) return;
    expect(result.detail).toMatch(/too long/i);
  });

  it('rejects a codepoint ASCII encodation cannot carry', () => {
    const result = encodeDataMatrix('café €');
    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('reports the payload as the scanned text', () => {
    const sym = encodeDataMatrix('12345678');
    if (!sym.ok) throw new Error('expected success');
    expect(sym.text).toBe('12345678');
  });
});
