import { describe, it, expect } from 'vitest';
import { encodeBarcode, parseRatio } from './encode';

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
