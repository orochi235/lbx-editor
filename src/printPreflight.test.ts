import { describe, it, expect } from 'vitest';
import { tapeMismatchMessage, unrenderableBarcodeMessage } from './printPreflight';

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

describe('unrenderableBarcodeMessage', () => {
  it('blocks when a barcode could not be encoded', () => {
    expect(unrenderableBarcodeMessage(1)).toContain('1 barcode');
  });

  it('pluralizes', () => {
    expect(unrenderableBarcodeMessage(3)).toContain('3 barcodes');
  });

  it('passes when everything encoded', () => {
    expect(unrenderableBarcodeMessage(0)).toBeNull();
  });
});
