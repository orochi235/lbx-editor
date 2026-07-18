import { describe, expect, it } from 'vitest';
import { buildImageInsert, type PendingImage } from './imageInsert';

const PENDING: PendingImage = {
  src: 'aGVsbG8=',
  originalName: 'logo.png',
  mimeType: 'image/png',
  defaultWidth: 40,
  defaultHeight: 20,
};

describe('buildImageInsert', () => {
  it('rejects the insert when no image has been picked', () => {
    expect(buildImageInsert(null, { x: 0, y: 0, width: 30, height: 30 })).toBeNull();
  });

  it('passes picked-file fields through as app image data', () => {
    const built = buildImageInsert(PENDING, { x: 1, y: 2, width: 40, height: 20 });
    expect(built?.data).toEqual({
      kind: 'image',
      src: 'aGVsbG8=',
      originalName: 'logo.png',
      mimeType: 'image/png',
    });
  });

  it('contain-fits a wide drag box (height is the limiting axis)', () => {
    // aspect 2:1 into an 80x10 box → scale 0.5 → 20x10, anchored at drag origin
    const built = buildImageInsert(PENDING, { x: 5, y: 7, width: 80, height: 10 });
    expect(built?.pose).toEqual({ x: 5, y: 7, width: 20, height: 10 });
  });

  it('contain-fits a tall drag box (width is the limiting axis)', () => {
    // aspect 2:1 into a 20x40 box → scale 0.5 → 20x10
    const built = buildImageInsert(PENDING, { x: 0, y: 0, width: 20, height: 40 });
    expect(built?.pose).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });

  it('drops at the default size for a click-sized drag', () => {
    const built = buildImageInsert(PENDING, { x: 3, y: 4, width: 1, height: 0.5 });
    expect(built?.pose).toEqual({ x: 3, y: 4, width: 40, height: 20 });
  });
});
