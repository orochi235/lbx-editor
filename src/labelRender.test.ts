import { describe, it, expect } from 'vitest';
import { labelRenderPlan, printableBandPt } from './labelRender';

// PT-P710BT-like geometry: 180 dpi, 24mm tape = 68pt, 128 printable dots.
const GEOM = { labelLengthPt: 144, tapeWidthPt: 68, printableDots: 128, dpi: 180 };

describe('printableBandPt', () => {
  it('centers the printable dots (as points) in the tape width', () => {
    const band = printableBandPt(GEOM);
    expect(band.height).toBeCloseTo(128 * (72 / 180), 10); // 51.2 pt
    expect(band.y).toBeCloseTo((68 - 51.2) / 2, 10); // 8.4 pt margins
  });
});

describe('labelRenderPlan', () => {
  it('scales both axes by dots-per-point (dpi/72) — no distortion', () => {
    const plan = labelRenderPlan(GEOM);
    expect(plan.scale.x).toBeCloseTo(2.5, 10);
    expect(plan.scale.y).toBe(plan.scale.x);
  });

  it('renders the centered printable band, landing on exactly printableDots', () => {
    const plan = labelRenderPlan(GEOM);
    expect(plan.sourceRect.x).toBe(0);
    expect(plan.sourceRect.width).toBe(144);
    expect(plan.sourceRect.y).toBeCloseTo(8.4, 10);
    expect(plan.sourceRect.height).toBeCloseTo(51.2, 10);
    expect(Math.round(plan.sourceRect.height * plan.scale.y)).toBe(GEOM.printableDots);
  });

  it('prints on a white background', () => {
    const plan = labelRenderPlan(GEOM);
    expect(plan.background).toBe('#ffffff');
  });
});
