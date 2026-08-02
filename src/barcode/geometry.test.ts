import { describe, it, expect } from 'vitest';
import {
  barcodeRects,
  barcodeBackgroundRect,
  barcodeModulePt,
  HUMAN_READABLE_HEIGHT_PT,
} from './geometry';
import { horizontalQuiet, uniformQuiet } from './types';
import type { Symbol1D, Symbol2D } from './types';

const oneD: Symbol1D = {
  kind: '1d',
  bars: [{ x: 0, width: 1 }, { x: 2, width: 2 }],
  totalModules: 10,
  quiet: horizontalQuiet(10, 10),
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
      cols: 2,
      rows: 2,
      rowHeightModules: 1,
      modules: [[true, false], [false, true]],
      quiet: uniformQuiet(4),
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
    const twoD: Symbol2D = {
      kind: '2d',
      cols: 1,
      rows: 1,
      rowHeightModules: 1,
      modules: [[true]],
      quiet: uniformQuiet(4),
      text: 'X',
    };
    const withText = barcodeRects(twoD, { x: 0, y: 0, width: 10, height: 10 }, true);
    const without = barcodeRects(twoD, { x: 0, y: 0, width: 10, height: 10 }, false);
    expect(withText).toEqual(without);
  });
});

describe('barcodeBackgroundRect', () => {
  it('inflates the pose by the quiet zone to the left and right of the bars', () => {
    // oneD is 10 modules across a 20pt pose, so a module is 2pt and the
    // quiet zone is 10 * 2 = 20pt. A 1D symbol asks for no vertical margin.
    const pose = { x: 5, y: 3, width: 20, height: 10 };
    const quiet = oneD.quiet.left * 2;

    expect(barcodeBackgroundRect(oneD, pose)).toEqual({
      x: pose.x - quiet,
      y: pose.y,
      width: pose.width + quiet * 2,
      height: pose.height,
    });
  });

  it('uses the tighter 2d quiet zone', () => {
    const twoD: Symbol2D = {
      kind: '2d',
      cols: 2,
      rows: 2,
      rowHeightModules: 1,
      modules: [[true, false], [false, true]],
      quiet: uniformQuiet(4),
      text: 'X',
    };
    // Square side = min(20, 10) = 10 across 2 modules, so a module is 5pt.
    const pose = { x: 0, y: 0, width: 20, height: 10 };
    const quiet = twoD.quiet.left * 5;

    expect(barcodeBackgroundRect(twoD, pose)).toEqual({
      x: -quiet,
      y: -quiet,
      width: 20 + quiet * 2,
      height: 10 + quiet * 2,
    });
  });
});

describe('non-square 2D symbols', () => {
  const wide = {
    kind: '2d' as const,
    cols: 100,
    rows: 10,
    rowHeightModules: 3,
    modules: Array.from({ length: 10 }, () => Array.from({ length: 100 }, () => true)),
    quiet: { left: 2, right: 2, top: 2, bottom: 2 },
    text: '',
  };

  it('sizes the module so the whole grid fits, rows included', () => {
    // 100 cols and 10 rows of 3 modules each = 30 module-heights.
    // A 300x300 pose fits 3pt per module across, 10pt down -> the smaller wins.
    expect(barcodeModulePt(wide, { width: 300, height: 300 })).toBe(3);
  });

  it('draws cells rowHeightModules tall', () => {
    const rects = barcodeRects(wide, { x: 0, y: 0, width: 300, height: 300 }, false);
    expect(rects[0]!.width).toBe(3);
    expect(rects[0]!.height).toBe(9);
  });

  it('centres the grid in the pose rather than stretching it', () => {
    const rects = barcodeRects(wide, { x: 0, y: 0, width: 300, height: 300 }, false);
    // Grid is 300 wide and 90 tall, so it letterboxes vertically by 105 each side.
    expect(rects[0]!.x).toBe(0);
    expect(rects[0]!.y).toBe(105);
  });
});

describe('square symbols are unchanged by the generalization', () => {
  it('gives a square 2D symbol the same module size as before', () => {
    const square = {
      kind: '2d' as const,
      cols: 21,
      rows: 21,
      rowHeightModules: 1,
      modules: Array.from({ length: 21 }, () => Array.from({ length: 21 }, () => true)),
      quiet: { left: 4, right: 4, top: 4, bottom: 4 },
      text: '',
    };
    // The old formula was min(w, h) / size.
    expect(barcodeModulePt(square, { width: 42, height: 84 })).toBe(2);
  });
});

describe('per-side quiet zones', () => {
  it('gives an asymmetric 1D symbol an asymmetric background', () => {
    const ean = {
      kind: '1d' as const,
      bars: [{ x: 0, width: 1 }],
      totalModules: 95,
      quiet: { left: 11, right: 7, top: 0, bottom: 0 },
      text: '',
    };
    const pose = { x: 100, y: 50, width: 95, height: 40 };
    const rect = barcodeBackgroundRect(ean, pose);
    // One module is 1pt here, so the margins are 11pt and 7pt.
    expect(rect.x).toBe(89);
    expect(rect.width).toBe(95 + 11 + 7);
    // No vertical quiet zone: the background is exactly the pose tall.
    expect(rect.y).toBe(50);
    expect(rect.height).toBe(40);
  });
});
