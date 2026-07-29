import { describe, it, expect } from 'vitest';
import {
  fitLengthToContent,
  fitExtentToContent,
  rebaseShift,
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

describe('fitExtentToContent', () => {
  it('matches the committed fit when all content is non-negative', () => {
    // The drift guard: the live extent and the committed fit must agree on
    // every document that has been through a rebase (i.e. every saved one).
    const poses = [
      { x: 10, y: 0, width: 30, height: 5 },
      { x: 80, y: 0, width: 20, height: 5 },
    ];
    const extent = fitExtentToContent(poses);
    expect(extent.originX).toBe(0);
    expect(extent.length).toBe(fitLengthToContent(poses));
  });

  it('extends the head by a margin when content crosses zero', () => {
    // Content spans -20 → 40, so the label runs -25.6 → 45.6.
    const extent = fitExtentToContent([{ x: -20, y: 0, width: 60, height: 5 }]);
    expect(extent.originX).toBe(-20 - LENGTH_MARGIN_PT);
    expect(extent.length).toBeCloseTo(60 + LENGTH_MARGIN_PT * 2, 6);
  });

  it('takes the furthest edge on each side, not the last node', () => {
    const poses = [
      { x: 100, y: 0, width: 20, height: 5 },
      { x: -30, y: 0, width: 10, height: 5 },
      { x: 5, y: 0, width: 10, height: 5 },
    ];
    const extent = fitExtentToContent(poses);
    expect(extent.originX).toBe(-30 - LENGTH_MARGIN_PT);
    expect(extent.length).toBeCloseTo(150 + LENGTH_MARGIN_PT * 2, 6);
  });

  it('keeps the head at zero for content entirely right of the origin', () => {
    expect(fitExtentToContent([{ x: 50, y: 0, width: 10, height: 5 }]).originX).toBe(0);
  });

  it('handles content entirely left of the origin', () => {
    const extent = fitExtentToContent([{ x: -80, y: 0, width: 20, height: 5 }]);
    expect(extent.originX).toBe(-80 - LENGTH_MARGIN_PT);
    // Tail still stops at the origin — the label never ends left of x=0.
    expect(extent.length).toBeCloseTo(80 + LENGTH_MARGIN_PT * 2, 6);
  });

  it('falls back to the minimum for an empty scene', () => {
    expect(fitExtentToContent([])).toEqual({ originX: 0, length: MIN_LABEL_LENGTH_PT });
  });

  it('clamps the tail, not the head, at the 1000mm ceiling', () => {
    const extent = fitExtentToContent([{ x: -10, y: 0, width: 5000, height: 5 }]);
    expect(extent.originX).toBe(-10 - LENGTH_MARGIN_PT);
    expect(extent.length).toBe(MAX_LABEL_LENGTH_PT);
  });
});

describe('rebaseShift', () => {
  it('is zero for a label already at the origin', () => {
    expect(rebaseShift(0)).toBe(0);
  });

  it('shifts right by the overhang', () => {
    expect(rebaseShift(-25.6)).toBeCloseTo(25.6, 6);
  });

  it('lands the leftmost object exactly on the leading margin', () => {
    const poses = [{ x: -20, y: 0, width: 60, height: 5 }];
    const s = rebaseShift(fitExtentToContent(poses).originX);
    const shifted = poses.map((p) => ({ ...p, x: p.x + s }));
    expect(Math.min(...shifted.map((p) => p.x))).toBeCloseTo(LENGTH_MARGIN_PT, 6);
  });

  it('preserves the on-screen length across the rebase', () => {
    // What was displayed mid-drag must be what commits — otherwise the label
    // visibly jumps at the moment of release.
    const poses = [
      { x: -20, y: 0, width: 60, height: 5 },
      { x: 90, y: 0, width: 10, height: 5 },
    ];
    const live = fitExtentToContent(poses);
    const s = rebaseShift(live.originX);
    const shifted = poses.map((p) => ({ ...p, x: p.x + s }));
    expect(fitLengthToContent(shifted)).toBeCloseTo(live.length, 6);
    expect(fitExtentToContent(shifted).originX).toBe(0);
  });
});
