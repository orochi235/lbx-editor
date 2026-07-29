import { describe, it, expect } from 'vitest';
import {
  barcodeRects,
  barcodeBackgroundRect,
  HUMAN_READABLE_HEIGHT_PT,
  QUIET_ZONE_MODULES_1D,
  QUIET_ZONE_MODULES_2D,
} from './geometry';
import type { Symbol1D, Symbol2D } from './types';

const oneD: Symbol1D = {
  kind: '1d',
  bars: [{ x: 0, width: 1 }, { x: 2, width: 2 }],
  totalModules: 10,
  text: 'X',
};

describe('barcodeRects', () => {
  it('scales modules to fill the pose width', () => {
    const rects = barcodeRects(oneD, { x: 0, y: 0, width: 20, height: 10 }, false);
    // 10 modules across 20pt = 2pt per module.
    expect(rects).toEqual([
      { x: 0, y: 0, width: 2, height: 10 },
      { x: 4, y: 0, width: 4, height: 10 },
    ]);
  });

  it('offsets by the pose origin', () => {
    const rects = barcodeRects(oneD, { x: 5, y: 3, width: 20, height: 10 }, false);
    expect(rects[0]).toEqual({ x: 5, y: 3, width: 2, height: 10 });
  });

  it('shortens the bars to make room for human-readable text', () => {
    const rects = barcodeRects(oneD, { x: 0, y: 0, width: 20, height: 10 }, true);
    expect(rects[0]!.height).toBe(10 - HUMAN_READABLE_HEIGHT_PT);
  });

  it('never gives bars a negative height when the pose is shorter than the text band', () => {
    const rects = barcodeRects(oneD, { x: 0, y: 0, width: 20, height: 4 }, true);
    expect(rects[0]!.height).toBe(0);
  });

  it('draws a 2d symbol as a centered square', () => {
    const twoD: Symbol2D = {
      kind: '2d',
      size: 2,
      modules: [[true, false], [false, true]],
      text: 'X',
    };
    const rects = barcodeRects(twoD, { x: 0, y: 0, width: 20, height: 10 }, false);
    // Square side = min(20, 10) = 10, centered horizontally at x=5, module = 5pt.
    expect(rects).toEqual([
      { x: 5, y: 0, width: 5, height: 5 },
      { x: 10, y: 5, width: 5, height: 5 },
    ]);
  });

  it('ignores the human-readable band for 2d symbols', () => {
    const twoD: Symbol2D = { kind: '2d', size: 1, modules: [[true]], text: 'X' };
    const withText = barcodeRects(twoD, { x: 0, y: 0, width: 10, height: 10 }, true);
    const without = barcodeRects(twoD, { x: 0, y: 0, width: 10, height: 10 }, false);
    expect(withText).toEqual(without);
  });
});

describe('barcodeBackgroundRect', () => {
  it('inflates the pose by the quiet zone on all four sides', () => {
    // oneD is 10 modules across a 20pt pose, so a module is 2pt and the
    // quiet zone is 10 * 2 = 20pt.
    const pose = { x: 5, y: 3, width: 20, height: 10 };
    const quiet = QUIET_ZONE_MODULES_1D * 2;

    expect(barcodeBackgroundRect(oneD, pose)).toEqual({
      x: pose.x - quiet,
      y: pose.y - quiet,
      width: pose.width + quiet * 2,
      height: pose.height + quiet * 2,
    });
  });

  it('uses the tighter 2d quiet zone', () => {
    const twoD: Symbol2D = {
      kind: '2d',
      size: 2,
      modules: [[true, false], [false, true]],
      text: 'X',
    };
    // Square side = min(20, 10) = 10 across 2 modules, so a module is 5pt.
    const pose = { x: 0, y: 0, width: 20, height: 10 };
    const quiet = QUIET_ZONE_MODULES_2D * 5;

    expect(barcodeBackgroundRect(twoD, pose)).toEqual({
      x: -quiet,
      y: -quiet,
      width: 20 + quiet * 2,
      height: 10 + quiet * 2,
    });
  });
});
