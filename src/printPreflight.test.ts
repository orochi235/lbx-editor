import { describe, it, expect } from 'vitest';
import { tapeMismatchMessage } from './printPreflight';

describe('tapeMismatchMessage', () => {
  it('names both widths on a mismatch', () => {
    const msg = tapeMismatchMessage(24, 12);
    expect(msg).toMatch(/24\s*mm/);
    expect(msg).toMatch(/12\s*mm/);
  });

  it('is null when the loaded tape matches', () => {
    expect(tapeMismatchMessage(12, 12)).toBeNull();
  });

  it('is null when the loaded width is unknown (printer asleep)', () => {
    expect(tapeMismatchMessage(12, null)).toBeNull();
  });

  it('is null when the printer reports no usable width', () => {
    expect(tapeMismatchMessage(12, 0)).toBeNull();
  });
});
