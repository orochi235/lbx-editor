import { describe, it, expect } from 'vitest';
import {
  fitLengthToContent,
  LENGTH_MARGIN_PT,
  MIN_LABEL_LENGTH_PT,
  MAX_LABEL_LENGTH_PT,
} from './autoLength';

describe('fitLengthToContent', () => {
  it('ends the label a trailing margin past the rightmost content edge', () => {
    expect(fitLengthToContent([{ x: 10, y: 0, width: 30, height: 5 }])).toBe(40 + LENGTH_MARGIN_PT);
  });

  it('takes the furthest right edge, not the last node', () => {
    const poses = [
      { x: 100, y: 0, width: 20, height: 5 },
      { x: 5, y: 0, width: 10, height: 5 },
    ];
    expect(fitLengthToContent(poses)).toBe(120 + LENGTH_MARGIN_PT);
  });

  it('preserves the leading gap — content is not reflowed', () => {
    // Same 30pt-wide object, pushed right: the label grows by the same amount.
    const near = fitLengthToContent([{ x: 10, y: 0, width: 30, height: 5 }]);
    const far = fitLengthToContent([{ x: 60, y: 0, width: 30, height: 5 }]);
    expect(far - near).toBeCloseTo(50, 6);
  });

  it('falls back to the minimum for an empty scene', () => {
    expect(fitLengthToContent([])).toBe(MIN_LABEL_LENGTH_PT);
  });

  it('clamps tiny content up to the minimum', () => {
    expect(fitLengthToContent([{ x: 0, y: 0, width: 1, height: 1 }])).toBe(MIN_LABEL_LENGTH_PT);
  });

  it("clamps down to P-touch's 1000mm auto-length ceiling", () => {
    expect(fitLengthToContent([{ x: 0, y: 0, width: 5000, height: 5 }])).toBe(MAX_LABEL_LENGTH_PT);
  });

  it('ignores negative-x content extending off the left of the tape', () => {
    expect(fitLengthToContent([{ x: -50, y: 0, width: 100, height: 5 }])).toBe(50 + LENGTH_MARGIN_PT);
  });

  it('reproduces the length P-touch recorded for an auto-length label', () => {
    // "Lego icon labels - Tactical Gear.lbx": objects span x 5.5 → 139.8pt, and
    // the file's style:backGround band ends at 139.8pt. P-touch's own computed
    // length is that plus the 5.6pt trailing margin.
    expect(fitLengthToContent([{ x: 5.5, y: 6.3, width: 134.3, height: 23.4 }])).toBeCloseTo(145.4, 6);
  });
});
