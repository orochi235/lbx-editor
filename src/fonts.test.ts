import { describe, it, expect } from 'vitest';
import { substituteFontFamily, BUNDLED_FAMILIES } from './fonts';

describe('substituteFontFamily', () => {
  it('passes through bundled families', () => {
    for (const f of BUNDLED_FAMILIES) expect(substituteFontFamily(f)).toBe(f);
  });
  it('maps known .lbx machine fonts', () => {
    expect(substituteFontFamily('Helvetica')).toBe('Inter');
    expect(substituteFontFamily('Arial')).toBe('Inter');
    expect(substituteFontFamily('Helvetica Neue Condensed Bold')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Univers LT Std 57 Cn')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Futura Condensed Medium')).toBe('Barlow Condensed');
  });
  it('heuristic: condensed-looking names go condensed, others default', () => {
    expect(substituteFontFamily('Roboto Condensed')).toBe('Barlow Condensed');
    expect(substituteFontFamily('SomeUnknownCn Font')).toBe('Barlow Condensed');
    expect(substituteFontFamily('Comic Sans MS')).toBe('Inter');
  });
});
