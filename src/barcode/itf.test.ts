import { describe, it, expect } from 'vitest';
import { encodeItf } from './itf';
import { bitstring, oracle } from './testOracle';

describe('encodeItf', () => {
  it('matches the reference encoder', () => {
    for (const payload of ['1234', '0123456789', '00012345678905', '12']) {
      const sym = encodeItf(payload, { ratio: 2, checkDigit: false });
      expect(sym.ok, payload).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), payload).toBe(oracle('interleaved2of5', payload));
    }
  });

  it('pads an odd-length payload with a leading zero', () => {
    // ITF encodes digits in pairs, so an odd count needs a leading zero — and
    // the padding must be visible in the text a scanner reads back.
    const sym = encodeItf('123', { ratio: 2, checkDigit: false });
    expect(sym.ok).toBe(true);
    if (!sym.ok || sym.kind !== '1d') return;
    expect(sym.text).toBe('0123');
    expect(bitstring(sym)).toBe(oracle('interleaved2of5', '0123'));
  });

  it('appends a mod-10 check digit when asked', () => {
    const sym = encodeItf('1234567890', { ratio: 2, checkDigit: true });
    expect(sym.ok).toBe(true);
    if (!sym.ok || sym.kind !== '1d') return;
    // 11 digits with the check digit, so it pads to 12.
    expect(sym.text).toHaveLength(12);
    expect(bitstring(sym)).toBe(oracle('interleaved2of5', sym.text));
  });

  it('rejects non-digits', () => {
    expect(encodeItf('12A4', { ratio: 2, checkDigit: false }))
      .toMatchObject({ ok: false, reason: 'invalid' });
    expect(encodeItf('', { ratio: 2, checkDigit: false })).toMatchObject({ ok: false });
  });
});
