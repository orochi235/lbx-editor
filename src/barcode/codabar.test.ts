import { describe, it, expect } from 'vitest';
import { encodeCodabar } from './codabar';
import { bitstring, oracle } from './testOracle';

describe('encodeCodabar', () => {
  it('matches the reference encoder', () => {
    for (const payload of ['A1234B', 'A123456789B', 'C40156B', 'A-$:/.+B']) {
      const sym = encodeCodabar(payload);
      expect(sym.ok, payload).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), payload).toBe(oracle('rationalizedCodabar', payload));
    }
  });

  it('covers every data character', () => {
    for (const ch of '0123456789-$:/.+') {
      const payload = `A${ch}B`;
      const sym = encodeCodabar(payload);
      expect(sym.ok, ch).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), `char "${ch}"`).toBe(oracle('rationalizedCodabar', payload));
    }
  });

  it('accepts every start/stop guard pair', () => {
    for (const start of 'ABCD') {
      for (const stop of 'ABCD') {
        const payload = `${start}17${stop}`;
        const sym = encodeCodabar(payload);
        expect(sym.ok, payload).toBe(true);
        if (!sym.ok || sym.kind !== '1d') return;
        expect(bitstring(sym), payload).toBe(oracle('rationalizedCodabar', payload));
      }
    }
  });

  it('adds default guards when the payload has none', () => {
    const sym = encodeCodabar('1234');
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(sym.text).toBe('A1234B');
  });

  it('rejects characters outside the Codabar set', () => {
    expect(encodeCodabar('AxyzB')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(encodeCodabar('A')).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
