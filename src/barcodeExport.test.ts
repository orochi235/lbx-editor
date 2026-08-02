/**
 * The pose is authoritative in the editor, but P-touch redraws a barcode from
 * the size fields in the file — barWidth for 1D, and for 2D a cell size living
 * under a different attribute per symbology (qrcodeStyle cellSize,
 * datamatrixStyle cellSize, pdf417Style width). Export has to restate the pose
 * in whichever term applies or a symbol resized here reopens at its old size.
 */
import { describe, it, expect } from 'vitest';
import { sceneToLbxConfig, exportLbx } from './lbxExport';
import { importLbx } from './lbxImport';
import { encodeBarcode, barcodeRequest } from './barcode';
import type { LabelBarcodeData, LabelPose } from './label';

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

  it('agrees with P-touch on a measured EAN-13', () => {
    // From a P-touch Editor-authored file (bil-lbx docs/samples/barcodes.lbx):
    // an EAN-13 at barWidth 0.8pt has a 112.8pt box, of which a fixed 36.8pt
    // is P-touch's own margin — so its 95 bar modules occupy 76pt. Under the
    // `margin="false"` we export, the box is the bars, so a 76pt pose has to
    // come back out as barWidth 0.8 or P-touch redraws the symbol at the wrong
    // size. The relative tests above can't catch this: they'd hold at any
    // module count.
    const ean: LabelBarcodeData = { ...BASE, protocol: 'EAN13', data: '5901234123457' };
    expect(exportOne(ean, { width: 76, height: 46 }).barWidth).toBeCloseTo(0.8, 6);
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
    expect(exportOne(qr, pose).qrCode?.cellSize).toBeCloseTo(46 / symbol.cols, 6);
  });

  it('uses the smaller pose dimension, as the drawn symbol does', () => {
    const symbol = encodeBarcode(barcodeRequest(qr));
    if (!symbol.ok || symbol.kind !== '2d') throw new Error('fixture should encode as 2D');

    const wide = exportOne(qr, { width: 200, height: 46 });
    expect(wide.qrCode?.cellSize).toBeCloseTo(46 / symbol.cols, 6);
  });

  it('keeps the other QR fields', () => {
    const out = exportOne(qr, { width: 46, height: 46 });
    expect(out.qrCode?.eccLevel).toBe('15%');
    expect(out.qrCode?.version).toBe('auto');
  });

  it('hands back a model it cannot draw rather than restating it as 2', () => {
    // We encode Model 2 only, and `qr-model-substituted` says so out loud. The
    // wording promises the file keeps what it came in with, so P-touch draws
    // the Model 1 it was asked for — silently rewriting it to 2 here would
    // make that message a lie and lose the user's setting.
    const model1 = { ...qr, qrCode: { ...qr.qrCode, model: 1 } } as LabelBarcodeData;
    expect(exportOne(model1, { width: 46, height: 46 }).qrCode?.model).toBe(1);
  });
});

describe('2D barcode export', () => {
  const dm: LabelBarcodeData = {
    ...BASE,
    protocol: 'DATAMATRIX',
    data: '12345678',
    humanReadable: false,
  };
  const pdf: LabelBarcodeData = {
    ...BASE,
    protocol: 'PDF417',
    data: '12345678',
    humanReadable: false,
  };

  it('does not stamp a qrcodeStyle onto a DataMatrix', () => {
    // `kind === '2d'` used to mean QR by accident, so a DataMatrix went out
    // with its cell size in a field bil-lbx only writes for a QRCODE — which
    // dropped it, leaving the symbology's own style element unwritten.
    const out = exportOne(dm, { width: 19.2, height: 19.2 });
    expect(out.qrCode).toBeUndefined();
    expect(out.dataMatrix).toBeDefined();
    expect(out.dataMatrix?.model).toBe('square');
  });

  it('does not stamp a qrcodeStyle onto a PDF417', () => {
    const out = exportOne(pdf, { width: 120, height: 40 });
    expect(out.qrCode).toBeUndefined();
    expect(out.pdf417).toBeDefined();
    expect(out.pdf417?.width).toBeGreaterThan(0);
  });

  it('states the PDF417 layout it drew, rather than auto', () => {
    const symbol = encodeBarcode(barcodeRequest(pdf));
    if (!symbol.ok || symbol.kind !== '2d') throw new Error('fixture should encode as 2D');

    const out = exportOne(pdf, { width: 120, height: 40 });
    expect(out.pdf417?.row).toBe(String(symbol.rows));
    // 17 modules per data column, plus start, two row indicators and an
    // 18-module stop: `17 * (columns + 4) + 1`.
    expect(out.pdf417?.column).toBe(String((symbol.cols - 1) / 17 - 4));
    expect(Number(out.pdf417?.column)).toBeGreaterThan(0);
    expect(out.pdf417?.aspect).toBe(symbol.rowHeightModules);
  });

  it('grows the exported box by the 2 modules per side P-touch expects', () => {
    const symbol = encodeBarcode(barcodeRequest(dm));
    if (!symbol.ok || symbol.kind !== '2d') throw new Error('fixture should encode as 2D');
    expect(symbol.cols).toBe(12);

    // 19.2pt over 12 modules is a 1.6pt cell, so the box is 16 modules —
    // 25.6pt — and its origin sits 2 cells up and left of the pose's (10, 8).
    const out = exportOne(dm, { width: 19.2, height: 19.2 });
    expect(out.dataMatrix?.cellSize).toBeCloseTo(1.6, 6);
    expect(out.position.width).toBeCloseTo(25.6, 6);
    expect(out.position.height).toBeCloseTo(25.6, 6);
    expect(out.position.x).toBeCloseTo(6.8, 6);
    expect(out.position.y).toBeCloseTo(4.8, 6);
  });

  it('leaves a 1D box as the bars alone', () => {
    // The 2 modules are a 2D convention; under `margin="false"` a 1D box is
    // the bars, so nothing may be added here.
    const out = exportOne(BASE, { width: 120, height: 46 });
    expect(out.position).toEqual({ x: 10, y: 8, width: 120, height: 46 });
  });
});

describe('2D barcode round-trip', () => {
  /**
   * The regression this all exists for: import converts P-touch's 2D box into
   * our pose by stripping 2 modules a side, so an export that wrote the pose
   * out as the box shrank the symbol by 4 modules on every save-and-reopen.
   * Whole file, both directions, no shortcuts through the geometry helpers.
   */
  async function roundTrip(data: LabelBarcodeData, pose: LabelPose) {
    const bytes = await exportLbx([{ id: 'n1', pose, data }], '24mm', false, 200, []);
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const result = await importLbx(buffer);
    const node = result.nodes[0];
    if (!node || node.data.kind !== 'barcode') throw new Error('expected a barcode node back');
    return node;
  }

  const cases: Array<[string, LabelBarcodeData, LabelPose]> = [
    [
      'QR',
      {
        ...BASE,
        protocol: 'QRCODE',
        data: 'https://example.com',
        humanReadable: false,
        qrCode: { eccLevel: '15%', version: 'auto', cellSize: 2 },
      },
      { x: 10, y: 8, width: 50, height: 50 },
    ],
    [
      'DataMatrix',
      { ...BASE, protocol: 'DATAMATRIX', data: '12345678', humanReadable: false },
      { x: 10, y: 8, width: 19.2, height: 19.2 },
    ],
    [
      'PDF417',
      { ...BASE, protocol: 'PDF417', data: '12345678', humanReadable: false },
      { x: 10, y: 8, width: 120, height: 40 },
    ],
  ];

  for (const [name, data, pose] of cases) {
    it(`brings a ${name} back at the pose it left with`, async () => {
      const node = await roundTrip(data, pose);
      const symbol = encodeBarcode(barcodeRequest(data));
      if (!symbol.ok || symbol.kind !== '2d') throw new Error('fixture should encode as 2D');

      // The symbol takes whichever axis binds, so only that one is pinned by
      // the cell size the file carries; the other keeps its slack.
      expect(node.pose.x).toBeCloseTo(pose.x, 6);
      expect(node.pose.y).toBeCloseTo(pose.y, 6);
      expect(node.pose.width).toBeCloseTo(pose.width, 6);
      expect(node.pose.height).toBeCloseTo(pose.height, 6);
    });
  }

  it('redraws the PDF417 at the shape the file states', async () => {
    const pdf: LabelBarcodeData = {
      ...BASE,
      protocol: 'PDF417',
      data: '12345678',
      humanReadable: false,
    };
    const before = encodeBarcode(barcodeRequest(pdf));
    const node = await roundTrip(pdf, { x: 10, y: 8, width: 120, height: 40 });
    const after = encodeBarcode(barcodeRequest(node.data as LabelBarcodeData));
    if (!before.ok || before.kind !== '2d') throw new Error('fixture should encode as 2D');
    if (!after.ok || after.kind !== '2d') throw new Error('reimport should encode as 2D');

    expect(after.rows).toBe(before.rows);
    expect(after.cols).toBe(before.cols);
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
