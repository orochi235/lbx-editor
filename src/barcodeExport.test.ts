/**
 * The pose is authoritative in the editor, but P-touch redraws a barcode from
 * the size fields in the file — barWidth for 1D, qrCode.cellSize for QR. Export
 * has to restate the pose in those terms or a symbol resized here reopens at
 * its old size.
 */
import { describe, it, expect } from 'vitest';
import { sceneToLbxConfig } from './lbxExport';
import { encodeBarcode, barcodeRequest } from './barcode';
import type { LabelBarcodeData } from './label';

const BASE: LabelBarcodeData = {
  kind: 'barcode',
  protocol: 'CODE128',
  data: '12345678',
  barWidth: 1.2,
  barRatio: '1:3',
  humanReadable: true,
  humanReadableAlignment: 'CENTER',
  checkDigit: false,
  zeroFill: false,
  opaqueBackground: true,
};

function exportOne(data: LabelBarcodeData, pose: { width: number; height: number }) {
  const config = sceneToLbxConfig(
    [{ id: 'n1', pose: { x: 10, y: 8, ...pose }, data }],
    '24mm',
    false,
    200,
    [],
  );
  const obj = config.objects[0];
  if (obj?.type !== 'barcode') throw new Error('expected a barcode object');
  return obj;
}

describe('1D barcode export', () => {
  it('restates the pose width as barWidth', () => {
    const pose = { width: 120, height: 46 };
    const symbol = encodeBarcode(barcodeRequest(BASE));
    if (!symbol.ok || symbol.kind !== '1d') throw new Error('fixture should encode as 1D');

    expect(exportOne(BASE, pose).barWidth).toBeCloseTo(pose.width / symbol.totalModules, 6);
  });

  it('tracks a resize rather than keeping the imported barWidth', () => {
    const narrow = exportOne(BASE, { width: 60, height: 46 }).barWidth!;
    const wide = exportOne(BASE, { width: 240, height: 46 }).barWidth!;
    expect(wide).toBeCloseTo(narrow * 4, 6);
    expect(narrow).not.toBeCloseTo(BASE.barWidth, 6);
  });
});

describe('QR export', () => {
  const qr: LabelBarcodeData = {
    ...BASE,
    protocol: 'QRCODE',
    data: 'https://example.com',
    humanReadable: false,
    qrCode: { eccLevel: '15%', version: 'auto', cellSize: 2 },
  };

  it('restates the pose as cellSize', () => {
    const pose = { width: 46, height: 46 };
    const symbol = encodeBarcode(barcodeRequest(qr));
    if (!symbol.ok || symbol.kind !== '2d') throw new Error('fixture should encode as 2D');

    // Same relationship geometry.ts draws with: the symbol takes the smaller
    // pose dimension and each module is that over the module count.
    expect(exportOne(qr, pose).qrCode?.cellSize).toBeCloseTo(46 / symbol.size, 6);
  });

  it('uses the smaller pose dimension, as the drawn symbol does', () => {
    const symbol = encodeBarcode(barcodeRequest(qr));
    if (!symbol.ok || symbol.kind !== '2d') throw new Error('fixture should encode as 2D');

    const wide = exportOne(qr, { width: 200, height: 46 });
    expect(wide.qrCode?.cellSize).toBeCloseTo(46 / symbol.size, 6);
  });

  it('keeps the other QR fields', () => {
    const out = exportOne(qr, { width: 46, height: 46 });
    expect(out.qrCode?.eccLevel).toBe('15%');
    expect(out.qrCode?.version).toBe('auto');
  });
});

describe('opaque background export', () => {
  it('writes a solid white brush when the background is on', () => {
    const out = exportOne({ ...BASE, opaqueBackground: true }, { width: 120, height: 46 });
    expect(out.brush).toEqual({ style: 'SOLID', color: '#FFFFFF' });
  });

  it('writes a null brush when the background is off', () => {
    const out = exportOne({ ...BASE, opaqueBackground: false }, { width: 120, height: 46 });
    expect(out.brush).toEqual({ style: 'NULL' });
  });
});

describe('unencodable barcode export', () => {
  it('keeps the imported sizes when the payload does not encode', () => {
    const broken: LabelBarcodeData = { ...BASE, protocol: 'EAN13', data: 'nope' };
    // Nothing better to say — the file keeps whatever it came in with.
    expect(exportOne(broken, { width: 120, height: 46 }).barWidth).toBe(BASE.barWidth);
  });
});
