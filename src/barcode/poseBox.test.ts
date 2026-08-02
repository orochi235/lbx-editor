import { describe, it, expect } from 'vitest';
import { symbolPoseFromBox, boxFromSymbolPose, POSE_QUIET_MODULES_2D } from './poseBox';

describe('2D pose <-> P-touch object box', () => {
  it('strips the 2 modules per side that P-touch bakes into the box', () => {
    // barcodes.lbx: a 21-module QR at cellSize 1.6pt sits in a 40pt box.
    // 40 / 1.6 = 25 = 21 + 2 per side.
    const pose = symbolPoseFromBox({ x: 100, y: 50, width: 40, height: 40 }, 1.6);
    expect(pose.width).toBeCloseTo(33.6, 6); // 21 * 1.6
    expect(pose.height).toBeCloseTo(33.6, 6);
    expect(pose.x).toBeCloseTo(103.2, 6); // inset by 2 * 1.6
    expect(pose.y).toBeCloseTo(53.2, 6);
  });

  it('round-trips a box through the pose and back', () => {
    const box = { x: 5.6, y: 8.4, width: 25.6, height: 25.6 };
    const back = boxFromSymbolPose(symbolPoseFromBox(box, 1.6), 1.6);
    expect(back.x).toBeCloseTo(box.x, 6);
    expect(back.y).toBeCloseTo(box.y, 6);
    expect(back.width).toBeCloseTo(box.width, 6);
    expect(back.height).toBeCloseTo(box.height, 6);
  });

  it('leaves the box alone when the file states no module size', () => {
    const box = { x: 1, y: 2, width: 30, height: 40 };
    expect(symbolPoseFromBox(box, undefined)).toEqual(box);
  });

  it('refuses to invert a box smaller than its own quiet zone', () => {
    // 4 modules of 10pt is 40pt of margin in a 30pt box. Shrinking would give a
    // negative width, so the box is returned untouched.
    const box = { x: 0, y: 0, width: 30, height: 30 };
    expect(symbolPoseFromBox(box, 10)).toEqual(box);
  });

  it("keeps the module size the pose implies equal to the file's", () => {
    // The point of the conversion: a 12-module DataMatrix at 1.6pt in P-touch's
    // 25.6pt box must come out as a pose 12 modules wide.
    const pose = symbolPoseFromBox({ x: 0, y: 0, width: 25.6, height: 25.6 }, 1.6);
    expect(pose.width / 12).toBeCloseTo(1.6, 6);
  });
});

it('exports the measured constant', () => {
  expect(POSE_QUIET_MODULES_2D).toBe(2);
});
