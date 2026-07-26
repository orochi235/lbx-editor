import { describe, it, expect } from 'vitest';
import {
  moduleFitness,
  barcodeModuleDots,
  MIN_RENDERABLE_MODULE_DOTS,
  MIN_RELIABLE_MODULE_DOTS,
} from './scannability';
import type { Symbol1D, Symbol2D } from './types';

const DPI = 180;

const oneD: Symbol1D = {
  kind: '1d',
  bars: [{ x: 0, width: 1 }],
  totalModules: 100,
  text: '12345678',
};

const twoD: Symbol2D = {
  kind: '2d',
  size: 25,
  modules: [],
  text: 'x',
};

describe('barcodeModuleDots', () => {
  it('converts a 1D symbol’s module width to printer dots', () => {
    // 100 modules across 40pt = 0.4pt each = exactly 1 dot at 180dpi.
    expect(barcodeModuleDots(oneD, { width: 40, height: 20 }, DPI)).toBeCloseTo(1, 6);
  });

  it('uses the smaller dimension for a 2D symbol, as the drawing does', () => {
    // 25 modules across 25pt = 1pt each = 2.5 dots at 180dpi.
    expect(barcodeModuleDots(twoD, { width: 200, height: 25 }, DPI)).toBeCloseTo(2.5, 6);
  });
});

describe('moduleFitness', () => {
  it('rejects a module the printhead cannot resolve at all', () => {
    expect(moduleFitness(0.5)).toBe('unrenderable');
    expect(moduleFitness(MIN_RENDERABLE_MODULE_DOTS - 0.01)).toBe('unrenderable');
  });

  it('flags a module that renders but falls under scanner minimums', () => {
    expect(moduleFitness(1)).toBe('marginal');
    expect(moduleFitness(MIN_RELIABLE_MODULE_DOTS - 0.01)).toBe('marginal');
  });

  it('passes a module at or above the reliable floor', () => {
    expect(moduleFitness(MIN_RELIABLE_MODULE_DOTS)).toBe('ok');
    expect(moduleFitness(4)).toBe('ok');
  });

  it('keeps the reliable floor at or above the GS1 minimum X-dimension', () => {
    // GS1 general distribution bottoms out near 0.25mm; retail POS at 0.264mm.
    // Our floor is expressed in dots, so check it clears both in millimetres.
    const mmPerDot = 25.4 / DPI;
    expect(MIN_RELIABLE_MODULE_DOTS * mmPerDot).toBeGreaterThanOrEqual(0.264);
  });
});
