import { describe, it, expect } from 'vitest';
import { encodeEan, eanCheckDigit } from './ean';
import { bitstring, oracle } from './testOracle';

describe('eanCheckDigit', () => {
  it('computes the published check digit', () => {
    // GS1's own worked example, plus two widely-published sample codes.
    expect(eanCheckDigit('629104150021')).toBe(3);
    expect(eanCheckDigit('590123412345')).toBe(7);
    expect(eanCheckDigit('9638507')).toBe(4);
  });
});

describe('encodeEan', () => {
  it('matches the reference encoder', () => {
    const cases: Array<[Parameters<typeof encodeEan>[1], string, string]> = [
      ['EAN13', '5901234123457', 'ean13'],
      ['EAN8', '96385074', 'ean8'],
      ['UPCA', '036000291452', 'upca'],
      ['UPCE', '01234565', 'upce'],
    ];
    for (const [protocol, payload, bcid] of cases) {
      const sym = encodeEan(payload, protocol, { zeroFill: false });
      expect(sym.ok, `${protocol} ${payload}`).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), protocol).toBe(oracle(bcid, payload));
    }
  });

  it('matches the reference encoder across a spread of EAN-13 payloads', () => {
    for (const stem of ['400638133393', '123456789012', '978014300723', '501234567890']) {
      const full = stem + String(eanCheckDigit(stem));
      const sym = encodeEan(full, 'EAN13', { zeroFill: false });
      expect(sym.ok, full).toBe(true);
      if (!sym.ok || sym.kind !== '1d') return;
      expect(bitstring(sym), full).toBe(oracle('ean13', full));
    }
  });

  it('appends the check digit when the payload omits it', () => {
    const sym = encodeEan('590123412345', 'EAN13', { zeroFill: false });
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(sym.text).toBe('5901234123457');
  });

  it('rejects a wrong check digit', () => {
    expect(encodeEan('5901234123450', 'EAN13', { zeroFill: false }))
      .toMatchObject({ ok: false, reason: 'invalid' });
  });

  it('rejects non-digits and wrong lengths', () => {
    expect(encodeEan('59012341234A', 'EAN13', { zeroFill: false })).toMatchObject({ ok: false });
    expect(encodeEan('123', 'EAN13', { zeroFill: false })).toMatchObject({ ok: false });
  });

  it('left-pads a short payload when zeroFill is on', () => {
    const sym = encodeEan('123', 'EAN13', { zeroFill: true });
    expect(sym.ok).toBe(true);
    if (!sym.ok) return;
    expect(sym.text).toBe('0000000001236');
  });
});
