import { describe, it, expect } from 'vitest';
import { encodeCode128 } from './code128';
import { bitstring, oracle } from './testOracle';

describe('encodeCode128', () => {
  it('matches the reference encoder', () => {
    for (const payload of ['ABC-123', '0123456789', 'Mixed Case 42', ' abc', 'A', '12']) {
      const sym = encodeCode128(payload, { gs1: false });
      expect(sym.ok, payload).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), payload).toBe(oracle('code128', payload));
    }
  });

  it('matches the reference encoder across the printable ASCII range', () => {
    for (let start = 32; start < 127; start += 8) {
      const payload = String.fromCharCode(
        ...Array.from({ length: 8 }, (_, i) => Math.min(126, start + i)),
      );
      const sym = encodeCode128(payload, { gs1: false });
      expect(sym.ok, payload).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), JSON.stringify(payload)).toBe(oracle('code128', payload));
    }
  });

  it('encodes numeric runs in code set C', () => {
    // Twelve digits pack two-per-symbol in C, so the symbol comes out shorter
    // than twelve alphabetic characters in B.
    const numeric = encodeCode128('123456789012', { gs1: false });
    const alpha = encodeCode128('abcdefghijkl', { gs1: false });
    expect(numeric.ok && alpha.ok).toBe(true);
    if (!numeric.ok || !alpha.ok || numeric.kind !== '1d' || alpha.kind !== '1d') return;
    expect(numeric.totalModules).toBeLessThan(alpha.totalModules);
  });

  it('matches the reference encoder for GS1-128', () => {
    const sym = encodeCode128('(01)09501101020917', { gs1: true });
    expect(sym.ok).toBe(true);
    if (!sym.ok || sym.kind !== '1d') return;
    expect(bitstring(sym)).toBe(oracle('gs1-128', '(01)09501101020917'));
  });

  it('rejects characters outside printable ASCII', () => {
    // Latin-1 above 126 would need FNC4 shifting. Refusing beats silently
    // mis-encoding into a label that scans as different text.
    expect(encodeCode128('emoji 🙂', { gs1: false })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(encodeCode128('café', { gs1: false })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(encodeCode128('', { gs1: false })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('reports the payload as the scanned text', () => {
    const sym = encodeCode128('ABC-123', { gs1: false });
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(sym.text).toBe('ABC-123');
  });
});
