import { describe, it, expect } from 'vitest';
import { maskToRgba } from './printPreview';

describe('maskToRgba', () => {
  it('paints ink dots in the ink color, opaque', () => {
    const rgba = maskToRgba(Uint8Array.from([1, 0, 0, 1]), 2, 2, '#c22525');
    expect(Array.from(rgba.slice(0, 4))).toEqual([0xc2, 0x25, 0x25, 255]);
    expect(Array.from(rgba.slice(12, 16))).toEqual([0xc2, 0x25, 0x25, 255]);
  });

  it('leaves non-ink pixels fully transparent', () => {
    const rgba = maskToRgba(Uint8Array.from([1, 0]), 2, 1, '#000000');
    expect(Array.from(rgba.slice(4, 8))).toEqual([0, 0, 0, 0]);
  });

  it('falls back to black for non-hex ink colors', () => {
    const rgba = maskToRgba(Uint8Array.from([1]), 1, 1, 'red');
    expect(Array.from(rgba.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });
});
