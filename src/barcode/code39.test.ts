import { describe, it, expect } from 'vitest';
import { encodeCode39 } from './code39';
import { bitstring, oracle } from './testOracle';

describe('encodeCode39', () => {
  it('matches the reference encoder', () => {
    for (const payload of ['A', 'ABC-123', 'HELLO WORLD', '0123456789']) {
      const sym = encodeCode39(payload, { ratio: 3 });
      expect(sym.ok, payload).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), payload).toBe(oracle('code39', payload));
    }
  });

  it('covers the whole alphabet', () => {
    const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%';
    for (const ch of alphabet) {
      const sym = encodeCode39(ch, { ratio: 3 });
      expect(sym.ok, ch).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), `char "${ch}"`).toBe(oracle('code39', ch));
    }
  });

  it('rejects characters outside the Code 39 alphabet', () => {
    // Lowercase is not a rejection case — it uppercases, and `text` reports
    // what actually got encoded. These have no Code 39 representation at all.
    expect(encodeCode39('a@b', { ratio: 3 })).toMatchObject({ ok: false, reason: 'invalid' });
    expect(encodeCode39('#', { ratio: 3 })).toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('honors the narrow:wide ratio', () => {
    const narrow = encodeCode39('A', { ratio: 2 });
    const wide = encodeCode39('A', { ratio: 3 });
    expect(narrow.ok && wide.ok).toBe(true);
    if (!narrow.ok || !wide.ok || narrow.kind !== '1d' || wide.kind !== '1d') return;
    expect(wide.totalModules).toBeGreaterThan(narrow.totalModules);
  });

  it('reports the payload as the scanned text', () => {
    const sym = encodeCode39('abc', { ratio: 3 });
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(sym.text).toBe('ABC');
  });
});
