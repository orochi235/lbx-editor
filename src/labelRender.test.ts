import { describe, it, expect } from 'vitest';
import { labelRenderPlan } from './labelRender';

// PT-P710BT-like geometry: 180 dpi, 24mm tape = 68pt, 128 printable dots.
const GEOM = { labelLengthPt: 144, tapeWidthPt: 68, printableDots: 128, dpi: 180 };

describe('labelRenderPlan', () => {
  it('scales x by dots-per-point (dpi/72)', () => {
    const plan = labelRenderPlan(GEOM);
    expect(plan.scale.x).toBeCloseTo(2.5, 10);
  });

  it('squeezes y so the full tape height lands on printableDots', () => {
    const plan = labelRenderPlan(GEOM);
    expect(plan.scale.y).toBeCloseTo(128 / 68, 10);
    // The invariant the squeeze exists for: output height rounds to exactly
    // printableDots, so no node near the tape edge is ever clipped.
    expect(Math.round(GEOM.tapeWidthPt * plan.scale.y)).toBe(GEOM.printableDots);
  });

  it('renders the full label rect from the scene origin', () => {
    const plan = labelRenderPlan(GEOM);
    expect(plan.sourceRect).toEqual({ x: 0, y: 0, width: 144, height: 68 });
  });

  it('prints on a white background', () => {
    const plan = labelRenderPlan(GEOM);
    expect(plan.background).toBe('#ffffff');
  });

  it('guards the degenerate zero-height tape (no divide-by-zero)', () => {
    const plan = labelRenderPlan({ ...GEOM, tapeWidthPt: 0 });
    expect(Number.isFinite(plan.scale.y)).toBe(true);
  });
});
