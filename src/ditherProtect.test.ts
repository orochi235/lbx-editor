import { describe, it, expect } from 'vitest';
import { protectedRegions } from './ditherProtect';
import { encodeBarcode, barcodeRequest, barcodeModulePt } from './barcode';
import type { LabelBarcodeData, LabelNodeData, LabelPose } from './label';

const GEOMETRY = { band: { y: 10 }, dpi: 180 };
const SCALE = 180 / 72;

const barcode = (over: Partial<LabelBarcodeData> = {}): LabelBarcodeData => ({
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
  ...over,
});

const pose: LabelPose = { x: 20, y: 12, width: 40, height: 20 };

function node(data: LabelNodeData, p: LabelPose = pose) {
  return { pose: p, data };
}

describe('protectedRegions', () => {
  it('maps a barcode pose into dot space, past the band and the quiet zone', () => {
    const symbol = encodeBarcode(barcodeRequest(barcode()));
    if (!symbol.ok) throw new Error('fixture should encode');
    const quiet = symbol.quiet.left * barcodeModulePt(symbol, pose);

    const [rect] = protectedRegions([node(barcode())], GEOMETRY);

    // Dither space starts at the top of the printable band, not the tape.
    // Code 128's quiet zone is horizontal only, so the region is the pose tall.
    expect(rect).toEqual({
      x: (pose.x - quiet) * SCALE,
      y: (pose.y - GEOMETRY.band.y) * SCALE,
      width: (pose.width + quiet * 2) * SCALE,
      height: pose.height * SCALE,
    });
  });

  it('covers the human-readable text as well as the bars', () => {
    // The text sits inside the pose, below the bars. Small type at 180 dpi is
    // no better served by a dither pattern than the bars are.
    const withText = protectedRegions([node(barcode({ humanReadable: true }))], GEOMETRY);
    const withoutText = protectedRegions([node(barcode())], GEOMETRY);

    expect(withText[0]!.height).toBe(withoutText[0]!.height);
  });

  it('protects nothing for a payload that will not encode', () => {
    // It draws as a placeholder box and print refuses it — there's no symbol
    // whose geometry needs preserving.
    // Code 39 has no '@' in its alphabet (and uppercases what it can).
    expect(protectedRegions([node(barcode({ data: 'a@b', protocol: 'CODE39' }))], GEOMETRY))
      .toEqual([]);
  });

  const text: LabelNodeData = {
    kind: 'text',
    text: 'Shelf A',
    fontFamily: 'Inter',
    fontSize: 10,
    fontWeight: 400,
    italic: false,
    horizontalAlignment: 'LEFT',
    verticalAlignment: 'TOP',
    color: '#000',
  };
  const image: LabelNodeData = { kind: 'image', src: '', originalName: 'photo.png', mimeType: 'image/png' };

  it('leaves images to the dither by default, since tone is what it is for', () => {
    expect(protectedRegions([node(image)], GEOMETRY)).toEqual([]);
  });

  it('protects text by default, as its pose box', () => {
    expect(protectedRegions([node(text)], GEOMETRY)).toEqual([{
      x: pose.x * SCALE,
      y: (pose.y - GEOMETRY.band.y) * SCALE,
      width: pose.width * SCALE,
      height: pose.height * SCALE,
    }]);
  });

  it('widens a stroked shape by half its stroke, which lies outside the pose', () => {
    const rect: LabelNodeData = {
      kind: 'rect', rounded: false, roundness: 0, strokeStyle: '#000', strokeWidth: 2, fillColor: null,
    };
    const [region] = protectedRegions([node(rect)], GEOMETRY);
    expect(region!.x).toBeCloseTo((pose.x - 1) * SCALE);
    expect(region!.width).toBeCloseTo((pose.width + 2) * SCALE);
  });

  it('follows the per-object flag either way', () => {
    expect(protectedRegions([node({ ...text, noDither: false })], GEOMETRY)).toEqual([]);
    expect(protectedRegions([node({ ...image, noDither: true })], GEOMETRY)).toHaveLength(1);
  });

  it('returns one region per barcode', () => {
    const regions = protectedRegions(
      [node(barcode()), node(barcode({ data: 'OTHER' }), { ...pose, x: 100 })],
      GEOMETRY,
    );

    expect(regions).toHaveLength(2);
    expect(regions[1]!.x).toBeGreaterThan(regions[0]!.x);
  });

  it('gives a 2D symbol the tighter quiet zone its spec asks for', () => {
    const qr = barcode({ protocol: 'QRCODE', data: 'https://example.com' });
    const symbol = encodeBarcode(barcodeRequest(qr));
    if (!symbol.ok) throw new Error('fixture should encode');

    const [rect] = protectedRegions([node(qr)], GEOMETRY);
    const pad = (pose.x - rect!.x / SCALE) / barcodeModulePt(symbol, pose);

    expect(pad).toBeCloseTo(4, 6);
  });
});
