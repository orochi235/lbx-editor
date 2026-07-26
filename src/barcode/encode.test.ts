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
