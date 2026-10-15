import { describe, it, expect } from 'vitest';
import { barcodeModulePt, barcodeRequest, encodeBarcode } from './barcode';
import { dotPt, gridAligned, isDitherProtected, snapNodePose, snapToDots } from './dotSnap';
import type { LabelBarcodeData, LabelNodeData } from './label';

const DPI = 180;
const DOT = dotPt(DPI);

const code128: LabelBarcodeData = {
  kind: 'barcode',
  protocol: 'CODE128',
  data: 'SHELF-42',
  barWidth: 0.3,
  barRatio: '1:3',
  humanReadable: false,
  humanReadableAlignment: 'CENTER',
  checkDigit: false,
  zeroFill: false,
  opaqueBackground: true,
};

const qr: LabelBarcodeData = { ...code128, protocol: 'QRCODE', data: 'hello' };

const dotsPerModule = (data: LabelBarcodeData, pose: { width: number; height: number }) => {
  const symbol = encodeBarcode(barcodeRequest(data));
  if (!symbol.ok) throw new Error('did not encode');
  return barcodeModulePt(symbol, pose) / DOT;
};

describe('snapToDots', () => {
  it('rounds to the nearest whole dot', () => {
    expect(snapToDots(1.1, DPI) / DOT).toBeCloseTo(3);
  });

  it('never goes below one dot', () => {
    expect(snapToDots(0.01, DPI)).toBeCloseTo(DOT);
  });
});

describe('snapNodePose', () => {
  it('gives a 1D barcode a whole number of dots per module, height untouched', () => {
    const pose = { x: 10, y: 5, width: 60, height: 20 };
    const snapped = snapNodePose(code128, pose, DPI);
    const k = dotsPerModule(code128, snapped);
    expect(k).toBeCloseTo(Math.round(k), 9);
    expect(snapped.height).toBe(20);
    expect({ x: snapped.x, y: snapped.y }).toEqual({ x: 10, y: 5 });
  });

  it('gives a 2D barcode whole-dot cells and a pose that is exactly the grid', () => {
    const pose = { x: 0, y: 0, width: 30, height: 33 };
    const snapped = snapNodePose(qr, pose, DPI);
    const k = dotsPerModule(qr, snapped);
    expect(k).toBeCloseTo(Math.round(k), 9);
    expect(snapped.width).toBeCloseTo(snapped.height, 9);
  });

  it('keeps the right edge when anchored at max', () => {
    const pose = { x: 10, y: 5, width: 60, height: 20 };
    const snapped = snapNodePose(code128, pose, DPI, { x: 'max', y: 'min' });
    expect(snapped.x + snapped.width).toBeCloseTo(70, 9);
  });

  it('leaves everything else alone', () => {
    const rect: LabelNodeData = {
      kind: 'rect', rounded: false, roundness: 0, strokeStyle: '#000', strokeWidth: 1, fillColor: null,
    };
    const pose = { x: 1.23, y: 4.56, width: 7.89, height: 10.11 };
    expect(snapNodePose(rect, pose, DPI)).toBe(pose);
  });
});

describe('isDitherProtected', () => {
  it('protects barcodes, text and shapes by default, and not images', () => {
    expect(isDitherProtected(code128)).toBe(true);
    expect(isDitherProtected({ kind: 'image', src: '', originalName: '', mimeType: 'image/png' })).toBe(false);
    expect(isDitherProtected({
      kind: 'line', strokeStyle: '#000', strokeWidth: 1, descending: false,
    })).toBe(true);
  });

  it('follows the per-object flag, except on barcodes', () => {
    expect(isDitherProtected({ kind: 'image', src: '', originalName: '', mimeType: 'image/png', noDither: true })).toBe(true);
    expect(isDitherProtected({
      kind: 'line', strokeStyle: '#000', strokeWidth: 1, descending: false, noDither: false,
    })).toBe(false);
  });
});

describe('gridAligned', () => {
  it('moves a pose to the nearest dot, rows counted from the band top', () => {
    const grid = { dpi: DPI, originY: 8.3 };
    const at = gridAligned({ x: 5, y: 12.55, width: 9, height: 9 }, grid);
    expect(at.x / DOT).toBeCloseTo(Math.round(at.x / DOT), 9);
    expect((at.y - grid.originY) / DOT).toBeCloseTo(Math.round((at.y - grid.originY) / DOT), 9);
    expect(Math.abs(at.x - 5)).toBeLessThanOrEqual(DOT / 2 + 1e-9);
    expect({ width: at.width, height: at.height }).toEqual({ width: 9, height: 9 });
  });
});
