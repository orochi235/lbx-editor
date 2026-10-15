import { describe, it, expect } from 'vitest';
import { alignTo, matchSize, unionRect, type Posed } from './arrange';

const a: Posed = { id: 'a', pose: { x: 10, y: 5, width: 20, height: 10 } };
const b: Posed = { id: 'b', pose: { x: 50, y: 30, width: 40, height: 6 } };
const ref = { x: 100, y: 8, width: 60, height: 50 };

describe('unionRect', () => {
  it('spans every pose', () => {
    expect(unionRect([a.pose, b.pose])).toEqual({ x: 10, y: 5, width: 80, height: 31 });
  });

  it('is null for nothing', () => {
    expect(unionRect([])).toBeNull();
  });
});

describe('alignTo', () => {
  it.each([
    ['left', { x: 100, y: 5 }],
    ['center-x', { x: 120, y: 5 }],
    ['right', { x: 140, y: 5 }],
    ['top', { x: 10, y: 8 }],
    ['center-y', { x: 10, y: 28 }],
    ['bottom', { x: 10, y: 48 }],
  ] as const)('%s moves only the matching axis', (edge, xy) => {
    const [moved] = alignTo([a], ref, edge);
    expect(moved!.pose).toEqual({ ...a.pose, ...xy });
  });
});

describe('matchSize', () => {
  it('takes the reference width, keeping the top-left corner', () => {
    const [m] = matchSize([a], ref, 'width');
    expect(m!.pose).toEqual({ x: 10, y: 5, width: 60, height: 10 });
  });

  it('takes the reference height, keeping the top-left corner', () => {
    const [m] = matchSize([b], ref, 'height');
    expect(m!.pose).toEqual({ x: 50, y: 30, width: 40, height: 50 });
  });

  it('takes both', () => {
    const [m] = matchSize([a], ref, 'both');
    expect(m!.pose).toEqual({ x: 10, y: 5, width: 60, height: 50 });
  });
});
