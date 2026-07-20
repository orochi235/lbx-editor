import { describe, it, expect } from 'vitest';
import { lineEndpoints } from './label';

describe('lineEndpoints', () => {
  const pose = { x: 10, y: 20, width: 100, height: 40 };

  it('descending line runs top-left to bottom-right', () => {
    expect(lineEndpoints(pose, true)).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 60 },
    ]);
  });

  it('ascending line runs bottom-left to top-right', () => {
    expect(lineEndpoints(pose, false)).toEqual([
      { x: 10, y: 60 },
      { x: 110, y: 20 },
    ]);
  });
});
