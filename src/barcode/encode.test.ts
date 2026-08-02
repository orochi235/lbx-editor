import { describe, it, expect } from 'vitest';
import type { BarcodeProtocol } from 'bil-lbx';
import { encodeBarcode, parseRatio, SUPPORTED_PROTOCOLS, isSupportedProtocol } from './encode';

/** Every protocol .lbx can carry. */
const ALL_PROTOCOLS: BarcodeProtocol[] = [
  'CODE39', 'CODE128', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF',
  'CODABAR', 'QRCODE', 'DATAMATRIX', 'PDF417', 'MAXICODE', 'GS1-128', 'GS1DATABAR', 'RSS',
];

describe('SUPPORTED_PROTOCOLS', () => {
  // A protocol the dispatcher handles rejects a bad payload as 'invalid'; one
  // it doesn't handle falls through to 'unsupported'. So probing with a single
  // payload separates the two regardless of whether it happens to be valid.
  it.each(ALL_PROTOCOLS)('agrees with the dispatcher about %s', (protocol) => {
    const result = encodeBarcode({ protocol, data: '12345670' });
    const dispatcherHandlesIt = result.ok || result.reason !== 'unsupported';
    expect(dispatcherHandlesIt).toBe(isSupportedProtocol(protocol));
  });

  it('lists only protocols .lbx can carry, without duplicates', () => {
    expect(new Set(SUPPORTED_PROTOCOLS).size).toBe(SUPPORTED_PROTOCOLS.length);
    for (const p of SUPPORTED_PROTOCOLS) expect(ALL_PROTOCOLS).toContain(p);
  });
});

describe('1D symbols measure their bars, not their margins', () => {
  // `barcodeModulePt` is `pose.width / totalModules`, so the pose means
  // whatever `totalModules` counts. A P-touch-authored file settles which it
  // is: with `margin="false"` — what we always export — P-touch's object box
  // is the bars alone. So every 1D encoder has to report the same thing, and
  // the quiet zone lives outside the pose, in `quietZonePt`, for all of them.
  //
  // The EAN family used to bake 9 quiet modules into each end, which made its
  // modules ~19% narrower than the pose said and double-counted the quiet zone
  // in the drawn background and the dither-protected region.
  const PAYLOADS: Array<[BarcodeProtocol, string]> = [
    ['CODE128', '1337'],
    ['GS1-128', '0112345678901231'],
    ['CODE39', 'ABC123'],
    ['ITF', '123456'],
    ['CODABAR', 'A1234B'],
    ['EAN13', '5901234123457'],
    ['EAN8', '96385074'],
    ['UPCA', '036000291452'],
    ['UPCE', '04252614'],
  ];

  it.each(PAYLOADS)('%s spans exactly [0, totalModules]', (protocol, data) => {
    const result = encodeBarcode({ protocol, data });
    expect(result.ok).toBe(true);
    if (!result.ok || result.kind !== '1d') throw new Error('expected a 1D symbol');

    const firstBarStarts = Math.min(...result.bars.map((b) => b.x));
    const lastBarEnds = Math.max(...result.bars.map((b) => b.x + b.width));
    expect(firstBarStarts).toBe(0);
    expect(lastBarEnds).toBe(result.totalModules);
  });
});

describe('every symbology states the quiet zone its standard asks for', () => {
  // These numbers are the whole point of `Symbol*.quiet`, and TypeScript only
  // enforces that the field exists, not that it is sane -- an encoder could
  // ship `horizontalQuiet(0, 0)` and every other test here would still pass.
  // Cross-checked against BWIPP's per-symbology `borderleft`/`borderright`
  // defaults in `node_modules/bwip-js/barcode.ps`, which agrees on all of
  // these except UPC-E, where it rounds the right margin up to UPC-A's 9.
  const QUIET: Array<[BarcodeProtocol, string, number, number]> = [
    ['CODE128', '1337', 10, 10],
    ['GS1-128', '0112345678901231', 10, 10],
    ['CODE39', 'ABC123', 10, 10],
    ['ITF', '123456', 10, 10],
    ['CODABAR', 'A1234B', 10, 10],
    ['EAN13', '5901234123457', 11, 7],
    ['EAN8', '96385074', 7, 7],
    ['UPCA', '036000291452', 9, 9],
    ['UPCE', '04252614', 9, 7],
  ];

  it.each(QUIET)('%s asks for %i modules left and %i right', (protocol, data, left, right) => {
    const result = encodeBarcode({ protocol, data });
    if (!result.ok) throw new Error(`expected ${protocol} to encode`);
    expect(result.quiet).toEqual({ left, right, top: 0, bottom: 0 });
  });

  it('gives QR the 4 cells its standard specifies, on all four sides', () => {
    const result = encodeBarcode({ protocol: 'QRCODE', data: '12345678' });
    if (!result.ok) throw new Error('expected QRCODE to encode');
    expect(result.quiet).toEqual({ left: 4, right: 4, top: 4, bottom: 4 });
  });
});

describe('encodeBarcode', () => {
  it('reports unsupported protocols instead of throwing', () => {
    const result = encodeBarcode({ protocol: 'MAXICODE', data: '123' });
    expect(result).toEqual({ ok: false, reason: 'unsupported', detail: 'MAXICODE' });
  });

  it('encodes a DataMatrix through the dispatcher', () => {
    const result = encodeBarcode({ protocol: 'DATAMATRIX', data: '12345678' });
    if (!result.ok) throw new Error(`expected DATAMATRIX to encode: ${result.detail}`);
    expect(result.kind).toBe('2d');
  });

  it('encodes a PDF417 through the dispatcher', () => {
    const result = encodeBarcode({ protocol: 'PDF417', data: '12345678' });
    if (!result.ok) throw new Error(`expected PDF417 to encode: ${result.detail}`);
    expect(result.kind).toBe('2d');
  });

  it('passes an explicit PDF417 layout through from the file', () => {
    const result = encodeBarcode({
      protocol: 'PDF417',
      data: '12345678',
      pdf417: { column: '2', row: '7', aspect: 3 },
    });
    if (!result.ok || result.kind !== '2d') throw new Error('expected a 2D symbol');
    // 17 * (2 + 4) + 1 -- the two stated data columns plus the two row
    // indicators, the start and stop patterns, and the closing bar.
    expect(result.cols).toBe(103);
    // Not 7. Alongside `columns`, `rows` is a *floor*: this payload needs 9
    // rows at 2 columns, so the symbol grows past the stated 7 rather than
    // failing -- BWIPP's behavior, and what a file whose text has since been
    // edited needs.
    expect(result.rows).toBe(9);
    expect(result.rowHeightModules).toBe(3);
  });

  it('honors a PDF417 error correction level of 0, which is a level and not an absence', () => {
    const stated = encodeBarcode({
      protocol: 'PDF417',
      data: '12345678',
      pdf417: { column: '4', eccLevel: '0' },
    });
    const auto = encodeBarcode({
      protocol: 'PDF417',
      data: '12345678',
      pdf417: { column: '4', eccLevel: 'auto' },
    });
    if (!stated.ok || stated.kind !== '2d') throw new Error('expected a 2D symbol');
    if (!auto.ok || auto.kind !== '2d') throw new Error('expected a 2D symbol');
    // Level 0 asks for 2 ECC codewords where the recommendation for this
    // payload is 8, and the symbol is a row shorter for it. If `eccLevel: 0`
    // were dropped as falsy the two would come out identical.
    expect(stated.rows).toBeLessThan(auto.rows);
  });

  it('reports invalid payloads', () => {
    const result = encodeBarcode({ protocol: 'EAN13', data: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid');
  });
});

describe('parseRatio', () => {
  it('reads the wide element width out of a "1:N" ratio', () => {
    expect(parseRatio('1:3')).toBe(3);
    expect(parseRatio('1:2')).toBe(2);
  });

  it('defaults to 1:3 when absent or out of range', () => {
    expect(parseRatio(undefined)).toBe(3);
    expect(parseRatio('garbage')).toBe(3);
    expect(parseRatio('1:9')).toBe(3);
  });
});
