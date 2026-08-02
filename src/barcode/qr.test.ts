import { describe, it, expect } from 'vitest';
import { encodeQr } from './qr';

describe('encodeQr', () => {
  it('produces a square module matrix', () => {
    const sym = encodeQr('https://example.com', {});
    expect(sym.ok).toBe(true);
    if (!sym.ok || sym.kind !== '2d') return;
    expect(sym.rows).toBe(sym.cols);
    expect(sym.modules).toHaveLength(sym.rows);
    expect(sym.modules[0]).toHaveLength(sym.cols);
  });

  it('places the three finder patterns', () => {
    const sym = encodeQr('TEST', {});
    if (!sym.ok || sym.kind !== '2d') throw new Error('expected a 2d symbol');
    const corner = (r0: number, c0: number) => sym.modules[r0]!.slice(c0, c0 + 7).every(Boolean);
    expect(corner(0, 0)).toBe(true); // top-left
    expect(corner(0, sym.cols - 7)).toBe(true); // top-right
    expect(corner(sym.cols - 7, 0)).toBe(true); // bottom-left
    // ...and no finder bottom-right, which is what makes QR orientable.
    expect(corner(sym.cols - 7, sym.cols - 7)).toBe(false);
  });

  it('grows with payload length', () => {
    const short = encodeQr('A', {});
    const long = encodeQr('A'.repeat(200), {});
    if (!short.ok || !long.ok || short.kind !== '2d' || long.kind !== '2d') {
      throw new Error('expected 2d symbols');
    }
    expect(long.cols).toBeGreaterThan(short.cols);
  });

  it('grows with error-correction level at a fixed payload', () => {
    const low = encodeQr('A'.repeat(100), { eccLevel: '7%' });
    const high = encodeQr('A'.repeat(100), { eccLevel: '30%' });
    if (!low.ok || !high.ok || low.kind !== '2d' || high.kind !== '2d') {
      throw new Error('expected 2d symbols');
    }
    expect(high.cols).toBeGreaterThan(low.cols);
  });

  it('rejects a payload too large for any version', () => {
    expect(encodeQr('A'.repeat(10000), {})).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('reports the payload as the scanned text', () => {
    const sym = encodeQr('https://example.com', {});
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(sym.text).toBe('https://example.com');
  });
});
