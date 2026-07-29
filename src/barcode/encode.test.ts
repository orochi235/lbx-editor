import { describe, it, expect } from 'vitest';
import type { BarcodeProtocol } from 'bil-lbx';
import { encodeBarcode, parseRatio, SUPPORTED_PROTOCOLS, isSupportedProtocol } from './encode';

/** Every protocol .lbx can carry. */
const ALL_PROTOCOLS: BarcodeProtocol[] = [
  'CODE39', 'CODE128', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'ITF',
  'CODABAR', 'QRCODE', 'DATAMATRIX', 'PDF417', 'MAXICODE', 'GS1-128', 'GS1DATABAR',
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

describe('encodeBarcode', () => {
  it('reports unsupported protocols instead of throwing', () => {
    const result = encodeBarcode({ protocol: 'MAXICODE', data: '123' });
    expect(result).toEqual({ ok: false, reason: 'unsupported', detail: 'MAXICODE' });
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
